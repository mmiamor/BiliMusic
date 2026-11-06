import { sanitizeFilter, EQ_LIMITS } from './dsp-math.mjs';

const KEY = 'bilimusic.dsp.presets.v1';
const clone = value => JSON.parse(JSON.stringify(value));
function snapshot(dsp) {
  return { filters: (dsp.eq?.filters || []).slice(0, EQ_LIMITS.maxFilters).map(sanitizeFilter),
    preamp: Math.max(-24, Math.min(12, Number(dsp.preamp) || 0)), autoPreamp: dsp.autoPreamp === true };
}

export function openDSPPresets(storage) {
  let items = [];
  try {
    const raw = JSON.parse(storage.getItem(KEY));
    if (Array.isArray(raw)) items = raw.filter(p => p && /^user:[a-z0-9-]+$/i.test(p.id) && typeof p.name === 'string' && Array.isArray(p.filters))
      .slice(0, 64).map(p => ({ id: p.id, name: p.name.trim().slice(0, 60), ...snapshot({...p,eq:{filters:p.filters}}) }));
  } catch { /* Broken optional presets must not prevent playback. */ }
  function persist(next) {
    storage.setItem(KEY, JSON.stringify(next));
    items = next;
  }
  return {
    list: () => clone(items),
    get: id => clone(items.find(p => p.id === id) || null),
    save(name, dsp) {
      name = String(name || '').trim();
      if (!name || name.length > 60) throw Error('请输入 1–60 字的预设名称。');
      if (items.some(p => p.name === name)) throw Error('这个名称已存在，请换一个名称另存。');
      if (items.length >= 64) throw Error('最多保存 64 个个人预设，请先移除不需要的预设。');
      const item = { id: 'user:' + crypto.randomUUID(), name, ...snapshot(dsp) };
      persist([...items, item]);
      return clone(item);
    },
    remove(id) { persist(items.filter(p => p.id !== id)); },
  };
}
