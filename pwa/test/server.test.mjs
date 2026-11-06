import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { createHandler } from '../server.mjs';
import { catalog, createSession, mediaResponse } from '../provider-network.mjs';
import metadata from '../package.json' with { type: 'json' };

const origin = 'https://music.example.org';
const official = 'https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=a64';
const flac = 'https://audio.kuwo.cn/song.flac?private_signature=123';
function response(value, headers = {}) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...headers } });
}

// Exercise the real request handler with streams so tests never bind a port.
async function call(handler, pathname, options = {}) {
  const body = options.body || {};
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = options.method || 'POST'; req.url = pathname;
  req.headers = { host: 'music.example.org', origin, 'content-type': 'application/json', ...options.headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  const chunks = [];
  const res = new Writable({ write(chunk, enc, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const headers = new Headers();
  let status = 200;
  res.setHeader = (key, value) => headers.set(key, value);
  res.writeHead = (code, fields) => {
    status = code; res.headersSent = true;
    for (const [key, value] of Object.entries(fields || {})) headers.set(key, value);
  };
  const finished = once(res, 'finish');
  await handler(req, res);
  await finished;
  const text = Buffer.concat(chunks).toString();
  return { status, headers, text, value: headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}
const cookieOf = r => r.headers.get('set-cookie').split(';')[0];

test('same-origin JSON and an approved host are required', async () => {
  const handler = createHandler({ publicOrigin: origin });
  assert.equal((await call(handler, '/api/catalog', { headers: { origin:'https://evil.test' } })).status,403);
  assert.equal((await call(handler, '/api/catalog', { headers: { host:'evil.test' } })).status,400);
  assert.equal((await call(handler, '/api/catalog', { headers: { 'content-type':'text/plain' } })).status,415);
  assert.equal((await call(handler, '/api/account/status')).value.loggedIn,false);
});

test('bootstrap reuses one secure session while unrelated requests are in flight', async () => {
  const handler = createHandler({publicOrigin:origin});
  const first = await call(handler,'/api/session');
  assert.deepEqual(first.value,{});
  const headers = { cookie:cookieOf(first) };
  const results = await Promise.all([call(handler,'/api/session',{headers}),call(handler,'/api/account/status',{headers})]);
  assert.equal(results[0].headers.get('set-cookie'),null);
  assert.equal(results[1].headers.get('set-cookie'),null);
  assert.equal(results[1].value.loggedIn,false);
});

test('only the selected Bilibili CDN host and port combinations are accepted', async () => {
  let count=0;
  const fetcher=async (_,options) => {assert.equal(options.headers['User-Agent'],'BiliMusic/'+metadata.version);count++;return new Response(null,{status:200});};
  const stream = url => mediaResponse({source:'bilibili',url,headers:{'User-Agent':'desktop'}},'HEAD','',new AbortController().signal,fetcher);
  await stream('https://node.edge.mountaintoys.cn:4483/audio');
  await stream('https://node.mcdn.bilivideo.cn:8082/audio');
  for (const url of ['https://node.edge.mountaintoys.cn:4433/a','https://cdn.kuwo.cn:8082/a','https://127.0.0.1:4483/a']) await assert.rejects(stream(url));
  assert.equal(count,2);
});

test('temporary media URLs are private, support Range and reject forged identities', async () => {
  let reads = 0;
  const handler = createHandler({ publicOrigin: origin, fetcher: async (url, options) => {
    reads++;
    if (url.startsWith('https://mobi.kuwo.cn/mobi.s')) return response({
      code:200,data:{rid:42, type:0, bitrate:2000, format:'flac',url:flac}
    });
    assert.equal(url,flac); assert.equal(options.headers.Range,'bytes=0-3');
    return new Response('fLaC',{status:206,headers:{'content-range':'bytes 0-3/400','content-length':'4'}});
  }});
  const out = await call(handler,'/api/catalog', {body:{op:'resolve',args:[{source:'kuwo',rid:'42'}]}});
  assert.equal(out.status,200);
  const cookie = cookieOf(out), [{url, quality}] = out.value.result;
  assert.match(url,/^\/api\/media\/[0-9a-f-]{36}$/);
  assert.equal(quality,'FLAC 无损'); assert.ok(!out.text.includes('private_signature'));
  assert.equal((await call(handler,url,{method:'GET'})).status,404);
  const invalid = await call(handler,url,{method:'GET',headers:{cookie,range:'bytes=0-3,5-9'}});
  assert.equal(invalid.status,416);
  const media = await call(handler,url,{method:'GET',headers:{cookie,range:'bytes=0-3'}});
  assert.equal(media.text,'fLaC'); assert.equal(media.status,206); assert.equal(media.headers.get('content-range'),'bytes 0-3/400');
  const beforeInvalidRequest = reads;
  const bad = await call(handler,'/api/catalog',{headers:{cookie},body:{op:'lyrics',args:[{source:'bilibili',au:'https://evil.test',lyricUrl:'http://127.0.0.1/'}]}});
  assert.equal(bad.status,400); assert.equal(reads,beforeInvalidRequest);
});

test('AU lyrics derive their address from the provider instead of the caller', async () => {
  const urls = [];
  const handler = createHandler({ publicOrigin:origin, fetcher:async (url, options) => {
    assert.equal(options.headers['User-Agent'],'BiliMusic/'+metadata.version);
    urls.push(url);
    if (url === 'https://www.bilibili.com/') return new Response('home');
    if(url.startsWith('https://www.bilibili.com/audio/music-service-c/web/song/info?')) {
      return response({code:0,data:{title:'Tune',uname:'Creator',lyric:'https://i0.hdslb.com/bfs/audio/lyric.lrc'}});
    }
    assert.equal(url,'https://i0.hdslb.com/bfs/audio/lyric.lrc');
    return new Response('[00:02.00]test');
  }});
  const result = await call(handler,'/api/catalog',{body:{op:'lyrics',args:[{source:'bilibili',au:11,lyricUrl:'http://127.0.0.1/secret'}]}});
  assert.equal(result.status,200); assert.equal(result.value.result[0].text,'test'); assert.equal(urls.length,3);
});

test('QR authorization is scoped to its browser and never returns provider credentials', async () => {
  const handler = createHandler({publicOrigin:origin,fetcher:async (url, options) => {
    assert.equal(options.headers['User-Agent'],'BiliMusic/'+metadata.version);
    if (url.includes('/qrcode/generate')) return response({code:0,data:{qrcode_key:'a'.repeat(32),url:official}});
    if (url.includes('/qrcode/poll')) return response({code:0,data:{code:0,refresh_token:'test-refresh'}},
      {'set-cookie':'SESSDATA=test-private; Domain=.bilibili.com; Secure; Path=/'});
    assert.equal(url,'https://api.bilibili.com/x/web-interface/nav');
    assert.match(options.headers.Cookie,/SESSDATA=test-private/);
    return response({code:0,data:{isLogin:true,uname:'测试账号'}});
  }});
  const qr = await call(handler,'/api/account/qr'), cookie=cookieOf(qr);
  assert.match(qr.value.image,/^data:image\/png;base64,/);assert.equal(qr.value.url,official);
  assert.match(qr.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await call(handler,'/api/account/poll')).value.status,'expired');
  const done=await call(handler,'/api/account/poll',{headers:{cookie}});
  assert.deepEqual(done.value,{status:'done'});assert.ok(!done.text.includes('test-private'));
  const status=await call(handler,'/api/account/status',{headers:{cookie}});
  assert.deepEqual(status.value,{loggedIn:true,name:'测试账号'});
  const logout=await call(handler,'/api/account/logout',{headers:{cookie}});
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await call(handler,'/api/account/status',{headers:{cookie}})).value.loggedIn,false);
});

test('media redirects must stay in the same provider CDN family', async () => {
  let count = 0;
  await assert.rejects(mediaResponse({source:'kuwo',url:flac},'GET','',new AbortController().signal,async () => {
    count++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});
  }));
  assert.equal(count,1);
});

test('static audio and shell are available without platform accounts', async () => {
  const handler=createHandler({publicOrigin:origin});
  const html=await call(handler,'/',{method:'GET'});
  assert.equal(html.status,200);assert.match(html.text,/main id="workspace"/);
  const clip=await call(handler,'/assets/mist.flac',{method:'GET',headers:{range:'bytes=0-3'}});
  assert.equal(clip.text,'fLaC');assert.equal(clip.status,206);
  assert.equal((await call(handler,'/%2e%2e%2fpackage.json',{method:'GET'})).status,404);
});

test('cloud music comments use a provider ID, validated sort and page, and carry no Bilibili cookies', async () => {
  const paths = [];
  const session = createSession(async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://music.163.com');
    assert.equal(options.headers.Cookie, undefined);
    paths.push(target.pathname);
    const item = { commentId: 99, user: { nickname: '听众' }, content: '试听记录', likedCount: 3, time: 1710000000000 };
    return response({ code: 200, comments: [item], hotComments: [item], total: 1, more: false, hasMore: false });
  });
  await session.jar.setCookie('SESSDATA=local-fixture; Domain=.bilibili.com; Path=/', 'https://api.bilibili.com/');
  const track = { source: 'netease', rid: '42', url: 'https://evil.test' };
  for (const sort of ['hot', 'new']) {
    const page = await catalog(session, 'comments', [track, { sort, page: 1 }]);
    assert.equal(page.items[0].text, '试听记录');
    assert.equal(String(page.items[0].id), '99');
  }
  assert.deepEqual(paths, ['/api/v1/resource/hotcomments/R_SO_4_42', '/api/v1/resource/comments/R_SO_4_42']);
  const badRequests = [
    [{ ...track, rid: '42/../../private' }], [{ ...track, rid: [42] }], [{ ...track, source: 'kuwo' }],
    [track, { sort: 'oldest' }], [track, { page: -1 }], [track, {page: '2'}],
  ];
  for (const args of badRequests) await assert.rejects(catalog(session, 'comments', args), { status: 400 });
  assert.equal(paths.length, 2);
});

test('cloud music metadata and media redirects cannot redirect a session to a different platform', async () => {
  const urls = [];
  const session = createSession(async url => {
    urls.push(url);
    return new Response(null, { status: 302, headers: { location: 'https://api.bilibili.com/x/web-interface/nav' } });
  });
  const track = { source: 'netease', rid: '42' };
  await assert.rejects(catalog(session, 'comments', [track, { sort: 'new' }]));
  assert.equal(urls.length, 1);
  const item = { source: 'netease', url: 'https://m8.music.126.net/test.mp3' };
  await assert.rejects(mediaResponse(item, 'GET', '', new AbortController().signal, async url => {
    urls.push(url); return new Response(null, { status: 302, headers: { location: 'https://other.126.net/song.mp3' } });
  }));
  assert.equal(urls.length, 2);
});
