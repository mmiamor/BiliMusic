// Official player links: https://radioparadise.com/listen/stream-links
// Verified 2026-11-06: all four HTTPS streams carry stereo 16-bit / 44.1 kHz
// FLAC in an Ogg container. This is CD-quality lossless live radio, not Hi-Res.
const website = 'https://radioparadise.com/listen/stream-links';
const qualityLabel = 'FLAC · 16 bit / 44.1 kHz';
const definitions = [
  ['main', '主频道 · Main Mix', '多种风格交织的音乐直播。', '/flac'],
  ['mellow', '轻柔频道 · Mellow Mix', '节奏舒缓的音乐直播。', '/mellow-flac'],
  ['rock', '摇滚频道 · Rock Mix', '以摇滚音乐为主的直播。', '/rock-flac'],
  ['global', '环球频道 · Global Mix', '来自世界各地的音乐直播。', '/global-flac'],
];
const mediaByStation = new Map(definitions.map(([id, , , path]) =>
  [id, 'https://stream.radioparadise.com' + path]));
const mediaURLs = new Set(mediaByStation.values());

export const RADIO_STATIONS = Object.freeze(definitions.map(([stationId, title, description]) =>
  Object.freeze({ source: 'radioparadise', id: 'radioparadise:' + stationId,
    stationId, title, artist: 'Radio Paradise', isLive: true, duration: 0,
    description, qualityLabel, website, cover: '' })));

// Exact canonical strings deliberately reject even a query, fragment, explicit
// default port or a URL-normalized alternative. This is not a generic proxy.
export function isRadioMediaURL(value) {
  return typeof value === 'string' && mediaURLs.has(value);
}

export function radioProvider() {
  return {
    async search(query = '', page = 1) {
      if (page !== 1) return [];
      const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
      return RADIO_STATIONS.filter(station => {
        const text = [station.title, station.artist, station.stationId, station.description, station.qualityLabel]
          .join(' ').toLowerCase();
        return words.every(word => text.includes(word));
      }).map(station => ({ ...station }));
    },
    async resolve(track) {
      const url = mediaByStation.get(track?.stationId);
      if (!url || (track.source && track.source !== 'radioparadise')) {
        throw new Error('未识别的 Radio Paradise 频道。');
      }
      // Ignore caller-supplied URLs, headers and quality metadata. There is no
      // lossy fallback: a FLAC failure must remain visible to the listener.
      return [{ url, headers: {}, codec: 'flac', mimeType: 'audio/ogg',
        lossless: true, quality: qualityLabel + ' · 无损直播', isLive: true,
        sampleRate: 44100, bitDepth: 16, channels: 2 }];
    },
    async entities() { return []; },
    async lyrics() { return []; },
  };
}
