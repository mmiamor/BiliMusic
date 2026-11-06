import { entryKey } from './library.mjs';

const emptyState = () => ({
  tracks: [], page: 0, loading: false, error: '', hasMore: false,
  label: '', description: '', fetchedAt: 0,
});

// Categories keep independent, memory-only snapshots. A generation belongs to
// one category, so switching tabs never turns another category's reply into the
// current feed, and refreshing invalidates any older pagination request.
export class DiscoveryFeed {
  constructor(fetcher, onChange = () => {}, { ttl = 600000, now = Date.now } = {}) {
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.ttl = ttl;
    this.now = now;
    this.category = 'popular';
    this.cache = new Map();
  }

  record(category = this.category) {
    if (!this.cache.has(category)) {
      this.cache.set(category, { state: emptyState(), generation: 0, pending: null });
    }
    return this.cache.get(category);
  }

  get current() {
    return this.record().state;
  }

  changed(category) {
    if (category === this.category) this.onChange();
  }

  select(category) {
    if (typeof category !== 'string') throw new TypeError('推荐分类必须是字符串。');
    const switched = category !== this.category;
    this.category = category;
    if (switched) this.changed(category);
    return this.load();
  }

  invalidate() {
    // Account changes replace the PWA provider session and its pagination state.
    // Old in-flight replies must not repopulate the new session's cached feed.
    for (const record of this.cache.values()) record.generation++;
    this.cache.clear();
    this.changed(this.category);
  }

  load({ refresh = false, more = false } = {}) {
    const category = this.category;
    const record = this.record(category);
    const state = record.state;
    // Repeated refreshes of page one are the same request. A new refresh may
    // supersede pagination, but a repeated load/more never queues another page.
    if (record.pending && (!refresh || record.pending.page === 1)) return record.pending.promise;
    more = more && !refresh;
    if (more && (!state.page || !state.hasMore)) return Promise.resolve(state);
    if (!more && !refresh && state.page > 0 && this.now() - state.fetchedAt < this.ttl) {
      return Promise.resolve(state);
    }

    const page = more ? state.page + 1 : 1;
    const generation = ++record.generation;
    let complete;
    const promise = new Promise(resolve => { complete = resolve; });
    record.pending = { page, generation, promise };
    state.loading = true;
    state.error = '';
    this.changed(category);

    void (async () => {
      try {
        const data = await this.fetcher(category, page);
        if (generation !== record.generation) return;
        if (!data || !Array.isArray(data.tracks)) throw new Error('暂时未能读取有效的推荐内容。');
        const tracks = more ? [...state.tracks] : [];
        const keys = new Set(tracks.map(entryKey));
        let added = 0;
        for (const track of data.tracks) {
          const key = entryKey(track);
          if (keys.has(key)) continue;
          keys.add(key);
          tracks.push(track);
          added++;
        }
        // Commit only a fully processed page; malformed or failed refreshes
        // leave the previous songs, metadata and pagination position intact.
        state.tracks = tracks;
        state.page = page;
        state.hasMore = Boolean(data.hasMore && added > 0);
        if (typeof data.label === 'string') state.label = data.label;
        if (typeof data.description === 'string') state.description = data.description;
        // Appending page two must not extend the lifetime of an old first page.
        if (!more) state.fetchedAt = this.now();
      } catch (error) {
        if (generation === record.generation) state.error = error?.message || '暂时无法读取推荐音乐，请稍后重试。';
      } finally {
        if (generation === record.generation) {
          state.loading = false;
          record.pending = null;
          this.changed(category);
        }
        complete(state);
      }
    })();
    return promise;
  }
}
