// AudioWorklet 处理器（同源模块加载到 AudioWorkletGlobalScope）。
// amhifi-limiter：前视（lookahead）砖墙限幅器，未触发时输出 = 延迟后的输入 × 1.0（逐位一致）
// amhifi-meter  ：ITU-R BS.1770 K 加权响度、4× 过采样真峰值、峰值/RMS、相关度、削波计数

class AmHifiLimiter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.D = Math.max(16, Math.round(sampleRate * 0.0015)); // 1.5 ms 前视
    this.ceiling = typeof o.ceiling === 'number' ? o.ceiling : 0.891;
    this.setRelease(typeof o.releaseMs === 'number' ? o.releaseMs : 80);
    const D = this.D;
    this.dl = [new Float32Array(D), new Float32Array(D)];
    this.dpos = 0;
    // 单调队列：窗口 [n-D, n] 内的最小所需增益
    this.cap = D + 2;
    this.qv = new Float64Array(this.cap);
    this.qi = new Float64Array(this.cap);
    this.qh = 0;
    this.qt = 0;
    this.qn = 0;
    // 长度 D+1 的滑动平均（保证增益曲线平滑且永远不晚于峰值到达）
    this.box = new Float64Array(D + 1).fill(1);
    this.boxSum = D + 1;
    this.boxPos = 0;
    this.g = 1;
    this.n = 0;
    this.minG = 1;
    this.reportEvery = Math.round(sampleRate / 20);
    this.reportCnt = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.ceiling === 'number') this.ceiling = d.ceiling;
      if (typeof d.releaseMs === 'number') this.setRelease(d.releaseMs);
    };
  }

  setRelease(ms) {
    this.rel = Math.exp(-1 / (Math.max(5, ms) * 0.001 * sampleRate));
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const frames = oL.length;
    const hasIn = inp && inp.length > 0;
    const L = hasIn ? inp[0] : null;
    const R = hasIn ? inp[1] || inp[0] : null;
    const D = this.D;
    const cap = this.cap;
    const N = D + 1;
    const dlL = this.dl[0];
    const dlR = this.dl[1];
    const ceiling = this.ceiling;
    let g = this.g;
    let minG = this.minG;

    for (let i = 0; i < frames; i++) {
      const xl = hasIn ? L[i] : 0;
      const xr = hasIn ? R[i] : 0;
      const al = xl < 0 ? -xl : xl;
      const ar = xr < 0 ? -xr : xr;
      const pk = al > ar ? al : ar;
      const req = pk > ceiling ? ceiling / pk : 1;
      const n = this.n++;

      while (this.qn > 0) {
        const last = (this.qt - 1 + cap) % cap;
        if (this.qv[last] >= req) {
          this.qt = last;
          this.qn--;
        } else break;
      }
      this.qv[this.qt] = req;
      this.qi[this.qt] = n;
      this.qt = (this.qt + 1) % cap;
      this.qn++;
      while (this.qn > 0 && this.qi[this.qh] < n - D) {
        this.qh = (this.qh + 1) % cap;
        this.qn--;
      }
      const wmin = this.qv[this.qh];

      this.boxSum += wmin - this.box[this.boxPos];
      this.box[this.boxPos] = wmin;
      this.boxPos = (this.boxPos + 1) % N;
      let avg = this.boxSum / N;
      if (avg > 1) avg = 1;

      if (avg < g) g = avg;
      else g = avg - (avg - g) * this.rel;
      if (g < minG) minG = g;

      const yl = dlL[this.dpos];
      const yr = dlR[this.dpos];
      dlL[this.dpos] = xl;
      dlR[this.dpos] = xr;
      this.dpos = this.dpos + 1 === D ? 0 : this.dpos + 1;

      if (g === 1) {
        oL[i] = yl;
        if (oR !== oL) oR[i] = yr;
      } else {
        oL[i] = yl * g;
        if (oR !== oL) oR[i] = yr * g;
      }
    }

    // 定期重算滑动和，消除浮点累积误差
    if ((this.n & 0xffff) < frames) {
      let sum = 0;
      for (let k = 0; k < N; k++) sum += this.box[k];
      this.boxSum = sum;
    }

    this.g = g;
    this.minG = minG;
    this.reportCnt += frames;
    if (this.reportCnt >= this.reportEvery) {
      this.port.postMessage({ gr: this.minG });
      this.reportCnt = 0;
      this.minG = 1;
    }
    return true;
  }
}

// 4× 过采样多相 FIR（48 taps，Kaiser 窗 sinc），用于真峰值估计
function makeTruePeakTaps() {
  const P = 4;
  const T = 12;
  const N = P * T;
  const beta = 7;
  const i0 = (x) => {
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 32; k++) {
      term *= (x / 2 / k) * (x / 2 / k);
      sum += term;
    }
    return sum;
  };
  const h = new Float64Array(N);
  const mid = (N - 1) / 2;
  for (let k = 0; k < N; k++) {
    const t = (k - mid) / P;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = (2 * k) / (N - 1) - 1;
    h[k] = sinc * (i0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0(beta));
  }
  const phases = [];
  for (let p = 0; p < P; p++) {
    const taps = new Float64Array(T);
    let sum = 0;
    for (let j = 0; j < T; j++) {
      taps[j] = h[p + P * j];
      sum += taps[j];
    }
    for (let j = 0; j < T; j++) taps[j] /= sum;
    phases.push(taps);
  }
  return phases;
}

// libebur128 的 K 加权系数（适用于任意采样率）
function kWeighting(fs) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [s1, s2];
}

class AmHifiMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = Math.round(sampleRate * 0.05); // 50 ms 子块
    this.k = kWeighting(sampleRate);
    this.ks = [new Float64Array(8), new Float64Array(8)]; // 每声道两级双二阶的状态 x1 x2 y1 y2
    this.tp = makeTruePeakTaps();
    this.T = this.tp[0].length;
    this.hist = [new Float64Array(this.T * 2), new Float64Array(this.T * 2)];
    this.hpos = 0;
    this.reset();
    this.epoch = 0;
    this.port.onmessage = e => {
      if (!e.data?.reset) return;
      this.epoch = e.data.epoch || 0;
      this.reset();
      this.ks.forEach(x => x.fill(0));
      this.hist.forEach(x => x.fill(0));
      this.hpos = 0;
    };
  }

  reset() {
    this.cnt = 0;
    this.peak = [0, 0];
    this.tpk = [0, 0];
    this.sq = [0, 0];
    this.ksq = [0, 0];
    this.lr = 0;
    this.clip = 0;
  }

  process(inputs) {
    const inp = inputs[0];
    const hasIn = inp && inp.length > 0;
    const frames = hasIn ? inp[0].length : 128;
    const chans = hasIn ? [inp[0], inp[1] || inp[0]] : null;
    const T = this.T;
    const tp = this.tp;
    const [s1, s2] = this.k;

    for (let c = 0; c < 2; c++) {
      const x = chans ? chans[c] : null;
      const st = this.ks[c];
      const hist = this.hist[c];
      let peak = this.peak[c];
      let tpk = this.tpk[c];
      let sq = 0;
      let ksq = 0;
      let hpos = this.hpos;
      for (let i = 0; i < frames; i++) {
        const v = x ? x[i] : 0;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        if (a >= 1) this.clip++;
        sq += v * v;

        // K 加权：两级 DF1 双二阶
        const y1 = s1.b0 * v + s1.b1 * st[0] + s1.b2 * st[1] - s1.a1 * st[2] - s1.a2 * st[3];
        st[1] = st[0];
        st[0] = v;
        st[3] = st[2];
        st[2] = y1;
        const y2 = y1 - 2 * st[4] + st[5] - s2.a1 * st[6] - s2.a2 * st[7];
        st[5] = st[4];
        st[4] = y1;
        st[7] = st[6];
        st[6] = y2;
        ksq += y2 * y2;

        // 真峰值：环形缓冲写两份，便于连续读取 T 个历史样本。
        // 插值点位于窗口中部（x[n-5]、x[n-6] 之间）；两侧样本都低于当前峰值一半（−6 dB）时，
        // 样本间峰值不可能超过当前峰值，跳过 4 相 FIR，可省去绝大部分计算
        hist[hpos] = v;
        hist[hpos + T] = v;
        const m1 = hist[hpos + T - 5];
        const m2 = hist[hpos + T - 6];
        const mid = Math.max(m1 < 0 ? -m1 : m1, m2 < 0 ? -m2 : m2);
        if (mid * 2 >= tpk) {
          for (let p = 0; p < 4; p++) {
            const taps = tp[p];
            let acc = 0;
            for (let j = 0; j < T; j++) acc += taps[j] * hist[hpos + T - j];
            if (acc < 0) acc = -acc;
            if (acc > tpk) tpk = acc;
          }
        }
        hpos = hpos + 1 === T ? 0 : hpos + 1;
      }
      if (c === 1) this.hpos = hpos;
      this.peak[c] = peak;
      this.tpk[c] = Math.max(tpk, peak);
      this.sq[c] += sq;
      this.ksq[c] += ksq;
    }
    if (chans) {
      const L = chans[0];
      const R = chans[1];
      let lr = 0;
      for (let i = 0; i < frames; i++) lr += L[i] * R[i];
      this.lr += lr;
    }

    this.cnt += frames;
    if (this.cnt >= this.block) {
      const n = this.cnt;
      const den = Math.sqrt(this.sq[0] * this.sq[1]);
      this.port.postMessage({
        epoch: this.epoch,
        n,
        peak: this.peak.slice(),
        tp: this.tpk.slice(),
        rms: [Math.sqrt(this.sq[0] / n), Math.sqrt(this.sq[1] / n)],
        ms: [this.ksq[0] / n, this.ksq[1] / n],
        corr: den > 1e-12 ? this.lr / den : null,
        clip: this.clip,
        silent: !hasIn
      });
      this.reset();
    }
    return true;
  }
}

registerProcessor('bilimusic-limiter', AmHifiLimiter);
registerProcessor('bilimusic-meter', AmHifiMeter);
