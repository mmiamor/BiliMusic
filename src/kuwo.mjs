import { plain, positiveID, seconds, httpsURL, entity, getBody, getJSON, urlWithParams } from './provider-utils.mjs';
import { kuwoLyricLines } from './lyric-lines.mjs';

const source = 'kuwo';
const headers = {
  Referer: 'https://www.kuwo.cn/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
};
const catalog = 'https://search.kuwo.cn/r.s';
const rates = ['2000kflac', '320kmp3', '128kmp3'];

// Simple SQ Music Plus maps the catalog's N_MINFO format/bitrate pairs to these playback tiers.
function catalogRates(row) {
  const pairs = String(row.N_MINFO || row.n_minfo || row.MINFO || '').split(';').map(entry => {
    const fields = Object.fromEntries(entry.split(',').map(field => field.trim().split(':', 2)));
    return fields.bitrate + 'k' + fields.format;
  });
  return rates.filter(rate => pairs.includes(rate));
}

function coverAt(value, dir) {
  return httpsURL(value) || (value && /^\d+\//.test(value) ? httpsURL('https://img2.kuwo.cn/star/' + dir + '/' + value) : '');
}

function song(row, parent = {}) {
  const rid = positiveID(String(row.MUSICRID || row.musicrid || row.rid || row.id || row.DC_TARGETID || '').replace(/^MUSIC_/, ''));
  if (!rid) return null;
  const artist = plain(row.ARTIST || row.artist || parent.artist);
  const title = plain(row.SONGNAME || row.NAME || row.songname || row.songName || row.name);
  if (!title) return null;
  const album = plain(row.ALBUM || row.album || parent.name);
  const cover = coverAt(row.web_albumpic_short, 'albumcover') || httpsURL(parent.hts_img || row.hts_img || row.pic || row.img);
  const entities = [
    entity(source, 'artist', row.ARTISTID || row.artistid || row.artistId || parent.artistid, artist, coverAt(row.web_artistpic_short, 'starheads')),
    entity(source, 'album', row.ALBUMID || row.albumid || row.albumId || parent.albumid, album, cover)
  ].filter(Boolean);
  const availableRates = catalogRates(row);
  return { id: 'kuwo:' + rid, source, rid, title, artist, album, duration: seconds(row.DURATION || row.duration), cover, entities,
    ...(availableRates.length && { availableRates }) };
}

export function kuwoStream(info, track) {
  const data = info?.data;
  if (Number(info?.code) !== 200 || !data?.url || String(data.rid) !== String(track.rid)) return null;
  // Some restricted requests resolve successfully to a different 11-second announcement.
  const kbps = Number(data.bitrate);
  if (data.type == null || Number(data.type) !== 0 || !Number.isFinite(kbps) || kbps <= 1) return null;
  const url = httpsURL(data.url);
  if (!url) return null;
  const extension = new URL(url).pathname.split('.').pop().toLowerCase();
  const format = String(data.format || extension).toLowerCase();
  const mimes = { flac: 'audio/flac', mp3: 'audio/mpeg', aac: 'audio/aac', m4a: 'audio/mp4', ogg: 'audio/ogg' };
  if (!mimes[format] || (mimes[extension] && extension !== format && !(['m4a', 'aac'].includes(format) && ['m4a', 'aac'].includes(extension)))) return null;
  const preview = track.duration > 40 && Number(data.duration) > 0 && Number(data.duration) < track.duration - 10;
  const quality = (format === 'flac' ? 'FLAC 无损' : format.toUpperCase() + (kbps > 1 ? ' · ' + kbps + ' kbps' : '')) + (preview ? ' · 试听' : '');
  const mimeType = format === 'aac' && extension === 'm4a' ? 'audio/mp4' : mimes[format];
  return { url, headers, quality, codec: format, mimeType, lossless: format === 'flac', bitrate: kbps, preview };
}

export function kuwoProvider(request) {
  const json = (base, params) => getJSON(request, urlWithParams(base, params), headers);
  const list = (params, page) => json(catalog, {
    client: 'kt', encoding: 'utf8', rformat: 'json', mobi: 1, vipver: 1, pn: page - 1, rn: 30, ...params
  });
  async function search(query, page) {
    const direct = query.match(/^https?:\/\/(?:www\.)?kuwo\.cn\/play_detail\/([1-9]\d*)(?:[/?#].*)?$/);
    if (direct) {
      if (page !== 1) return [];
      const rid = direct[1];
      const info = (await json('https://m.kuwo.cn/newh5/singles/songinfoandlrc', { musicId: rid })).data?.songinfo;
      const track = info && song({ ...info, rid });
      if (track) return [track];
      // The H5 lyrics service can omit metadata for a playable recording.
      const html = await getBody(request, 'https://www.kuwo.cn/play_detail/' + rid, headers);
      const pageTitle = html.match(/<title[^>]*>([^<]+)_单曲在线试听_酷我音乐<\/title>/i)?.[1];
      const split = pageTitle?.lastIndexOf('_') ?? -1;
      if (split <= 0) throw new Error('酷我未返回此歌曲的信息。');
      const title = plain(pageTitle.slice(0, split));
      const artist = plain(pageTitle.slice(split + 1));
      const data = await list({ all: title + ' ' + artist, ft: 'music', correct: 1 }, 1);
      const exact = (data.abslist || []).map(row => song(row)).find(row => row?.rid === rid);
      return [exact || song({ ...info, rid, name: title, artist })];
    }
    const data = await list({ all: query, ft: 'music', correct: 1 }, page);
    return (data.abslist || []).map(row => song(row)).filter(Boolean);
  }
  async function searchEntities(type, query, page) {
    if (!['artist', 'album'].includes(type)) throw new Error('酷我仅支持搜索歌手和专辑。');
    const data = await list({ all: query, ft: type, correct: 1 }, page);
    if (type === 'artist') return (data.abslist || []).map(row =>
      entity(source, type, row.ARTISTID, row.ARTIST, row.hts_PICPATH || coverAt(row.PICPATH, 'starheads'))).filter(Boolean);
    return (data.albumlist || []).map(row =>
      entity(source, type, row.albumid || row.id, row.name, row.hts_img || coverAt(row.pic, 'albumcover'), { artist: plain(row.artist) })).filter(Boolean);
  }
  async function browse(item, page) {
    const artist = item.type === 'artist';
    if (!artist && item.type !== 'album') throw new Error('无法浏览此酷我条目。');
    const params = artist ? { stype: 'artist2music', artistid: item.id, sortby: 0 } : { stype: 'albuminfo', albumid: item.id };
    const data = await list({ ...params, alflac: 1 }, page);
    return (data.musiclist || []).map(row => song(row, data)).filter(Boolean);
  }
  async function resolve(track) {
    if (!positiveID(track.rid)) throw new Error('酷我歌曲编号无效。');
    // SQMusic 3.0 downloadurl2 uses f=web/user=0 and the official signed-URL endpoint.
    // This client uses its own guest entitlement, without an APK channel or device identity.
    const supported = rates.filter(rate => !track.availableRates?.length || track.availableRates.includes(rate));
    const attempts = await Promise.allSettled(supported.map(br => json('https://mobi.kuwo.cn/mobi.s', {
      f: 'web', user: 0, type: 'convert_url_with_sign', rid: track.rid, br
    })));
    const unique = new Map();
    let wrongTrack = false;
    for (const result of attempts) {
      if (result.status !== 'fulfilled') continue;
      const data = result.value.data;
      if (data?.rid && String(data.rid) !== String(track.rid)) wrongTrack = true;
      const media = kuwoStream(result.value, track);
      if (media) unique.set(media.url, media);
    }
    if (unique.size) {
      return [...unique.values()].sort((a, b) => Number(a.preview) - Number(b.preview) ||
        Number(b.lossless) - Number(a.lossless) || b.bitrate - a.bitrate);
    }
    if (attempts.length && attempts.every(result => result.status === 'rejected')) throw attempts[0].reason;
    if (wrongTrack) throw new Error('酷我为当前访客返回了另一条提示音，未提供这首歌的可播放音轨。');
    throw new Error('酷我未向当前访客提供这首歌的可播放音频，可能需要会员或受地区限制。');
  }
  async function lyrics(track) {
    const endpoint = 'https://m.kuwo.cn/newh5/singles/songinfoandlrc';
    const params = { musicId: track.rid, httpsStatus: 1 };
    let result = await json(endpoint, params);
    // H5 can return a transient application-level 301 even over HTTP 200.
    if (Number(result.status) === 301 && !result.data) result = await json(endpoint, params);
    if (result.status != null && Number(result.status) !== 200) {
      throw new Error('酷我暂时无法读取此曲目的歌词。');
    }
    return kuwoLyricLines(result.data?.lrclist || []);
  }
  return { search, searchEntities, entities: async track => track.entities || [], browse, resolve, lyrics };
}
