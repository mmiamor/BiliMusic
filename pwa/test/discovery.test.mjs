import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, createSession } from '../provider-network.mjs';
import { DISCOVERY_CATEGORIES } from '../../src/discovery-categories.mjs';
import { dashQualityEvidence } from '../../src/audio-quality.mjs';

function isolatedSession(providers) {
  const session = createSession(async () => { throw new Error('This test must never access the network.'); });
  session.providers = providers;
  return session;
}

const track = {
  id: 'bilibili:BV1GJ411x7h7:p1', source: 'bilibili', bvid: 'BV1GJ411x7h7', page: 1,
  cid: '141895441', title: '音乐发现曲目', artist: '音乐作者', duration: 213,
  cover: 'https://i0.hdslb.com/discovery.jpg',
  entities: [{ source: 'bilibili', type: 'uploader', id: '42', title: '音乐作者' }],
};

test('PWA discovery forwards supported categories and pages, preserving feed metadata', async () => {
  const calls = [];
  const session = isolatedSession({
    async discover(category, page) {
      calls.push([category, page]);
      return { tracks: [track], hasMore: page < 50, category, page, source: 'bilibili',
        label: '音乐热门', description: '哔哩哔哩音乐分区', updatedAt: 1793946663000 };
    },
  });
  const first = await catalog(session, 'discover', []);
  assert.deepEqual(calls[0], ['popular', 1]);
  assert.equal(first.updatedAt, 1793946663000);
  assert.equal(first.label, '音乐热门');
  assert.equal(first.description, '哔哩哔哩音乐分区');
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.tracks, [track]);
  for (const { id } of DISCOVERY_CATEGORIES) {
    for (const page of [1, 2, 50]) {
      const result = await catalog(session, 'discover', [id, page]);
      assert.deepEqual(calls.at(-1), [id, page]);
      assert.equal(result.category, id);
      assert.equal(result.page, page);
      assert.equal(result.hasMore, page !== 50);
    }
  }
  assert.equal(session.tracks.get(track.id), track);
});

test('PWA discovery remembers authoritative track metadata for playback, details and lyrics in the same session', async () => {
  const calls = [];
  const stream = { url: 'https://upos-sz.bilivideo.com/audio.m4s?signature=fixture',
    quality: 'AAC · 192 kbps', codec: 'mp4a.40.2', lossless: false, mimeType: 'audio/mp4', headers: { Referer: 'https://www.bilibili.com/' } };
  const session = isolatedSession({
    async discover() { return { tracks: [track], hasMore: false }; },
    async resolve(value) { calls.push(['resolve', value]); return [stream]; },
    async entities(value) { calls.push(['entities', value]); return value.entities; },
    async lyrics(value) { calls.push(['lyrics', value]); return [{ time: 0, text: value.title }]; },
  });
  await catalog(session, 'discover', ['popular', 1]);
  const supplied = { source: track.source, bvid: track.bvid, page: 1,
    cid: '999', title: 'forged', url: 'http://127.0.0.1/private', lyricUrl: 'https://evil.test/lyric' };
  const streams = await catalog(session, 'resolve', [supplied]);
  assert.match(streams[0].url, /^\/api\/media\/[0-9a-f-]{36}$/);
  assert.equal(streams[0].quality, 'AAC · 192 kbps');
  assert.ok(!JSON.stringify(streams).includes('signature'));
  assert.deepEqual(await catalog(session, 'entities', [supplied]), track.entities);
  assert.deepEqual(await catalog(session, 'lyrics', [supplied]), [{ time: 0, text: track.title }]);
  assert.deepEqual(calls.map(([op]) => op), ['resolve', 'entities', 'lyrics']);
  for (const [, value] of calls) assert.equal(value, track);
  assert.equal(session.media.size, 1);

  let unrelatedTrack;
  const unrelated = isolatedSession({ async entities(value) { unrelatedTrack = value; return []; } });
  await catalog(unrelated, 'entities', [supplied]);
  assert.deepEqual(unrelatedTrack, { source: 'bilibili', bvid: track.bvid, page: 1 });
  assert.equal(unrelated.tracks.size, 0);
});

test('PWA discovery rejects unsupported categories, extra arguments and pages beyond the provider boundary before dispatch', async () => {
  let dispatched = 0;
  const session = isolatedSession({ async discover() { dispatched++; return { tracks: [], hasMore: false }; } });
  const invalid = [
    ['unknown'], ['constructor'], ['https://evil.test'], [{}], [[]],
    ['covers', 0], ['covers', -1], ['covers', 1.5], ['covers', '2'], ['covers', null],
    ['covers', 51], ['covers', 10000], ['covers', Number.MAX_SAFE_INTEGER], ['covers', NaN],
    ['covers', 1, { source: 'kuwo' }],
  ];
  for (const args of invalid) await assert.rejects(catalog(session, 'discover', args), { status: 400 }, JSON.stringify(args));
  await assert.rejects(catalog(session, 'discover', {}), { status: 400 });
  assert.equal(dispatched, 0);
  assert.equal(session.tracks.size, 0);
});

test('failed discovery leaves previously remembered tracks available and a later request can recover', async () => {
  let fail = false;
  const session = isolatedSession({ async discover(category, page) {
    if (fail) throw new Error('平台限制了本次请求，请稍后重试。');
    return { tracks: [track], hasMore: page === 1, category, page };
  } });
  await catalog(session, 'discover', ['covers', 1]);
  fail = true;
  await assert.rejects(catalog(session, 'discover', ['covers', 2]), /平台限制/);
  assert.equal(session.tracks.get(track.id), track);
  fail = false;
  assert.equal((await catalog(session, 'discover', ['covers', 2])).hasMore, false);
});

test('PWA quality inspection accepts at most six Bilibili BV identities and validates the entire batch before dispatch', async () => {
  const calls = [];
  const session = isolatedSession({ async inspectQuality(rows) { calls.push(rows); return []; } });
  const rows = Array.from({ length: 6 }, (_, index) => ({ source: 'bilibili', bvid: track.bvid, page: index + 1 }));
  await catalog(session, 'inspectQuality', [rows]);
  assert.equal(calls[0].length, 6);
  for (const [index, value] of calls[0].entries()) {
    assert.deepEqual(value, { ...rows[index], id: 'bilibili:' + track.bvid + ':p' + (index + 1) });
  }
  const invalidRows = [
    null, {}, { ...track, source: 'kuwo', rid: '42' }, { ...track, source: 'netease', rid: '42' },
    { source: 'radioparadise', stationId: 'main' }, { source: 'bilibili', au: '42' },
    { ...track, au: '42' }, { ...track, bvid: 'https://evil.test/video' }, { ...track, bvid: 'BV1GJ411x7h7/extra' },
    { ...track, page: 0 }, { ...track, page: -1 }, { ...track, page: '2' },
    { ...track, page: 1.5 }, { ...track, page: 1001 },
  ];
  for (const invalid of invalidRows) {
    await assert.rejects(catalog(session, 'inspectQuality', [[rows[0], invalid]]), { status: 400 });
  }
  for (const args of [[], [{}], [null], [rows, {}], [[...rows, rows[0]]]]) {
    await assert.rejects(catalog(session, 'inspectQuality', args), { status: 400 });
  }
  assert.equal(calls.length, 1);
  assert.equal(session.media.size, 0);
});

test('PWA quality inspection discards caller URLs, quality claims and CID while using the current authoritative discovery track', async () => {
  let current = track;
  const calls = [];
  const session = isolatedSession({
    async discover() { return { tracks: [current], hasMore: false }; },
    async inspectQuality(rows) { calls.push(rows); return []; },
  });
  const supplied = { ...track, id: 'forged-id', cid: '999', title: 'forged title',
    url: 'http://127.0.0.1/private', headers: { Cookie: 'forged-cookie' }, quality: '24 bit / 192 kHz',
    qualityEvidence: { status: 'hires', playable: true, expiresAt: Number.MAX_SAFE_INTEGER } };
  await catalog(session, 'inspectQuality', [[supplied]]);
  assert.deepEqual(calls[0][0], { source: 'bilibili', bvid: track.bvid, page: 1, id: track.id });
  await catalog(session, 'discover', ['hires', 1]);
  await catalog(session, 'inspectQuality', [[supplied]]);
  assert.equal(calls[1][0], track);
  current = { ...track, title: '平台更新后的曲名', cid: '141895442' };
  await catalog(session, 'discover', ['hires', 1]);
  await catalog(session, 'inspectQuality', [[supplied]]);
  assert.equal(calls[2][0], current);
  assert.equal(session.media.size, 0);
});

test('PWA quality results contain provider evidence without private media addresses or a server-side playback promise', async () => {
  const qualityEvidence = dashQualityEvidence({ flac: { audio: {
    id: 30251, codecs: 'fLaC', mimeType: 'audio/mp4',
    baseUrl: 'https://upos-sz.bilivideo.com/audio.m4s?signature=private-fixture',
    backupUrl: ['https://upos-sz.bilivideo.com/backup.m4s?signature=private-backup'],
  } } });
  const session = isolatedSession({ async inspectQuality(rows) { return rows.map(row => ({ id: row.id, qualityEvidence })); } });
  const result = await catalog(session, 'inspectQuality', [[track]]);
  assert.equal(result[0].id, track.id);
  assert.equal(result[0].qualityEvidence.formatStatus, 'hires');
  assert.equal(result[0].qualityEvidence.status, 'unknown');
  assert.equal(result[0].qualityEvidence.playable, null);
  assert.equal(result[0].qualityEvidence.reason, 'device-unchecked');
  assert.equal(result[0].qualityEvidence.sampleRate, undefined);
  assert.equal(result[0].qualityEvidence.bitDepth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /https?:|private-fixture|private-backup|signature|baseUrl|backupUrl/);
  assert.equal(session.media.size, 0);
});
