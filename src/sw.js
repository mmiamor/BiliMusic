const CACHE = 'bilimusic-shell-0.3.3-1';
const SHELL = [
  './index.html',
  './app.css',
  './lyrics.css',
  './macos.css',
  './player-layout.css',
  './discovery.css',
  './discovery-feed.mjs',
  './discovery-categories.mjs',
  './audio-quality.mjs',
  './radio.mjs',
  './hifi-links.json',
  './settings-view.mjs',
  './settings-model.mjs',
  './settings.css',
  './app-version.mjs',
  './window-chrome.css',
  './window-chrome.mjs',
  './viewport.mjs',
  './comments.css',
  './comment-feed.mjs',
  './app.mjs',
  './icons.mjs',
  './library.mjs',
  './audio.mjs',
  './providers.mjs',
  './provider-utils.mjs',
  './bilibili.mjs',
  './kuwo.mjs',
  './netease.mjs',
  './wbi.mjs',
  './lyric-lines.mjs',
  './pwa-bridge.mjs',
  './vendor/pinyin-pro/index.mjs',
  './manifest.webmanifest',
  './icons/v021-32.png',
  './icons/v021-180.png',
  './icons/v021-192.png',
  './icons/v021-512.png',
  './icons/v021-maskable-512.png',
  './install-preview.webp',
  './assets/forest.jpg',
  './assets/mist.flac',
  './assets/creek.flac',
  './assets/dusk.flac',
];
const assets = new Set(SHELL.map((path) => new URL(path, self.registration.scope).href));
const index = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('bilimusic-shell-') && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// Range playback must also work when a browser seeks inside an offline FLAC.
async function rangeResponse(stored, range) {
  const data = await stored.arrayBuffer(),
    size = data.byteLength;
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]))
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size)
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(data.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': stored.headers.get('Content-Type') || 'audio/flac',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    },
  });
}
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  const navigation = request.mode === 'navigate' && (url.pathname === '/' || url.href === index);
  if (!navigation && !assets.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cached = await (await caches.open(CACHE)).match(navigation ? index : request.url);
      if (!cached) return fetch(request);
      const range = request.headers.get('Range');
      return range && url.pathname.endsWith('.flac') ? rangeResponse(cached, range) : cached;
    })(),
  );
});
