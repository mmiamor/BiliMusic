import { entryKey } from './library.mjs';
import { cleanPlaylistTrack } from './playlist-track.mjs';

const KEY='bilimusic.playlists.v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const cleanName=value=>{if(typeof value!=='string')throw Error('歌单名称需要 1–80 字。');const name=value.trim();if(!name||name.length>80)throw Error('歌单名称需要 1–80 字。');return name;};
const cleanDescription=value=>{if(value==null)return '';if(typeof value!=='string'||value.length>500)throw Error('歌单描述最多 500 字。');return value.trim();};
export function openPlaylists({storage,request}) {
  let data=[];
  if(!request)try{
    const raw=JSON.parse(storage.getItem(KEY));
    if(Array.isArray(raw))for(const p of raw.slice(0,100)) {
      if(!p||typeof p.id!=='string'||!Array.isArray(p.tracks))continue;
      try{
        const tracks=[],seen=new Set();
        for(const item of p.tracks.slice(0,500))try{const t=cleanPlaylistTrack(item),key=entryKey(t);if(!seen.has(key)){seen.add(key);tracks.push(t);}}catch{}
        data.push({id:p.id,name:cleanName(p.name),description:cleanDescription(p.description),tracks,createdAt:p.createdAt,updatedAt:p.updatedAt});
      }catch{}
    }
  }catch{}
  const metadata=p=>({...p,tracks:undefined,trackCount:p.tracks.length});
  const persist=next=>{storage.setItem(KEY,JSON.stringify(next));data=next;};
  async function call(op,input={}) {
    if(request)return request('playlists/'+op,input);
    const current=data.find(p=>p.id===input.id);
    if(op==='list')return{playlists:clone(data.map(metadata))};
    if(op==='create') {
      if(data.length>=100)throw Error('最多创建 100 个歌单。');
      const playlist={id:crypto.randomUUID(),name:cleanName(input.name),description:cleanDescription(input.description),tracks:[],createdAt:Date.now(),updatedAt:Date.now()};
      persist([playlist,...data]);return{playlist:clone({...playlist,trackCount:0})};
    }
    if(!current)throw Error('歌单不存在或已删除。');
    if(op==='get')return{playlist:clone({...current,trackCount:current.tracks.length})};
    if(op==='delete'){persist(data.filter(p=>p.id!==input.id));return{};}
    const next=clone(current);
    if(op==='update')Object.assign(next,{name:cleanName(input.name),description:cleanDescription(input.description)});
    else if(op==='add') {
      if(!Array.isArray(input.tracks)||input.tracks.length>500)throw Error('歌曲列表无效。');
      const incoming=input.tracks.map(cleanPlaylistTrack);
      for(const track of incoming) {
        if(!next.tracks.some(t=>entryKey(t)===entryKey(track)))next.tracks.push(track);
      }
      if(next.tracks.length>500)throw Error('每个歌单最多保存 500 首歌曲。');
    }else if(op==='remove')next.tracks=next.tracks.filter(t=>entryKey(t)!==input.trackKey);
    else if(op==='reorder') {
      const map=new Map(next.tracks.map(t=>[entryKey(t),t]));
      if(!Array.isArray(input.keys)||input.keys.length!==map.size||new Set(input.keys).size!==map.size||input.keys.some(key=>!map.has(key)))throw Error('歌曲顺序已变化，请刷新后重试。');
      next.tracks=input.keys.map(key=>map.get(key));
    }else throw Error('不支持的歌单操作。');
    next.updatedAt=Date.now();persist(data.map(p=>p.id===next.id?next:p));return{playlist:clone({...next,trackCount:next.tracks.length})};
  }
  return{call};
}
