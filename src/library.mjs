export const sectionInfo = {
  tracks: ['喜欢的歌曲', 'heart'],
  uploader: ['UP 主', 'user'],
  collection: ['哔哩哔哩合集', 'collection'],
  artist: ['收藏的歌手', 'artist'],
  album: ['收藏的专辑', 'album'],
  history: ['最近播放', 'history'],
};
export const sourceNames = { bilibili: '哔哩哔哩', kuwo: '酷我音乐', netease:'网易云音乐', radioparadise: 'Radio Paradise', local: '内置原声' };
export const session = [
  ['mist', '薄雾序曲', 28.26],
  ['creek', '溪流之间', 23.87],
  ['dusk', '暮色回声', 31.24],
].map(([id, title, duration]) => ({
  id: 'local:' + id,
  title,
  duration,
  source: 'local',
  artist: 'BiliMusic Studio',
  album: '山间来信',
  cover: './assets/forest.jpg',
  file: './assets/' + id + '.flac',
}));

export const entryKey = (item) =>
  JSON.stringify([item.source, item.type || 'track', String(item.id)]);

export function openLibrary(storage, onSaveError = () => {}, key = 'bilimusic.library.v1') {
  const data = {};
  let saved;
  try {
    saved = JSON.parse(storage.getItem(key)) || {};
  } catch {
    saved = {};
  }
  for (const group of Object.keys(sectionInfo)) {
    data[group] = Array.isArray(saved[group])
      ? saved[group].filter(
          (x) =>
            x &&
            typeof x.title === 'string' &&
            x.id != null &&
            Object.hasOwn(sourceNames, x.source),
        )
      : [];
  }
  function store() {
    try {
      storage.setItem(key, JSON.stringify(data));
    } catch {
      onSaveError();
    }
  }
  return {
    list: (group) => data[group] || [],
    has: (group, item) => data[group].some((x) => entryKey(x) === entryKey(item)),
    toggle(group, item) {
      const index = data[group].findIndex((x) => entryKey(x) === entryKey(item));
      if (index < 0) data[group].unshift(item);
      else data[group].splice(index, 1);
      store();
      return index < 0;
    },
    refresh(item) {
      const group = data[item.type];
      const i = group.findIndex((x) => entryKey(x) === entryKey(item));
      if (i >= 0) {
        group[i] = item;
        store();
      }
    },
    played(item) {
      data.history = [item, ...data.history.filter((x) => entryKey(x) !== entryKey(item))].slice(
        0,
        100,
      );
      store();
    },
  };
}
