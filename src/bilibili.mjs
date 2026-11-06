import { plain, positiveID, seconds, httpsURL, entity, getBody, getJSON, urlWithParams } from './provider-utils.mjs';
import { signedQuery } from './wbi.mjs';
import { subtitleLyricLines } from './lyric-lines.mjs';
import { DISCOVERY_CATEGORIES } from './discovery-categories.mjs';
import { dashQualityEvidence, unknownQuality } from './audio-quality.mjs';

const source = 'bilibili';
const api = 'https://api.bilibili.com';
const web = 'https://www.bilibili.com';
const headers = {
  Referer: web + '/', 'Accept-Language': 'zh-CN,zh;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
};
const spaceHeaders = mid => ({ ...headers, Referer: 'https://space.bilibili.com/' + mid, Origin: 'https://space.bilibili.com' });
const bvidPattern = /^BV[0-9A-Za-z]{10}$/;
const musicRegions = new Set([3, 28, 29, 30, 31, 59, 130, 193, 243, 244]);
const discoveryQueries = Object.freeze({
  popular: { keyword: '音乐', tid: 3, order: 'click' },
  latest: { keyword: '音乐', tid: 3, order: 'pubdate' },
  live: { keyword: '音乐现场', tid: 29, order: 'totalrank' },
  covers: { keyword: '翻唱', tid: 31, order: 'totalrank' },
  instrumental: { keyword: '演奏', tid: 59, order: 'totalrank' },
  original: { keyword: '原创', tid: 28, order: 'totalrank' },
  hires: { keyword: 'Hi-Res', tid: 3, order: 'totalrank' },
});
const discoveryPageSize = 20;
const discoveryPageLimit = 50;

function unwrap(result) {
  if (Number(result.code) !== 0) {
    const reason = [-352, -412, -799].includes(Number(result.code)) ? '请求受限，请稍后重试或输入 BV 号' : plain(result.msg || result.message);
    throw new Error('哔哩哔哩：' + (reason || '请求失败') + '（' + result.code + '）。');
  }
  return result.data || {};
}

function video(row, page, uploader) {
  if (!bvidPattern.test(row.bvid)) return null;
  const number = page?.page || 1;
  const author = row.owner || { mid: row.mid || uploader?.id, name: row.author || uploader?.title };
  const authorEntity = entity(source, 'uploader', author.mid, author.name, author.face || uploader?.cover);
  const season = row.ugc_season;
  const collection = season && entity(source, 'collection', season.id, season.title, season.cover, { mid: String(season.mid || author.mid) });
  return {
    id: 'bilibili:' + row.bvid + ':p' + number, source, bvid: row.bvid, page: number,
    cid: positiveID(page?.cid || row.cid), title: plain(page && row.pages?.length > 1 ? page.part : row.title),
    artist: plain(author.name), cover: httpsURL(row.pic), duration: seconds(page?.duration ?? row.duration ?? row.length),
    entities: [authorEntity, collection].filter(Boolean)
  };
}

export function dashStreams(dash, canPlayType) {
  const list = value => (Array.isArray(value) ? value : [value]).filter(item => item && typeof item === 'object');
  const tracks = [
    ...list(dash?.flac?.audio).map(item => [item, 'FLAC']),
    ...list(dash?.dolby?.audio).map(item => [item, 'Dolby']),
    ...list(dash?.audio).map(item => [item, ''])
  ].map(([item, category]) => {
    const isHiResTier = Number(item.id) === 30251 || category === 'FLAC';
    const isDolby = Number(item.id) === 30250 || category === 'Dolby';
    const mimeType = item.mimeType || item.mime_type || 'audio/mp4';
    const rawFlac = /^audio\/(?:x-)?flac$/i.test(mimeType);
    const declaredCodec = String(item.codecs || '').trim();
    const codec = declaredCodec || (isHiResTier || rawFlac ? 'fLaC' : isDolby ? 'ec-3' : 'mp4a.40.2');
    const formatKnown = Boolean(declaredCodec || rawFlac) && !(rawFlac && declaredCodec && !/^flac$/i.test(declaredCodec));
    const lossless = formatKnown && (/^flac$/i.test(declaredCodec) || rawFlac);
    const kbps = Math.round(Number(item.bandwidth) / 1000);
    const quality = !formatKnown ? '音质待确认' : lossless ? (isHiResTier ? '平台 Hi-Res · FLAC 无损' : 'FLAC 无损') :
      (isDolby ? 'Dolby' : /^mp4a/i.test(codec) ? 'AAC' : codec) + (kbps ? ' · ' + kbps + ' kbps' : '');
    return { item, mimeType, rawFlac, codec, lossless, quality, priority: lossless ? 2 : Number(isDolby) };
  }).sort((a,b) => b.priority - a.priority || Number(b.item.bandwidth) - Number(a.item.bandwidth));
  const result = [];
  const seen = new Set();
  for (const {item, mimeType, rawFlac, codec, lossless, quality} of tracks) {
    // A player can support standalone FLAC while lacking FLAC-in-MP4. Probe the actual container.
    const mediaType = rawFlac ? mimeType : mimeType + '; codecs="' + (lossless ? 'fLaC' : codec) + '"';
    if (canPlayType && !canPlayType(mediaType)) continue;
    const urls = [item.baseUrl, item.base_url, ...(item.backupUrl || item.backup_url || [])].map(httpsURL).filter(Boolean);
    // Prefer the platform's origin CDN over peer relays when the same rendition offers both.
    const central = url => /^upos-.*\.bilivideo\.(?:com|cn)$/.test(new URL(url).hostname);
    urls.sort((a, b) => Number(central(b)) - Number(central(a)));
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      result.push({ url, quality, codec, lossless, mimeType, headers });
    }
  }
  return result;
}

export function parseLrc(text) {
  const list = [];
  const offset = Number(String(text).match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  for (const line of String(text).split(/\r?\n/)) {
    const stamp = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const words = line.replace(stamp, '').trim();
    if (!words) continue;
    for (const match of line.matchAll(stamp)) {
      list.push({ time: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] || 0)) - offset), text: words });
    }
  }
  return list.sort((a,b) => a.time - b.time);
}

export function biliProvider(request, canPlayType) {
  let session;
  let keys;
  let keyTime = 0;
  let keysPending;
  let sessionEpoch = 0;
  const detailCache = new Map();
  const uploaderCursors = new Map();
  const discoveryPages = new Map();
  const discoveryRefreshes = new Map();
  const qualityCache = new Map();
  const qualityPending = new Map();
  const qualityQueue = [];
  let activeQualityJobs = 0;
  const json = (url, extra = headers) => getJSON(request, url, extra);
  const read = async (url, params, extra) => unwrap(await json(urlWithParams(url, params), extra));
  async function ensureSession() {
    // Visit the public homepage once to let the native cookie jar receive the anonymous buvid.
    if (!session) {
      const epoch = sessionEpoch;
      session = getBody(request, web + '/', headers).then(() => true).catch(() => {
        if (epoch === sessionEpoch) session = null;
      });
    }
    await session;
  }
  function resetSession() {
    sessionEpoch++;
    session = null;
    keys = null;
    keyTime = 0;
    keysPending = null;
    qualityCache.clear();
    for (const job of qualityPending.values()) job.finish(unknownQuality('session-changed'));
    qualityPending.clear();
    qualityQueue.length = 0;
  }
  async function signed(path, params, extra, checkpoint = () => {}) {
    await ensureSession();
    checkpoint();
    let signingKeys = keys;
    if (!signingKeys || Date.now() - keyTime > 3600000) {
      const epoch = sessionEpoch;
      if (!keysPending) {
        const pending = json(api + '/x/web-interface/nav').then(data => {
          const next = data.data?.wbi_img; // Guests receive signing keys alongside code -101.
          if (epoch === sessionEpoch) { keys = next; keyTime = Date.now(); }
          return next;
        }).finally(() => { if (keysPending === pending) keysPending = null; });
        keysPending = pending;
      }
      signingKeys = await keysPending;
    }
    checkpoint();
    return unwrap(await json(api + path + '?' + signedQuery(params, signingKeys), extra));
  }
  async function detail(bvid) {
    if (!bvidPattern.test(bvid)) throw new Error('BV 号格式无效。');
    if (detailCache.has(bvid)) return detailCache.get(bvid);
    const result = await read(api + '/x/web-interface/view', { bvid });
    if (detailCache.size >= 40) detailCache.delete(detailCache.keys().next().value);
    detailCache.set(bvid, result);
    return result;
  }
  async function audioTrack(id) {
    await ensureSession();
    const row = await read(web + '/audio/music-service-c/web/song/info', { sid: id });
    return { id: 'bilibili:au' + id, source, au: id, title: plain(row.title), artist: plain(row.author || row.uname),
      cover: httpsURL(row.cover), duration: seconds(row.duration), lyricUrl: httpsURL(row.lyric),
      entities: [entity(source, 'uploader', row.uid, row.uname || row.author, '')].filter(Boolean) };
  }
  async function searchRows(type, query, page) {
    await ensureSession();
    return (await read(api + '/x/web-interface/search/type', { search_type: type, keyword: query, page })).result || [];
  }
  async function discover(category = 'popular', page = 1) {
    if (!Object.hasOwn(discoveryQueries, category)) throw new Error('未识别的音乐发现分类。');
    if (!Number.isSafeInteger(page) || page < 1 || page > discoveryPageLimit) {
      throw new Error('音乐发现页码须为 1 至 50。');
    }
    const config = discoveryQueries[category];
    const metadata = DISCOVERY_CATEGORIES.find(item => item.id === category) ||
      { title: 'Hi-Res 候选', description: '哔哩哔哩音乐分区 · Hi-Res 关键词候选 · 需核验当前音轨' };
    let state = discoveryPages.get(category);
    let refreshToken;
    if (page === 1) {
      // Keep the last successful feed pageable while a refresh is pending or
      // fails. Only the latest successful refresh may publish its new snapshot.
      refreshToken = Symbol(category);
      discoveryRefreshes.set(category, refreshToken);
      state = { pages: new Map(), pending: new Map(), seen: new Set(), until: Math.floor(Date.now() / 1000) };
    }
    if (!state) throw new Error('请从音乐发现的第一页开始加载。');
    if (state.pages.has(page)) return state.pages.get(page);
    if (state.pending.has(page)) return state.pending.get(page);
    if (state.endedAt && page > state.endedAt) {
      return { ...state.pages.get(state.endedAt), tracks: [], hasMore: false, page };
    }
    if (page > 1 && !state.pages.has(page - 1)) throw new Error('请按顺序加载下一页音乐。');

    const requestPage = async () => {
      await ensureSession();
      const since = state.until - 30 * 86400;
      const params = { search_type: 'video', keyword: config.keyword, tids: config.tid,
        order: config.order, page, page_size: discoveryPageSize };
      if (category === 'popular') Object.assign(params, { pubtime_begin_s: since, pubtime_end_s: state.until });
      // The old music ranking endpoint can return an abandoned 2025 snapshot;
      // region/dynamic is also retired. Use the live music-filtered search API,
      // with its real sorting and scope stated explicitly in the UI metadata.
      const data = await read(api + '/x/web-interface/search/type', params);
      if (!Array.isArray(data.result) || (data.page !== undefined && Number(data.page) !== page)) {
        throw new Error('哔哩哔哩未返回有效的音乐发现列表。');
      }
      const totalPages = data.numPages === undefined ? null : Number(data.numPages);
      if (totalPages !== null && (!Number.isSafeInteger(totalPages) || totalPages < 0)) {
        throw new Error('哔哩哔哩返回了无效的音乐发现分页。');
      }
      const tracks = [];
      const pageIDs = new Set();
      for (const row of data.result) {
        if (!row || typeof row !== 'object' || (row.type && row.type !== 'video')) continue;
        const tid = Number(row.typeid ?? row.tid);
        if (!musicRegions.has(tid) || (config.tid !== 3 && tid !== config.tid)) continue;
        const published = Number(row.pubdate);
        if (category === 'popular' && (!Number.isSafeInteger(published) || published < since || published > state.until)) continue;
        const track = video(row);
        if (!track || !track.title || pageIDs.has(track.id) || state.seen.has(track.id)) continue;
        pageIDs.add(track.id);
        if (Number.isSafeInteger(published) && published > 0) track.publishedAt = published * 1000;
        const playCount = Number(row.play);
        if (Number.isSafeInteger(playCount) && playCount >= 0) track.playCount = playCount;
        if (category === 'hires') track.qualityEvidence = unknownQuality('candidate');
        tracks.push(track);
      }
      const hasMore = data.result.length > 0 && page < discoveryPageLimit &&
        (totalPages === null ? data.result.length >= discoveryPageSize : page < totalPages);
      const result = { tracks, hasMore, category, page, source, label: metadata.title,
        description: metadata.description, updatedAt: Date.now() };
      for (const id of pageIDs) state.seen.add(id);
      state.pages.set(page, result);
      if (!hasMore) state.endedAt = page;
      if (page === 1 && discoveryRefreshes.get(category) === refreshToken) discoveryPages.set(category, state);
      return result;
    };
    const pending = requestPage();
    state.pending.set(page, pending);
    try { return await pending; }
    finally { state.pending.delete(page); }
  }
  async function search(query, page) {
    const bv = query.match(/^(BV[0-9a-zA-Z]{10})$/) || query.match(/^https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(BV[0-9a-zA-Z]{10})(?=[/?#]|$)/);
    if (bv) {
      if (page > 1) return [];
      const row = await detail(bv[1]);
      const pageParam = query.startsWith('http') ? new URL(query).searchParams.get('p') : null;
      const pages = row.pages || [];
      return pages.filter(p => pageParam === null || +pageParam === p.page).map(p => video(row, p)).filter(Boolean);
    }
    const au = query.match(/^(?:https?:\/\/(?:www\.)?bilibili\.com\/audio\/)?au([1-9]\d*)(?:[/?#].*)?$/i);
    if (au) return page === 1 ? [await audioTrack(au[1])] : [];
    return (await searchRows('video', query, page)).map(row => video(row)).filter(Boolean);
  }
  async function searchEntities(type, query, page) {
    if (type !== 'uploader') throw new Error('可通过 UP 主空间、合集链接或投稿详情找到哔哩哔哩合集。');
    return (await searchRows('bili_user', query, page)).map(row => entity(source, type, row.mid, row.uname, row.upic)).filter(Boolean);
  }
  async function entities(track) {
    if (track.au) return track.entities || [];
    const row = await detail(track.bvid);
    return video(row)?.entities || [];
  }
  async function browse(item, page) {
    await ensureSession();
    if (item.type === 'uploader') {
      // The public space's “播放全部” list uses the previous archive ID as its cursor.
      if (page === 1) {
        if (uploaderCursors.size >= 40) uploaderCursors.delete(uploaderCursors.keys().next().value);
        uploaderCursors.set(item.id, new Map([[1, '']]));
      }
      const chain = uploaderCursors.get(item.id);
      if (!chain?.has(page)) throw new Error('请从 UP 主投稿的第一页顺序加载。');
      const oid = chain.get(page);
      if (oid === null) return [];
      const data = await read(api + '/x/v2/medialist/resource/list',
        { type: 1, biz_id: item.id, oid, otype: 2, ps: 30, direction: 'false' });
      const rows = data.media_list || [];
      const last = positiveID(rows.at(-1)?.id);
      chain.set(page + 1, data.has_more && last && last !== oid ? last : null);
      return rows.filter(row => String(row.id) !== oid).map(row =>
        video({ ...row, bvid: row.bv_id, owner: row.upper, pic: row.cover, cid: row.pages?.[0]?.id })).filter(Boolean);
    }
    if (item.type !== 'collection' || !positiveID(item.mid)) throw new Error('合集链接缺少 UP 主空间编号。');
    const data = await read(api + '/x/polymer/web-space/seasons_archives_list', { mid: item.mid, season_id: item.id, page_num: page, page_size: 30 }, spaceHeaders(item.mid));
    const meta = data.meta;
    const collection = meta && String(meta.season_id) === item.id
      ? entity(source, 'collection', meta.season_id, meta.name || meta.title, meta.cover, { mid: String(meta.mid || item.mid) }) : item;
    return (data.archives || []).map(row => {
      const track = video(row, null, { id: item.mid, title: row.author || '' });
      if (track) track.entities.push(collection);
      return track;
    }).filter(Boolean);
  }
  async function collections(uploader, page) {
    if (uploader.type !== 'uploader' || !positiveID(uploader.id)) throw new Error('请先选择 UP 主。');
    await ensureSession();
    const data = await read(api + '/x/polymer/web-space/seasons_series_list',
      { mid: uploader.id, page_num: page, page_size: 20 }, spaceHeaders(uploader.id));
    return (data.items_lists?.seasons_list || []).map(({ meta }) => meta &&
      entity(source, 'collection', meta.season_id, meta.name, meta.cover, { mid: uploader.id })).filter(Boolean);
  }
  async function audioStreams(track) {
    await ensureSession();
    const append = (info) => {
      if (String(info.sid) !== String(track.au) || !Array.isArray(info.cdns)) return [];
      const q = Number(info.type);
      if (![-1, 0, 1, 2, 3].includes(q)) return [];
      const flac = q === 3;
      const quality = flac ? 'FLAC 无损' : q === -1 ? 'AAC · 试听' : 'AAC · ' + [128, 192, 320][q] + ' kbps';
      return info.cdns.map(httpsURL).filter(Boolean).map(url => ({ url, headers, quality, codec: flac ? 'flac' : 'aac', lossless: flac,
        mimeType: flac ? 'audio/flac' : 'audio/mp4' }));
    };
    let best = [];
    try {
      const info = await read(api + '/audio/music-service-c/url', { songid: track.au, quality: 3, privilege: 2, platform: 'android', mid: 0 });
      best = append(info);
      if (best.length && best[0].lossless === false) return best;
    } catch { /* The web endpoint can still provide the public track. */ }
    try {
      const info = await read(web + '/audio/music-service-c/web/url', { sid: track.au, quality: 2, privilege: 2 });
      return [...best, ...append(info)];
    } catch (error) { if (best.length) return best; throw error; }
  }
  async function cidFor(track) {
    if (positiveID(track.cid)) return track.cid;
    const row = await detail(track.bvid);
    const cid = row.pages?.find(p => p.page === Number(track.page || 1))?.cid;
    if (!cid) throw new Error('哔哩哔哩未返回此分 P 的编号。');
    return cid;
  }
  function qualityIdentity(track) {
    const page = track?.page ?? 1;
    if (track?.source !== source || !bvidPattern.test(track?.bvid) || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
      throw new Error('音质核验需要有效的哔哩哔哩视频与分 P。');
    }
    return { id: 'bilibili:' + track.bvid + ':p' + page, bvid: track.bvid, page };
  }
  function rememberQuality(id, evidence, epoch) {
    if (epoch !== sessionEpoch) return;
    if (qualityCache.size >= 200 && !qualityCache.has(id)) qualityCache.delete(qualityCache.keys().next().value);
    qualityCache.set(id, evidence);
  }
  function unknownProbeError(error) {
    const reason = error?.qualityReason || (/-101|未登录/.test(error?.message) ? 'login-required'
      : /请求受限|平台限制|HTTP (?:412|429)/.test(error?.message) ? 'restricted'
        : /timeout|超时/i.test(error?.message) || error?.name === 'AbortError' ? 'timeout' : 'unavailable');
    return unknownQuality(reason);
  }
  async function probeQuality(job) {
    const checkpoint = () => {
      const qualityReason = job.epoch !== sessionEpoch ? 'session-changed' : job.deadline <= Date.now() ? 'timeout' : '';
      if (qualityReason) throw Object.assign(new Error('音质暂未确认'), { qualityReason });
    };
    checkpoint();
    // Resolve the CID from the video's own page list rather than trusting a
    // caller-supplied CID that could belong to a different upload.
    const info = await detail(job.track.bvid);
    checkpoint();
    if (info.bvid && info.bvid !== job.track.bvid) throw new Error('视频资料不匹配');
    const cid = positiveID(info.pages?.find(part => Number(part.page) === job.track.page)?.cid);
    if (!cid) return unknownQuality('missing-page');
    const data = await signed('/x/player/wbi/playurl',
      { bvid: job.track.bvid, cid, fnval: 4048, fnver: 0, fourk: 1, qn: 80 }, undefined, checkpoint);
    checkpoint();
    return dashQualityEvidence(data.dash, canPlayType);
  }
  function pumpQualityQueue() {
    while (activeQualityJobs < 2 && qualityQueue.length) {
      const job = qualityQueue.shift();
      if (job.settled) {
        if (qualityPending.get(job.track.id) === job) qualityPending.delete(job.track.id);
        continue;
      }
      activeQualityJobs++;
      void probeQuality(job).then(job.finish, error => job.finish(unknownProbeError(error))).finally(() => {
        // The native/PWA transport can outlive our UI timeout. Hold this slot
        // until that request settles so another batch never exceeds two probes.
        activeQualityJobs--;
        if (qualityPending.get(job.track.id) === job) qualityPending.delete(job.track.id);
        pumpQualityQueue();
      });
    }
  }
  function qualityFor(track) {
    const cached = qualityCache.get(track.id);
    if (cached?.expiresAt > Date.now()) return Promise.resolve({ ...cached });
    const existing = qualityPending.get(track.id);
    if (existing) return existing.result;
    if (qualityPending.size >= 24) return Promise.resolve(unknownQuality('busy'));
    const job = { track, epoch: sessionEpoch, deadline: Date.now() + 6000, settled: false };
    job.result = new Promise(resolve => {
      job.finish = evidence => {
        if (job.settled) return;
        job.settled = true;
        clearTimeout(job.timer);
        const result = job.epoch === sessionEpoch ? evidence : unknownQuality('session-changed');
        rememberQuality(track.id, result, job.epoch);
        resolve({ ...result });
      };
    });
    job.timer = setTimeout(() => job.finish(unknownQuality('timeout')), 6000);
    qualityPending.set(track.id, job);
    qualityQueue.push(job);
    pumpQualityQueue();
    return job.result;
  }
  async function inspectQuality(tracks) {
    if (!Array.isArray(tracks) || tracks.length > 6) throw new Error('每批最多核验 6 首音乐。');
    const unique = new Map(tracks.map(track => { const value = qualityIdentity(track); return [value.id, value]; }));
    return Promise.all([...unique.values()].map(async track => ({ id: track.id, qualityEvidence: await qualityFor(track) })));
  }
  async function resolve(track) {
    if (track.au) return audioStreams(track);
    const cid = await cidFor(track);
    // Request all web DASH formats with the native/PWA session; the server grants tiers per account and upload.
    const data = await signed('/x/player/wbi/playurl', { bvid: track.bvid, cid, fnval: 4048, fnver: 0, fourk: 1, qn: 80 });
    const streams = dashStreams(data.dash, canPlayType);
    if (!streams.length) throw new Error('此投稿没有当前设备可播放的独立音轨。');
    return streams;
  }
  async function lyrics(track) {
    if (track.au) return track.lyricUrl ? parseLrc(await getBody(request, track.lyricUrl, headers)) : [];
    const cid = await cidFor(track);
    const data = await signed('/x/player/wbi/v2', { bvid: track.bvid, cid });
    const options = (data.subtitle?.subtitles || []).filter(s => httpsURL(s.subtitle_url));
    const language = track => String(track.lan || '').toLowerCase().replace(/^ai-/, '').split('-')[0];
    const sub = options.find(s => language(s) === 'zh') || options[0];
    if (!sub) return [];
    const other = options.find(s => language(s) && language(s) !== language(sub));
    const getCues = async source => (await json(httpsURL(source.subtitle_url))).body || [];
    const [words, translations] = await Promise.all([
      getCues(sub), other ? getCues(other).catch(() => []) : []
    ]);
    return subtitleLyricLines(words, sub.lan, translations);
  }
  return { search, discover, inspectQuality, resolve, lyrics, entities, searchEntities, browse, collections, resetSession };
}
