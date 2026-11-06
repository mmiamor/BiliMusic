import test from 'node:test';
import assert from 'node:assert/strict';
import { biliProvider } from '../src/bilibili.mjs';
import { adaptQualityForDevice, dashQualityEvidence } from '../src/audio-quality.mjs';

const cdn = 'https://upos-sz.bilivideo.com/audio.m4s?private_signature=fixture';
const flac = { id: 30251, codecs: 'fLaC', mimeType: 'audio/mp4', baseUrl: cdn };
const aac = { id: 30280, codecs: 'mp4a.40.2', mimeType: 'audio/mp4', baseUrl: cdn };
const track = number => ({ source: 'bilibili', bvid: 'BV' + String(number).padStart(10, '0'), page: 1 });
const reply = data => ({ status: 200, body: JSON.stringify({ code: 0, data }) });
const tick = () => new Promise(resolve => setImmediate(resolve));

function provider(playurl, { canPlayType = () => 'probably', detail, nav } = {}) {
  const calls = [];
  const api = biliProvider(async value => {
    const url = new URL(value);
    calls.push(url);
    if (url.pathname === '/') return { status: 200, body: '' };
    if (url.pathname === '/x/web-interface/view') return detail ? detail(url) : reply({ bvid: url.searchParams.get('bvid'),
      pages: [{ page: 1, cid: '101' }, { page: 2, cid: '202' }] });
    if (url.pathname === '/x/web-interface/nav') return nav ? nav(url) : reply({
      wbi_img: { img_url: 'https://i0.hdslb.com/' + '1'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + '2'.repeat(32) + '.png' },
    });
    assert.equal(url.pathname, '/x/player/wbi/playurl');
    return playurl(url);
  }, canPlayType);
  return { api, calls };
}

test('Hi-Res requires explicit FLAC metadata, a platform tier and support for the actual container', () => {
  const dash = { flac: { audio: flac }, audio: [aac] };
  const probes = [];
  const confirmed = dashQualityEvidence(dash, type => { probes.push(type); return 'probably'; });
  assert.equal(confirmed.status, 'hires');
  assert.equal(confirmed.platformTier, 'hires');
  assert.equal(confirmed.playable, true);
  assert.equal(confirmed.lossless, true);
  assert.match(confirmed.label, /平台 Hi-Res/);
  assert.ok(probes.includes('audio/mp4; codecs="fLaC"'));
  assert.equal(confirmed.sampleRate, undefined);
  assert.equal(confirmed.bitDepth, undefined);
  assert.ok(!JSON.stringify(confirmed).includes('private_signature'));
  const standaloneOnly = dashQualityEvidence(dash, type => type === 'audio/flac' ? 'probably' : '');
  assert.equal(standaloneOnly.status, 'unsupported');
  assert.equal(standaloneOnly.playable, false);
  assert.equal(standaloneOnly.formatStatus, 'hires');
});

test('raw FLAC MIME is explicit evidence while ordinary FLAC does not prove the platform Hi-Res tier', () => {
  const raw = { mime_type: 'audio/flac', base_url: cdn };
  const platform = dashQualityEvidence({ flac: { audio: raw } }, () => 'probably');
  assert.equal(platform.status, 'hires');
  assert.equal(platform.mediaType, 'audio/flac');
  const ordinary = dashQualityEvidence({ audio: [raw] }, () => 'probably');
  assert.equal(ordinary.status, 'lossless');
  assert.equal(ordinary.platformTier, 'standard');
  assert.ok(!ordinary.label.includes('Hi-Res'));
});

test('a declared Hi-Res slot returning AAC is described as current AAC, not as lossless or globally unavailable Hi-Res', () => {
  const evidence = dashQualityEvidence({ flac: { display: true, audio: { ...aac, id: 30251 } } }, () => 'probably');
  assert.equal(evidence.status, 'lossy');
  assert.equal(evidence.lossless, false);
  assert.equal(evidence.label, '当前返回 AAC');
  assert.equal(evidence.platformTier, 'standard');
});

test('missing codecs, absent URLs, foreign media hosts and contradictory MIME remain unverified', () => {
  for (const item of [
    { ...flac, codecs: undefined }, { ...flac, baseUrl: '' },
    { ...flac, baseUrl: 'https://evil.test/audio.flac' },
    { ...flac, mimeType: 'audio/aac' }, { ...aac, mimeType: 'audio/flac' },
  ]) {
    const evidence = dashQualityEvidence({ flac: { audio: item } }, () => 'probably');
    assert.equal(evidence.status, 'unknown');
    assert.equal(evidence.lossless, null);
    assert.equal(evidence.playable, null);
  }
  assert.equal(dashQualityEvidence({ flac: { display: true, audio: null } }, () => 'probably').status, 'unknown');
});

test('PWA evidence stays device-unchecked until the actual browser confirms its container', () => {
  const server = dashQualityEvidence({ flac: { audio: flac } });
  assert.equal(server.formatStatus, 'hires');
  assert.equal(server.status, 'unknown');
  assert.equal(server.reason, 'device-unchecked');
  assert.equal(server.playable, null);
  assert.equal(adaptQualityForDevice(server, () => 'probably').status, 'hires');
  assert.equal(adaptQualityForDevice(server, () => '').status, 'unsupported');
  assert.equal(server.status, 'unknown');
});

test('quality probes derive the correct page CID and deduplicate identities without trusting supplied track metadata', async () => {
  const { api, calls } = provider(url => {
    assert.equal(url.searchParams.get('cid'), '202');
    assert.equal(url.searchParams.get('fnval'), '4048');
    return reply({ dash: { flac: { audio: flac } } });
  });
  const item = { ...track(1), page: 2, cid: '999999', title: 'Hi-Res 24/192', id: 'forged' };
  const result = await api.inspectQuality([item, item]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'bilibili:BV0000000001:p2');
  assert.equal(result[0].qualityEvidence.status, 'hires');
  assert.equal(calls.filter(url => url.pathname === '/x/player/wbi/playurl').length, 1);
  await assert.rejects(api.inspectQuality(Array.from({ length: 7 }, (_, i) => track(i))));
  await assert.rejects(api.inspectQuality([{ ...track(1), source: 'kuwo' }]));
});

test('six-item batches are limited to two simultaneous probes and share WBI keys', async () => {
  let active = 0, maximum = 0;
  const { api, calls } = provider(async () => {
    active++; maximum = Math.max(maximum, active);
    await tick();
    active--;
    return reply({ dash: { audio: [aac] } });
  });
  const result = await api.inspectQuality(Array.from({ length: 6 }, (_, i) => track(i + 1)));
  assert.equal(result.length, 6);
  assert.equal(maximum, 2);
  assert.ok(result.every(item => item.qualityEvidence.status === 'lossy'));
  assert.equal(calls.filter(url => url.pathname === '/x/web-interface/nav').length, 1);
});

test('quality cache expires and account reset immediately invalidates prior-session evidence', async context => {
  let now = Date.now(), calls = 0, entitled = false;
  context.mock.method(Date, 'now', () => now);
  const { api } = provider(() => {
    calls++;
    return reply({ dash: entitled ? { flac: { audio: flac } } : { audio: [aac] } });
  });
  assert.equal((await api.inspectQuality([track(1)]))[0].qualityEvidence.status, 'lossy');
  await tick();
  await api.inspectQuality([track(1)]);
  assert.equal(calls, 1);
  now += 10 * 60 * 1000 + 1;
  await api.inspectQuality([track(1)]);
  assert.equal(calls, 2);
  await tick();
  entitled = true;
  api.resetSession();
  assert.equal((await api.inspectQuality([track(1)]))[0].qualityEvidence.status, 'hires');
  assert.equal(calls, 3);
});

test('login restrictions and network errors stay unknown, never a claim that no Hi-Res track exists', async context => {
  let now = Date.now(), calls = 0;
  context.mock.method(Date, 'now', () => now);
  const { api } = provider(() => {
    calls++;
    return { status: 200, body: JSON.stringify({ code: -101, message: 'not logged in' }) };
  });
  const first = (await api.inspectQuality([track(1)]))[0].qualityEvidence;
  assert.equal(first.status, 'unknown');
  assert.equal(first.reason, 'login-required');
  assert.equal(first.lossless, null);
  assert.equal(first.expiresAt - first.checkedAt, 30000);
  await tick();
  await api.inspectQuality([track(1)]);
  assert.equal(calls, 1);
  now += 30001;
  await api.inspectQuality([track(1)]);
  assert.equal(calls, 2);
});

test('UI probe timeouts finish the batch without starting more than two unfinished native requests', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const releases = [];
  const { api } = provider(() => new Promise(resolve => releases.push(resolve)));
  const pending = api.inspectQuality(Array.from({ length: 6 }, (_, i) => track(i + 1)));
  for (let i = 0; i < 20 && releases.length < 2; i++) await tick();
  assert.equal(releases.length, 2);
  context.mock.timers.tick(6001);
  const result = await pending;
  assert.ok(result.every(item => item.qualityEvidence.status === 'unknown' && item.qualityEvidence.reason === 'timeout'));
  assert.equal(releases.length, 2);
  releases.forEach(resolve => resolve(reply({ dash: { flac: { audio: flac } } })));
  await tick();
  assert.equal(releases.length, 2);
});

test('an old account probe cannot overwrite the new account cache after reset', async () => {
  let releaseOld, count = 0;
  const { api } = provider(() => {
    if (++count === 1) return new Promise(resolve => { releaseOld = resolve; });
    return reply({ dash: { flac: { audio: flac } } });
  });
  const old = api.inspectQuality([track(1)]);
  while (!releaseOld) await tick();
  api.resetSession();
  assert.equal((await old)[0].qualityEvidence.reason, 'session-changed');
  const next = await api.inspectQuality([track(1)]);
  assert.equal(next[0].qualityEvidence.status, 'hires');
  releaseOld(reply({ dash: { audio: [aac] } }));
  await tick();
  assert.equal((await api.inspectQuality([track(1)]))[0].qualityEvidence.status, 'hires');
  assert.equal(count, 2);
});
