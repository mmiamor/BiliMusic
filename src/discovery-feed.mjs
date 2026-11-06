import { entryKey } from './library.mjs';

const emptyState = () => ({
  tracks: [], page: 0, loading: false, error: '', hasMore: false,
  label: '', description: '', fetchedAt: 0, qualityLoading: false, qualityChecked: 0,
});

const qualityStatuses = new Set(['hires', 'lossless', 'lossy', 'unsupported', 'unknown']);
const qualityFields = ['status', 'formatStatus', 'label', 'codec', 'mimeType', 'mediaType',
  'lossless', 'playable', 'platformTier', 'checkedAt', 'expiresAt', 'reason', 'evidenceSource'];
const copyEvidence = evidence => Object.fromEntries(qualityFields
  .filter(key => Object.hasOwn(evidence, key) && (evidence[key] === null ||
    ['string', 'number', 'boolean'].includes(typeof evidence[key])))
  .map(key => [key, evidence[key]]));
const freshEvidence = (evidence, now) => Boolean(evidence && qualityStatuses.has(evidence.status) &&
  Number.isFinite(evidence.checkedAt) && Number.isFinite(evidence.expiresAt) &&
  evidence.checkedAt >= 0 && evidence.expiresAt > evidence.checkedAt && evidence.expiresAt > now);
const playableHiRes = (track, now) => freshEvidence(track.qualityEvidence, now) &&
  track.qualityEvidence.status === 'hires' && track.qualityEvidence.playable === true;

// Categories keep independent, memory-only snapshots. A generation belongs to
// one category, so switching tabs never turns another category's reply into the
// current feed, and refreshing invalidates any older pagination request.
export class DiscoveryFeed {
  constructor(fetcher, onChange = () => {}, {
    ttl = 600000, now = Date.now, qualityFetcher, defaultCategory = 'hires',
  } = {}) {
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.ttl = ttl;
    this.now = now;
    this.qualityFetcher = typeof qualityFetcher === 'function' ? qualityFetcher : null;
    this.category = defaultCategory;
    this.cache = new Map();
  }

  record(category = this.category) {
    if (!this.cache.has(category)) {
      this.cache.set(category, {
        state: emptyState(), generation: 0, pending: null,
        qualityGeneration: 0, qualityPending: new Set(), sourceOrder: new Map(),
      });
    }
    return this.cache.get(category);
  }

  get current() {
    const record = this.record();
    this.refreshQuality(record);
    return record.state;
  }

  refreshQuality(record) {
    const now = this.now();
    let checked = 0;
    record.state.tracks = record.state.tracks.map(track => {
      if (!track.qualityEvidence) return track;
      if (freshEvidence(track.qualityEvidence, now)) { checked++; return track; }
      // Never leave an expired Hi-Res badge on a cached recommendation. Reading
      // cached state expires evidence, but never triggers another network probe.
      const { qualityEvidence, ...unverified } = track;
      return unverified;
    }).sort((a, b) => Number(playableHiRes(b, now)) - Number(playableHiRes(a, now)) ||
      (record.sourceOrder.get(entryKey(a)) ?? 0) - (record.sourceOrder.get(entryKey(b)) ?? 0));
    record.state.qualityChecked = checked;
  }

  inspectQuality(category, record, newTracks) {
    if (!this.qualityFetcher) return;
    // Keep catalog loading quick and bound optional platform work to six new
    // videos per page. Pagination does not repeatedly inspect earlier songs.
    const candidates = newTracks.filter(track => track.source === 'bilibili').slice(0, 6);
    if (!candidates.length) return;
    const generation = record.qualityGeneration;
    const job = {};
    record.qualityPending.add(job);
    record.state.qualityLoading = true;
    const active = () => generation === record.qualityGeneration && this.cache.get(category) === record;
    const candidateKeys = new Map(candidates.map(track => [String(track.id), entryKey(track)]));

    // Both a synchronous throw and a rejected promise are isolated from catalog
    // results. The last catch also contains failures from an observer callback.
    void Promise.resolve().then(() => active() ? this.qualityFetcher(candidates) : []).then(results => {
      if (!active() || !Array.isArray(results)) return;
      const evidence = new Map();
      for (const result of results) {
        const key = candidateKeys.get(String(result?.id));
        if (key && freshEvidence(result.qualityEvidence, this.now())) {
          evidence.set(key, copyEvidence(result.qualityEvidence));
        }
      }
      record.state.tracks = record.state.tracks.map(track => {
        const verified = evidence.get(entryKey(track));
        return verified ? { ...track, qualityEvidence: verified } : track;
      });
    }).catch(() => {}).finally(() => {
      if (!active()) return;
      record.qualityPending.delete(job);
      record.state.qualityLoading = record.qualityPending.size > 0;
      this.refreshQuality(record);
      this.changed(category);
    }).catch(() => {});
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
    for (const record of this.cache.values()) {
      record.generation++;
      record.qualityGeneration++;
    }
    this.cache.clear();
    this.changed(this.category);
  }

  load({ refresh = false, more = false } = {}) {
    const category = this.category;
    const record = this.record(category);
    this.refreshQuality(record);
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
    if (!more) {
      record.qualityGeneration++;
      record.qualityPending.clear();
      state.qualityLoading = false;
    }
    let complete;
    const promise = new Promise(resolve => { complete = resolve; });
    record.pending = { page, generation, promise };
    state.loading = true;
    state.error = '';
    this.changed(category);

    void (async () => {
      let newTracks;
      try {
        const data = await this.fetcher(category, page);
        if (generation !== record.generation) return;
        if (!data || !Array.isArray(data.tracks)) throw new Error('暂时未能读取有效的推荐内容。');
        const tracks = more ? [...state.tracks] : [];
        const sourceOrder = more ? new Map(record.sourceOrder) : new Map();
        const addedTracks = [];
        const keys = new Set(tracks.map(entryKey));
        let added = 0;
        for (const track of data.tracks) {
          const key = entryKey(track);
          if (keys.has(key)) continue;
          keys.add(key);
          tracks.push(track);
          sourceOrder.set(key, sourceOrder.size);
          addedTracks.push(track);
          added++;
        }
        // Commit only a fully processed page; malformed or failed refreshes
        // leave the previous songs, metadata and pagination position intact.
        state.tracks = tracks;
        record.sourceOrder = sourceOrder;
        state.page = page;
        state.hasMore = Boolean(data.hasMore && added > 0);
        if (typeof data.label === 'string') state.label = data.label;
        if (typeof data.description === 'string') state.description = data.description;
        // Appending page two must not extend the lifetime of an old first page.
        if (!more) state.fetchedAt = this.now();
        this.refreshQuality(record);
        newTracks = addedTracks;
      } catch (error) {
        if (generation === record.generation) state.error = error?.message || '暂时无法读取推荐音乐，请稍后重试。';
      } finally {
        if (generation === record.generation) {
          state.loading = false;
          record.pending = null;
          if (newTracks) this.inspectQuality(category, record, newTracks);
          this.changed(category);
        }
        complete(state);
      }
    })();
    return promise;
  }
}
