import test from 'node:test';
import assert from 'node:assert/strict';
import { CommentFeed } from '../src/comment-feed.mjs';

const song = (id) => ({ source: 'netease', id: 'netease:' + id, rid: String(id) });
const entry = (id) => ({ id: String(id), text: String(id) });
function fixture() {
  const requests = [];
  const feed = new CommentFeed(
    (track, options) =>
      new Promise((resolve, reject) => {
        requests.push({ track, options, resolve, reject });
      }),
    () => {},
  );
  return { feed, requests };
}

test('late replies after changing song or sort never replace the visible comments', async () => {
  const { feed, requests } = fixture();
  const oldSong = feed.open(song(1));
  const oldSort = feed.open(song(2));
  const current = feed.open(song(2), 'new');
  requests[2].resolve({ items: [entry(30)], hasMore: true, total: 91 });
  requests[1].reject(Error('old'));
  requests[0].resolve({ items: [entry(10)], hasMore: false, total: 1 });
  await Promise.all([current, oldSort, oldSong]);
  assert.deepEqual(feed.items, [entry(30)]);
  assert.equal(feed.error, '');
  assert.equal(feed.total, 91);
  assert.equal(feed.sort, 'new');
});
test('more removes duplicate IDs, refresh replaces old pages and a failed refresh preserves visible items', async () => {
  const { feed, requests } = fixture();
  const first = feed.open(song(1));
  requests[0].resolve({ items: [entry(2)], total: null, hasMore: true });
  await first;
  const more = feed.load(true);
  assert.equal(requests[1].options.page, 2);
  requests[1].resolve({ items: [entry(2), entry(1)], hasMore: false });
  await more;
  assert.deepEqual(feed.items, [entry(2), entry(1)]);
  const refresh = feed.load();
  requests[2].reject(Error('offline'));
  await refresh;
  assert.deepEqual(feed.items, [entry(2), entry(1)]);
  const retry = feed.load();
  requests[3].resolve({ items: [entry(3)], hasMore: false });
  await retry;
  assert.deepEqual(feed.items, [entry(3)]);
  const pending = feed.load();
  feed.close();
  requests[4].reject(Error('late'));
  await pending;
  assert.equal(feed.track, null);
  assert.equal(feed.error, '');
});
