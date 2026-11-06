import { RADIO_STATIONS } from './radio.mjs';
import { session as localTracks } from './library.mjs';

const requireTrack = (ok, message) => { if (!ok) throw new Error(message); };
const text = (value, max, required = false) => {
  requireTrack(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), '文字参数无效或过长。');
  const out=value.trim(); requireTrack(!required||out.length>0,'名称不能为空。'); return out;
};
const positiveID = value => typeof value==='number'&&Number.isSafeInteger(value)&&value>0 ? String(value) : typeof value==='string'&&/^[1-9]\d{0,17}$/.test(value) ? value : null;
const coverURL = value => {
  if(!value) return '';
  if(value==='./assets/forest.jpg') return value;
  requireTrack(typeof value==='string'&&value.length<=2048,'封面地址无效。');
  let url; try {url=new URL(value.startsWith('//')?'https:'+value:value);}catch{throw new Error('封面地址无效。');}
  const roots=['hdslb.com','bilibili.com','kuwo.cn','kuwo.com','music.126.net','music.163.com'];
  requireTrack(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.port&&roots.some(root=>url.hostname===root||url.hostname.endsWith('.'+root)),'封面来源不受支持。');
  url.protocol='https:'; url.hash='';
  requireTrack(url.href.length<=2048,'封面地址无效。');
  return url.href;
};
export function cleanPlaylistTrack(input) {
  requireTrack(input&&typeof input==='object'&&!Array.isArray(input),'曲目参数无效。');
  requireTrack(input.type===undefined||input.type==='track','歌单只能添加曲目。');
  requireTrack(typeof input.id==='string'&&input.id.length<=128,'曲目标识无效。');
  // Only identities and display metadata cross the persistence boundary.
  for(const key of ['url','headers','cookie','cookies','token','streams','stream','candidates']) requireTrack(input[key]===undefined,'曲目不能包含媒体地址或登录凭据。');
  let identity;
  if(input.source==='bilibili') {
    const video=/^bilibili:(BV[0-9A-Za-z]{10}):p([1-9]\d{0,4})$/.exec(input.id), audio=/^bilibili:au([1-9]\d{0,17})$/.exec(input.id);
    requireTrack(video||audio,'哔哩哔哩曲目标识无效。');
    if(video) {
      const page=Number(video[2]); requireTrack(page<=10000&&(!input.bvid||input.bvid===video[1])&&(!input.page||Number(input.page)===page),'哔哩哔哩分 P 标识不一致。');
      identity={bvid:video[1],page};
    } else {requireTrack(!input.au||positiveID(input.au)===audio[1],'音频投稿标识不一致。');identity={au:audio[1]};}
  } else if(input.source==='kuwo'||input.source==='netease') {
    const rid=input.id.slice(input.source.length+1);
    requireTrack(input.id.startsWith(input.source+':')&&positiveID(rid)&&(!input.rid||positiveID(input.rid)===rid),'音乐曲目标识无效。'); identity={rid};
  } else if(input.source==='radioparadise') {
    const station=RADIO_STATIONS.find(x=>x.id===input.id);requireTrack(station,'电台标识无效。');identity={stationId:station.stationId,isLive:true};
  } else if(input.source==='local') {
    const track=localTracks.find(x=>x.id===input.id);requireTrack(track,'内置曲目标识无效。');identity={};
  } else throw new Error('曲目音源不受支持。');
  const out={source:input.source,id:input.id,type:'track',...identity,title:text(input.title??'',300,true),artist:text(input.artist??'',200),album:text(input.album??'',200),cover:coverURL(input.cover??''),duration:Math.min(86400,Math.max(0,Number.isFinite(Number(input.duration))?Number(input.duration):0))};
  if(input.source==='local') { const known=localTracks.find(x=>x.id===input.id); out.cover=known.cover; out.file=known.file; }
  return out;
}
