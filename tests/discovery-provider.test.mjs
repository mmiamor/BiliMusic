import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders } from '../src/providers.mjs';
import { DISCOVERY_CATEGORIES } from '../src/discovery-categories.mjs';

const currentTime = Math.floor(Date.now() / 1000);
const row = (number, extra = {}) => ({ type: 'video', bvid: 'BV' + String(number).padStart(10, '0'),
  typeid: '31', title: '音乐 ' + number, author: '演唱者', mid: 42,
  pic: '//i0.hdslb.com/test.jpg', duration: '3:25', pubdate: currentTime - 86400, play: 1234, ...extra });
const response = data => ({ status: 200, body: JSON.stringify({ code: 0, data }) });
function provider(respond) {
  const requests = [];
  const api = createProviders(async value => {
    const url = new URL(value);
    if (url.hostname === 'www.bilibili.com' && url.pathname === '/') return { status: 200, body: '' };
    assert.equal(url.origin, 'https://api.bilibili.com');
    assert.equal(url.pathname, '/x/web-interface/search/type');
    requests.push(url);
    return respond(url);
  });
  return { api, requests };
}

test('discovery requests the declared music regions and sorting, not the retired chart or global popular feed', async () => {
  const expected = {
    popular: [3, 'click'], latest: [3, 'pubdate'], live: [29, 'totalrank'],
    covers: [31, 'totalrank'], instrumental: [59, 'totalrank'], original: [28, 'totalrank'],
  };
  const { api, requests } = provider(url => response({ page: 1, numPages: 1,
    result: [row(1, { typeid: url.searchParams.get('tids') === '3' ? '193' : url.searchParams.get('tids') })] }));
  for (const category of DISCOVERY_CATEGORIES) {
    const result = await api.discover(category.id);
    const params = requests.at(-1).searchParams;
    assert.equal(params.get('search_type'), 'video');
    assert.equal(Number(params.get('tids')), expected[category.id][0]);
    assert.equal(params.get('order'), expected[category.id][1]);
    assert.equal(params.get('page_size'), '20');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.label, category.title);
    assert.equal(result.description, category.description);
    assert.equal(result.source, 'bilibili');
    assert.ok(Number.isSafeInteger(result.updatedAt));
  }
});

test('discovery keeps native BV identities, music partitions and clean metadata without inferring lossless from titles', async () => {
  const { api } = provider(() => response({ page: 1, numPages: 1, result: [
    row(1, { title: '<em class="keyword">Hi-Res FLAC</em> &amp; 音乐' }), row(1),
    row(2, { typeid: '17' }), row(3, { typeid: undefined }), row(4, { bvid: '../invalid' }),
    row(5, { type: 'bili_user' }), row(6, { title: '' }), null,
  ] }));
  const result = await api.discover('latest');
  assert.equal(result.tracks.length, 1);
  const track = result.tracks[0];
  assert.equal(track.id, 'bilibili:BV0000000001:p1');
  assert.equal(track.bvid, 'BV0000000001');
  assert.equal(track.title, 'Hi-Res FLAC & 音乐');
  assert.equal(track.cover, 'https://i0.hdslb.com/test.jpg');
  assert.equal(track.duration, 205);
  assert.equal(track.entities[0].id, '42');
  assert.equal(track.playCount, 1234);
  assert.equal(track.lossless, undefined);
  assert.equal(track.quality, undefined);
});

test('popular discovery fixes its thirty-day interval across pages and rejects out-of-window results', async () => {
  const { api, requests } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    const since = Number(url.searchParams.get('pubtime_begin_s'));
    const until = Number(url.searchParams.get('pubtime_end_s'));
    return response({ page, numPages: 2, result: [row(page), row(20, { pubdate: since - 1 }),
      row(21, { pubdate: until + 1 }), row(22, { pubdate: undefined })] });
  });
  assert.equal((await api.discover()).tracks.length, 1);
  assert.equal((await api.discover('popular', 2)).tracks.length, 1);
  const first = requests[0].searchParams, next = requests[1].searchParams;
  assert.equal(Number(first.get('pubtime_end_s')) - Number(first.get('pubtime_begin_s')), 30 * 86400);
  assert.equal(next.get('pubtime_end_s'), first.get('pubtime_end_s'));
  assert.equal(next.get('pubtime_begin_s'), first.get('pubtime_begin_s'));
});

test('discovery deduplicates page boundaries, caches retries and stops at the advertised final page', async () => {
  const { api, requests } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    return response({ page, numPages: 2, result: page === 1 ? [row(1), row(2)] : [row(2), row(3)] });
  });
  assert.equal((await api.discover('covers')).hasMore, true);
  const next = await api.discover('covers', 2);
  assert.deepEqual(next.tracks.map(track => track.bvid), ['BV0000000003']);
  assert.equal(next.hasMore, false);
  assert.deepEqual(await api.discover('covers', 2), next);
  assert.deepEqual((await api.discover('covers', 3)).tracks, []);
  assert.equal(requests.length, 2);
  assert.equal((await api.discover('covers')).tracks.length, 2);
  assert.equal(requests.length, 3);
});

test('one category cannot accept tracks from another music subregion', async () => {
  const { api } = provider(() => response({ page: 1, numPages: 1,
    result: [row(1, { typeid: '29' }), row(2, { typeid: '31' }), row(3, { typeid: '59' })] }));
  assert.deepEqual((await api.discover('live')).tracks.map(track => track.bvid), ['BV0000000001']);
});

test('discovery rejects unknown categories, invalid pages and jumps before making requests', async () => {
  const { api, requests } = provider(() => response({ result: [], numPages: 0 }));
  for (const category of ['constructor', 'not-music', {}, null]) await assert.rejects(api.discover(category));
  for (const page of [0, -1, 1.5, '2', NaN, 51]) await assert.rejects(api.discover('latest', page));
  await assert.rejects(api.discover('latest', 2), /第一页/);
  assert.equal(requests.length, 0);
});

test('discovery surfaces platform limits and malformed responses, while a failed page remains retryable', async () => {
  let mode = 'first';
  const { api } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    if (page === 1) return response({ page, numPages: 2, result: [row(1)] });
    if (mode === 'limited') return { status: 200, body: JSON.stringify({ code: -352, message: 'blocked' }) };
    if (mode === 'http') return { status: 412, body: 'blocked' };
    if (mode === 'malformed') return response({ page, result: {} });
    if (mode === 'wrong-page') return response({ page: 1, numPages: 2, result: [row(2)] });
    if (mode === 'bad-count') return response({ page, numPages: 'unknown', result: [row(2)] });
    return response({ page, numPages: 2, result: [row(2)] });
  });
  await api.discover('covers');
  for (const failure of ['limited', 'http', 'malformed', 'wrong-page', 'bad-count']) {
    mode = failure;
    await assert.rejects(api.discover('covers', 2));
  }
  mode = 'good';
  assert.deepEqual((await api.discover('covers', 2)).tracks.map(track => track.bvid), ['BV0000000002']);
});

test('a late earlier refresh cannot corrupt the newer category snapshot', async () => {
  let releaseOld;
  let firstCount = 0;
  const { api } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    if (page === 1 && ++firstCount === 1) return new Promise(resolve => { releaseOld = resolve; });
    return response({ page, numPages: 2, result: page === 1 ? [row(2)] : [row(2), row(3)] });
  });
  const old = api.discover('covers');
  while (!releaseOld) await new Promise(resolve => setImmediate(resolve));
  await api.discover('covers');
  releaseOld(response({ page: 1, numPages: 2, result: [row(3)] }));
  await old;
  assert.deepEqual((await api.discover('covers', 2)).tracks.map(track => track.bvid), ['BV0000000003']);
});

test('a failed refresh preserves the successful pagination and duplicate boundary for loading more', async () => {
  let failRefresh = false;
  const { api } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    if (page === 1 && failRefresh) throw new Error('refresh failed');
    return response({ page, numPages: 3,
      result: page === 1 ? [row(1)] : page === 2 ? [row(1), row(2)] : [row(2), row(3)] });
  });
  await api.discover('covers');
  await api.discover('covers', 2);
  failRefresh = true;
  await assert.rejects(api.discover('covers'), /refresh failed/);
  const next = await api.discover('covers', 3);
  assert.deepEqual(next.tracks.map(track => track.bvid), ['BV0000000003']);
  assert.equal(next.hasMore, false);
});

test('an obsolete successful refresh cannot replace the preserved feed after the latest refresh fails', async () => {
  let releaseOlder;
  let firstCount = 0;
  const { api } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    if (page === 1) {
      firstCount++;
      if (firstCount === 2) return new Promise(resolve => { releaseOlder = resolve; });
      if (firstCount === 3) throw new Error('latest refresh failed');
      return response({ page, numPages: 2, result: [row(1)] });
    }
    return response({ page, numPages: 2, result: [row(1), row(2)] });
  });
  await api.discover('covers');
  const olderRefresh = api.discover('covers');
  while (!releaseOlder) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(api.discover('covers'), /latest refresh failed/);
  releaseOlder(response({ page: 1, numPages: 2, result: [row(2)] }));
  await olderRefresh;
  assert.deepEqual((await api.discover('covers', 2)).tracks.map(track => track.bvid), ['BV0000000002']);
});

test('an obsolete failed refresh cannot restore its old snapshot over a newer successful feed', async () => {
  let rejectOlder;
  let firstCount = 0;
  const { api } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    if (page === 1) {
      firstCount++;
      if (firstCount === 2) return new Promise((_resolve, reject) => { rejectOlder = reject; });
      return response({ page, numPages: 2, result: [row(firstCount === 1 ? 1 : 2)] });
    }
    return response({ page, numPages: 2, result: [row(1), row(2), row(3)] });
  });
  await api.discover('covers');
  const failedOlder = assert.rejects(api.discover('covers'), /obsolete refresh failed/);
  while (!rejectOlder) await new Promise(resolve => setImmediate(resolve));
  await api.discover('covers');
  rejectOlder(new Error('obsolete refresh failed'));
  await failedOlder;
  assert.deepEqual((await api.discover('covers', 2)).tracks.map(track => track.bvid), ['BV0000000001', 'BV0000000003']);
});

test('a late page from the old feed cannot pollute the new feed cache or its deduplication', async () => {
  let releaseOldPage;
  let firstCount = 0;
  let secondCount = 0;
  const { api } = provider(url => {
    const page = Number(url.searchParams.get('page'));
    if (page === 1) return response({ page, numPages: 2, result: [row(++firstCount)] });
    if (++secondCount === 1) return new Promise(resolve => { releaseOldPage = resolve; });
    return response({ page, numPages: 2, result: [row(2), row(3)] });
  });
  await api.discover('covers');
  const oldPage = api.discover('covers', 2);
  while (!releaseOldPage) await new Promise(resolve => setImmediate(resolve));
  await api.discover('covers');
  releaseOldPage(response({ page: 2, numPages: 2, result: [row(1), row(3)] }));
  await oldPage;
  assert.deepEqual((await api.discover('covers', 2)).tracks.map(track => track.bvid), ['BV0000000003']);
  assert.equal(secondCount, 2);
});
