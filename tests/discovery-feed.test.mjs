import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscoveryFeed } from '../src/discovery-feed.mjs';

const track = (id, source = 'bilibili', extra = {}) => ({ id: String(id), source, title: '曲目 ' + id, ...extra });
const page = (tracks, extra = {}) => ({ tracks, hasMore: true, label: '音乐推荐', description: '公开音乐投稿', ...extra });

function fixture({ ttl = 600000, time = 1000 } = {}) {
  const requests = [], changes = [];
  let clock = time;
  const feed = new DiscoveryFeed(
    (category, number) => new Promise((resolve, reject) => requests.push({ category, page: number, resolve, reject })),
    () => changes.push({ category: feed.category, loading: feed.current.loading, ids: feed.current.tracks.map(t => t.id) }),
    { ttl, now: () => clock },
  );
  return { feed, requests, changes, tick: value => { clock = value; } };
}

test('discovery is lazy and reuses in-flight initial, refresh and more requests', async () => {
  const { feed, requests } = fixture();
  assert.equal(feed.category, 'popular');
  assert.deepEqual(feed.current, {
    tracks: [], page: 0, loading: false, error: '', hasMore: false,
    label: '', description: '', fetchedAt: 0,
  });
  assert.equal(requests.length, 0);
  const first = feed.load();
  assert.equal(first, feed.load());
  assert.equal(first, feed.load({ refresh: true }));
  assert.equal(first, feed.load({ more: true }));
  assert.equal(requests.length, 1);
  assert.equal(feed.current.loading, true);
  requests[0].resolve(page([track(1)]));
  await first;
  const more = feed.load({ more: true });
  assert.equal(more, feed.load({ more: true }));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].page, 2);
  requests[1].resolve(page([track(2)]));
  await more;
  const refresh = feed.load({ refresh: true });
  assert.equal(refresh, feed.load({ refresh: true }));
  requests[2].resolve(page([track(3)]));
  await refresh;
  assert.deepEqual(feed.current.tracks, [track(3)]);
  assert.equal(feed.current.page, 1);
});

test('out-of-order category replies fill their own caches without notifying or replacing the active feed', async () => {
  const { feed, requests, changes } = fixture();
  const popular = feed.load();
  const instrumental = feed.select('instrumental');
  assert.deepEqual(requests.map(r => [r.category, r.page]), [['popular', 1], ['instrumental', 1]]);
  requests[1].resolve(page([track(20)], { label: '器乐', description: '器乐分类' }));
  await instrumental;
  const visible = feed.current;
  const before = changes.length;
  requests[0].resolve(page([track(10)], { label: '热门' }));
  await popular;
  assert.equal(changes.length, before);
  assert.equal(feed.current, visible);
  assert.deepEqual(feed.current.tracks, [track(20)]);
  assert.equal(feed.current.label, '器乐');
  await feed.select('popular');
  assert.deepEqual(feed.current.tracks, [track(10)]);
  assert.equal(feed.current.label, '热门');
  assert.equal(requests.length, 2);
  assert.equal(changes.at(-1).category, 'popular');
});

test('returning to an in-flight category reuses its request and inactive failures stay isolated', async () => {
  const { feed, requests, changes } = fixture();
  const popular = feed.load();
  const covers = feed.select('covers');
  assert.equal(feed.select('popular'), popular);
  assert.equal(requests.length, 2);
  const before = changes.length;
  requests[1].reject(Error('cover request failed'));
  await covers;
  assert.equal(changes.length, before);
  assert.equal(feed.current.error, '');
  assert.equal(feed.current.loading, true);
  requests[0].resolve(page([track(1)]));
  await popular;
  assert.equal(feed.current.loading, false);
});

test('pagination deduplicates entry keys and stops if an upstream page adds no songs', async () => {
  const { feed, requests } = fixture();
  const first = feed.load();
  requests[0].resolve(page([track(1), track(1), track(2)]));
  await first;
  assert.deepEqual(feed.current.tracks, [track(1), track(2)]);
  const more = feed.load({ more: true });
  requests[1].resolve(page([track(2), track(3), track(1, 'kuwo'), track(1, 'bilibili', { type: 'other' })]));
  await more;
  assert.equal(feed.current.tracks.length, 5);
  assert.equal(feed.current.hasMore, true);
  const duplicates = feed.load({ more: true });
  requests[2].resolve(page([track(2), track(3)]));
  await duplicates;
  assert.equal(feed.current.page, 3);
  assert.equal(feed.current.hasMore, false);
  await feed.load({ more: true });
  assert.equal(requests.length, 3);
});

test('refresh supersedes an older pagination response, including late errors and loading state', async () => {
  const { feed, requests, changes } = fixture();
  const first = feed.load();
  requests[0].resolve(page([track(1)]));
  await first;
  const oldMore = feed.load({ more: true });
  const refresh = feed.load({ refresh: true });
  assert.equal(requests[1].page, 2);
  assert.equal(requests[2].page, 1);
  const before = changes.length;
  requests[1].reject(Error('obsolete page two'));
  await oldMore;
  assert.equal(changes.length, before);
  assert.equal(feed.current.loading, true);
  assert.equal(feed.current.error, '');
  requests[2].resolve(page([track(10)]));
  await refresh;
  const stalePage = feed.load({ more: true });
  const nextRefresh = feed.load({ refresh: true });
  requests[4].resolve(page([track(20)]));
  await nextRefresh;
  const settled = changes.length;
  requests[3].resolve(page([track(11)]));
  await stalePage;
  assert.equal(changes.length, settled);
  assert.deepEqual(feed.current.tracks, [track(20)]);
  assert.equal(feed.current.page, 1);
  assert.equal(feed.current.loading, false);
});

test('failed refresh and pagination preserve existing songs, metadata and retry position', async () => {
  const { feed, requests } = fixture();
  const first = feed.load();
  requests[0].resolve(page([track(1)]));
  await first;
  const more = feed.load({ more: true });
  requests[1].resolve(page([track(2)]));
  await more;
  const expected = { ...feed.current };
  const refresh = feed.load({ refresh: true });
  requests[2].reject(Error('offline'));
  await refresh;
  assert.deepEqual(feed.current, { ...expected, error: 'offline' });
  const failedMore = feed.load({ more: true });
  assert.equal(feed.current.error, '');
  assert.equal(requests[3].page, 3);
  requests[3].reject(Error('page unavailable'));
  await failedMore;
  assert.deepEqual(feed.current, { ...expected, error: 'page unavailable' });
  const retry = feed.load({ more: true });
  assert.equal(requests[4].page, 3);
  requests[4].resolve(page([track(3)], { hasMore: false }));
  await retry;
  assert.deepEqual(feed.current.tracks, [track(1), track(2), track(3)]);
  assert.equal(feed.current.error, '');
});

test('successful empty feeds are cached distinctly from errors, even when fetched at timestamp zero', async () => {
  const { feed, requests, tick } = fixture({ ttl: 100, time: 0 });
  const failed = feed.load();
  requests[0].reject(Error('unavailable'));
  await failed;
  assert.equal(feed.current.page, 0);
  assert.equal(feed.current.error, 'unavailable');
  const retry = feed.load();
  requests[1].resolve(page([], { hasMore: true }));
  await retry;
  assert.equal(feed.current.page, 1);
  assert.equal(feed.current.fetchedAt, 0);
  assert.equal(feed.current.error, '');
  assert.equal(feed.current.hasMore, false);
  tick(99);
  await feed.select('popular');
  await feed.load();
  assert.equal(requests.length, 2);
  tick(100);
  const expired = feed.select('popular');
  assert.equal(requests.length, 3);
  requests[2].resolve(page([track(1)]));
  await expired;
  assert.equal(feed.current.fetchedAt, 100);
});

test('loading later pages does not extend the first-page cache lifetime and invalid responses preserve it', async () => {
  const { feed, requests, tick } = fixture({ ttl: 100, time: 0 });
  const first = feed.load();
  requests[0].resolve(page([track(1)]));
  await first;
  tick(90);
  const more = feed.load({ more: true });
  requests[1].resolve(page([track(2)]));
  await more;
  assert.equal(feed.current.fetchedAt, 0);
  tick(100);
  const expired = feed.load();
  assert.equal(requests[2].page, 1);
  requests[2].resolve({ hasMore: false });
  await expired;
  assert.deepEqual(feed.current.tracks, [track(1), track(2)]);
  assert.equal(feed.current.page, 2);
  assert.match(feed.current.error, /有效/);
});

test('synchronously throwing fetchers expose an error without leaving the feed loading', async () => {
  const feed = new DiscoveryFeed(() => { throw Error('synchronous failure'); });
  await feed.load();
  assert.equal(feed.current.loading, false);
  assert.equal(feed.current.error, 'synchronous failure');
  assert.equal(feed.current.page, 0);
});

test('account changes invalidate every category and discard old responses before restarting at page one', async () => {
  const { feed, requests, changes } = fixture();
  const first = feed.load();
  requests[0].resolve(page([track(1)]));
  await first;
  const oldMore = feed.load({ more: true });
  const oldCategory = feed.select('covers');
  feed.invalidate();
  assert.equal(feed.category, 'covers');
  assert.equal(feed.current.page, 0);
  assert.deepEqual(feed.current.tracks, []);
  const next = feed.load();
  assert.deepEqual(requests.map(r => [r.category, r.page]), [['popular', 1], ['popular', 2], ['covers', 1], ['covers', 1]]);
  requests[3].resolve(page([track(30)]));
  await next;
  const before = changes.length;
  requests[1].resolve(page([track(2)]));
  requests[2].resolve(page([track(20)]));
  await Promise.all([oldMore, oldCategory]);
  assert.equal(changes.length, before);
  assert.deepEqual(feed.current.tracks, [track(30)]);
  const popular = feed.select('popular');
  assert.equal(requests[4].page, 1);
  requests[4].resolve(page([track(10)]));
  await popular;
  assert.deepEqual(feed.current.tracks, [track(10)]);
});
