import { CookieJar } from 'tough-cookie';
import QRCode from 'qrcode';
import { createProviders } from '../src/providers.mjs';
import { DISCOVERY_CATEGORIES } from '../src/discovery-categories.mjs';
import metadata from './package.json' with { type: 'json' };

const serverAgent = 'BiliMusic/' + metadata.version;
const biliHeaders = { 'User-Agent': serverAgent, Referer: 'https://www.bilibili.com/', Accept: 'application/json' };
const passport = 'https://passport.bilibili.com/x/passport-login/web/qrcode/';
const nav = 'https://api.bilibili.com/x/web-interface/nav';
const maxText = 8 * 1024 * 1024;
const apiPaths = new Set([
  '/x/web-interface/nav', '/x/web-interface/view', '/x/web-interface/search/type',
  '/x/player/wbi/playurl', '/x/player/wbi/v2', '/x/polymer/web-space/seasons_archives_list',
  '/x/polymer/web-space/seasons_series_list', '/x/v2/medialist/resource/list', '/audio/music-service-c/url',
]);
const kuwoPaths = new Map([
  ['m.kuwo.cn', '/newh5/singles/songinfoandlrc'], ['search.kuwo.cn', '/r.s'], ['mobi.kuwo.cn', '/mobi.s'],
]);
const neteasePaths = new Set([
  '/api/cloudsearch/pc', '/api/song/detail/', '/api/song/enhance/player/url/v1', '/api/song/lyric', '/api/v1/artist/songs',
]);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireInput(ok) { if (!ok) throw new HttpError(400, '无效的音源参数。'); }
function under(host, domain) { return host === domain || host.endsWith('.' + domain); }
function safeURL(text, source) {
  const url = new URL(text);
  const edge = source === 'bilibili' && (
    (url.port === '8082' && url.hostname.endsWith('.mcdn.bilivideo.cn')) ||
    (url.port === '4483' && url.hostname.endsWith('.edge.mountaintoys.cn'))
  );
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && !edge)) throw Error('音源地址无效。');
  return url;
}
function metadataAllowed(url) {
  const h = url.hostname, path = url.pathname;
  if (h === 'api.bilibili.com') return apiPaths.has(path);
  if (h === 'www.bilibili.com') return ['/', '/audio/music-service-c/web/song/info', '/audio/music-service-c/web/url'].includes(path);
  if (h === 'passport.bilibili.com') return ['generate', 'poll'].some(op => url.href.split('?')[0] === passport + op);
  if (h === 'www.kuwo.cn') return /^\/play_detail\/[1-9]\d*$/.test(path);
  if (kuwoPaths.has(h)) return kuwoPaths.get(h) === path;
  if (h === 'music.163.com') {
    return neteasePaths.has(path)
      || /^\/api\/v1\/album\/[1-9]\d{0,19}$/.test(path)
      || /^\/api\/v1\/resource\/(?:comments|hotcomments)\/R_SO_4_[1-9]\d{0,19}$/.test(path);
  }
  // Only official subtitles and AU lyric files returned by the upstream metadata APIs reach these hosts.
  return under(h, 'hdslb.com') || under(h, 'biliimg.com') || under(h, 'bilivideo.com') || under(h, 'bilivideo.cn');
}
function metadataFamily(url) {
  if (url.hostname === 'music.163.com') return 'netease';
  return under(url.hostname, 'kuwo.cn') ? 'kuwo' : 'bilibili';
}
export function mediaAllowed(url, source) {
  const host = url.hostname;
  if (url.port) return source === 'bilibili' && (
    (url.port === '8082' && host.endsWith('.mcdn.bilivideo.cn')) ||
    (url.port === '4483' && host.endsWith('.edge.mountaintoys.cn'))
  );
  if (source === 'kuwo') return under(host, 'kuwo.cn') || under(host, 'kuwo.com');
  if (source === 'netease') return host.endsWith('.music.126.net');
  if (source !== 'bilibili') return false;
  return ['bilivideo.com', 'bilivideo.net', 'bilivideo.cn', 'hdslb.com'].some(domain => under(host, domain))
    || /^upos-[a-z0-9-]+\.akamaized\.net$/.test(host);
}

export async function boundedText(body, limit = maxText) {
  if (!body) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '响应内容过大。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

export function createSession(fetcher = fetch) {
  const session = { jar: new CookieJar(), pending: null, media: new Map(), tracks: new Map(), lastSeen: Date.now(), active: 0, jobs: 0 };
  async function request(url, options = {}, jar = session.jar) {
    const signal = AbortSignal.timeout(18000);
    const family = metadataFamily(safeURL(url));
    for (let i = 0; i <= 4; i++) {
      const target = safeURL(url);
      if (!metadataAllowed(target) || metadataFamily(target) !== family) throw Error('不支持此平台资源。');
      const headers = { 'User-Agent': serverAgent, ...options.headers };
      // The shared provider also runs inside a desktop webview. Identify this Node client
      // consistently to Bilibili's APIs, login flow, and lyric hosts.
      if (family === 'bilibili') headers['User-Agent'] = serverAgent;
      const carriesCookies = under(target.hostname, 'bilibili.com');
      if (carriesCookies) {
        const cookie = await jar.getCookieString(target.href);
        if (cookie) headers.Cookie = cookie;
      }
      const response = await fetcher(target.href, { headers, signal, redirect: 'manual' });
      if (carriesCookies) {
        for (const value of response.headers.getSetCookie()) await jar.setCookie(value, target.href, { ignoreError: true });
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel();
        url = new URL(response.headers.get('location'), target).href;
        continue;
      }
      return { status: response.status, body: await boundedText(response.body) };
    }
    throw Error('音源重定向次数过多。');
  }
  session.providers = createProviders(request);
  session.account = async (action) => {
    if (action === 'cancel') { session.pending = null; return {}; }
    if (action === 'status') {
      const cookies = await session.jar.getCookies(nav);
      if (!cookies.some(c => c.key === 'SESSDATA')) return { loggedIn: false, name: '' };
      const data = await accountData(nav, session.jar, true);
      return { loggedIn: data.isLogin === true, name: data.isLogin ? String(data.uname || '') : '' };
    }
    if (action === 'qr') {
      const pending = { jar: new CookieJar(), key: '', expires: Date.now() + 180000, lastPoll: 0 };
      session.pending = pending;
      const data = await accountData(passport + 'generate?source=main-fe-header', pending.jar);
      const target = safeURL(data.url);
      const validPage = target.origin + target.pathname;
      if (!['https://account.bilibili.com/h5/account-h5/auth/scan-web', 'https://passport.bilibili.com/h5-app/passport/login/scan'].includes(validPage)
          || !/^[a-zA-Z0-9_-]{16,128}$/.test(data.qrcode_key)) throw Error('平台未返回有效的扫码地址。');
      pending.key = data.qrcode_key;
      return { image: await QRCode.toDataURL(target.href, { width: 232, margin: 4 }), url: target.href };
    }
    if (action !== 'poll') throw new HttpError(404, '未知的账号操作。');
    const pending = session.pending;
    if (!pending?.key || pending.expires < Date.now()) return { status: 'expired' };
    if (Date.now() - pending.lastPoll < 1500) return { status: pending.state || 'waiting' };
    pending.lastPoll = Date.now();
    const data = await accountData(passport + 'poll?qrcode_key=' + encodeURIComponent(pending.key), pending.jar);
    if (session.pending !== pending) return { status: 'expired' };
    const states = { 86101: 'waiting', 86090: 'scanned', 86038: 'expired', 0: 'done' };
    const status = states[data.code];
    if (!status) throw Error('平台暂时无法确认二维码状态。');
    if (status === 'done') {
      const cookies = await pending.jar.getCookies(nav);
      if (!cookies.some(c => c.key === 'SESSDATA')) throw Error('平台未授权登录，请重新扫码。');
      if (session.pending !== pending) return {status: 'expired'};
      session.jar = pending.jar;
      session.media.clear();
      session.providers = createProviders(request);
    }
    pending.state = status;
    if (status === 'done' || status === 'expired') session.pending = null;
    return { status };
  };
  async function accountData(url, jar, guest = false) {
    const response = await request(url, { headers: biliHeaders }, jar);
    if (response.status !== 200) throw Error('哔哩哔哩登录服务暂时不可用。');
    let value;
    try { value = JSON.parse(response.body); } catch { throw Error('哔哩哔哩登录服务暂时不可用。'); }
    if (guest && value.code === -101) return {isLogin: false};
    if (value.code !== 0 || !value.data) throw Error('哔哩哔哩暂时无法完成账号请求。');
    return value.data;
  }
  return session;
}

function id(value) {
  requireInput(typeof value === 'string' || Number.isSafeInteger(value));
  requireInput(/^[1-9]\d{0,19}$/.test(String(value)));
  return String(value);
}
function page(value = 1) {
  requireInput(Number.isInteger(value) && value > 0 && value <= 10000);
  return value;
}
function source(value) { requireInput(['bilibili','kuwo','netease'].includes(value)); return value; }
function query(value) {
  requireInput(typeof value === 'string' && value.trim().length > 0 && value.length <= 1024);
  return value.trim();
}
function entity(value) {
  requireInput(value && typeof value === 'object');
  const platform = source(value.source);
  const types = platform === 'bilibili' ? ['uploader', 'collection'] : ['artist', 'album'];
  requireInput(types.includes(value.type));
  const item = { source: platform, type: value.type, id: id(value.id) };
  if (value.type === 'collection') item.mid = id(value.mid);
  return item;
}
function identify(value) {
  requireInput(value && typeof value === 'object');
  const platform = source(value.source);
  if (platform !== 'bilibili') return { source: platform, rid: id(value.rid), duration: Math.max(0, Math.min(86400, Number(value.duration) || 0)) };
  if (value.au) return { source: platform, au: id(value.au) };
  requireInput(typeof value.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value.bvid));
  return { source: platform, bvid: value.bvid, page: page(value.page) };
}

export async function catalog(session, op, args) {
  requireInput(Array.isArray(args) && args.length <= 4);
  const providers = session.providers;
  function remember(rows) {
    for (const row of rows) {
      if (row?.id && !row.type) {
        if (session.tracks.size >= 300) session.tracks.delete(session.tracks.keys().next().value);
        session.tracks.set(row.id, row);
      }
    }
    return rows;
  }
  if (op === 'search') return remember(await providers.search(source(args[0]), query(args[1]), page(args[2])));
  if (op === 'discover') {
    const category = args[0] ?? 'popular';
    requireInput(args.length <= 2 && DISCOVERY_CATEGORIES.some(item => item.id === category));
    const requestedPage = page(args[1]);
    requireInput(requestedPage <= 50);
    const result = await providers.discover(category, requestedPage);
    remember(result.tracks);
    return result;
  }
  if (op === 'searchEntities') {
    const platform = source(args[0]);
    requireInput((platform === 'bilibili' ? ['uploader'] : ['artist', 'album']).includes(args[1]));
    return providers.searchEntities(platform, args[1], query(args[2]), page(args[3]));
  }
  if (op === 'browse' || op === 'collections') {
    const entry = entity(args[0]);
    if (op === 'collections') requireInput(entry.type === 'uploader');
    return remember(await providers[op](entry, page(args[1])));
  }
  requireInput(['entities', 'lyrics', 'resolve', 'comments'].includes(op));
  let track = identify(args[0]);
  if (op === 'comments') {
    const options = args[1] ?? {};
    requireInput(args.length <= 2 && track.source === 'netease' && typeof options === 'object' && !Array.isArray(options));
    const sort = options.sort ?? 'hot';
    requireInput(sort === 'hot' || sort === 'new');
    return providers.comments(track, { sort, page: page(options.page) });
  }
  const trackId = track.rid ? track.source + ':' + track.rid : track.au ? 'bilibili:au' + track.au : 'bilibili:' + track.bvid + ':p' + track.page;
  const saved = session.tracks.get(trackId);
  // Favorites persist across server restarts. Reconstruct the AU lyric URL and
  // album/artist links from platform metadata instead of accepting caller-supplied URLs.
  if (saved) track = saved;
  else if (track.au && op !== 'resolve') {
    [track] = await providers.search('bilibili', 'au' + track.au);
    if (!track) throw Error('音频投稿已不可用。');
  } else if (track.rid && op === 'entities') {
    const detailURL = track.source === 'netease' ? 'https://music.163.com/song?id=' : 'https://www.kuwo.cn/play_detail/';
    [track] = await providers.search(track.source, detailURL + track.rid);
    if (!track) return [];
  }
  const result = await providers[op](track);
  if (op !== 'resolve') return result;
  const now = Date.now();
  for (const [key, item] of session.media) if (item.expires <= now) session.media.delete(key);
  const published = [];
  for (const item of result.slice(0, 24)) {
    let url;
    try { url = safeURL(item.url, track.source); } catch { continue; }
    if (!mediaAllowed(url, track.source)) continue;
    const key = crypto.randomUUID();
    if (session.media.size >= 128) session.media.delete(session.media.keys().next().value);
    session.media.set(key, { ...item, source: track.source, expires: now + 4 * 3600000 });
    published.push({ url: '/api/media/' + key, codec: item.codec, lossless: item.lossless, quality: item.quality, mimeType: item.mimeType });
  }
  if (!published.length) throw Error('没有可供网页播放的音轨。');
  return published;
}

export async function mediaResponse(item, method, range, signal, fetcher = fetch) {
  let url = item.url;
  const headers = { ...item.headers, 'Accept-Encoding': 'identity' };
  if (item.source === 'bilibili') headers['User-Agent'] = serverAgent;
  if (range) headers.Range = range;
  for (let i = 0; i <= 4; i++) {
    const target = safeURL(url, item.source);
    if (!mediaAllowed(target, item.source)) throw Error('音源不支持此流媒体地址。');
    const response = await fetcher(target.href, { method, headers, redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400 || !response.headers.get('location')) return response;
    await response.body?.cancel();
    url = new URL(response.headers.get('location'), target).href;
  }
  throw Error('音频重定向次数过多。');
}
