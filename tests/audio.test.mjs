import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, activeLyricIndex } from '../src/audio.mjs';

// Exercise switching while the native download or browser decoder is still busy.
class Media extends EventTarget {
  #url = '';
  readyState = 0;
  currentTime = 0;
  duration = 90;
  error = null;
  set src(url) { this.#url = url; this.readyState = 0; this.currentTime = 0; this.error = null; }
  get src() { return this.#url; }
  setAttribute() {}
  hasAttribute(key) { return key === 'src' && !!this.#url; }
  removeAttribute() { this.#url = ''; }
  load() {}
  pause() {}
  async play() {
    if (this.src.includes('incompatible')) throw new Error('unsupported codec');
    this.readyState = 4;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
}

// Playback control tests do not need a sound device.
class Player extends AudioEngine { async unlock() {} }

test('a mobile browser can start the prepared PWA stream on a second tap', async t => {
  let allowed = false;
  class GestureMedia extends Media {
    async play() {
      if (!allowed) throw new DOMException('User interaction required', 'NotAllowedError');
      return super.play();
    }
  }
  globalThis.biliNative = { platform: 'pwa' };
  t.after(() => { delete globalThis.biliNative; });
  const player = new Player(new GestureMedia());
  const stream = { url: '/api/media/test-track', quality: 'FLAC' };
  assert.equal(await player.start([stream]), stream);
  assert.equal(player.media.src, stream.url);
  allowed = true;
  assert.equal(await player.play(), true);
  assert.equal(player.stream, stream);
});

test('iPhone PWA starts the media element even while AudioContext resume is pending', {timeout:2000}, async t => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{userAgent:'iPhone',maxTouchPoints:5}});
  globalThis.biliNative={platform:'pwa'};
  t.after(()=>{
    if(previousNavigator) Object.defineProperty(globalThis,'navigator',previousNavigator);
    else delete globalThis.navigator;
    delete globalThis.biliNative;
  });
  class MobileMedia extends Media {
    getAttribute(key) {return key==='src'?this.src:null;}
  }
  class SuspendedPlayer extends AudioEngine {unlock(){return new Promise(()=>{});}}
  const media=new MobileMedia(), player=new SuspendedPlayer(media);
  player.activate();
  assert.match(media.src,/^data:audio\/wav/);
  await new Promise(resolve=>setImmediate(resolve));
  const track={url:'/api/media/fixture',quality:'AAC'};
  assert.equal(await player.start([track]),track);
  assert.equal(media.src,track.url);
  assert.equal(media.loop,false);
});

test('lyrics before first line, exact timestamps, duplicates and backward seeks', () => {
  const lines = [{ time: 1 }, { time: 3 }, { time: 3 }, { time: 4.5 }];
  assert.deepEqual([0, 1, 3, 5, 2].map(t => activeLyricIndex(lines, t)), [-1, 0, 2, 3, 0]);
});

test('presets, edits and bypass use bounded, independent settings', () => {
  const player = new Player(new Media());
  assert.equal(player.applyPreset('rock').preset, 'rock');
  assert.equal(player.setDSP({ preamp: 200, enabled: false }).preset, 'custom');
  assert.equal(player.dsp.preamp, 12);
  assert.equal(player.dsp.enabled, false);
  const snapshot = player.dsp;
  snapshot.bands[0] = 1000;
  assert.notEqual(player.dsp.bands[0], 1000);
  assert.equal(player.setVolume(-2), 0);
});

test('superseded native download is immediately cancelled and late handle is released', async t => {
  let complete;
  const released = [];
  t.after(() => { delete globalThis.biliNative; });
  globalThis.biliNative = {
    prepareMedia: () => new Promise(resolve => { complete = resolve; }),
    releaseMedia: url => released.push(url)
  };
  const player = new Player(new Media());
  const stale = player.start([{ url: 'https://example.invalid/pending' }]);
  const next = { url: './current.wav' };
  assert.equal(await player.start([next]), next);
  assert.equal(await stale, null);
  complete('blob:stale');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(released, ['blob:stale']);
  assert.equal(player.media.src, next.url);
});

test('decoder rejection falls back, late codec error restores playhead on backup', async t => {
  const released = [];
  t.after(() => { delete globalThis.biliNative; });
  globalThis.biliNative = {
    prepareMedia: async ({ url }) => url.replace('https://', 'blob:'),
    releaseMedia: url => released.push(url)
  };
  const player = new Player(new Media());
  const streams = ['incompatible', 'primary', 'backup'].map(id => ({ url: 'https://example.invalid/' + id }));
  assert.equal(await player.start(streams), streams[1]);
  player.seek(42);
  const changed = new Promise(resolve => player.addEventListener('streamchange', e => resolve(e.detail), { once: true }));
  player.media.error = { code: 3 };
  player.media.dispatchEvent(new Event('error'));
  assert.equal(await changed, streams[2]);
  assert.equal(player.media.currentTime, 42);
  player.stop();
  assert.deepEqual(released, streams.map(s => s.url.replace('https://', 'blob:')));
});

test('initial exhaustion rejects and late exhaustion emits a playback error', async () => {
  const player = new Player(new Media());
  await assert.rejects(player.start([{ url: './incompatible' }]), /unsupported codec/);
  assert.equal(player.stream, null);
  await player.load('./ok.wav');
  const failed = new Promise(resolve => player.addEventListener('playbackerror', e => resolve(e.detail), { once: true }));
  player.media.error = { code: 2 };
  player.media.dispatchEvent(new Event('error'));
  assert.match((await failed).message, /下载/);
  assert.equal(player.stream, null);
});

test('iOS bundled FLAC uses a seekable blob and releases it on stop', async t => {
  const input = [], released = [];
  t.after(() => { delete globalThis.biliNative; delete globalThis.location; });
  globalThis.location = { href: 'bilimusic://app/index.html' };
  globalThis.biliNative = {
    platform: 'ios',
    prepareMedia: async source => { input.push(source); return 'blob:local'; },
    releaseMedia: url => released.push(url)
  };
  const player = new Player(new Media());
  assert.equal(await player.load('./assets/mist.flac'), true);
  assert.equal(input[0].url, 'bilimusic://app/assets/mist.flac');
  assert.equal(input[0].mimeType, 'audio/flac');
  assert.equal(player.media.src, 'blob:local');
  player.stop();
  assert.deepEqual(released, ['blob:local']);
});

test('player controls show playing again after a mid-song decoder error selects a backup', async t => {
  let media, player;
  class EventMedia extends Media {
    paused = true;
    constructor() { super(); media = this; }
    pause() {
      if (this.paused) return;
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
    async play() {
      await super.play();
      this.paused = false;
      // Browsers emit playing before play() resolves and before streamchange.
      this.dispatchEvent(new Event('playing'));
    }
  }

  const nodes = new Map();
  const document = new EventTarget();
  document.querySelector = selector => {
    if (!nodes.has(selector)) nodes.set(selector, Object.assign(new EventTarget(), { scrollTop: 0, contains: () => false }));
    return nodes.get(selector);
  };
  document.querySelectorAll = () => [];
  document.closest = () => ({ dataset: { action: 'session-play' } });
  const globals = { Audio: EventMedia, document, window: {}, localStorage: { getItem: () => null, setItem() {} } };
  for (const [name, value] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : Reflect.deleteProperty(globalThis, name));
  }

  // The bundled EP has one URL. Supply a second local candidate without network or a sound card.
  const start = AudioEngine.prototype.start;
  t.mock.method(AudioEngine.prototype, 'unlock', async () => {});
  t.mock.method(AudioEngine.prototype, 'start', function (streams) {
    player = this;
    return start.call(this, [...streams, { url: './backup.flac', quality: '备用 FLAC' }]);
  });
  await import('../src/app.mjs');
  document.dispatchEvent(new Event('click'));
  await new Promise(resolve => setImmediate(resolve));
  const controls = () => document.querySelector('#transport').innerHTML;
  assert.match(controls(), /aria-label="暂停"/);
  player.seek(21);
  const recovered = new Promise(resolve => player.addEventListener('streamchange', resolve, { once: true }));
  media.error = { code: 3 };
  media.dispatchEvent(new Event('error'));
  await recovered;
  assert.equal(media.src, './backup.flac');
  assert.equal(media.currentTime, 21);
  assert.equal(media.paused, false);
  assert.match(controls(), /aria-label="暂停"/);
  assert.match(document.querySelector('#deck').innerHTML, /备用 FLAC/);
});
