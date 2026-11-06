import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5 } from '../src/wbi.mjs';
import { createProviders, parseEntity } from '../src/providers.mjs';
import { dashStreams, parseLrc } from '../src/bilibili.mjs';
import { kuwoStream } from '../src/kuwo.mjs';

test('WBI digest agrees with RFC MD5 across UTF-8 and padding boundaries', () => {
  for (const value of ['', '中文', 'a'.repeat(56), 'b'.repeat(73), 'c'.repeat(900)]) {
    assert.equal(md5(value), createHash('md5').update(value).digest('hex'));
  }
});

test('DASH keeps lossless first, prefers origin CDN and filters unsupported codecs', () => {
  const dash = {
    flac: { audio: { baseUrl: 'https://peer.bilivideo.cn/flac', backupUrl: ['https://upos-sz.bilivideo.com/flac'], codecs: 'fLaC' } },
    dolby: { audio: [{ baseUrl: 'https://upos-sz.bilivideo.com/dolby', codecs: 'ec-3' }] },
    audio: [{ base_url: 'https://upos-sz.bilivideo.com/aac', codecs: 'mp4a.40.2', bandwidth: 192000 }]
  };
  const streams = dashStreams(dash, mime => !mime.includes('ec-3'));
  assert.deepEqual(streams.map(s => s.lossless), [true, true, false]);
  assert.equal(new URL(streams[0].url).hostname, 'upos-sz.bilivideo.com');
  assert.match(streams[2].quality, /192 kbps/);
});

test('Hi-Res 30251 respects the served codec and FLAC-in-MP4 decoding support', () => {
  const dash = { flac: { display: true, audio: null }, audio: [
    { id: 30280, codecs: 'mp4a.40.2', bandwidth: 360000, baseUrl: 'https://cdn.bilivideo.com/normal' },
    { id: 30251, codecs: 'fLaC', bandwidth: 200000, baseUrl: 'https://cdn.bilivideo.com/hires' }
  ] };
  const full = dashStreams(dash, () => 'probably');
  assert.deepEqual(full.map(s => s.lossless), [true, false]);
  assert.match(full[0].quality, /Hi-Res.*FLAC/);
  const limited = dashStreams(dash, type => type === 'audio/mp4; codecs="fLaC"' ? '' : 'probably');
  assert.deepEqual(limited.map(s => s.lossless), [false]);
  const contradictory = { ...dash.audio[1], codecs: 'mp4a.40.2' };
  assert.equal(dashStreams({ flac: { display: true, audio: contradictory } })[0].lossless, false);
  assert.deepEqual(dashStreams({ flac: { display: true } }), []);
  const unconfirmed = { ...dash.audio[1], codecs: undefined };
  const [inferred] = dashStreams({ flac: { audio: unconfirmed } }, () => 'probably');
  assert.equal(inferred.lossless, false);
  assert.equal(inferred.quality, '音质待确认');
  assert.equal(inferred.codec, 'fLaC'); // Preserve the decoder fallback, without claiming verified FLAC.
});

test('resolving again after a login uses fresh WBI keys and the Hi-Res tier the session receives', async () => {
  let entitled = false;
  let visits = 0;
  let keyRequests = 0;
  const api = createProviders(async value => {
    const url = new URL(value);
    let result = { code: 0, data: {} };
    if (url.pathname === '/') visits++;
    if (url.pathname === '/x/web-interface/nav') {
      keyRequests++;
      const key = (entitled ? '1' : '2').repeat(32);
      result.data.wbi_img = { img_url: 'https://i0.hdslb.com/' + key + '.png', sub_url: 'https://i1.hdslb.com/' + key + '.png' };
    }
    if (url.pathname === '/x/player/wbi/playurl') {
      assert.equal(url.searchParams.get('fnval'), '4048');
      assert.match(url.searchParams.get('w_rid'), /^[0-9a-f]{32}$/);
      result.data.dash = { audio: [{ id: 30280, baseUrl: 'https://cdn.bilivideo.com/normal' }] };
      if (entitled) result.data.dash.flac = { display: true, audio: { id: 30251, codecs: 'fLaC', baseUrl: 'https://cdn.bilivideo.com/flac' } };
    }
    return {status: 200, body: JSON.stringify(result)};
  });
  const track = {source: 'bilibili', cid: '1', bvid: 'BV1GJ411x7h7'};
  assert.equal((await api.resolve(track))[0].lossless, false);
  entitled = true;
  api.resetBilibiliSession();
  assert.match((await api.resolve(track))[0].quality, /Hi-Res/);
  assert.equal(visits, 2);
  assert.equal(keyRequests, 2);
});

test('Kuwo validates media identity and labels the actual format', () => {
  const track = { rid: '12', duration: 200 };
  const data = { rid: 12, type: 0, duration: 200, bitrate: 128, format: 'mp3', url: 'https://kw-bj.kuwo.cn/t.mp3' };
  const stream = overrides => kuwoStream({ code: 200, data: { ...data, ...overrides } }, track);
  assert.equal(stream({}).lossless, false);
  assert.equal(stream({ format: 'flac', url: 'https://kw-bj.kuwo.cn/t.flac', bitrate: 2000 }).lossless, true);
  assert.equal(stream({ format: 'flac' }), null);
  assert.equal(stream({ rid: 77, type: 1, duration: 11, bitrate: 1 }), null);
  assert.match(stream({ duration: 30 }).quality, /试听/);
});

test('BV links select the correct page and detail exposes the official UGC collection', async () => {
  const bvid = 'BV1GJ411x7h7';
  const row = { bvid, title: '总标题', owner: { name: '音乐人', mid: 50 },
    pages: [{ page: 1, cid: 11, part: '第一首' }, { page: 2, cid: 22, part: '第二首' }],
    ugc_season: { id: 16, mid: 50, title: '演奏集' } };
  let calls = 0;
  const api = createProviders(async (u) => {
    assert.equal(new URL(u).pathname, '/x/web-interface/view');
    calls++;
    return { status: 200, body: JSON.stringify({ code: 0, data: row }) };
  });
  const [track] = await api.search('bilibili', 'https://www.bilibili.com/video/' + bvid + '?p=2');
  assert.equal(track.title, '第二首');
  assert.equal(track.cid, '22');
  assert.deepEqual((await api.entities(track)).map(e => [e.type,e.id]), [['uploader','50'], ['collection','16']]);
  assert.equal(calls, 1);
});

test('recognizes entity URLs only on their official hosts and preserves season owner', () => {
  const up = parseEntity('https://space.bilibili.com/50/upload/video');
  assert.equal(up.type, 'uploader');
  const collection = parseEntity('https://space.bilibili.com/50/lists/16?type=season');
  assert.deepEqual([collection.mid, collection.id], ['50', '16']);
  assert.equal(parseEntity('https://space.bilibili.com/50/lists/16?type=series'), null);
  assert.equal(parseEntity('https://www.kuwo.cn/album_detail/21').type, 'album');
  assert.equal(parseEntity('https://www.kuwo.cn.evil.test/singer_detail/21'), null);
});

test('a restricted FLAC attempt can fall back to an eligible track of the same ID', async () => {
  const rates = [];
  const p = createProviders(async url => {
    const br = new URL(url).searchParams.get('br');
    rates.push(br);
    const data = br === '2000kflac' ? { rid: 88, type: 1, bitrate: 1, format: 'mp3' }
      : { rid: 19, type: 0, bitrate: 320, format: 'mp3' };
    data.url = 'https://kw-bj.kuwo.cn/example.mp3';
    return { status: 200, body: JSON.stringify({ code: 200, data }) };
  });
  const [stream] = await p.resolve({ source: 'kuwo', rid: '19' });
  assert.deepEqual(rates, ['2000kflac','320kmp3','128kmp3']);
  assert.equal(stream.lossless, false);
  assert.match(stream.quality, /320 kbps/);
});

test('SQMusic guest resolution keeps same-song codec fallbacks in actual quality order', async () => {
  const requests = [];
  const p = createProviders(async value => {
    const url = new URL(value);
    const br = url.searchParams.get('br');
    requests.push(br);
    assert.equal(url.origin, 'https://mobi.kuwo.cn');
    assert.equal(url.searchParams.get('user'), '0');
    assert.equal(url.searchParams.get('type'), 'convert_url_with_sign');
    assert.equal(url.searchParams.get('source'), null);
    const flac = br === '2000kflac', codec = flac ? 'flac' : 'mp3';
    return {status:200,body:JSON.stringify({code:200,data:{rid:42,type:0,duration:180,
      bitrate:flac?1600:320,format:codec,url:'https://kw-er.kuwo.cn/track.' + codec}})};
  });
  const streams = await p.resolve({ source:'kuwo', rid:'42', duration:180, availableRates:['2000kflac','320kmp3'] });
  assert.deepEqual(requests,['2000kflac','320kmp3']);
  assert.deepEqual(streams.map(s=>s.codec),['flac','mp3']);
});

test('uploader pagination uses archive IDs and drops the overlapping boundary item', async () => {
  const p = createProviders(async url => {
    const u = new URL(url);
    if (u.pathname === '/') return { status: 200, body: '' };
    const oid = u.searchParams.get('oid');
    const rows = (oid === '' ? [11, 12] : [12, 13]).map(id => ({
      id, bv_id: 'BV' + String(id).padStart(10, '0'), upper: { mid: 42, name: '演奏者' }, title: '曲目 ' + id
    }));
    return { status: 200, body: JSON.stringify({ code: 0, data: { media_list: rows, has_more: oid === '' } }) };
  });
  const up = parseEntity('https://space.bilibili.com/42');
  assert.equal((await p.browse(up)).length, 2);
  assert.deepEqual((await p.browse(up, 2)).map(t => t.title), ['曲目 13']);
  assert.deepEqual(await p.browse(up, 3), []);
});

test('lyrics use repeated timestamps, fractions and the declared offset', () => {
  const rows = parseLrc('[offset:50]\n[00:01.20][00:02.25]same text');
  assert.deepEqual(rows.map(r => Math.round(r.time * 1000)), [1150,2200]);
  assert.deepEqual(rows.map(r => r.text), ['same text','same text']);
});
