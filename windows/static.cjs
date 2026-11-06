const { createReadStream } = require('node:fs');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

// Chromium's file: fetch response does not expose byte ranges or a content
// length through a custom protocol. Serve the actual bytes so bundled audio
// retains a seekable duration instead of being treated as an unbounded stream.
async function staticFileResponse(request, root) {
  const url = new URL(request.url);
  if (url.protocol !== 'bilimusic:' || url.host !== 'app' || !['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 403 });
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/'); }
  catch { return new Response(null, { status: 400 }); }
  const file = path.resolve(root, '.' + pathname);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return new Response(null, { status: 403 });
  }
  let info;
  try { info = await stat(file); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return new Response(null, { status: 404 });
    throw error;
  }
  if (!info.isFile()) return new Response(null, { status: 404 });
  const headers = {
    'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'accept-ranges': 'bytes',
    'last-modified': info.mtime.toUTCString(),
  };
  let start = 0, end = info.size - 1, status = 200;
  const range = request.headers.get('range');
  if (range !== null) {
    const invalid = () => new Response(null, { status: 416, headers: {
      ...headers, 'content-range': `bytes */${info.size}`, 'content-length': '0',
    } });
    if (!/^bytes=(?:\d{1,15}-\d{0,15}|-\d{1,15})$/.test(range)) return invalid();
    const [a, b] = range.slice(6).split('-');
    if (a) { start = Number(a); end = b ? Math.min(Number(b), end) : end; }
    else start = Math.max(0, info.size - Number(b));
    if (start > end || start >= info.size) return invalid();
    headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
    status = 206;
  }
  headers['content-length'] = String(end - start + 1);
  if (request.method === 'HEAD' || info.size === 0) return new Response(null, { status, headers });
  const stream = createReadStream(file, { start, end });
  const abort = () => stream.destroy();
  if (request.signal.aborted) abort();
  else request.signal.addEventListener('abort', abort, { once: true });
  stream.once('close', () => request.signal.removeEventListener('abort', abort));
  return new Response(Readable.toWeb(stream), { status, headers });
}

module.exports = { staticFileResponse };
