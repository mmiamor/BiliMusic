import test from 'node:test';
import assert from 'node:assert/strict';
import { openLibrary } from '../src/library.mjs';

test('favorites with the same platform ID stay separate by type and survive reopening', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const entries = [
    ['bilibili', 'uploader'], ['bilibili', 'collection'], ['kuwo', 'artist'], ['kuwo', 'album']
  ].map(([source, type]) => ({ id: '12', source, type, title: type }));
  const first = openLibrary(storage);
  for (const item of entries) assert.equal(first.toggle(item.type, item), true);
  first.refresh({ ...entries[0], title: '已解析的名称' });
  const second = openLibrary(storage);
  assert.equal(second.list('uploader')[0].title, '已解析的名称');
  assert.equal(second.toggle('collection', entries[1]), false);
  const third = openLibrary(storage);
  assert.equal(third.list('collection').length, 0);
  for (const item of [entries[0], entries[2], entries[3]]) assert.equal(third.has(item.type, item), true);
});
