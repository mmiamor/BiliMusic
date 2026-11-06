import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const networkCode = await readFile(new URL('../windows/network.cjs', import.meta.url), 'utf8');

function nativeNetwork() {
  const calls = [];
  const net = { request(options) {
    const request = new EventEmitter();
    const call = { options, headers: {} };
    calls.push(call);
    request.setHeader = (name, value) => { call.headers[name.toLowerCase()] = value; };
    request.abort = () => request.emit('close');
    request.end = () => queueMicrotask(() => {
      const response = Readable.from([Buffer.from('{"code":0,"data":{"archives":[]}}')]);
      response.statusCode = 200;
      response.headers = { 'content-type': ['application/json'], 'set-cookie': ['private-session=hidden'] };
      response.once('end', () => request.emit('close'));
      request.emit('response', response);
    });
    return request;
  } };
  const context = { module: { exports: {} }, require: name => name === 'electron' ? { net } : require(name),
    URL, Response, Buffer, setTimeout, clearTimeout };
  vm.runInNewContext(networkCode, context, { filename: 'network.cjs' });
  return { ...context.module.exports, calls };
}

test('Windows collection requests retain full provider referrers with a compatible Chromium policy and session cookies', async () => {
  const { requestText, calls } = nativeNetwork();
  const result = await requestText({
    url: 'https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=50&season_id=16',
    headers: { Referer: 'https://space.bilibili.com/50', Origin: 'https://space.bilibili.com',
      Cookie: 'caller-must-not-inject-session', 'User-Agent': 'BiliMusic' },
  });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).code, 0);
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer-when-downgrade');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].headers.referer, 'https://space.bilibili.com/50');
  assert.equal(calls[0].headers.origin, 'https://space.bilibili.com');
  assert.equal(calls[0].headers.cookie, undefined);
  assert.equal(result.headers['set-cookie'], undefined);
});

test('Windows provider requests still reject non-HTTPS, unapproved, credential-bearing and passport URLs before networking', async () => {
  const { requestText, calls } = nativeNetwork();
  for (const url of ['http://api.bilibili.com/x/web-interface/nav',
    'https://api.bilibili.com.evil.test/', 'https://name:password@api.bilibili.com/',
    'https://api.bilibili.com:444/', 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate']) {
    await assert.rejects(requestText({ url }), /平台范围|官方登录/);
  }
  assert.equal(calls.length, 0);
});

test('Windows radio accepts only the four official HTTPS stream paths and retains the Ogg MIME', () => {
  const { checkedSource } = nativeNetwork();
  for (const path of ['flac', 'mellow-flac', 'rock-flac', 'global-flac']) {
    const source = checkedSource({ url: 'https://stream.radioparadise.com/' + path, mimeType: 'audio/ogg' });
    assert.equal(source.mimeType, 'audio/ogg');
    assert.equal(source.url, 'https://stream.radioparadise.com/' + path);
  }
  for (const url of ['http://stream.radioparadise.com/flac', 'https://stream.radioparadise.com/other',
    'https://stream.radioparadise.com/flac?url=http://127.0.0.1', 'https://stream.radioparadise.com/flac#track',
    'https://stream.radioparadise.com.evil.test/flac', 'https://sub.stream.radioparadise.com/flac',
    'https://user:secret@stream.radioparadise.com/flac', 'https://stream.radioparadise.com:444/flac',
    'https://stream.radioparadise.com:443/flac', 'https://STREAM.radioparadise.com/flac',
    'https://stream.radioparadise.com/other/../flac', 'https://stream.radioparadise.com/flac?',
    'https://stream.radioparadise.com/flac#']) {
    assert.throws(() => checkedSource({ url }), /平台范围/);
  }
});
