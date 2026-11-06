const verifiedTTL = 10 * 60 * 1000;
const unknownTTL = 30 * 1000;

const labels = {
  hires: '平台 Hi-Res · FLAC', lossless: 'FLAC 无损', lossy: '当前返回有损音轨',
  unsupported: '设备暂不支持此音轨', unknown: '音质待核验',
};

export function unknownQuality(reason = 'candidate', checkedAt = Date.now()) {
  return { status: 'unknown', formatStatus: 'unknown', label: reason === 'candidate' ? '音质待核验' : '音质暂未确认',
    codec: '', mimeType: '', mediaType: '', lossless: null, playable: null, platformTier: null,
    checkedAt, expiresAt: reason === 'candidate' ? 0 : checkedAt + unknownTTL, reason, evidenceSource: 'none' };
}

function codecLabel(codec) {
  if (/^(?:mp4a|aac)/i.test(codec)) return 'AAC';
  if (/^ec-3$/i.test(codec)) return 'Dolby E-AC-3';
  if (/^ac-3$/i.test(codec)) return 'Dolby AC-3';
  return codec.toUpperCase();
}

// A Node/PWA backend can establish the platform format, but only the listening
// device can establish decoder support. Do not turn server-side metadata into
// a promise that an arbitrary browser can play FLAC in an MP4 container.
export function adaptQualityForDevice(evidence, canPlayType) {
  if (!evidence || !['hires', 'lossless', 'lossy'].includes(evidence.formatStatus) ||
      evidence.evidenceSource !== 'bilibili-dash' || !evidence.mediaType) return evidence;
  let playable = null;
  if (typeof canPlayType === 'function') {
    try { playable = Boolean(canPlayType(evidence.mediaType)); } catch { /* Unknown, not unsupported. */ }
  }
  const status = playable === true ? evidence.formatStatus : playable === false ? 'unsupported' : 'unknown';
  const label = playable === null ? codecLabel(evidence.codec) + ' · 待确认设备支持'
    : playable === false ? codecLabel(evidence.codec) + ' · 当前设备不支持'
      : status === 'lossy' ? '当前返回 ' + codecLabel(evidence.codec) : labels[status];
  return { ...evidence, status, label, playable,
    reason: playable === null ? 'device-unchecked' : playable === false ? 'unsupported-codec' : '' };
}

function approvedMediaURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname;
    if (url.port) return (url.port === '8082' && host.endsWith('.mcdn.bilivideo.cn')) ||
      (url.port === '4483' && host.endsWith('.edge.mountaintoys.cn'));
    return ['bilivideo.com', 'bilivideo.net', 'bilivideo.cn', 'hdslb.com'].some(domain => host === domain || host.endsWith('.' + domain)) ||
      /^upos-[a-z0-9-]+\.akamaized\.net$/.test(host);
  } catch { return false; }
}

// This validates metadata returned by the current platform session, not decoded
// sample data. FLAC/30251 never imply a bit depth or a sample rate such as 24/96.
export function dashQualityEvidence(dash, canPlayType, checkedAt = Date.now()) {
  const list = value => (Array.isArray(value) ? value : [value]).filter(item => item && typeof item === 'object');
  const candidates = [
    ...list(dash?.flac?.audio).map(item => [item, true]),
    ...list(dash?.audio).map(item => [item, Number(item.id) === 30251]),
    ...list(dash?.dolby?.audio).map(item => [item, false]),
  ];
  const evidence = [];
  for (const [item, tier] of candidates) {
    const backups = item.backupUrl ?? item.backup_url;
    const urls = [item.baseUrl, item.base_url, ...(Array.isArray(backups) ? backups : [])];
    if (!urls.some(approvedMediaURL)) continue;
    const mimeType = String(item.mimeType || item.mime_type || '').trim().toLowerCase();
    if (!/^audio\/(?:mp4|x-m4a|flac|x-flac|webm|ogg|aac)$/.test(mimeType)) continue;
    const rawFlac = /^audio\/(?:x-)?flac$/.test(mimeType);
    const declared = String(item.codecs || '').trim();
    if (rawFlac && declared && !/^flac$/i.test(declared)) continue;
    const codec = rawFlac || /^flac$/i.test(declared) ? 'flac' : declared;
    const lossless = codec === 'flac';
    if (lossless && !rawFlac && !['audio/mp4', 'audio/x-m4a'].includes(mimeType)) continue;
    if (!lossless && !/^(?:mp4a(?:\.[0-9a-f]+)+|aac|ec-3|ac-3|opus|vorbis)$/i.test(codec)) continue;
    const mediaType = rawFlac ? mimeType : mimeType + '; codecs="' + (lossless ? 'fLaC' : codec) + '"';
    const formatStatus = lossless ? tier ? 'hires' : 'lossless' : 'lossy';
    evidence.push(adaptQualityForDevice({ formatStatus, status: 'unknown', codec, mimeType, mediaType,
      lossless, playable: null, platformTier: tier && lossless ? 'hires' : 'standard',
      checkedAt, expiresAt: checkedAt + verifiedTTL, reason: 'device-unchecked',
      label: labels.unknown, evidenceSource: 'bilibili-dash' }, canPlayType));
  }
  // Describe the best verified upstream format, retaining an explicit unsupported
  // device state instead of pretending that an AAC fallback is the Hi-Res track.
  const score = item => item.formatStatus === 'hires' ? 3 : item.formatStatus === 'lossless' ? 2 : 1;
  evidence.sort((a, b) => score(b) - score(a));
  return evidence[0] || unknownQuality('no-verifiable-audio', checkedAt);
}
