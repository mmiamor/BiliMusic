import { EQ_BANDS, DSP_PRESETS, normalizeDSP, patchDSP, numberIn } from './dsp-model.mjs';
import { createDSPGraph } from './dsp-graph.mjs';
export { EQ_BANDS, DSP_PRESETS } from './dsp-model.mjs';

const SETTINGS_KEY = 'bilimusic.audio.v1';
// Ten milliseconds of silent mono PCM. WebKit grants playback to the media element
// that receives play() in the original tap, before an online track has a stream URL.
const gestureClip = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
function isAppleWebPlayer() {
  const nav = globalThis.navigator;
  return globalThis.biliNative?.platform === 'pwa' && nav &&
    (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints>1));
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
  #contextOptions;
  #contextError = '';
  #sinkError = '';
  #sinkRequest = 0;
  #sinkPending = Promise.resolve();

  constructor(media = new Audio()) {
    super();
    this.media = media;
    media.preload = 'auto';
    media.setAttribute('playsinline', '');
    const saved = readSettings();
    this.#dsp = normalizeDSP(saved?.dsp);
    this.#volume = numberIn(saved?.volume, 0, 1, 0.8);
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

  get dsp() { return structuredClone(this.#dsp); }
  get volume() { return this.#volume; }
  get stream() { return this.#stream; }
  get dspStatus() {
    const active = this.#graph?.status || { worklet: 'idle', sampleRate: null, baseLatency: null, outputLatency: null, preampDb: null, maxBoost: null, chain: [], contextState: 'idle' };
    return { ...active, sinkSupported: Boolean(this.#context?.setSinkId || (globalThis.AudioContext || globalThis.webkitAudioContext)?.prototype?.setSinkId), sinkError: this.#sinkError, contextError: this.#contextError,
      reloadRequired: Boolean(this.#contextOptions && (this.#contextOptions.sampleRate !== this.#dsp.output.sampleRate || this.#contextOptions.latencyHint !== this.#dsp.output.latencyHint)),
      sinkId: typeof this.#context?.sinkId === 'string' ? this.#context.sinkId : '',
    };
  }
  getMeters() {
    return this.#graph?.getMeters() || { available: false, peak: null, rms: null, tp: null, corr: null, clips: 0, momentary: null, shortTerm: null, integrated: null, lra: null, tpMax: null, limiterReduction: 0 };
  }
  resetMeters() { this.#graph?.resetMeters(); }
  async listOutputDevices() {
    const devices = await globalThis.navigator?.mediaDevices?.enumerateDevices?.();
    return (devices || []).filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default').map((d, index) => ({ id: d.deviceId, label: d.label || '音频输出 ' + (index + 1) }));
  }
  async setOutputDevice(id) {
    if (typeof id !== 'string' || id.length > 512) throw new Error('无效的输出设备。');
    const request = ++this.#sinkRequest;
    if (!this.#context) await this.unlock();
    if (!this.#context?.setSinkId) {
      this.#sinkError = '当前设备不支持在应用内切换输出，请使用系统声音设置。';
      throw new Error(this.#sinkError);
    }
    try {
      const pending = this.#sinkPending.catch(() => {}).then(async () => {
        if (request === this.#sinkRequest) await this.#context.setSinkId(id);
      });
      this.#sinkPending = pending;
      await pending;
      if (request !== this.#sinkRequest) return;
      this.#sinkError = '';
      this.setDSP({ output: { sinkId: id } });
    } catch (error) {
      if (request === this.#sinkRequest) {
        this.#sinkError = '无法切换到该输出设备，请检查连接或使用系统默认输出。';
        this.dispatchEvent(new Event('dspchange'));
      }
      throw new Error(this.#sinkError || error.message);
    }
  }


  #update() {
    this.#graph?.apply(this.#dsp, this.#volume);
    if (!this.#graph) this.media.volume = this.#volume;
    try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify({ dsp: this.#dsp, volume: this.#volume })); }
    catch { /* Playback still works if persistence is unavailable. */ }
  }

  applyPreset(id) {
    const preset = DSP_PRESETS.find(p => p.id === id);
    if (!preset) return this.dsp;
    return this.setDSP({ enabled: true, preset: preset.id, preamp: preset.preamp, autoPreamp: preset.autoPreamp, eq: { enabled: true, filters: preset.filters } });
  }

  setDSP(patch) {
    this.#dsp = patchDSP(this.#dsp, patch);
    this.#update();
    this.dispatchEvent(new Event('dspchange'));
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
      const output = this.#dsp.output;
      const options = { latencyHint: output.latencyHint };
      if (output.sampleRate) options.sampleRate = output.sampleRate;
      try { this.#context = new AudioContext(options); }
      catch (error) {
        if (!output.sampleRate) throw error;
        this.#contextError = '所选采样率不可用，已使用系统默认采样率。';
        this.#context = new AudioContext({ latencyHint: output.latencyHint });
      }
      this.#contextOptions = { ...output };
      if (output.sinkId && this.#sinkRequest === 0) void this.setOutputDevice(output.sinkId).catch(() => {});
    }
    if (this.#context.state !== 'running') await this.#context.resume();
    if (!this.#graph && this.#context.state === 'running') {
      this.#graph = createDSPGraph(this.#context, this.#context.createMediaElementSource(this.media), { onStatus: () => this.dispatchEvent(new Event('dspchange')) });
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
