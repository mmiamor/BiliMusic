import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders, parseEntity } from '../src/providers.mjs';
import { neteaseLink } from '../src/netease.mjs';

const track = { source: 'netease', id: 'netease:123', rid: '123', duration: 180 };
const reply = value => ({ status: 200, body: JSON.stringify({ code: 200, ...value }) });

test('NetEase search, hash links, IDs and saved entities retain authoritative platform IDs', async () => {
  const endpoints = [];
  const api = createProviders(async value => {
    const url = new URL(value);
    endpoints.push(url.pathname);
    const row = { id: 123, name: 'Sample', dt: 180000, ar: [{ id: 3, name: 'Artist' }], al: { id: 4, name: 'Album', picUrl: 'https://p1.music.126.net/c.jpg' } };
    return url.pathname.endsWith('/pc') ? reply({ result: { songs: [row] } }) : reply({ songs: [row] });
  });
  const [searched] = await api.search('netease', 'sample');
  const [linked] = await api.search('netease', 'https://music.163.com/#/song?id=123');
  const [byId] = await api.search('netease', '123');
  assert.deepEqual(searched, linked);
  assert.deepEqual(linked, byId);
  assert.equal(linked.duration, 180);
  assert.deepEqual((await api.entities(linked)).map(e => [e.source, e.type, e.id]),
    [['netease', 'artist', '3'], ['netease', 'album', '4']]);
  assert.deepEqual(endpoints, ['/api/cloudsearch/pc', '/api/song/detail/', '/api/song/detail/']);
  assert.equal(parseEntity('https://y.music.163.com/m/album?id=4').source, 'netease');
  assert.equal(parseEntity('https://music.163.com/#/artist?id=3').id, '3');
  assert.equal(neteaseLink('https://music.163.com.fake/m/song?id=123'), null);
  assert.equal(neteaseLink('https://music.163.com/#//other.example/song?id=123'), null);
});

test('requested NetEase lossless may return an MP3 preview; restricted and off-platform URLs never play', async () => {
  const served = { code: 200, id: 123, type: 'mp3', br: 320000, freeTrialInfo: { start: 0, end: 30 }, url: 'http://m10.music.126.net/r.mp3' };
  const api = createProviders(async () => reply({ data: [served] }));
  const [s] = await api.resolve(track);
  assert.equal(s.quality, 'MP3 · 320 kbps · 试听');
  assert.equal(s.lossless, false);
  assert.match(s.url, /^https:/);
  for (const row of [{ ...served, code: -110 }, { ...served, id: 15 }, { ...served, url: 'https://other.example/a.mp3' }]) {
    const denied = createProviders(async () => reply({ data: [row] }));
    await assert.rejects(denied.resolve(track), /未授权/);
  }
});

test('NetEase lyrics keep supplied timed translations and romanization before local pinyin', async () => {
  const api = createProviders(async () => reply({
    lrc: { lyric: '[00:01.20]雨声\n[00:03.00]风' },
    tlyric: { lyric: '[00:01.200]Rain\n[00:05]Later' },
    romalrc: { lyric: '[00:01.200]custom reading' }
  }));
  const lines = await api.lyrics(track);
  assert.equal(lines[0].time, 1.2);
  assert.equal(lines[0].translation, 'Rain');
  assert.equal(lines[0].pronunciation, 'custom reading');
  assert.equal(lines[1].translation, undefined);
  assert.equal(lines[1].pronunciation, 'feng');
});

test('NetEase comments use dedicated hot/latest endpoints, paginate, and preserve text and millisecond times', async () => {
  const paths = [];
  const api = createProviders(async value => {
    const u = new URL(value);
    paths.push([u.pathname, u.searchParams.get('offset')]);
    const row = {commentId: 42, content: 'Testing', user: {nickname:'Listener'}, likedCount: 7, time: 1700000000000};
    return reply({ comments: [row], hotComments:[{...row, commentId: 43}], more:false, hasMore:true, total:60 });
  });
  const hot = await api.comments(track, {sort:'hot',page:2});
  const recent = await api.comments(track, {sort:'new',page:1});
  assert.deepEqual(paths,[['/api/v1/resource/hotcomments/R_SO_4_123','20'],['/api/v1/resource/comments/R_SO_4_123','0']]);
  assert.deepEqual(hot.items[0], {id:'43',text:'Testing',user:'Listener',avatar:'',time:1700000000000,likes:7});
  assert.equal(recent.hasMore,false);
  assert.equal(hot.hasMore,true);
  assert.equal(recent.total,60);
  await assert.rejects(api.comments(track,{sort:'all'}), /无效/);
});
