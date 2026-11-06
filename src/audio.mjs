// Graphic EQ centers, Q and music presets follow AppleMusic/src/inject/dsp.js.
export const EQ_BANDS = Object.freeze([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
export const DSP_PRESETS = Object.freeze([
  ['flat', '平直', 0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['vocal', '人声', -3.5, [-1, -1, -1, -2, -1, 1, 3, 1.5, 0, 0]],
  ['bass', '低音增强', -5.5, [5, 4.5, 3, 1, 0, 0, 0, 0, 0, 0]],
  ['pop', '流行', -5, [-1, 0, 2, 3.5, 4, 3, 1.5, 0, -0.5, -1]],
  ['rock', '摇滚', -5, [4.5, 3.5, 2, 0.5, -1, -1, 0.5, 2.5, 3.5, 4]],
  ['jazz', '爵士', -4, [3, 2, 1, 2, -1.5, -1.5, 0, 1, 2.5, 3]],
  ['classical', '古典', -4.5, [4, 3, 2, 1.5, -1, -1, 0, 2, 3, 3.5]],
  ['electronic', '电子', -5.5, [4.5, 4, 1, 0, -2, 2, 1, 1.5, 4, 4.5]]
].map(([id, name, preamp, bands]) => Object.freeze({ id, name, preamp, bands: Object.freeze(bands) })));

const SETTINGS_KEY = 'bilimusic.audio.v1';
// Ten milliseconds of silent mono PCM. WebKit grants playback to the media element
// that receives play() in the original tap, before an online track has a stream URL.
const gestureClip = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
function isAppleWebPlayer() {
  const nav = globalThis.navigator;
  return globalThis.biliNative?.platform === 'pwa' && nav &&
    (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints>1));
}
const gainFromDb = db => 10 ** (db / 20);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function numberIn(value, min, max, fallback) {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

function settings(value = {}) {
  value ??= {};
  const bands = EQ_BANDS.map((_, i) => numberIn(value.bands?.[i], -12, 12, 0));
  const preamp = numberIn(value.preamp, -24, 12, 0);
  const preset = DSP_PRESETS.find(p => p.preamp === preamp && p.bands.every((gain, i) => gain === bands[i]));
  return { enabled: value.enabled !== false, preset: preset?.id || 'custom', preamp, bands, limiter: value.limiter === true };
}

function readSettings() {
  try { return JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
}

/** Last line starting at or before the playhead, or -1 during an intro. Times are seconds. */
export function activeLyricIndex(lines, seconds) {
  if (!Array.isArray(lines) || !Number.isFinite(seconds)) return -1;
  let start = 0;
  let end = lines.length;
  while (start < end) {
    const mid = Math.floor((start + end) / 2);
    if (lines[mid].time <= seconds) start = mid + 1;
    else end = mid;
  }
  return start - 1;
}

function smooth(param, value, now) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, 0.012);
}

// The media element is attached to Web Audio once. EQ bypass keeps master volume active.
function makeGraph(context, media) {
  const input = context.createMediaElementSource(media);
  const preamp = context.createGain();
  const filters = EQ_BANDS.map(hz => {
    const node = context.createBiquadFilter();
    node.type = 'peaking';
    node.frequency.value = Math.min(hz, context.sampleRate * 0.4995);
    node.Q.value = 1.41;
    return node;
  });
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -1;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.08;
  // Compensate for Web Audio compressor makeup gain as in the desktop engine.
  const compensation = context.createGain();
  compensation.gain.value = gainFromDb(0.6 * -1 * (1 - 1 / 20));
  const master = context.createGain();
  let last = preamp;
  for (const filter of filters) {
    last.connect(filter);
    last = filter;
  }
  compressor.connect(compensation);
  compensation.connect(master);
  master.connect(context.destination);
  let route;
  return {
    apply(dsp, volume) {
      const now = context.currentTime;
      smooth(preamp.gain, gainFromDb(dsp.preamp), now);
      filters.forEach((filter, index) => smooth(filter.gain, dsp.bands[index], now));
      smooth(master.gain, volume, now);
      const nextRoute = dsp.enabled ? (dsp.limiter ? 'limit' : 'eq') : 'direct';
      if (route === nextRoute) return;
      input.disconnect();
      last.disconnect();
      if (dsp.enabled) {
        input.connect(preamp);
        last.connect(dsp.limiter ? compressor : master);
      } else {
        input.connect(master);
      }
      route = nextRoute;
    }
  };
}

function abortError() { return new DOMException('已切换播放请求', 'AbortError'); }

function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function releaseNative(url) {
  if (url) Promise.resolve(globalThis.biliNative?.releaseMedia(url)).catch(() => {});
}

function mediaError(media) {
  const descriptions = { 1: '播放被中断', 2: '音频下载失败', 3: '音频解码失败', 4: '设备无法播放此音频格式' };
  return new Error(descriptions[media.error?.code] || '音频无法播放');
}

export class AudioEngine extends EventTarget {
  #context;
  #graph;
  #dsp;
  #volume;
  #session;
  #handle;
  #sources = [];
  #index = -1;
  #recovering = false;
  #stream = null;
  #wantsPlay = false;
  #resumeAt = 0;
  #gesturePrimed = false;

  constructor(media = new Audio()) {
    super();
    this.media = media;
    media.preload = 'auto';
    media.setAttribute('playsinline', '');
    const saved = readSettings();
    this.#dsp = settings(saved.dsp);
    this.#volume = numberIn(saved.volume, 0, 1, 0.8);
    media.addEventListener('loadedmetadata', () => {
      if (this.#resumeAt > 0) this.seek(this.#resumeAt);
    });
    media.addEventListener('error', () => {
      if (!this.#stream || this.#recovering || !media.error) return;
      const session = this.#session;
      const error = mediaError(media);
      this.#resumeAt = media.currentTime || this.#resumeAt;
      this.#trySources(this.#index + 1, session, error).catch(cause => {
        if (!session.signal.aborted) this.dispatchEvent(new CustomEvent('playbackerror', { detail: cause }));
      });
    });
  }

  get dsp() { return { ...this.#dsp, bands: [...this.#dsp.bands] }; }
  get volume() { return this.#volume; }
  get stream() { return this.#stream; }

  #update() {
    this.#graph?.apply(this.#dsp, this.#volume);
    try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify({ dsp: this.#dsp, volume: this.#volume })); }
    catch { /* Playback still works if persistence is unavailable. */ }
  }

  applyPreset(id) {
    const preset = DSP_PRESETS.find(p => p.id === id);
    if (!preset) return this.dsp;
    return this.setDSP({ enabled: true, preamp: preset.preamp, bands: preset.bands });
  }

  setDSP(patch) {
    this.#dsp = settings({ ...this.#dsp, ...patch });
    this.#update();
    return this.dsp;
  }

  setVolume(value) {
    this.#volume = numberIn(value, 0, 1, this.#volume);
    this.#update();
    return this.#volume;
  }

  // Acquire gesture permission without delaying resolution or playback on a suspended context.
  activate() {
    void this.unlock().catch(() => {});
    if (!isAppleWebPlayer() || this.#gesturePrimed || this.media.hasAttribute('src')) return;
    this.media.src = gestureClip;
    this.media.loop = true;
    this.media.play().then(() => {
      this.#gesturePrimed = true;
      if (this.media.getAttribute('src') === gestureClip) {
        this.media.pause();
        this.media.loop = false;
      }
    }).catch(() => {});
  }

  async unlock() {
    if (!this.#context) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('此设备缺少 Web Audio 播放支持');
      this.#context = new AudioContext({ latencyHint: 'playback' });
    }
    if (this.#context.state !== 'running') await this.#context.resume();
    if (!this.#graph && this.#context.state === 'running') {
      this.#graph = makeGraph(this.#context, this.media);
      this.media.volume = 1;
      this.#graph.apply(this.#dsp, this.#volume);
    }
  }

  #detach() {
    this.#stream = null;
    this.media.pause();
    this.media.loop = false;
    if (this.media.hasAttribute('src')) {
      this.media.removeAttribute('src');
      this.media.load();
    }
    releaseNative(this.#handle);
    this.#handle = null;
  }

  stop() {
    this.#session?.abort();
    this.#session = null;
    this.#recovering = false;
    this.#resumeAt = 0;
    this.#wantsPlay = false;
    this.#sources = [];
    this.#index = -1;
    const hadStream = !!this.#stream;
    this.#detach();
    if (hadStream) this.dispatchEvent(new CustomEvent('streamchange', { detail: null }));
  }

  pause() {
    this.#wantsPlay = false;
    this.media.pause();
  }

  async play() {
    this.#wantsPlay = true;
    if (!this.media.hasAttribute('src')) return false;
    if (isAppleWebPlayer() && !this.#graph) {
      this.media.volume = this.#volume;
      // Let AVFoundation start immediately. The DSP graph attaches only once it can render.
      void this.unlock().catch(() => {});
      await this.media.play();
    } else {
      await Promise.all([this.unlock(), this.media.play()]);
    }
    return true;
  }

  seek(seconds) {
    if (!Number.isFinite(seconds) || !this.#session || this.#stream?.isLive) return;
    this.#resumeAt = Math.max(0, seconds);
    if (this.media.readyState >= 1) {
      const duration = this.media.duration;
      this.media.currentTime = Number.isFinite(duration) ? Math.min(duration, this.#resumeAt) : this.#resumeAt;
      this.#resumeAt = 0;
    }
  }

  load(url) { return this.start([{ url }]).then(Boolean); }

  async start(candidates) {
    this.stop();
    const sources = Array.isArray(candidates) ? candidates.filter(source => typeof source?.url === 'string' && source.url) : [];
    if (!sources.length) throw new Error('没有可播放的音轨');
    const session = this.#session = new AbortController();
    this.#sources = sources;
    this.#wantsPlay = true;
    try {
      // Interrupt a pending start immediately even if a native download is still finishing.
      return await untilAborted(this.#trySources(0, session), session.signal);
    } catch (error) {
      if (session.signal.aborted) return null;
      throw error;
    }
  }

  async #trySources(index, session, previousError) {
    this.#recovering = true;
    let lastError = previousError;
    for (; index < this.#sources.length; index++) {
      this.#detach();
      const stream = this.#sources[index];
      this.#index = index;
      try {
        let url = stream.url;
        const bundled = globalThis.biliNative?.platform === 'ios' && !/^(https?:|blob:|data:)/i.test(url);
        if (bundled) url = new URL(url, globalThis.location.href).href;
        if (bundled || /^https?:\/\//i.test(url)) {
          if (!globalThis.biliNative) throw new Error('请在 BiliMusic 客户端播放网络音频');
          const mimeType = stream.mimeType || (/\.flac$/i.test(url) ? 'audio/flac' : undefined);
          url = await globalThis.biliNative.prepareMedia({ url, headers: stream.headers, mimeType });
          if (session.signal.aborted) { releaseNative(url); return null; }
          this.#handle = url;
        }
        this.media.src = url;
        await this.#waitForMedia(session.signal);
        if (session.signal.aborted) return null;
        this.#stream = stream;
        this.#recovering = false;
        this.dispatchEvent(new CustomEvent('streamchange', { detail: stream }));
        return stream;
      } catch (cause) {
        if (session.signal.aborted) return null;
        lastError = cause;
        // Some mobile browsers require a fresh tap after the asynchronous URL lookup.
        // Keep the already attached media so the next tap calls play() in the gesture.
        if (cause.name === 'NotAllowedError' && globalThis.biliNative?.platform === 'pwa' && this.media.hasAttribute('src')) {
          this.media.pause();
          this.#stream = stream;
          this.#recovering = false;
          this.#wantsPlay = false;
          this.dispatchEvent(new CustomEvent('streamchange', { detail: stream }));
          return stream;
        }
        // A gesture restriction applies to every candidate.
        if (cause.name === 'NotAllowedError') break;
      }
    }
    this.#recovering = false;
    this.#detach();
    this.dispatchEvent(new CustomEvent('streamchange', { detail: null }));
    throw lastError || new Error('没有可播放的音轨');
  }

  async #waitForMedia(signal) {
    const media = this.media;
    let timer, onError, onReady;
    const failure = new Promise((_, reject) => {
      onError = () => reject(mediaError(media));
      media.addEventListener('error', onError);
      timer = setTimeout(() => reject(new Error('音频载入超时')), 30000);
    });
    const ready = new Promise(resolve => {
      onReady = resolve;
      media.addEventListener('loadedmetadata', onReady);
    });
    try {
      const play = this.#wantsPlay ? this.play().catch(error => {
        if (error.name === 'AbortError' && !this.#wantsPlay) return media.readyState >= 1 || ready;
        throw error;
      }) : ready;
      await untilAborted(Promise.race([play, failure]), signal);
    } finally {
      clearTimeout(timer);
      media.removeEventListener('loadedmetadata', onReady);
      media.removeEventListener('error', onError);
    }
  }
}
