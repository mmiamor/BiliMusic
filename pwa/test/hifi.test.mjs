import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { catalog, createSession, mediaAllowed, mediaResponse } from '../provider-network.mjs';
import { createHandler } from '../server.mjs';
import { RADIO_STATIONS } from '../../src/radio.mjs';

const origin = 'https://music.example.org';
const host = 'https://stream.radioparadise.com';
const stationPaths = { main: '/flac', mellow: '/mellow-flac', rock: '/rock-flac', global: '/global-flac' };
const noNetwork = async () => { throw new Error('This test must never access the network.'); };

// Exercise the real handler in memory; these tests never start a server or bind a port.
async function call(handler, pathname, options = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(options.body || {}))]);
  req.method = options.method || 'POST'; req.url = pathname;
  req.headers = { host: 'music.example.org', origin, 'content-type': 'application/json', ...options.headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  const chunks = [], headers = new Headers();
  const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  let status = 200;
  res.setHeader = (key, value) => headers.set(key, value);
  res.writeHead = (code, fields) => {
    status = code; res.headersSent = true;
    for (const [key, value] of Object.entries(fields || {})) headers.set(key, value);
  };
  const finished = once(res, 'finish');
  await handler(req, res); await finished;
  const bytes = Buffer.concat(chunks), text = bytes.toString();
  return { status, headers, bytes, text, value: headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}

test('PWA radio resolution uses only fixed station identities and ignores caller stream, header and quality overrides', async () => {
  const session = createSession(noNetwork);
  for (const station of RADIO_STATIONS) {
    const [stream] = await catalog(session, 'resolve', [{ source: 'radioparadise', stationId: station.stationId,
      id: 'radioparadise:forged', url: 'https://evil.test/audio', headers: { Cookie: 'forged-cookie' },
      quality: 'Hi-Res 24/192', codec: 'aac', mimeType: 'audio/mp4', lossless: false }]);
    assert.match(stream.url, /^\/api\/media\/[0-9a-f-]{36}$/);
    assert.equal(stream.codec, 'flac');
    assert.equal(stream.lossless, true);
    assert.equal(stream.mimeType, 'audio/ogg');
    assert.equal(stream.isLive, true);
    assert.match(stream.quality, /16 bit \/ 44\.1 kHz/);
    assert.doesNotMatch(stream.quality, /Hi-Res|24\/192/);
    const saved = session.media.get(stream.url.split('/').at(-1));
    assert.equal(saved.url, host + stationPaths[station.stationId]);
    assert.equal(saved.source, 'radioparadise');
    assert.equal(saved.isLive, true);
    assert.deepEqual(saved.headers, {});
    assert.doesNotMatch(JSON.stringify(stream), /radioparadise\.com|evil\.test|forged-cookie/);
  }
  for (const stationId of [undefined, null, '', 'constructor', 'MAIN', '/flac', 'main?url=evil', 'https://evil.test', ['main'], {}]) {
    await assert.rejects(catalog(session, 'resolve', [{ source: 'radioparadise', stationId }]), { status: 400 });
  }
  assert.equal(session.media.size, RADIO_STATIONS.length);
});

test('PWA radio media allowlist rejects arbitrary hosts, paths, queries and credentials', async () => {
  for (const path of Object.values(stationPaths)) {
    assert.equal(mediaAllowed(new URL(host + path), 'radioparadise'), true);
  }
  const rejected = [
    'https://evil.test/flac', 'https://stream.radioparadise.com.evil.test/flac', 'https://127.0.0.1/flac',
    'https://other.radioparadise.com/flac', 'https://stream.radioparadise.com:8443/flac',
    host + '/', host + '/other-flac', host + '/flac/', host + '/%66lac',
    host + '/flac?url=https://evil.test', host + '/flac?token=fixture', host + '/flac#fragment',
    'http://stream.radioparadise.com/flac', 'https://user:password@stream.radioparadise.com/flac',
  ];
  let fetched = 0;
  for (const url of rejected) {
    assert.equal(mediaAllowed(new URL(url), 'radioparadise'), false, url);
    await assert.rejects(mediaResponse({ source: 'radioparadise', url }, 'GET', '', new AbortController().signal,
      async () => { fetched++; throw new Error('A rejected URL must never be fetched.'); }));
  }
  assert.equal(mediaAllowed(new URL(host + '/flac'), 'bilibili'), false);
  for (const url of [host + ':443/flac', host + '/other/../flac', host + '/flac?', host + '/flac#',
    'https://STREAM.radioparadise.com/flac']) {
    await assert.rejects(mediaResponse({ source: 'radioparadise', url }, 'GET', '', new AbortController().signal,
      async () => { fetched++; throw new Error('A non-canonical URL must never be fetched.'); }));
  }
  assert.equal(fetched, 0);
});

test('PWA radio redirects cannot broaden the fixed stream allowlist', async () => {
  for (const location of ['https://evil.test/audio', host + '/arbitrary', host + '/flac?redirected=1']) {
    const urls = [];
    await assert.rejects(mediaResponse({ source: 'radioparadise', url: host + '/flac', headers: {} },
      'GET', '', new AbortController().signal, async url => {
        urls.push(url);
        return new Response(null, { status: 302, headers: { location } });
      }));
    assert.deepEqual(urls, [host + '/flac']);
  }
});

test('PWA radio proxies a live Ogg FLAC body without Range and publishes the provider MIME instead of an upstream generic MIME', async () => {
  const calls = [];
  const body = Buffer.from('OggS-fixture-live-audio');
  const handler = createHandler({ publicOrigin: origin, fetcher: async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, host + '/flac');
    assert.equal(options.headers.Range, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers['Accept-Encoding'], 'identity');
    assert.equal(options.redirect, 'manual');
    return new Response(options.method === 'HEAD' ? null : body, { status: 200,
      headers: { 'Content-Type': 'application/octet-stream' } });
  } });
  const resolved = await call(handler, '/api/catalog', { body: { op: 'resolve',
    args: [{ source: 'radioparadise', stationId: 'main', url: 'https://evil.test/audio', mimeType: 'text/html' }] } });
  assert.equal(resolved.status, 200);
  assert.equal(calls.length, 0);
  const cookie = resolved.headers.get('set-cookie').split(';')[0];
  const [{ url }] = resolved.value.result;
  assert.equal((await call(handler, url, { method: 'GET' })).status, 404);
  const media = await call(handler, url, { method: 'GET', headers: { cookie } });
  assert.equal(media.status, 200);
  assert.deepEqual(media.bytes, body);
  assert.equal(media.headers.get('content-type'), 'audio/ogg');
  assert.equal(media.headers.get('content-range'), null);
  assert.equal(media.headers.get('content-length'), null);
  assert.equal(media.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(media.headers.get('cache-control'), 'private, no-store');
  const head = await call(handler, url, { method: 'HEAD', headers: { cookie } });
  assert.equal(head.status, 200);
  assert.equal(head.bytes.length, 0);
  assert.equal(head.headers.get('content-type'), 'audio/ogg');
  assert.deepEqual(calls.map(item => item.options.method), ['GET', 'HEAD']);
});
