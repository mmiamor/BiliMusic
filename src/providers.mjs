import { biliProvider } from './bilibili.mjs';
import { kuwoProvider } from './kuwo.mjs';
import { entity, positiveID } from './provider-utils.mjs';
import { annotateLyrics } from './lyric-lines.mjs';
import { neteaseLink, neteaseProvider } from './netease.mjs';

export function parseEntity(input) {
  const netease = neteaseLink(input);
  if (netease && netease.type !== 'song') {
    const label = netease.type === 'album' ? '专辑' : '歌手';
    return entity('netease', netease.type, netease.id, label + ' ' + netease.id, '');
  }
  let url;
  try { url = new URL(String(input).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (url.hostname === 'space.bilibili.com') {
    const parts = path.split('/');
    const mid = positiveID(parts[1]);
    if (!mid) return null;
    const season = (parts[2] === 'lists' && url.searchParams.get('type') !== 'series') ? positiveID(parts[3])
      : (parts[2] === 'channel' && parts[3] === 'collectiondetail') ? positiveID(url.searchParams.get('sid')) : '';
    if (season) return entity('bilibili', 'collection', season, '合集 ' + season, '', { mid });
    if (parts.length === 2 || ['upload', 'video', 'dynamic'].includes(parts[2])) return entity('bilibili', 'uploader', mid, 'UP 主 ' + mid, '');
  }
  if (url.hostname === 'www.kuwo.cn' || url.hostname === 'kuwo.cn') {
    const match = path.match(/^\/(singer_detail|album_detail)\/([1-9]\d*)$/);
    if (match) return entity('kuwo', match[1] === 'singer_detail' ? 'artist' : 'album', match[2],
      (match[1] === 'singer_detail' ? '歌手 ' : '专辑 ') + match[2], '');
  }
  return null;
}

export function createProviders(request, { canPlayType } = {}) {
  const providers = { bilibili: biliProvider(request, canPlayType), kuwo: kuwoProvider(request), netease: neteaseProvider(request) };
  const from = (source) => {
    if (!Object.hasOwn(providers, source)) throw new Error('未识别的音乐平台。');
    return providers[source];
  };
  const pageNumber = value => Number.isSafeInteger(value) && value > 0 ? value : 1;
  return {
    parseEntity,
    resetBilibiliSession: () => providers.bilibili.resetSession(),
    discover: (category = 'popular', page = 1) => providers.bilibili.discover(category, page),
    search: (source, query, page = 1) => from(source).search(String(query).trim(), pageNumber(page)),
    searchEntities: (source, type, query, page = 1) => from(source).searchEntities(type, String(query).trim(), pageNumber(page)),
    browse: (entry, page = 1) => from(entry.source).browse(entry, pageNumber(page)),
    collections: (entry, page = 1) => providers.bilibili.collections(entry, pageNumber(page)),
    entities: track => from(track.source).entities(track),
    resolve: track => from(track.source).resolve(track),
    comments: (track, options) => {
      if (track.source !== 'netease') throw new Error('仅网易云歌曲提供评论。');
      return providers.netease.comments(track, options);
    },
    lyrics: async track => annotateLyrics(await from(track.source).lyrics(track))
  };
}
