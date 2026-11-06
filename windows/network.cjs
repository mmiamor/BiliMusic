const { net } = require('electron');
const { Readable } = require('node:stream');

// Exact domain or a subdomain. Never let a media redirect escape the provider family list.
const domains = ['bilibili.com', 'bilivideo.com', 'bilivideo.cn', 'biliapi.net',
  'biliapi.com', 'hdslb.com', 'bilivideo.net', 'akamaized.net', 'kuwo.cn', 'kuwo.com'];
const headerNames = new Set(['accept', 'accept-language', 'origin', 'referer', 'user-agent',
  'csrf', 'secret', 'cross', 'x-requested-with', 'x-csrf-token']);
const maxMetadata = 8 * 1024 * 1024;
const radioURLs = new Set(['flac', 'mellow-flac', 'rock-flac', 'global-flac'].map(path => 'https://stream.radioparadise.com/' + path));
const neteaseCatalog = new Set(['/api/cloudsearch/pc', '/api/song/detail/', '/api/song/lyric',
  '/api/song/enhance/player/url/v1', '/api/v1/artist/songs']);

function checkedURL(input) {
  const url = new URL(input);
  if (url.hostname === 'stream.radioparadise.com' && !radioURLs.has(input)) throw new Error('该来源地址不在受支持的平台范围内');
  // Passport payloads may contain session material. Only the native login window handles them.
  if (['passport.bilibili.com', 'account.bilibili.com'].includes(url.hostname)) {
    throw new Error('请在哔哩哔哩官方登录窗口完成授权');
  }
  const netease = url.hostname.endsWith('.music.126.net') || (url.hostname === 'music.163.com' &&
    (neteaseCatalog.has(url.pathname) || /^\/api\/v1\/(album\/[1-9]\d*|resource\/(hotcomments|comments)\/R_SO_4_[1-9]\d*)$/.test(url.pathname)));
  const radio = url.hostname === 'stream.radioparadise.com' && !url.search && !url.hash &&
    /^\/(?:flac|mellow-flac|rock-flac|global-flac)$/.test(url.pathname);
  const safeDomain = !url.port && (radio || netease || domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain)));
  const edge = (url.port === '8082' && url.hostname.endsWith('.mcdn.bilivideo.cn')) ||
    (url.port === '4483' && url.hostname.endsWith('.edge.mountaintoys.cn'));
  if (url.protocol !== 'https:' || url.username || url.password || !(safeDomain || edge)) {
    throw new Error('该来源地址不在受支持的平台范围内');
  }
  return url.href;
}

function checkedSource(input) {
  const url = checkedURL(input?.url);
  const headers = {};
  for (const [name, value] of Object.entries(input.headers || {})) {
    if (headerNames.has(name.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) {
      headers[name.toLowerCase()] = value;
    }
  }
  const mimeType = /^audio\/[a-z0-9.+-]+$/i.test(input.mimeType) ? input.mimeType : '';
  return { url, headers, mimeType };
}

function openRemote(source, range, signal) {
  return new Promise((resolve, reject) => {
    // These are explicit provider page URLs, not the renderer's browsing URL.
    // Chromium rejects a full cross-origin Referer under its default strict-origin
    // policy before sending the request (ERR_BLOCKED_BY_CLIENT). Preserve the
    // approved provider's page referrer; checkedURL still permits HTTPS only.
    const request = net.request({ url: source.url, credentials: 'include', redirect: 'manual',
      referrerPolicy: 'no-referrer-when-downgrade' });
    const abort = () => { request.abort(); reject(new Error('音源连接已取消')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    // Only bound the connection phase. Long tracks can remain open while playing.
    const timer = setTimeout(abort, 30000);
    request.on('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    });
    request.on('error', reject);
    request.on('redirect', (_status, _method, url) => {
      try {
        if (radioURLs.has(source.url) && !radioURLs.has(url)) throw new Error('电台重定向地址不受支持');
        checkedURL(url); request.followRedirect();
      } catch (error) { request.abort(); reject(error); }
    });
    request.on('response', (response) => {
      clearTimeout(timer);
      resolve({ response, request });
    });
    for (const [name, value] of Object.entries(source.headers)) request.setHeader(name, value);
    if (range) request.setHeader('Range', range);
    request.end();
  });
}

async function requestText(input) {
  const { response, request } = await openRemote(checkedSource(input));
  const chunks = [];
  let length = 0;
  const timer = setTimeout(() => request.abort(), 30000);
  try {
    for await (const chunk of response) {
      length += chunk.length;
      if (length > maxMetadata) { request.abort(); throw new Error('来源响应过大'); }
      chunks.push(chunk);
    }
  } finally { clearTimeout(timer); }
  const headers = {};
  for (const [name, values] of Object.entries(response.headers)) {
    if (name !== 'set-cookie') headers[name] = Array.isArray(values) ? values.join(', ') : String(values);
  }
  return { status: response.statusCode, headers, body: Buffer.concat(chunks).toString('utf8') };
}

async function streamMedia(source, request) {
  const { response } = await openRemote(source, request.headers.get('range'), request.signal);
  const headers = { 'cache-control': 'no-store' };
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers[name];
    if (value) headers[name] = Array.isArray(value) ? value[0] : value;
  }
  if (source.mimeType && response.statusCode < 300) headers['content-type'] = source.mimeType;
  return new Response(Readable.toWeb(response), { status: response.statusCode, headers });
}

module.exports = { checkedSource, requestText, streamMedia };
