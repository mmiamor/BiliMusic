import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { staticFileResponse } from '../windows/static.cjs';

let root;
const bytes = Buffer.from('fLaC0123456789');
const request = (name = '/sample.flac', options = {}) => new Request('bilimusic://app' + name, options);
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bilimusic-static-'));
  await Promise.all([
    writeFile(path.join(root, 'sample.flac'), bytes),
    writeFile(path.join(root, 'empty.flac'), ''),
    writeFile(path.join(root, 'app.mjs'), 'export const ready=true;'),
    mkdir(path.join(root, 'folder')),
  ]);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

test('Windows bundled audio exposes its complete bounded byte length', async () => {
  const response = await staticFileResponse(request(), root);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/flac');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.equal(response.headers.get('content-range'), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('Windows audio serves initial, bounded, open, suffix and clamped ranges', async () => {
  for (const [range, start, end] of [
    ['bytes=0-', 0, 13], ['bytes=4-8', 4, 8], ['bytes=10-', 10, 13],
    ['bytes=-4', 10, 13], ['bytes=-99', 0, 13], ['bytes=12-999', 12, 13], ['bytes=0-0', 0, 0],
  ]) {
    const response = await staticFileResponse(request('/sample.flac', { headers: { range } }), root);
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`, range);
    assert.equal(response.headers.get('content-length'), String(end - start + 1), range);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1), range);
  }
});

test('Windows audio rejects malformed, multiple and unsatisfiable ranges with a bounded 416', async () => {
  for (const range of ['', 'bytes=14-', 'bytes=8-4', 'bytes=-0', 'bytes=0-1,4-5',
    'bytes=9007199254740992-', 'items=0-1', 'bytes=-', 'bytes=NaN-']) {
    const response = await staticFileResponse(request('/sample.flac', { headers: { range } }), root);
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), `bytes */${bytes.length}`);
    assert.equal(response.headers.get('content-length'), '0');
    assert.equal(await response.text(), '');
  }
});

test('Windows HEAD preserves full and partial audio headers without reading a body', async () => {
  const full = await staticFileResponse(request('/sample.flac', { method: 'HEAD' }), root);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-length'), String(bytes.length));
  assert.equal(full.body, null);
  const partial = await staticFileResponse(request('/sample.flac', { method: 'HEAD', headers: { range: 'bytes=4-8' } }), root);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 4-8/${bytes.length}`);
  assert.equal(partial.headers.get('content-length'), '5');
  assert.equal(partial.body, null);
});

test('Windows empty files have zero length and no satisfiable byte range', async () => {
  const full = await staticFileResponse(request('/empty.flac'), root);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-length'), '0');
  assert.equal(full.body, null);
  for (const range of ['bytes=0-', 'bytes=-1']) {
    const response = await staticFileResponse(request('/empty.flac', { headers: { range } }), root);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */0');
  }
});

test('Windows static routing retains app origin, method and path restrictions', async () => {
  for (const input of [
    new Request('bilimusic://other/sample.flac'), new Request('https://app/sample.flac'),
    request('/sample.flac', { method: 'POST' }), request('/'),
    request('/%2e%2e%2foutside.flac'), request('/%2e%2e%5coutside.flac'),
  ]) assert.equal((await staticFileResponse(input, root)).status, 403, input.url);
  assert.equal((await staticFileResponse(request('/%ZZ'), root)).status, 400);
  assert.equal((await staticFileResponse(request('/missing.flac'), root)).status, 404);
  assert.equal((await staticFileResponse(request('/folder'), root)).status, 404);
});

test('Windows ES modules keep a JavaScript MIME type through the static helper', async () => {
  const response = await staticFileResponse(request('/app.mjs'), root);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await response.text(), 'export const ready=true;');
});
