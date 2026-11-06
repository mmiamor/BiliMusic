import { GRAPHIC_FREQS, graphic, BUILTIN_PRESETS, sanitizeFilter, EQ_LIMITS } from './dsp-math.mjs';

export const EQ_BANDS = Object.freeze([...GRAPHIC_FREQS]);
const presetIds = ['flat', 'graphic', 'bass', 'treble', 'vocal', 'vshape', 'loudness', 'rock', 'pop', 'jazz', 'classical', 'electronic'];
export const DSP_PRESETS = Object.freeze(Object.entries(BUILTIN_PRESETS).map(([name, p], i) => Object.freeze({
  id: presetIds[i], name, preamp: 0, autoPreamp: true,
  filters: Object.freeze(p.filters.map(f => Object.freeze({...f}))),
  bands: Object.freeze(GRAPHIC_FREQS.map(hz => p.filters.find(f => f.type === 'PK' && f.fc === hz)?.gain || 0)),
})));
export const SAMPLE_RATES = Object.freeze([0, 44100, 48000, 88200, 96000, 176400, 192000]);
export const numberIn = (value, min, max, fallback) => value != null && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Upgrade v1 without enabling new processing or replacing its manual gain. */
export function normalizeDSP(input = {}) {
  const value = obj(input), eq = obj(value.eq), cf = obj(value.crossfeed), mx = obj(value.matrix), lim = obj(value.limiterSettings), output = obj(value.output);
  const legacy = !value.version && Array.isArray(value.bands);
  const filters = (legacy ? graphic(GRAPHIC_FREQS.map((_, i) => numberIn(value.bands[i], -12, 12, 0))) : Array.isArray(eq.filters) ? eq.filters : []).slice(0, EQ_LIMITS.maxFilters).map(sanitizeFilter);
  const preamp = numberIn(value.preamp, -24, 12, 0);
  return {
    version: 2, enabled: value.enabled !== false,
    preset: typeof value.preset === 'string' ? value.preset.slice(0, 120) : filters.length ? 'custom' : 'flat',
    preamp, autoPreamp: legacy ? false : value.autoPreamp !== false,
    bands: GRAPHIC_FREQS.map(hz => filters.find(f => f.type === 'PK' && f.fc === hz)?.gain || 0),
    eq: { enabled: legacy ? true : eq.enabled === true, filters },
    crossfeed: { enabled: cf.enabled === true, cutoff: numberIn(cf.cutoff, 300, 1200, 700), feed: numberIn(cf.feed, 1, 15, 4.5) },
    matrix: { width: numberIn(mx.width, 0, 2, 1), balance: numberIn(mx.balance, -1, 1, 0), mono: mx.mono === true, swap: mx.swap === true, invertL: mx.invertL === true, invertR: mx.invertR === true },
    limiter: legacy ? value.limiter === true : value.limiter !== false,
    limiterSettings: { ceiling: numberIn(lim.ceiling, -6, 0, legacy ? -1 : -0.1), release: numberIn(lim.release, 20, 500, 80) },
    output: { sampleRate: SAMPLE_RATES.includes(Number(output.sampleRate)) ? Number(output.sampleRate) : 0, latencyHint: ['playback','balanced','interactive'].includes(output.latencyHint) ? output.latencyHint : 'playback', sinkId: typeof output.sinkId === 'string' ? output.sinkId.slice(0, 512) : '' },
    meterTap: value.meterTap === 'pre' ? 'pre' : 'post',
  };
}

/** Merge one UI change while keeping unrelated effect and output settings intact. */
export function patchDSP(current, patch = {}) {
  patch = obj(patch);
  const next = { ...current, ...patch };
  for (const key of ['eq','crossfeed','matrix','limiterSettings','output']) next[key] = {...current[key], ...obj(patch[key])};
  if (Array.isArray(patch.bands) && !Array.isArray(patch.eq?.filters)) {
    next.eq.filters = graphic(GRAPHIC_FREQS.map((_, i) => numberIn(patch.bands[i], -12, 12, 0)));
    next.eq.enabled = true;
  }
  if (!Object.hasOwn(patch, 'preset') && (Object.hasOwn(patch,'preamp') || Object.hasOwn(patch,'autoPreamp') || Array.isArray(patch.bands) || Array.isArray(patch.eq?.filters))) next.preset = 'custom';
  return normalizeDSP(next);
}
