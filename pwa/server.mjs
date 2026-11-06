import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { boundedText, catalog, createSession, HttpError, mediaResponse } from './provider-network.mjs';
import { createDatabase } from './database.mjs';
import { createAuthRoutes } from './auth-routes.mjs';

const assets = fileURLToPath(new URL('../src/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon',
  '.flac': 'audio/flac', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const sessionTTL = 24 * 3600000;

function json(res, status, object) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(object));
}
function check(condition, status, message) { if (!condition) throw new HttpError(status, message); }
function publicError(error) {
  if (error instanceof HttpError) return error.message;
  if (/^(?:酷我|哔哩哔哩|网易云|平台|音源|没有可供|此投稿)/.test(error.message)
      && !/https?:|SESSDATA|token|cookie|qrcode_key/i.test(error.message)) return error.message.slice(0, 160);
  return '音源暂时无法访问，请稍后重试。';
}
function rangeHeader(value) {
  if (!value) return '';
  check(/^bytes=(?:\d{1,15}-\d{0,15}|-\d{1,15})$/.test(value), 416, '音频范围无效。');
  return value;
}
async function staticFile(req, res, pathname) {
  check(req.method === 'GET' || req.method === 'HEAD', 405, '请求方式无效。');
  let name;
  try { name = decodeURIComponent(pathname); } catch { throw new HttpError(400, '文件路径无效。'); }
  if (name === '/') name = '/index.html';
  check(/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name), 404, '资源不存在。');
  const type = types[path.extname(name)];
  check(type, 404, '资源不存在。');
  const filename = path.join(assets, name.slice(1));
  let info;
  try { info = await stat(filename); } catch { throw new HttpError(404, '资源不存在。'); }
  check(info.isFile(), 404, '资源不存在。');
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
  let start = 0, end = info.size - 1, status = 200;
  const range = rangeHeader(req.headers.range);
  if (range) {
    const [a, b] = range.slice(6).split('-');
    if (a) { start = Number(a); end = b ? Math.min(Number(b), end) : end; }
    else start = Math.max(0, info.size - Number(b));
    if (start > end || start >= info.size) {
      res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + info.size }); res.end(); return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    status = 206;
  }
  res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD' || info.size === 0) { res.end(); return; }
  await pipeline(createReadStream(filename, { start, end }), res);
}

async function media(req, res, session, key, fetcher) {
  check(req.method === 'GET' || req.method === 'HEAD', 405, '请求方式无效。');
  check(!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] !== 'cross-site', 403, '跨站音频请求受限。');
  const item = session?.media.get(key);
  check(item && item.expires > Date.now(), 404, '音频地址已过期，请重新点播。');
  check(session.active < 6, 429, '请稍后重试。');
  const range = rangeHeader(req.headers.range);
  const controller = new AbortController();
  session.controllers ||= new Set(); session.controllers.add(controller);
  const abort = () => controller.abort();
  // A header timeout bounds failed connections. The body can continue for a whole song.
  const timer = setTimeout(abort, 20000);
  res.once('close', abort);
  session.active++;
  try {
    const remote = await mediaResponse(item, req.method, range, controller.signal, fetcher);
    clearTimeout(timer);
    const headers = { 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin' };
    for (const name of ['content-range', 'accept-ranges', 'content-length']) {
      if (remote.headers.has(name)) headers[name] = remote.headers.get(name);
    }
    if (remote.status === 416) { await remote.body?.cancel(); delete headers['content-length']; res.writeHead(416, headers); res.end(); return; }
    if (![200, 206].includes(remote.status)) { await remote.body?.cancel(); throw new HttpError(502, '音源拒绝了本次播放请求。'); }
    if (!['identity', null].includes(remote.headers.get('content-encoding'))) delete headers['content-length'];
    headers['Content-Type'] = /^audio\/[a-z0-9.+-]+$/i.test(item.mimeType) ? item.mimeType : 'application/octet-stream';
    res.writeHead(remote.status, headers);
    if (!remote.body || req.method === 'HEAD') { await remote.body?.cancel(); res.end(); return; }
    await pipeline(Readable.fromWeb(remote.body), res);
  } finally {
    clearTimeout(timer); res.off('close', abort); controller.abort(); session.controllers.delete(controller); session.active--;
  }
}

function rate(buckets, id, max, now) {
  let value = buckets.get(id);
  if (!value || value.until <= now) {
    if (buckets.size >= 16000) {
      for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
      check(buckets.size < 16000, 429, '当前请求较多，请稍后重试。');
    }
    value = { count: 0, until: now + 60000 }; buckets.set(id, value);
  }
  check(++value.count <= max, 429, '请求过于频繁，请稍后重试。');
}

export function createHandler({ publicOrigin, fetcher = fetch, database }) {
  const origin = new URL(publicOrigin);
  const secure = origin.protocol === 'https:';
  check(secure || ['127.0.0.1','localhost','[::1]'].includes(origin.hostname) && origin.protocol === 'http:',
    400, 'PUBLIC_ORIGIN 应使用 HTTPS 或本机回环地址。');
  const sessions = new Map(), buckets = new Map();
  const cookieName = secure ? '__Host-bilimusic' : 'bilimusic_dev';
  const cookieFlags = '; Path=/; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
  function destroySession(key, session) {
    session.closed=true; session.pending=null; session.media.clear(); session.tracks.clear();
    for(const controller of session.controllers||[])controller.abort();
    void session.jar.removeAllCookies().catch(()=>{});
    sessions.delete(key);
  }
  const authRoutes=createAuthRoutes({database,secure,rate:(id,max,now)=>rate(buckets,id,max,now),onSessionEnd:key=>{
    if(!key)return;
    for(const [id,session] of sessions)if(session.authKey===key)destroySession(id,session);
  }});
  let lastSweep = 0, pendingRequests = 0;
  function cookieId(req) {
    const value = (req.headers.cookie || '').split(';').map(entry => entry.trim()).find(entry => entry.startsWith(cookieName + '='));
    return value?.slice(cookieName.length + 1) || '';
  }
  function sessionFor(req, res, create, now, clientIP, auth) {
    const id = cookieId(req);
    let session = sessions.get(id);
    if (session && now - session.lastSeen >= sessionTTL) { destroySession(id,session); session = null; }
    if(database&&session&&(session.userId!==auth.user?.id||session.authKey!==auth.key))session=null;
    if (!session && create) {
      rate(buckets, 'new-session:' + clientIP, 24, now);
      check(sessions.size < 512, 503, '服务器繁忙，请稍后重试。');
      const key = randomBytes(32).toString('hex');
      session = createSession(fetcher);
      if(database) {session.userId=auth.user.id;session.authKey=auth.key;}
      sessions.set(key, session);
      res.setHeader('Set-Cookie', cookieName + '=' + key + cookieFlags + '; Max-Age=86400');
    }
    if (session) session.lastSeen = now;
    return session;
  }
  return async function handler(req, res) {
    let reserved = false, activeSession;
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      check(req.headers.host?.toLowerCase() === origin.host, 400, '域名不匹配。');
      const pathname = new URL(req.url, origin).pathname;
      if (!pathname.startsWith('/api/')) { await staticFile(req, res, pathname); return; }
      res.setHeader('Cache-Control', 'private, no-store');
      const now = Date.now();
      if (now - lastSweep > 60000) {
        for (const [key, session] of sessions) if (session.lastSeen + sessionTTL <= now) destroySession(key,session);
        for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
        lastSweep = now;
      }
      const proxyIP = req.headers['x-real-ip'];
      const clientIP = typeof proxyIP === 'string' && isIP(proxyIP) ? proxyIP : req.socket.remoteAddress;
      rate(buckets, 'addr:' + clientIP, 600, now);
      check(pendingRequests < 72, 503, '服务器繁忙，请稍后重试。');
      pendingRequests++; reserved = true;
      const auth=authRoutes.read(req);
      if(database&&!['/api/auth/status','/api/auth/login'].includes(pathname))check(auth.user,401,'请先登录 BiliMusic。');
      if (pathname.startsWith('/api/media/')) {
        await media(req, res, sessionFor(req, res, false, now, clientIP,auth), pathname.slice('/api/media/'.length), fetcher); return;
      }
      check(req.method === 'POST', 405, '请使用 POST。');
      check(req.headers.origin === origin.origin && req.headers['sec-fetch-site'] !== 'cross-site', 403, '请求来源不匹配。');
      check(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 415, '请发送 JSON。');
      const body = await boundedText(req, pathname==='/api/auth/login'?4096:pathname==='/api/playlists/add'?4*1024*1024:pathname.startsWith('/api/playlists/')?512*1024:48*1024);
      let input;
      try { input = JSON.parse(body); } catch { throw new HttpError(400, 'JSON 格式无效。'); }
      check(input && typeof input === 'object' && !Array.isArray(input), 400, '输入参数无效。');
      // Uploading a body yields to other requests; logout may have revoked the
      // credential after the early gate, before any data read or write occurs.
      if(database) {
        auth.user=database.authenticate(auth.token);
        if(!['/api/auth/status','/api/auth/login'].includes(pathname))check(auth.user,401,'请先登录 BiliMusic。');
      }
      const handled=await authRoutes.handle(pathname,input,{auth,clientIP,now});
      if(handled) {
        if(database&&!pathname.startsWith('/api/auth/'))check(database.authenticate(auth.token)?.id===auth.user.id,401,'登录状态已失效，请重新登录。');
        const cookies=handled.cookies||[];
        if(handled.clearProvider)cookies.push(cookieName+'='+cookieFlags+'; Max-Age=0');
        if(cookies.length)res.setHeader('Set-Cookie',cookies);
        json(res,200,handled.value);return;
      }
      const catalogRoute = pathname === '/api/catalog';
      const bootstrap = pathname === '/api/session';
      const action = pathname.match(/^\/api\/account\/(status|qr|poll|cancel|logout)$/)?.[1];
      check(catalogRoute || bootstrap || action, 404, '接口不存在。');
      if (action === 'logout') {
        const id = cookieId(req), old = sessions.get(id);
        if (old&&(!database||(old.userId===auth.user.id&&old.authKey===auth.key))) destroySession(id,old);
        res.setHeader('Set-Cookie', cookieName + '=' + cookieFlags + '; Max-Age=0');
        json(res, 200, { loggedIn: false, name: '' }); return;
      }
      const session = sessionFor(req, res, catalogRoute || bootstrap || action === 'qr', now, clientIP,auth);
      if (bootstrap) { json(res, 200, {}); return; }
      if (!session) {
        json(res, 200, action === 'status' ? { loggedIn: false, name: '' } : action === 'cancel' ? {} : { status: 'expired' }); return;
      }
      if (action === 'qr') rate(buckets, 'qr:' + clientIP, 12, now);
      rate(buckets, 'session:' + (cookieId(req) || clientIP), 150, now);
      check(session.jobs < 8, 429, '当前操作较多，请稍后重试。');
      activeSession=session; activeSession.jobs++;
      const result=catalogRoute?{result:await catalog(session,input.op,input.args)}:await session.account(action);
      if(database)check(!session.closed&&database.authenticate(auth.token)?.id===auth.user.id,401,'登录状态已失效，请重新登录。');
      json(res,200,result);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error instanceof HttpError ? error.status : 502, { error: publicError(error) });
      else if (!res.destroyed) res.destroy();
    } finally {
      if (activeSession) activeSession.jobs--;
      if (reserved) pendingRequests--;
    }
  };
}

export function databaseOptionsFromEnv(env=process.env) {
  const filename=env.BILIMUSIC_DB_PATH||path.resolve(env.BILIMUSIC_STATE_DIR||env.STATE_DIR||path.join(fileURLToPath(new URL('.',import.meta.url)),'state'),'bilimusic.sqlite');
  return {filename,adminUsername:env.BILIMUSIC_ADMIN_USERNAME||'Music',adminPassword:env.BILIMUSIC_ADMIN_PASSWORD,adminPasswordHash:env.BILIMUSIC_ADMIN_PASSWORD_HASH};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3294);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('无效的 PORT。');
  const publicOrigin = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:' + port;
  const database=await createDatabase(databaseOptionsFromEnv());
  const server = http.createServer({ requestTimeout: 30000, headersTimeout: 15000 }, createHandler({ publicOrigin,database }));
  server.on('close',()=>database.close());
  server.maxConnections = 512;
  server.listen(port, '127.0.0.1');
}
