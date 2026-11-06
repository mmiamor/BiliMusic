// One request generation per song, sort order or refresh. Late replies can never replace
// the comments for a new track, including when a listener returns to a previous track.
export class CommentFeed {
  constructor(fetchPage, onChange) {
    this.fetchPage = fetchPage;
    this.onChange = onChange;
    this.track = null;
    this.sort = 'hot';
    this.generation = 0;
  }

  open(track, sort = this.sort) {
    this.close();
    this.track = track;
    this.sort = sort;
    this.page = 0;
    this.total = null;
    this.items = [];
    this.hasMore = false;
    this.error = '';
    return this.load();
  }

  close() {
    this.generation++;
    this.track = null;
    this.busy = false;
  }

  async load(more = false) {
    if (!this.track) return;
    if (this.track.source !== 'netease') {
      this.onChange();
      return;
    }
    if (more && (this.busy || !this.hasMore)) return;
    const id = ++this.generation;
    const page = more ? this.page + 1 : 1;
    this.error = '';
    this.busy = true;
    this.onChange();
    try {
      const data = await this.fetchPage(this.track, { sort: this.sort, page });
      if (id !== this.generation) return;
      const items = more ? [...this.items] : [];
      const ids = new Set(items.map((item) => String(item.id)));
      for (const item of data.items || []) {
        const key = String(item.id);
        if (!ids.has(key)) {
          ids.add(key);
          items.push(item);
        }
      }
      this.hasMore = Boolean(data.hasMore && (!more || items.length > this.items.length));
      this.items = items;
      this.page = page;
      this.total = Number.isSafeInteger(data.total) ? data.total : null;
    } catch (error) {
      if (id === this.generation) this.error = error.message || '暂时无法读取评论。';
    } finally {
      if (id === this.generation) {
        this.busy = false;
        this.onChange();
      }
    }
  }
}
