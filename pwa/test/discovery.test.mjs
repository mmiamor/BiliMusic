import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, createSession } from '../provider-network.mjs';
import { DISCOVERY_CATEGORIES } from '../../src/discovery-categories.mjs';

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
