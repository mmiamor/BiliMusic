// RFC 1321 digest used by Bilibili's WBI query signature.
const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
const mixin = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13];

export function md5(text) {
  const data = new TextEncoder().encode(text);
  const bytes = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  bytes.set(data);
  bytes[data.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, data.length * 8, true);
  view.setUint32(bytes.length - 4, Math.floor(data.length / (2 ** 29)), true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const round = Math.floor(i / 16);
      let f, word;
      if (round === 0) { f = (b & c) | (~b & d); word = i; }
      else if (round === 1) { f = (d & b) | (~d & c); word = 5 * i + 1; }
      else if (round === 2) { f = b ^ c ^ d; word = 3 * i + 5; }
      else { f = c ^ (b | ~d); word = 7 * i; }
      const sum = (a + f + constants[i] + view.getUint32(offset + (word % 16) * 4, true)) | 0;
      const shift = shifts[round][i % 4];
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      a = d; d = c; c = b; b = (b + rotated) | 0;
    }
    [a, b, c, d].forEach((n, i) => { state[i] = (state[i] + n) | 0; });
  }
  return state.flatMap(n => [0, 8, 16, 24].map(s => ((n >>> s) & 255).toString(16).padStart(2, '0'))).join('');
}

export function signedQuery(params, img, now = Date.now()) {
  const keys = [img?.img_url, img?.sub_url].map(url => (url || '').match(/\/([a-z\d]{32})\.\w+(?:\?|$)/i)?.[1]);
  if (keys.some(key => !key)) throw new Error('哔哩哔哩未提供搜索签名，请稍后重试。');
  const secret = mixin.map(i => keys.join('')[i]).join('');
  const data = { ...params, wts: Math.floor(now / 1000) };
  const query = Object.keys(data).sort().map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(String(data[k]).replace(/[!'()*]/g, ''))).join('&');
  return query + '&w_rid=' + md5(query + secret);
}
