const entities = { amp: '&', quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', nbsp: ' ' };

export function plain(value) {
  return String(value ?? '').replace(/<\/?em\b[^>]*>/gi, '')
    .replace(/&(amp|quot|apos|#39|lt|gt|nbsp);/gi, (_, key) => entities[key.toLowerCase()]).trim();
}

export function httpsURL(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).replace(/^\/\//, 'https://'));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

export function seconds(value) {
  const parts = String(value ?? '').split(':').map(Number);
  return parts.every(n => Number.isFinite(n) && n >= 0) ? parts.reduce((acc, n) => acc * 60 + n, 0) : 0;
}

export function positiveID(value) {
  const s = String(value ?? '');
  return /^[1-9]\d{0,19}$/.test(s) ? s : '';
}

export function urlWithParams(url, params) {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, value);
  return u.href;
}

export async function getBody(request, url, headers) {
  const response = await request(url, { headers });
  if (response.status === 412 || response.status === 429) throw new Error('平台限制了本次请求，请稍后重试。');
  if (response.status < 200 || response.status >= 300) throw new Error('平台请求失败（HTTP ' + response.status + '）。');
  return response.body;
}

export async function getJSON(request, url, headers) {
  const body = await getBody(request, url, headers);
  try { return JSON.parse(body); } catch { throw new Error('平台未返回可读的数据，请稍后重试。'); }
}

export function entity(source, type, id, title, cover, extra = {}) {
  return positiveID(id) ? { source, type, id: String(id), title: plain(title), cover: httpsURL(cover), ...extra } : null;
}
