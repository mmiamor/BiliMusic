import test from 'node:test';
import assert from 'node:assert/strict';
import { openPlaylists } from '../src/playlists.mjs';
import { entryKey, session } from '../src/library.mjs';
import { cleanPlaylistTrack } from '../src/playlist-track.mjs';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    fail: false,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { if (this.fail) throw Error('quota denied'); values.set(key, String(value)); },
    snapshot() { return Object.fromEntries(values); },
  };
}
async function populated(storage = memoryStorage()) {
  const repository = openPlaylists({ storage });
  const { playlist } = await repository.call('create', { name: '夜间收藏', description: '三首本地示例' });
  await repository.call('add', { id: playlist.id, tracks: session });
  return { repository, storage, id: playlist.id };
}
const get = async (repository, id) => (await repository.call('get', { id })).playlist;

test('local playlist names, descriptions and track counts survive rename and reload', async () => {
  const storage = memoryStorage(), repository = openPlaylists({ storage });
  const { playlist } = await repository.call('create', { name: '  我的夜晚  ', description: '  安静听歌  ' });
  assert.equal(playlist.name, '我的夜晚'); assert.equal(playlist.description, '安静听歌');
  assert.equal(playlist.trackCount, 0);
  await repository.call('add', { id: playlist.id, tracks: [session[0]] });
  await repository.call('update', { id: playlist.id, name: '通勤收藏', description: '早上再听' });
  const reloaded = openPlaylists({ storage }), result = await get(reloaded, playlist.id);
  assert.equal(result.name, '通勤收藏'); assert.equal(result.description, '早上再听');
  assert.equal(result.trackCount, 1); assert.equal(result.tracks[0].id, session[0].id);
  assert.equal((await reloaded.call('list')).playlists[0].trackCount, 1);
});

test('adding repeated songs keeps one entry and returns independent snapshots', async () => {
  const { repository, id } = await populated();
  const input = { ...session[0], title: '重复标题不能覆盖原歌单内容' };
  await repository.call('add', { id, tracks: [input, input, session[1]] });
  const first = await get(repository, id);
  assert.equal(first.tracks.length, 3); assert.equal(first.tracks[0].title, session[0].title);
  input.title = '修改调用者对象'; first.tracks[0].title = '修改返回对象'; first.tracks.pop();
  const second = await get(repository, id);
  assert.equal(second.tracks.length, 3); assert.equal(second.tracks[0].title, session[0].title);
});

test('reorder accepts exactly the current keys and rejects stale or malformed orders atomically', async () => {
  const { repository, id } = await populated();
  const keys = session.map(entryKey), reversed = [...keys].reverse();
  await repository.call('reorder', { id, keys: reversed });
  assert.deepEqual((await get(repository, id)).tracks.map(entryKey), reversed);
  for (const bad of [keys.slice(1), [keys[0], keys[0], keys[1]], [keys[0], keys[1], 'unknown'], null, { length: 3 }, 'abc']) {
    await assert.rejects(repository.call('reorder', { id, keys: bad }), error => error.name === 'Error' && /顺序|排序/.test(error.message));
    assert.deepEqual((await get(repository, id)).tracks.map(entryKey), reversed);
  }
});

test('removing and deleting persisted playlists does not mutate a previously copied play queue', async () => {
  const { repository, storage, id } = await populated();
  const playing = (await get(repository, id)).tracks;
  await repository.call('remove', { id, trackKey: entryKey(session[1]) });
  assert.deepEqual((await get(repository, id)).tracks.map(entryKey), [entryKey(session[0]), entryKey(session[2])]);
  assert.deepEqual(playing.map(entryKey), session.map(entryKey));
  await repository.call('delete', { id });
  assert.deepEqual((await openPlaylists({ storage }).call('list')).playlists, []);
  await assert.rejects(repository.call('get', { id }), /歌单不存在/);
  assert.equal(playing.length, 3);
});

test('failed writes preserve both the live state and the last saved data for every mutation', async () => {
  const operations = [
    ['create', () => ({ name: '不可保存的新歌单' })],
    ['update', id => ({ id, name: '不可保存的重命名', description: '未落盘' })],
    ['add', id => ({ id, tracks: [{ source: 'netease', id: 'netease:1234', rid: '1234', title: '另一个合法来源', artist: 'QA', duration: 10 }] })],
    ['remove', id => ({ id, trackKey: entryKey(session[0]) })],
    ['reorder', id => ({ id, keys: session.map(entryKey).reverse() })],
    ['delete', id => ({ id })],
  ];
  for (const [operation, input] of operations) {
    const { repository, storage, id } = await populated();
    const before = await get(repository, id), disk = storage.snapshot(); storage.fail = true;
    await assert.rejects(repository.call(operation, input(id)), /quota denied/, operation);
    assert.deepEqual(await get(repository, id), before, operation + ' live state');
    assert.deepEqual(storage.snapshot(), disk, operation + ' stored state');
  }
});

test('invalid song batches cannot partially add valid entries or persist non-track metadata', async () => {
  const storage = memoryStorage(), repository = openPlaylists({ storage });
  const { playlist } = await repository.call('create', { name: '完整性检查' });
  for (const invalid of [null, { ...session[1], source: 'unknown' }, { ...session[1], title: {} }, { ...session[1], id: {} }, { ...session[1], type: 'album' }]) {
    await assert.rejects(repository.call('add', { id: playlist.id, tracks: [session[0], invalid] }));
    assert.equal((await get(repository, playlist.id)).tracks.length, 0);
  }
});

test('corrupt stored track metadata is discarded while usable playlists remain editable', async () => {
  const id = '84638e84-b2f3-4498-8eaa-c52e9b6fd274';
  const storage = memoryStorage({ 'bilimusic.playlists.v1': JSON.stringify([
    null, { id: 'bad', name: {}, tracks: [] },
    { id, name: '恢复的歌单', description: '', tracks: [null, false, {}, { ...session[1], title: {} }, session[0]] },
  ]) });
  const repository = openPlaylists({ storage });
  assert.equal((await repository.call('list')).playlists.length, 1);
  const restored = await get(repository, id);
  assert.deepEqual(restored.tracks.map(entryKey), [entryKey(session[0])]);
  await repository.call('add', { id, tracks: [session[1]] });
  assert.equal((await get(repository, id)).trackCount, 2);
  await repository.call('remove', { id, trackKey: entryKey(session[0]) });
  assert.deepEqual((await get(repository, id)).tracks.map(entryKey), [entryKey(session[1])]);
});

test('damaged or inaccessible storage starts empty and an invalid name does not create a playlist', async () => {
  for (const storage of [memoryStorage({ 'bilimusic.playlists.v1': '{invalid' }), { getItem() { throw Error('denied'); }, setItem() {} }]) {
    const repository = openPlaylists({ storage });
    assert.deepEqual((await repository.call('list')).playlists, []);
    for (const name of ['', ' '.repeat(4), '长'.repeat(81)]) await assert.rejects(repository.call('create', { name }), /歌单名称/);
    assert.deepEqual((await repository.call('list')).playlists, []);
  }
});

test('cover normalization remains repeatable and rejects Unicode URLs that exceed the canonical limit', () => {
  const prefix='https://i0.hdslb.com/',base={source:'kuwo',id:'kuwo:42',title:'测试'};
  const short=cleanPlaylistTrack({...base,cover:prefix+'界'.repeat(200)});
  assert.ok(short.cover.length<=2048);assert.deepEqual(cleanPlaylistTrack(short),short);
  const boundary=cleanPlaylistTrack({...base,cover:prefix+'a'.repeat(2048-prefix.length)});
  assert.equal(boundary.cover.length,2048);assert.deepEqual(cleanPlaylistTrack(boundary),boundary);
  assert.throws(()=>cleanPlaylistTrack({...base,cover:prefix+'界'.repeat(2048-prefix.length)}),/封面地址/);
});
