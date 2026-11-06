// DSP mathematics adapted from the original Apple Music HiFi DSP.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
// 滤波器数学（RBJ Audio EQ Cookbook）、频响计算、AutoEQ / Equalizer APO 解析与内置预设。

const FILTER_TYPES = {
  PK: { label: '峰值 PK', gain: true },
  LSC: { label: '低架 LS', gain: true },
  HSC: { label: '高架 HS', gain: true },
  LPQ: { label: '低通 LP', gain: false },
  HPQ: { label: '高通 HP', gain: false },
  NO: { label: '陷波 Notch', gain: false },
  BP: { label: '带通 BP', gain: false }
};

const SHELF_Q = Math.SQRT1_2; // Web Audio 的 lowshelf/highshelf 固定斜率 S=1，等价 Q=0.7071
const EQ_LIMITS = { fcMin: 10, fcMax: 22000, gainMin: -24, gainMax: 24, qMin: 0.1, qMax: 24, maxFilters: 24 };

function sanitizeFilter(f) {
  f = f && typeof f === 'object' ? f : {};
  const type = FILTER_TYPES[f && f.type] ? f.type : 'PK';
  return {
    type,
    fc: clamp(finite(Number(f && f.fc), 1000), EQ_LIMITS.fcMin, EQ_LIMITS.fcMax),
    gain: FILTER_TYPES[type].gain ? clamp(finite(Number(f && f.gain), 0), EQ_LIMITS.gainMin, EQ_LIMITS.gainMax) : 0,
    q: clamp(finite(Number(f && f.q), type === 'LSC' || type === 'HSC' ? SHELF_Q : 1), EQ_LIMITS.qMin, EQ_LIMITS.qMax),
    on: !(f && f.on === false)
  };
}

// RBJ 双二阶系数（已按 a0 归一化）
function biquadCoeffs(f, fs) {
  const fc = Math.min(f.fc, fs * 0.4995);
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * f.q);
  const A = Math.pow(10, f.gain / 40);
  const sqA2a = 2 * Math.sqrt(A) * alpha;
  let b0, b1, b2, a0, a1, a2;
  switch (f.type) {
    case 'LSC':
      b0 = A * (A + 1 - (A - 1) * cos + sqA2a);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sqA2a);
      a0 = A + 1 + (A - 1) * cos + sqA2a;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sqA2a;
      break;
    case 'HSC':
      b0 = A * (A + 1 + (A - 1) * cos + sqA2a);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sqA2a);
      a0 = A + 1 - (A - 1) * cos + sqA2a;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sqA2a;
      break;
    case 'LPQ':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'HPQ':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'NO':
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'BP':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    default: // PK
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function magnitudeDb(c, freq, fs) {
  const w = (2 * Math.PI * freq) / fs;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
  const ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2;
  const di = -(c.a1 * s1 + c.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) || 1e-30);
}

function logFreqs(n, lo = 20, hi = 20000) {
  const out = new Float64Array(n);
  const r = Math.log(hi / lo);
  for (let i = 0; i < n; i++) out[i] = lo * Math.exp((r * i) / (n - 1));
  return out;
}

const CURVE_FREQS = logFreqs(512);

// 每个滤波器各自的频响 + 总频响（dB）
function eqResponse(filters, fs, freqs = CURVE_FREQS) {
  const total = new Float64Array(freqs.length);
  const each = [];
  for (const f of filters) {
    const c = biquadCoeffs(f, fs);
    const arr = new Float64Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      arr[i] = magnitudeDb(c, freqs[i], fs);
      if (f.on) total[i] += arr[i];
    }
    each.push(arr);
  }
  return { total, each };
}

// 曲线最大提升量，用于自动防削波前级
function eqMaxBoost(filters, fs) {
  const active = filters.filter((f) => f.on);
  if (!active.length) return 0;
  const freqs = Array.from(CURVE_FREQS);
  for (const f of active) if (f.fc >= 20 && f.fc <= 20000) freqs.push(f.fc);
  const coeffs = active.map((f) => biquadCoeffs(f, fs));
  let max = -Infinity;
  for (const fr of freqs) {
    let sum = 0;
    for (const c of coeffs) sum += magnitudeDb(c, fr, fs);
    if (sum > max) max = sum;
  }
  return Math.max(0, max);
}

// ── AutoEQ / Equalizer APO ParametricEQ.txt ──
const APO_TYPE_MAP = {
  PK: 'PK', PEQ: 'PK', MODAL: 'PK',
  LS: 'LSC', LSC: 'LSC', LSQ: 'LSC', LOWSHELF: 'LSC',
  HS: 'HSC', HSC: 'HSC', HSQ: 'HSC', HIGHSHELF: 'HSC',
  LP: 'LPQ', LPQ: 'LPQ', HP: 'HPQ', HPQ: 'HPQ',
  NO: 'NO', NOTCH: 'NO', BP: 'BP'
};

function parseApo(text) {
  if (typeof text !== 'string' || text.length > 131072) return { preamp: null, filters: [], errors: ['参数文件无效或超过 128 KB。'] };
  const filters = [];
  const errors = [];
  let preamp = null;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    let m = line.match(/^preamp\s*:\s*([-+]?\d+(?:\.\d+)?)\s*db\s*$/i);
    if (m) {
      preamp = (preamp || 0) + Number(m[1]);
      return;
    }
    if (/^preamp\s*:/i.test(line)) { errors.push(`第 ${idx + 1} 行：无效的前级增益`); return; }
    if (/^graphiceq\s*:/i.test(line)) {
      errors.push(`第 ${idx + 1} 行：GraphicEQ 格式暂不支持，请改用 ParametricEQ.txt`);
      return;
    }
    m = line.match(/^filter\s*\d*\s*:\s*(on|off)\s+([a-z]+)(.*)$/i);
    if (!m) {
      if (/^(filter|include|channel|copy|convolution)\b/i.test(line)) errors.push(`第 ${idx + 1} 行：不支持的参数语句`);
      return;
    }
    const type = APO_TYPE_MAP[m[2].toUpperCase()];
    if (!type) {
      errors.push(`第 ${idx + 1} 行：不支持的滤波器类型 ${m[2]}`);
      return;
    }
    const rest = m[3];
    const fc = rest.match(/fc\s+([\d.]+)\s*hz/i);
    if (!fc) {
      errors.push(`第 ${idx + 1} 行：缺少 Fc`);
      return;
    }
    const gain = rest.match(/gain\s+([-+]?[\d.]+)\s*db/i);
    const q = rest.match(/\bq\s+([\d.]+)/i);
    const bw = rest.match(/bw\s+oct\s+([\d.]+)/i);
    if ((/\bq\s+/i.test(rest) && !q) || (/\bgain\s+/i.test(rest) && !gain)) { errors.push(`第 ${idx + 1} 行：增益或 Q 格式无效`); return; }
    if (!Number.isFinite(Number(fc[1])) || Number(fc[1]) <= 0 || (gain && !Number.isFinite(Number(gain[1]))) ||
        (q && (!Number.isFinite(Number(q[1])) || Number(q[1]) <= 0)) ||
        (bw && (!Number.isFinite(Number(bw[1])) || Number(bw[1]) <= 0))) {
      errors.push(`第 ${idx + 1} 行：频率、增益或 Q 数值无效`); return;
    }
    if (FILTER_TYPES[type].gain && !gain) { errors.push(`第 ${idx + 1} 行：缺少 Gain`); return; }
    let qv = q ? Number(q[1]) : null;
    if (qv === null && bw) {
      const p = Math.pow(2, Number(bw[1]));
      qv = Math.sqrt(p) / (p - 1);
    }
    if (qv === null) qv = type === 'PK' ? 1.41 : SHELF_Q;
    filters.push(sanitizeFilter({ type, fc: Number(fc[1]), gain: gain ? Number(gain[1]) : 0, q: qv, on: m[1].toUpperCase() === 'ON' }));
  });
  if (filters.length > EQ_LIMITS.maxFilters) {
    errors.push(`滤波器数量超过 ${EQ_LIMITS.maxFilters} 个，已截断`);
    filters.length = EQ_LIMITS.maxFilters;
  }
  return { preamp, filters, errors };
}

function toApo(filters, preamp) {
  const lines = [`Preamp: ${finite(Number(preamp), 0).toFixed(3)} dB`];
  filters.forEach((f, i) => {
    f = sanitizeFilter(f);
    const gain = FILTER_TYPES[f.type].gain ? ` Gain ${f.gain.toFixed(3)} dB` : '';
    lines.push(`Filter ${i + 1}: ${f.on ? 'ON' : 'OFF'} ${f.type} Fc ${f.fc.toFixed(3)} Hz${gain} Q ${f.q.toFixed(6)}`);
  });
  return lines.join('\r\n') + '\r\n';
}

// ── 内置预设 ──
const GRAPHIC_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const graphic = (gains) => gains.map((g, i) => ({ type: 'PK', fc: GRAPHIC_FREQS[i], gain: g, q: 1.41, on: true }));

const BUILTIN_PRESETS = {
  '平直 Flat': { filters: [] },
  '10 段图示 EQ（全 0）': { filters: graphic([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
  '低音增强 Bass': { filters: [{ type: 'LSC', fc: 105, gain: 5, q: SHELF_Q, on: true }] },
  '高音增强 Treble': { filters: [{ type: 'HSC', fc: 8000, gain: 4, q: SHELF_Q, on: true }] },
  '人声 Vocal': {
    filters: [
      { type: 'PK', fc: 250, gain: -2, q: 1, on: true },
      { type: 'PK', fc: 2500, gain: 3, q: 1, on: true },
      { type: 'PK', fc: 5000, gain: 1.5, q: 1.2, on: true }
    ]
  },
  'V 型 V-Shape': {
    filters: [
      { type: 'LSC', fc: 80, gain: 5, q: SHELF_Q, on: true },
      { type: 'PK', fc: 1500, gain: -2.5, q: 0.7, on: true },
      { type: 'HSC', fc: 9000, gain: 4, q: SHELF_Q, on: true }
    ]
  },
  '低音量响度补偿 Loudness': {
    filters: [
      { type: 'LSC', fc: 90, gain: 6, q: SHELF_Q, on: true },
      { type: 'HSC', fc: 10000, gain: 3, q: SHELF_Q, on: true }
    ]
  },
  '摇滚 Rock': { filters: graphic([4.5, 3.5, 2, 0.5, -1, -1, 0.5, 2.5, 3.5, 4]) },
  '流行 Pop': { filters: graphic([-1, 0, 2, 3.5, 4, 3, 1.5, 0, -0.5, -1]) },
  '爵士 Jazz': { filters: graphic([3, 2, 1, 2, -1.5, -1.5, 0, 1, 2.5, 3]) },
  '古典 Classical': { filters: graphic([4, 3, 2, 1.5, -1, -1, 0, 2, 3, 3.5]) },
  '电子 Electronic': { filters: graphic([4.5, 4, 1, 0, -2, 2, 1, 1.5, 4, 4.5]) }
};

const CROSSFEED_PRESETS = {
  'bs2b 默认（700 Hz / 4.5 dB）': { cutoff: 700, feed: 4.5 },
  'Chu Moy（700 Hz / 6 dB）': { cutoff: 700, feed: 6 },
  'Jan Meier（650 Hz / 9.5 dB）': { cutoff: 650, feed: 9.5 }
};

export { FILTER_TYPES, SHELF_Q, EQ_LIMITS, sanitizeFilter, biquadCoeffs, magnitudeDb, logFreqs, CURVE_FREQS, eqResponse, eqMaxBoost, parseApo, toApo, GRAPHIC_FREQS, graphic, BUILTIN_PRESETS, CROSSFEED_PRESETS };
