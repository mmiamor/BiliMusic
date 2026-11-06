export const DISCOVERY_CATEGORIES = Object.freeze([
  { id: 'hires', title: 'Hi-Res 优先', description: '哔哩哔哩音乐分区 · 优先展示已核验可用的 Hi-Res 音轨' },
  { id: 'popular', title: '音乐热门', description: '近 30 天音乐投稿 · 已核验 Hi-Res 优先，其余按播放量排序' },
  { id: 'latest', title: '最新音乐', description: '最新音乐投稿 · 已核验 Hi-Res 优先，其余按发布时间排序' },
  { id: 'live', title: '音乐现场', description: '哔哩哔哩音乐现场分区 · 已核验 Hi-Res 优先' },
  { id: 'covers', title: '翻唱', description: '哔哩哔哩翻唱分区 · 已核验 Hi-Res 优先' },
  { id: 'instrumental', title: '演奏', description: '哔哩哔哩演奏分区 · 已核验 Hi-Res 优先' },
  { id: 'original', title: '原创', description: '哔哩哔哩原创音乐分区 · 已核验 Hi-Res 优先' },
].map(Object.freeze));
