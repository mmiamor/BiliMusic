import test from 'node:test';
import assert from 'node:assert/strict';
import { RADIO_STATIONS, isRadioMediaURL, radioProvider } from '../src/radio.mjs';

test('radio exposes four distinct live stations and searches their local catalogue only', async () => {
  const provider = radioProvider();
  const all = await provider.search();
  assert.deepEqual(all.map(row => row.stationId), ['main', 'mellow', 'rock', 'global']);
  assert.equal(new Set(all.map(row => row.id)).size, 4);
  assert.ok(all.every(row => row.source === 'radioparadise' && row.isLive && row.duration === 0));
  assert.deepEqual((await provider.search('ROCK')).map(row => row.stationId), ['rock']);
  assert.deepEqual((await provider.search('环球')).map(row => row.stationId), ['global']);
  assert.deepEqual((await provider.search('Radio Paradise mellow')).map(row => row.stationId), ['mellow']);
  assert.deepEqual(await provider.search('unknown station'), []);
  assert.deepEqual(await provider.search('', 2), []);
  all[0].stationId = 'evil';
  assert.equal((await provider.search())[0].stationId, 'main');
  assert.equal(RADIO_STATIONS[0].stationId, 'main');
});

test('radio resolves only official FLAC streams and retains the actual Ogg container', async () => {
  const provider = radioProvider();
  const paths = ['/flac', '/mellow-flac', '/rock-flac', '/global-flac'];
  for (const [index, track] of RADIO_STATIONS.entries()) {
    const streams = await provider.resolve(track);
    assert.equal(streams.length, 1);
    const stream = streams[0];
    assert.equal(stream.url, 'https://stream.radioparadise.com' + paths[index]);
    assert.equal(isRadioMediaURL(stream.url), true);
    assert.equal(stream.codec, 'flac');
    assert.equal(stream.mimeType, 'audio/ogg');
    assert.equal(stream.lossless, true);
    assert.equal(stream.isLive, true);
    assert.equal(stream.sampleRate, 44100);
    assert.equal(stream.bitDepth, 16);
    assert.match(stream.quality, /16 bit \/ 44\.1 kHz/);
    assert.doesNotMatch(stream.quality, /Hi-?Res/i);
    assert.deepEqual(await provider.entities(track), []);
    assert.deepEqual(await provider.lyrics(track), []);
  }
});

test('resolve ignores injected URLs and headers, and rejects unknown station identities', async () => {
  const provider = radioProvider();
  const [stream] = await provider.resolve({ stationId: 'main', url: 'https://evil.example/audio',
    headers: { cookie: 'private', referer: 'https://evil.example/' }, codec: 'mp3', lossless: false });
  assert.equal(stream.url, 'https://stream.radioparadise.com/flac');
  assert.deepEqual(stream.headers, {});
  stream.url = 'https://evil.example/audio';
  assert.equal((await provider.resolve({ stationId: 'main' }))[0].url, 'https://stream.radioparadise.com/flac');
  for (const track of [null, {}, { stationId: '__proto__' }, { stationId: '../flac' },
    { stationId: 'https://stream.radioparadise.com/flac' }, { stationId: 'main', source: 'bilibili' }]) {
    await assert.rejects(provider.resolve(track), /未识别/);
  }
});

test('radio URL allowlist rejects credentials, ports, queries, fragments and normalized escapes', () => {
  const base = 'https://stream.radioparadise.com';
  const rejected = [null, undefined, {}, 1, new URL(base + '/flac'),
    'http://stream.radioparadise.com/flac', 'https://other.radioparadise.com/flac',
    'https://stream.radioparadise.com.evil.example/flac',
    'https://evil.example@stream.radioparadise.com/flac',
    'https://user:pass@stream.radioparadise.com/flac',
    base + ':443/flac', base + ':8443/flac', base + '/flac?', base + '/flac?token=1',
    base + '/flac#', base + '/flac#fragment', base + '/flac/', base + '/mp3-192',
    base + '/flacm', base + '/beyond-flac', base + '/%66lac', base + '/other/../flac',
    'https://STREAM.radioparadise.com/flac', ' ' + base + '/flac', base + '/flac\n'];
  for (const value of rejected) assert.equal(isRadioMediaURL(value), false, String(value));
});
