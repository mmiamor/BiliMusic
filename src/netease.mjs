import { entity, getJSON, httpsURL, plain, positiveID, urlWithParams } from './provider-utils.mjs';
import { parseLrc } from './bilibili.mjs';

const source = 'netease';
const origin = 'https://music.163.com';
const headers = { Referer: origin + '/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36' };
const pageSize = 30;
const commentPageSize = 20;

// NetEase share links use either a normal path, the desktop hash route, or the mobile prefix.
export function neteaseLink(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !['music.163.com', 'y.music.163.com'].includes(url.hostname)) return null;
  if (url.hash.startsWith('#/')) {
    if (url.hash.startsWith('#//')) return null;
    url = new URL(url.hash.slice(1), origin);
  }
  const route = url.pathname.match(/^\/(?:m\/)?(song|artist|album)(?:\/([1-9]\d*))?\/?$/);
  const id = route && positiveID(route[2] || url.searchParams.get('id'));
  return id ? { type: route[1], id } : null;
}

function artist(row) {
  return row && entity(source, 'artist', row.id, row.name, row.img1v1Url || row.picUrl);
}

function album(row) {
  return row && entity(source, 'album', row.id, row.name, row.picUrl || row.blurPicUrl);
}

// The same modern/legacy field pairs are used by AppleMusic's src/shared/sources.js mapSong.
function song(row, parentAlbum) {
  const rid = positiveID(row?.id);
  const title = plain(row?.name);
  if (!rid || !title) return null;
  const artists = row.ar || row.artists || [];
  const record = { ...parentAlbum, ...(row.al || row.album) };
  const entities = [...artists.map(artist), album(record)].filter(Boolean);
  return { id: source + ':' + rid, source, rid, title, artist: artists.map(a => plain(a.name)).filter(Boolean).join(' / '),
    album: plain(record.name), cover: httpsURL(record.picUrl || parentAlbum?.picUrl),
    duration: Math.max(0, Number(row.dt || row.duration) || 0) / 1000, entities };
}

function ridOf(track) {
  const rid = positiveID(track.rid);
  if (!rid) throw new Error('网易云歌曲编号无效。');
  return rid;
}

function stream(row, track) {
  if (!row || Number(row.code) !== 200 || String(row.id) !== ridOf(track)) return null;
  const url = httpsURL(row.url);
  if (!url || !new URL(url).hostname.endsWith('.music.126.net')) return null;
  const codec = String(row.type || new URL(url).pathname.split('.').pop()).toLowerCase();
  const mimeType = { flac: 'audio/flac', mp3: 'audio/mpeg', aac: 'audio/aac', m4a: 'audio/mp4' }[codec];
  if (!mimeType) return null;
  const preview = !!row.freeTrialInfo || (track.duration > 30 && row.time > 0 && row.time / 1000 < track.duration - 8);
  const kbps = Math.round(Number(row.br) / 1000);
  const lossless = codec === 'flac';
  const quality = (lossless ? 'FLAC 无损' : codec.toUpperCase() + (kbps ? ' · ' + kbps + ' kbps' : '')) + (preview ? ' · 试听' : '');
  return { url, headers, codec, mimeType, lossless, quality };
}

function parallelLyrics(original, translation, romanized) {
  const timeline = text => new Map(parseLrc(text || '').map(row => [Math.round(row.time * 1000), row.text]));
  const translations = timeline(translation);
  const readings = timeline(romanized);
  return parseLrc(original || '').map(row => {
    const stamp = Math.round(row.time * 1000);
    const translated = translations.get(stamp);
    const reading = readings.get(stamp);
    return { ...row, ...(translated && translated !== row.text && { translation: translated }),
      ...(reading && reading !== row.text && { pronunciation: reading }) };
  });
}

export function neteaseProvider(request) {
  async function json(path, params = {}) {
    const result = await getJSON(request, urlWithParams(origin + path, params), headers);
    if (Number(result.code) !== 200) throw new Error('网易云暂时无法提供此内容（' + String(result.code ?? '未知状态') + '）。');
    return result;
  }
  async function detail(rid) {
    const { songs } = await json('/api/song/detail/', { ids: '[' + rid + ']' });
    const found = song((songs || []).find(s => String(s.id) === rid));
    if (!found) throw new Error('网易云未提供这首歌曲的信息。');
    return found;
  }
  const catalog = async (query, type, page) => (await json('/api/cloudsearch/pc', {
    s: query, type, limit: pageSize, offset: (page - 1) * pageSize
  })).result || {};
  async function search(query, page) {
    const link = neteaseLink(query);
    const rid = positiveID(query) || (link?.type === 'song' && link.id);
    if (rid) return page === 1 ? [await detail(rid)] : [];
    return ((await catalog(query, 1, page)).songs || []).map(row => song(row)).filter(Boolean);
  }
  async function searchEntities(type, query, page) {
    if (type === 'artist') return ((await catalog(query, 100, page)).artists || []).map(artist).filter(Boolean);
    if (type === 'album') return ((await catalog(query, 10, page)).albums || []).map(album).filter(Boolean);
    throw new Error('网易云可搜索歌手和专辑。');
  }
  async function browse(item, page) {
    const id = positiveID(item.id);
    if (!id) throw new Error('网易云资料编号无效。');
    const offset = (page - 1) * pageSize;
    if (item.type === 'artist') {
      const data = await json('/api/v1/artist/songs', { id, offset, limit: pageSize, order: 'hot' });
      return (data.songs || []).map(row => song(row)).filter(Boolean);
    }
    if (item.type === 'album') {
      const data = await json('/api/v1/album/' + id);
      return (data.songs || data.album?.songs || []).slice(offset, offset + pageSize)
        .map(row => song(row, data.album)).filter(Boolean);
    }
    throw new Error('无法浏览此网易云条目。');
  }
  async function resolve(track) {
    const rid = ridOf(track);
    for (const level of ['lossless', 'standard']) {
      const data = await json('/api/song/enhance/player/url/v1', {
        ids: '[' + rid + ']', level, encodeType: level === 'lossless' ? 'flac' : 'mp3'
      });
      const media = stream((data.data || []).find(row => String(row.id) === rid), track);
      if (media) return [media];
    }
    throw new Error('网易云未授权当前会话播放此曲，可能限于会员、版权或地区。');
  }
  async function lyrics(track) {
    const result = await json('/api/song/lyric', { id: ridOf(track), lv: -1, tv: -1, rv: -1 });
    return parallelLyrics(result.lrc?.lyric, result.tlyric?.lyric, result.romalrc?.lyric);
  }
  async function comments(track, {sort = 'hot', page = 1} = {}) {
    if (!['hot', 'new'].includes(sort) || !Number.isSafeInteger(page) || page < 1) throw new Error('无效的评论排序或页码。');
    const hot = sort === 'hot';
    const offset = (page - 1) * commentPageSize;
    const result = await json('/api/v1/resource/' + (hot ? 'hotcomments' : 'comments') + '/R_SO_4_' + ridOf(track),
      { limit: commentPageSize, offset });
    const raw = (hot ? result.hotComments : result.comments) || [];
    const items = raw.flatMap(row => {
      const id = positiveID(row.commentId);
      const text = plain(row.content);
      if (!id || !text) return [];
      return [{ id, text, user: plain(row.user?.nickname) || '网易云用户', avatar: httpsURL(row.user?.avatarUrl),
        time: Number(row.time) || 0, likes: Math.max(0, Number(row.likedCount) || 0) }];
    });
    const total = Number.isFinite(result.total) ? result.total : null;
    const more = hot ? result.hasMore : result.more;
    return { items, total, hasMore: raw.length > 0 && (typeof more === 'boolean' ? more :
      (total == null ? raw.length === commentPageSize : offset + raw.length < total)) };
  }
  return { search, searchEntities, browse, resolve, lyrics, comments,
    entities: async track => track.entities?.length ? track.entities : (await detail(ridOf(track))).entities };
}
