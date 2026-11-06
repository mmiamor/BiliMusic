import { icon } from './icons.mjs';
import { openLibrary, entryKey, sectionInfo, session, sourceNames } from './library.mjs';
import { createProviders, parseEntity } from './providers.mjs';
import { AudioEngine, DSP_PRESETS, EQ_BANDS, activeLyricIndex } from './audio.mjs';
import { installWebBridge } from './pwa-bridge.mjs';
import { CommentFeed } from './comment-feed.mjs';
import { installViewport } from './viewport.mjs';

installWebBridge();
installViewport();

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const fmt = (n) =>
  Number.isFinite(+n) && +n > 0
    ? Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0')
    : '0:00';
const engine = new AudioEngine();
const api =
  window.biliNative?.catalog ||
  createProviders(
    (url, options = {}) => {
      if (!window.biliNative) throw Error('请在 BiliMusic 应用内连接音源');
      return window.biliNative.request({ url, headers: options.headers || {} });
    },
    { canPlayType: (type) => engine.media.canPlayType(type) },
  );
const library = openLibrary(localStorage, () =>
  notify('本机储存空间不足，本次更改仅在当前会话有效'),
);
const state = {
  page: 'home',
  current: session[0],
  queue: [...session],
  deck: 'queue',
  playerDsp: false,
  sheet: null,
  searchSource: 'bilibili',
  searchType: 'track',
  query: '',
  searchRows: [],
  searchPage: 0,
  searchMore: false,
  searchState: '',
  entity: null,
  entityRows: [],
  entityPage: 0,
  entityMore: false,
  entityState: '',
  entityTab: 'tracks',
  lyrics: [],
  lyricStatus: '',
  lyricMode: localStorage.getItem('bilimusic.lyricMode') || 'pronunciation',
  playback: 'ready',
  message: '',
  loop: false,
  selected: null,
  related: [],
  relatedStatus: '',
};
let returnToPlayer = false;
let commentParent = null,
  commentRefreshTimer;
const comments = new CommentFeed((track, options) => api.comments(track, options), drawComments);
const commentDate = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const browsingTimers = new WeakMap();
let playToken = 0,
  searchToken = 0,
  browseToken = 0,
  infoToken = 0,
  timer;
let rows = [],
  entityCards = [],
  detailEntities = [],
  previousPage = 'home',
  searchError = '',
  browseError = '';
let entityParents = [],
  accountName = '',
  accountBusy = false,
  accountChecked = false;
const labels = {
  home: '发现音乐',
  search: '音源搜索',
  library: '我的资料库',
  entity: '详情',
  ...Object.fromEntries(Object.entries(sectionInfo).map(([k, [label]]) => [k, label])),
};
const shortType = {
  track: '歌曲',
  uploader: 'UP 主',
  collection: '合集',
  artist: '歌手',
  album: '专辑',
};
const action = (name, value = '') => `data-action="${esc(name)}" data-value="${esc(value)}"`;
function iconButton(name, title, act, value = '', extra = '') {
  return `<button type="button" class="icon ${extra}" title="${esc(title)}" aria-label="${esc(title)}" ${action(act, value)}>${icon(name)}</button>`;
}
function notify(message) {
  $('#notice').textContent = message;
  $('#notice').classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => $('#notice').classList.remove('show'), 3600);
}
function coverUrl(item) {
  const src = item?.cover || '';
  return /^https:\/\//i.test(src) || src === './assets/forest.jpg' ? esc(src) : '';
}
function cover(item, extra = '') {
  const src = coverUrl(item);
  return `<span class="art ${extra}">${icon('music', 22)}${src ? `<img src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
}
function nav(label, glyph, page, count) {
  return `<button type="button" class="nav-link ${state.page === page ? 'active' : ''}" ${action('nav', page)}>${icon(glyph)}<span>${label}</span>${count ? '<small>' + count + '</small>' : ''}</button>`;
}
function sidebar() {
  const preset = DSP_PRESETS.find((p) => p.id === engine.dsp.preset)?.name || '自定义';
  $('#sidebar').innerHTML =
    `<button class="brand" ${action('nav', 'home')}><span class="brand-icon"><img src="./icons/v021-180.png" alt=""></span>BiliMusic</button>
    <div class="nav-scroll"><h2 class="nav-caption">音乐馆</h2>
    ${nav('发现音乐', 'discover', 'home')}${nav('音源搜索', 'search', 'search')}
    <h2 class="nav-caption second">我的资料库</h2>
    ${Object.entries(sectionInfo)
      .map(([key, [label, glyph]]) => nav(label, glyph, key, library.list(key).length))
      .join('')}</div>
    <button class="sidebar-dsp" ${action('dsp')}><span class="dsp-pin">${icon('sliders', 19)}</span><span><strong>DSP 调音台</strong><small>${engine.dsp.enabled ? esc(preset) : '已旁通'}</small></span>${icon('chevron', 15)}</button>`;
  $('#mobile-nav').innerHTML = [
    ['home', 'discover', '发现'],
    ['search', 'search', '搜索'],
    ['library', 'library', '资料库'],
    ['dsp', 'sliders', '调音台'],
  ]
    .map(
      ([page, glyph, label]) =>
        `<button class="${state.page === page || (page === 'library' && Object.hasOwn(sectionInfo, state.page)) ? 'active' : ''}" ${action(page === 'dsp' ? 'dsp' : 'nav', page)}>${icon(glyph, 19)}${label}</button>`,
    )
    .join('');
}
function viewTitle(title, sub, control = '') {
  return `<div class="view-title"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${control}</div>`;
}
function sourceCard(source, title, description) {
  return `<button class="source-card ${source}" ${action('source', source)}><span class="source-mark">${icon(source === 'bilibili' ? 'bili' : source, 29)}</span><span><strong>${title}</strong><small>${description}</small></span><span class="source-arrow">${icon('upRight', 16)}</span></button>`;
}
function trackList(items) {
  rows = items;
  return `<div class="track-list">${items
    .map((t, i) => {
      const playing =
        state.current && entryKey(state.current) === entryKey(t) && state.playback === 'playing';
      return `<div class="track-row ${playing ? 'playing' : ''}"><button class="song-main" ${action('track', i)} aria-label="播放 ${esc(t.title)}"><span class="track-index">${playing ? icon('wave', 15) : String(i + 1).padStart(2, '0')}</span>${cover(t, 'thumb')}<span class="track-text"><strong>${esc(t.title)}</strong><small>${esc(t.artist || sourceNames[t.source])}</small></span></button>
      <span class="track-time">${t.duration ? fmt(t.duration) : '—'}</span>${iconButton('dots', '曲目详情：' + t.title, 'info', i)}</div>`;
    })
    .join('')}</div>`;
}
function home() {
  return `<h1 class="home-heading">发现音乐</h1><article class="hero">
    <div class="hero-content"><div class="hero-label"><span></span> 原创试听 EP</div>
    <h2>山间来信</h2><p class="en-title" lang="en">Letters from the Forest</p>
    <p class="hero-credit">BiliMusic Studio <i></i> 3 首器乐曲</p>
    <button class="primary light" ${action('session-play')}>${icon('play', 14)} 播放 EP</button></div>
    <img class="hero-album" src="./assets/forest.jpg" alt="山间来信专辑封面">
    </article>
    <div class="section-head"><h2>探索音源</h2></div><div class="sources">${sourceCard('bilibili', '哔哩哔哩', '投稿与合集')}${sourceCard('kuwo', '酷我音乐', '无损音乐与歌词')}${sourceCard('netease', '网易云音乐', '歌曲与评论')}</div>
    <div class="section-head"><h2>试听曲目</h2><span>山间来信 · 3 首</span></div>${trackList(session)}`;
}
function empty(title, subtitle, button = '') {
  return `<div class="empty"><span class="empty-icon">${icon('album', 30)}</span><h3>${esc(title)}</h3><p>${esc(subtitle)}</p>${button}</div>`;
}
function entityList(items) {
  entityCards = items;
  return (
    '<div class="entity-list">' +
    items
      .map(
        (e, i) =>
          `<button class="entity-card" ${action('entity', i)}>${cover(e, 'entity-art ' + (['uploader', 'artist'].includes(e.type) ? 'round' : ''))}<span><strong>${esc(e.title)}</strong><small>${sourceNames[e.source]} · ${shortType[e.type]}</small></span>${icon('chevron', 16)}</button>`,
      )
      .join('') +
    '</div>'
  );
}
function libraryPage(page) {
  if (page === 'library')
    return (
      viewTitle('我的资料库', '收藏保存在这台设备') +
      Object.entries(sectionInfo)
        .map(([key, [label, glyph]]) => nav(label, glyph, key, library.list(key).length))
        .join('')
    );
  const items = library.list(page);
  const cta = `<button class="primary" ${action('library-search', page)}>${icon('search', 15)} 搜索${shortType[page] || '音乐'}</button>`;
  return (
    viewTitle(
      labels[page],
      items.length + (page === 'tracks' || page === 'history' ? ' 首曲目' : ' 项收藏'),
      items.length ? cta : '',
    ) +
    (items.length
      ? ['tracks', 'history'].includes(page)
        ? trackList(items)
        : entityList(items)
      : empty(
          page === 'history' ? '还没有播放记录' : '这里还没有收藏',
          page === 'history'
            ? '播放一首曲目后，可以在这里找到它。'
            : page === 'tracks'
              ? '在播放器或曲目详情中点击爱心收藏。'
              : page === 'collection'
                ? '粘贴合集链接，或从曲目详情打开所属合集。'
                : '在搜索结果中打开详情，点击收藏即可。',
          cta,
        ))
  );
}
function chips(choices, active, act) {
  return choices
    .map(
      ([key, label]) =>
        `<button class="chip ${active === key ? 'selected' : ''}" aria-pressed="${active === key}" ${action(act, key)}>${label}</button>`,
    )
    .join('');
}
const searchKinds = {
  bilibili: [
    ['track', '曲目'],
    ['uploader', 'UP 主'],
    ['collection', '合集链接'],
  ],
  kuwo: [
    ['track', '歌曲'],
    ['artist', '歌手'],
    ['album', '专辑'],
  ],
  netease: [
    ['track', '歌曲'],
    ['artist', '歌手'],
    ['album', '专辑'],
  ],
};
function searchPage() {
  const entityMode = state.searchType !== 'track';
  const help =
    state.searchType === 'collection'
      ? '粘贴哔哩哔哩合集的完整链接'
      : state.searchSource === 'bilibili'
        ? '输入关键词、BV 号或哔哩哔哩链接'
        : '输入歌曲、歌手、专辑名或' + sourceNames[state.searchSource] + '链接';
  let body = '';
  if (state.searchRows.length)
    body = entityMode ? entityList(state.searchRows) : trackList(state.searchRows);
  if (state.searchState === 'loading') body += '<p class="status" role="status">正在搜索…</p>';
  else if (state.searchState === 'error')
    body += empty(
      '搜索未完成',
      searchError,
      `<button class="secondary" ${action('retry-search')}>重试</button>`,
    );
  else if (!body) {
    const kuwo = state.searchSource === 'kuwo';
    const example =
      !entityMode && state.searchSource !== 'netease'
        ? `<button class="secondary" ${action('example', kuwo ? 'kuwo' : 'bilibili')}>${icon(kuwo ? 'music' : 'user', 15)} ${kuwo ? '打开《欢乐颂》' : '浏览索尼音乐中国的投稿'}</button>`
        : '';
    body =
      state.searchState === 'done'
        ? empty('没有找到结果', '试试其他关键词，或粘贴完整的来源链接。')
        : empty('搜索' + sourceNames[state.searchSource], help, example);
  }
  if (state.searchMore && state.searchState === 'done')
    body += `<button class="more" ${action('more-search')}>加载更多</button>`;
  const account =
    state.searchSource === 'bilibili' && window.biliNative?.loginBilibili
      ? `<button class="account-button" ${action('account')} ${accountBusy ? 'disabled' : ''}>${icon('user', 14)} ${accountBusy ? '正在处理…' : accountName ? esc(accountName) + ' · 退出' : '登录哔哩哔哩'}</button>`
      : '';
  return (
    viewTitle('音源搜索', '') +
    `<div class="source-switch">${chips(
      [
        ['bilibili', '哔哩哔哩'],
        ['kuwo', '酷我音乐'],
        ['netease', '网易云音乐'],
      ],
      state.searchSource,
      'source',
    )}${account}</div><div class="filters">${chips(searchKinds[state.searchSource], state.searchType, 'search-kind')}</div>` +
    body
  );
}
async function checkAccount() {
  accountChecked = true;
  try {
    if (window.biliNative.getAccount) {
      const data = await window.biliNative.getAccount();
      accountName = data.loggedIn ? data.name || '已登录' : '';
    } else {
      const response = await window.biliNative.request({
        url: 'https://api.bilibili.com/x/web-interface/nav',
        headers: { Referer: 'https://www.bilibili.com/' },
      });
      const data = JSON.parse(response.body).data;
      accountName = data?.isLogin ? data.uname || '已登录' : '';
    }
  } catch {
    accountChecked = false;
  }
  if (state.page === 'search') renderView();
}
async function changeAccount() {
  if (accountBusy || !window.biliNative?.loginBilibili) return;
  const logout = Boolean(accountName);
  accountBusy = true;
  renderView();
  try {
    if (logout) await window.biliNative.logoutBilibili();
    else await window.biliNative.loginBilibili();
    api.resetBilibiliSession?.();
    await checkAccount();
    if (!accountChecked) notify('暂时无法读取登录状态，请稍后重试');
    else if (logout || accountName) {
      notify(accountName ? '已登录 ' + accountName : '已退出哔哩哔哩');
      if (state.current.source === 'bilibili' && engine.stream) {
        const resume = { position: currentTime(), paused: engine.media.paused };
        await playTrack(state.current, state.queue, resume);
      }
    }
  } catch (e) {
    notify(e.message || '登录窗口暂时无法打开');
  } finally {
    accountBusy = false;
    if (state.page === 'search') renderView();
  }
}
function entityPage() {
  const e = state.entity;
  if (!e) return '';
  const saved = library.has(e.type, e);
  const collections = state.entityTab === 'collections';
  const noun = collections ? '合集' : '曲目';
  let body = collections ? entityList(state.entityRows) : trackList(state.entityRows);
  if (state.entityState === 'loading')
    body += '<p class="status" role="status">正在读取' + noun + '…</p>';
  else if (state.entityState === 'error')
    body += empty(
      noun + '读取失败',
      browseError,
      `<button class="secondary" ${action('browse-retry')}>重试</button>`,
    );
  else if (!state.entityRows.length)
    body += empty('暂时没有可用' + noun, '可以稍后重新打开此详情。');
  if (state.entityMore && state.entityState === 'done')
    body += `<button class="more" ${action('browse-more')}>加载更多</button>`;
  const tabs =
    e.type === 'uploader'
      ? `<div class="filters entity-tabs">${chips(
          [
            ['tracks', '投稿'],
            ['collections', '合集'],
          ],
          state.entityTab,
          'entity-tab',
        )}</div>`
      : '<div class="section-head"><h2>曲目</h2></div>';
  return (
    `<button class="back-link" ${action('entity-back')}>${icon('back', 16)} 返回</button><div class="entity-intro">${cover(e, 'entity-hero')}<div><small>${sourceNames[e.source]} · ${shortType[e.type]}</small><h1>${esc(e.title)}</h1><button class="secondary ${saved ? 'saved' : ''}" ${action('save-entity')}>${icon(saved ? 'check' : 'plus', 15)} ${saved ? '已收藏' : '收藏' + shortType[e.type]}</button></div></div>` +
    tabs +
    body
  );
}
function renderView() {
  sidebar();
  $('#crumb').innerHTML =
    `<span>${['home', 'search'].includes(state.page) ? '音乐馆' : '资料库'}</span>${icon('chevron', 12)}<strong>${esc(labels[state.page])}</strong>`;
  rows = [];
  entityCards = [];
  $('#content').innerHTML =
    state.page === 'home'
      ? home()
      : state.page === 'search'
        ? searchPage()
        : state.page === 'entity'
          ? entityPage()
          : libraryPage(state.page);
}
function navigate(page) {
  if (!Object.hasOwn(labels, page)) return;
  if (state.sheet) closeSheet();
  state.page = page;
  renderView();
  if (
    page === 'search' &&
    state.searchSource === 'bilibili' &&
    !accountChecked &&
    window.biliNative?.loginBilibili
  )
    void checkAccount();
  $('#content').scrollTop = 0;
}
function resetSearch() {
  searchToken++;
  state.searchRows = [];
  state.searchState = '';
  state.searchPage = 0;
  state.searchMore = false;
}
function goSource(source, kind = 'track') {
  if (
    source !== state.searchSource &&
    /^(?:https?:\/\/|BV[0-9a-z]{10}$|au\d+$)/i.test($('#global-search').value.trim())
  ) {
    $('#global-search').value = '';
    state.query = '';
  }
  state.searchSource = source;
  state.searchType = kind;
  resetSearch();
  navigate('search');
  if (state.query.trim() && kind !== 'collection') runSearch();
  else $('#global-search').focus();
}
function union(items, more) {
  const seen = new Set(items.map(entryKey));
  return [
    ...items,
    ...more.filter((item) => {
      const key = entryKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}
async function runSearch(page = 1) {
  const query = $('#global-search').value.trim();
  state.query = query;
  if (!query) {
    resetSearch();
    navigate('search');
    $('#global-search').focus();
    return;
  }
  const id = ++searchToken;
  if (page === 1) {
    state.searchRows = [];
    state.searchPage = 0;
    state.searchMore = false;
  }
  state.page = 'search';
  state.searchState = 'loading';
  renderView();
  try {
    const linked = parseEntity(query);
    if (linked) {
      state.searchSource = linked.source;
      state.searchType = linked.type;
      state.searchRows = [linked];
      state.searchState = 'done';
      renderView();
      await openEntity(linked);
      return;
    }
    if (/^https?:\/\/(?:y\.)?music\.163\.com\//i.test(query)) {
      state.searchSource = 'netease';
      state.searchType = 'track';
    } else if (/^https?:\/\/(?:www\.)?kuwo\.cn\/play_detail\//i.test(query)) {
      state.searchSource = 'kuwo';
      state.searchType = 'track';
    } else if (
      /^(?:BV[0-9a-z]{10}$|au\d+$|https?:\/\/(?:www\.|m\.)?bilibili\.com\/(?:video|audio)\/)/i.test(
        query,
      )
    ) {
      state.searchSource = 'bilibili';
      state.searchType = 'track';
    }
    if (state.searchType === 'collection') throw Error('请输入包含合集编号的哔哩哔哩合集链接。');
    const found =
      state.searchType === 'track'
        ? await api.search(state.searchSource, query, page)
        : await api.searchEntities(state.searchSource, state.searchType, query, page);
    if (id !== searchToken) return;
    const merged = union(state.searchRows, found);
    state.searchMore = found.length > 0 && merged.length > state.searchRows.length;
    state.searchRows = merged;
    state.searchPage = page;
    state.searchState = 'done';
  } catch (e) {
    if (id !== searchToken) return;
    state.searchState = 'error';
    searchError = e.message || String(e);
  }
  if (state.page === 'search') renderView();
}
async function openEntity(entity) {
  if (!entity) return;
  if (state.sheet) closeSheet();
  if (state.page === 'entity') entityParents.push({ entity: state.entity, tab: state.entityTab });
  else {
    previousPage = state.page;
    entityParents = [];
  }
  state.entity = entity;
  state.entityTab = 'tracks';
  state.entityRows = [];
  state.entityPage = 0;
  state.entityMore = false;
  state.page = 'entity';
  $('#content').scrollTop = 0;
  await browse(1);
}
function entityTab(tab) {
  state.entityTab = tab;
  state.entityRows = [];
  state.entityPage = 0;
  state.entityMore = false;
  void browse(1);
}
async function browse(page) {
  const id = ++browseToken;
  const entity = state.entity;
  state.entityState = 'loading';
  renderView();
  try {
    const found =
      state.entityTab === 'collections'
        ? await api.collections(entity, page)
        : await api.browse(entity, page);
    if (id !== browseToken) return;
    const enriched = found
      .flatMap((track) => track.entities || [])
      .find((e) => entryKey(e) === entryKey(entity));
    if (enriched) {
      state.entity = {
        ...entity,
        ...enriched,
        title: enriched.title || entity.title,
        cover: enriched.cover || entity.cover,
      };
      library.refresh(state.entity);
    }
    const merged = union(state.entityRows, found);
    state.entityMore = found.length > 0 && merged.length > state.entityRows.length;
    state.entityRows = merged;
    state.entityPage = page;
    state.entityState = 'done';
  } catch (e) {
    if (id !== browseToken) return;
    state.entityState = 'error';
    browseError = e.message || String(e);
  }
  if (state.page === 'entity') renderView();
}

function currentTime() {
  if (state.playback === 'loading' && !engine.stream) return 0;
  return Number.isFinite(engine.media.currentTime) ? engine.media.currentTime : 0;
}
function duration() {
  return engine.stream && Number.isFinite(engine.media.duration)
    ? engine.media.duration
    : state.current?.duration || 0;
}
function quality() {
  if (engine.stream) return engine.stream.quality || engine.stream.codec || '正在播放';
  return state.current?.source === 'local' ? 'FLAC · 44.1 kHz' : '音质待解析';
}
function queueList() {
  return `<ol class="queue-list">${state.queue
    .map((t, i) => {
      const selected = entryKey(t) === entryKey(state.current);
      return `<li><button class="${selected ? 'current' : ''}" ${action('queue-track', i)}><span class="queue-num">${selected ? icon('wave', 16) : String(i + 1).padStart(2, '0')}</span><span>${esc(t.title)}</span><small>${fmt(t.duration)}</small></button></li>`;
    })
    .join('')}</ol>`;
}
function availableModes() {
  return [
    'original',
    ...['pronunciation', 'translation'].filter((key) => state.lyrics.some((line) => line[key])),
  ];
}
function selectedMode(modes) {
  return modes.includes(state.lyricMode) ? state.lyricMode : modes[1] || 'original';
}
function lyricsView(mode = selectedMode(availableModes())) {
  if (!state.lyrics.length)
    return `<div class="no-lyric">${icon('lyrics', 24)}<p>${esc(state.lyricStatus || (state.current.source === 'local' ? '这是一首器乐曲' : '播放后加载歌词'))}</p></div>`;
  const current = activeLyricIndex(state.lyrics, currentTime());
  return `<div class="lyric-lines" aria-label="同步歌词">${state.lyrics
    .map((line, i) => {
      const reading = mode !== 'original' ? line[mode] : '';
      const style = i === current ? ' active' : Math.abs(i - current) === 1 ? ' near' : '';
      return `<button class="lyric-line${style}" ${i === current ? 'aria-current="true"' : ''} ${action('lyric-seek', i)}><span class="lyric-original">${esc(line.text)}</span>${reading ? `<span class="lyric-reading">${esc(reading)}</span>` : ''}</button>`;
    })
    .join('')}</div>`;
}
function immersivePlayer() {
  const track = state.current;
  const modes = availableModes(),
    mode = selectedMode(modes);
  const labels = { original: '仅原文', pronunciation: '原文与注音', translation: '原文与译文' };
  const saved = library.has('tracks', track);
  return `<section class="immersive-player">
    <button class="immersive-handle" ${action('close')} aria-label="收起歌词页" title="收起歌词页"></button>
    <header class="immersive-header">${cover(track, 'immersive-cover')}
      <div class="immersive-heading"><h2 id="sheet-title">${esc(track.title)}</h2><small>${esc(track.artist || sourceNames[track.source])}</small></div>
      <button class="icon" ${action('save-current')} aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏歌曲'}" title="${saved ? '取消收藏' : '收藏歌曲'}">${icon('star')}</button>
      ${iconButton('dots', '曲目详情', 'current-info')}</header>
    ${playbackFeedback()}
    <div class="immersive-body">${lyricsView(mode)}</div>
    <footer class="immersive-footer">
      <div class="lyric-assists"><button ${action('lyric-options')} aria-expanded="false" aria-haspopup="menu" aria-controls="lyric-options" aria-label="歌词显示选项" title="歌词显示选项" ${modes.length === 1 ? 'disabled' : ''}>${icon('languages', 23)}</button>
        <div id="lyric-options" class="lyric-options" role="menu" aria-label="歌词显示选项" hidden>${modes.map((key) => `<button role="menuitemradio" aria-checked="${key === mode}" ${action('lyric-mode', key)}>${labels[key]}${key === mode ? icon('check', 15) : ''}</button>`).join('')}</div></div>
      <div class="lyric-timeline"><input type="range" data-seek min="0" max="${duration()}" step=".1" value="${currentTime()}" aria-label="播放进度">
        <div class="lyric-times"><span data-clock>${fmt(currentTime())}</span><span>${icon('wave', 13)} ${esc(quality())}</span><span data-remaining>−${fmt(duration() - currentTime())}</span></div></div>
      <div class="lyric-transport">${playerControls()}</div>
      <div class="lyric-volume">${icon('quiet', 15)}<input type="range" data-volume min="0" max="1" step=".01" value="${engine.volume}" aria-label="音量">${icon('volume', 16)}</div>
      <div class="lyric-tools"><button ${action('deck-tab', 'queue')} aria-label="返回封面播放器" title="返回封面播放器" aria-pressed="true">${icon('lyrics', 22)}</button>
        ${iconButton('headphones', '打开 DSP 调音台', 'dsp')}${track.source === 'netease' ? iconButton('comments', '网易云评论', 'comments') : ''}${iconButton('queue', '查看播放队列', 'queue-view')}</div>
    </footer></section>`;
}
function panel(full = false) {
  if (full) return fullPlayer();
  const t = state.current;
  const saved = library.has('tracks', t);
  return `<div class="deck-head"><h2 id="${full ? 'sheet-title' : 'deck-title'}">${icon('headphones', 17)}播放详情</h2>
    ${full ? iconButton('close', '关闭播放详情', 'close') : iconButton('expand', '展开展示播放器', 'player')}</div>
    <div class="deck-art ${t.source === 'local' ? 'local-art' : ''}">${cover(t)}${t.source === 'local' ? '<span class="art-type">FIELD SESSIONS</span><span class="art-name">Letters<br><em>from the Forest</em></span>' : ''}</div>
    <div class="now-title"><div><h3>${esc(t.title)}</h3><button class="artist-link" ${action('current-info')}>${esc(t.artist || sourceNames[t.source])}${icon('chevron', 12)}</button></div>${iconButton('heart', saved ? '取消收藏这首歌' : '收藏这首歌', 'save-current', '', saved ? 'liked' : '')}</div>
    <div class="track-meta"><span class="format">${icon('wave', 12)} ${esc(quality())}</span><span>${sourceNames[t.source]}</span>${t.source === 'netease' ? `<button class="comments-link" ${action('comments')}>${icon('comments', 14)} 评论</button>` : ''}</div>
    ${playbackFeedback()}
    ${full ? `<div class="full-time">${seekBar()}</div><div class="full-controls">${playerControls()}</div>` : ''}
    <div class="deck-tabs"><button class="${state.deck === 'queue' ? 'active' : ''}" ${action('deck-tab', 'queue')}>播放队列 <small>${state.queue.length}</small></button><button class="${state.deck === 'lyrics' ? 'active' : ''}" ${action('deck-tab', 'lyrics')}>歌词</button></div>
    ${state.deck === 'queue' ? queueList() : lyricsView()}`;
}
function renderDeck() {
  $('#deck').innerHTML = panel();
  if (state.sheet === 'player') {
    $('#sheet').classList.remove('immersive-sheet');
    $('#sheet-body').innerHTML = panel(true);
  }
  refreshTime();
}
function fullPlayer() {
  const t = state.current, saved = library.has('tracks', t);
  const pane = state.playerDsp ? 'dsp' : state.deck;
  const modes = availableModes(), mode = selectedMode(modes);
  const modeLabels = { original: '原文', pronunciation: '注音', translation: '译文' };
  const modeButtons = pane === 'lyrics' && modes.length > 1
    ? `<div class="player-lyric-modes">${modes.map(key => `<button class="chip ${key === mode ? 'selected' : ''}" aria-pressed="${key === mode}" ${action('lyric-mode', key)}>${modeLabels[key]}</button>`).join('')}</div>` : '';
  return `${sheetHead('正在播放')}<div class="player-layout">
    <section class="player-main" aria-label="当前歌曲与播放控制">
      <div class="deck-art">${cover(t)}</div>
      <div class="now-title"><div><h3>${esc(t.title)}</h3><button class="artist-link" ${action('current-info')}>${esc(t.artist || sourceNames[t.source])}${icon('chevron', 12)}</button></div>${iconButton('heart', saved ? '取消收藏这首歌' : '收藏这首歌', 'save-current', '', saved ? 'liked' : '')}</div>
      <div class="track-meta"><span class="format">${icon('wave', 12)} ${esc(quality())}</span><span>${sourceNames[t.source]}</span>${t.source === 'netease' ? `<button class="comments-link" ${action('comments')}>${icon('comments', 14)} 评论</button>` : ''}</div>
      ${playbackFeedback()}<div class="full-time">${seekBar()}</div>
      <div class="full-controls">${iconButton('loop', state.loop ? '关闭队列循环' : '开启队列循环', 'loop', '', state.loop ? 'on' : '')}${playerControls()}</div>
      <div class="player-volume">${iconButton(engine.volume > 0 ? 'volume' : 'muted', engine.volume > 0 ? '静音' : '取消静音', 'mute')}<input type="range" data-volume min="0" max="1" step=".01" value="${engine.volume}" aria-label="音量"></div>
    </section>
    <section class="player-detail" aria-label="歌词、队列与调音台">
      <div class="player-tabs">${[['lyrics','歌词'],['queue','播放队列'],['dsp','DSP']].map(([key,label]) => `<button aria-pressed="${pane === key}" class="${pane === key ? 'active' : ''}" ${action('player-pane',key)}>${label}${key === 'queue' ? `<small>${state.queue.length}</small>` : ''}</button>`).join('')}</div>
      ${modeButtons}<div class="player-detail-body ${pane === 'lyrics' ? 'player-lyrics' : ''}">${pane === 'dsp' ? dspView(false) : pane === 'queue' ? queueList() : lyricsView(mode)}</div>
    </section></div>`;
}
function playerControls() {
  const active = state.playback === 'playing';
  const loading = state.playback === 'loading';
  return (
    iconButton('prev', '上一首', 'previous') +
    iconButton(
      loading ? 'loading' : active ? 'pause' : 'play',
      loading ? '正在载入，点按激活播放' : active ? '暂停' : '播放',
      'toggle',
      '',
      'play-key' + (loading ? ' is-loading' : ''),
    ) +
    iconButton('next', '下一首', 'next')
  );
}
function playbackFeedback() {
  if (!state.message) return '';
  let controls = '';
  if (state.playback === 'loading') controls = `<button ${action('cancel-loading')}>取消</button>`;
  if (state.playback === 'error') {
    controls = `<button ${action('toggle')}>重试</button>`;
    if (state.current.source !== 'local')
      controls += ['bilibili', 'kuwo', 'netease']
        .filter((k) => k !== state.current.source)
        .map((k) => `<button ${action('find-alternative', k)}>在${sourceNames[k]}搜索</button>`)
        .join('');
  }
  return `<div class="play-feedback"><span class="play-message" role="status">${esc(state.message)}</span>${controls}</div>`;
}
function seekBar() {
  return `<div class="seekbar"><span data-clock>${fmt(currentTime())}</span><input type="range" data-seek min="0" max="${duration() || 0}" step="0.1" value="${currentTime()}" aria-label="播放进度"><span data-length>${fmt(duration())}</span></div>`;
}
function renderTransport() {
  const t = state.current;
  $('#transport').innerHTML =
    `<button class="mini-track" ${action('player')}>${cover(t, 'mini-art')}<span><strong>${esc(t.title)}</strong><small>${esc(t.artist || sourceNames[t.source])}</small></span></button>
    <div class="transport-center"><div class="buttons">${iconButton('loop', state.loop ? '关闭队列循环' : '开启队列循环', 'loop', '', state.loop ? 'on' : '')}${playerControls()}${iconButton('queue', '查看播放队列', 'show-queue')}</div>${seekBar()}</div>
    <div class="output">${iconButton(engine.volume > 0 ? 'volume' : 'muted', engine.volume > 0 ? '静音' : '取消静音', 'mute')}<input data-volume type="range" min="0" max="1" step="0.01" value="${engine.volume}" aria-label="音量"><i></i><button class="dsp-key" ${action('dsp')}>${icon('sliders', 16)} DSP</button></div>`;
  refreshTime();
}
function refreshTime() {
  const pos = currentTime(),
    len = duration();
  document.querySelectorAll('[data-clock]').forEach((el) => (el.textContent = fmt(pos)));
  document.querySelectorAll('[data-length]').forEach((el) => (el.textContent = fmt(len)));
  document
    .querySelectorAll('[data-remaining]')
    .forEach((el) => (el.textContent = '−' + fmt(Math.max(0, len - pos))));
  document.querySelectorAll('[data-seek]').forEach((el) => {
    el.max = len || 0;
    el.disabled = !engine.stream;
    if (el !== document.activeElement || !el.matches(':active')) el.value = pos;
    el.style.setProperty('--played', (len ? Math.min(100, (pos / len) * 100) : 0) + '%');
  });
  document.querySelectorAll('[data-volume]').forEach((el) => {
    el.value = engine.volume;
    el.style.setProperty('--played', engine.volume * 100 + '%');
  });
  const lyricIndex = activeLyricIndex(state.lyrics, pos);
  document.querySelectorAll('.lyric-lines').forEach((container) => {
    const key = String(lyricIndex);
    if (!container.clientHeight || container.dataset.focusLine === key) return;
    const first = container.dataset.focusLine === undefined;
    container.dataset.focusLine = key;
    container.querySelectorAll('.active,.near').forEach((row) => {
      row.classList.remove('active', 'near');
      row.removeAttribute('aria-current');
    });
    const row = container.children[lyricIndex];
    if (row) {
      row.classList.add('active');
      row.setAttribute('aria-current', 'true');
      row.previousElementSibling?.classList.add('near');
      row.nextElementSibling?.classList.add('near');
    } else container.firstElementChild?.classList.add('near');
    if (!container.hasAttribute('data-browsing')) alignLyric(container, row, !first);
  });
}
function alignLyric(container, row, animate) {
  if (!row) {container.scrollTop=0;return;}
  const top = row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2;
  container.scrollTo({
    top: Math.max(0, top),
    behavior: 'instant',
  });
}
function browseLyrics(event) {
  const container = event.target.closest('.lyric-lines');
  if (!container) return;
  container.setAttribute('data-browsing', '');
  clearTimeout(browsingTimers.get(container));
  browsingTimers.set(
    container,
    setTimeout(() => {
      container.removeAttribute('data-browsing');
      if (container.isConnected) alignLyric(container, container.querySelector('.active'), true);
    }, 4000),
  );
}
document.addEventListener('wheel', browseLyrics, { passive: true });
document.addEventListener('touchmove', browseLyrics, { passive: true });
function paintPlayback() {
  renderTransport();
  renderDeck();
  if (state.page !== 'search' || state.searchState !== 'loading') renderView();
}
async function loadLyrics(t, id) {
  if (t.source === 'local') return;
  try {
    const lines = await api.lyrics(t);
    if (id !== playToken) return;
    state.lyrics = lines;
    state.lyricStatus = lines.length ? '' : '音源暂未提供歌词';
  } catch {
    if (id !== playToken) return;
    state.lyricStatus = '歌词暂时无法读取';
  }
  renderDeck();
}
async function playTrack(t, queue, resume) {
  if (!t) return;
  const id = ++playToken;
  engine.stop();
  engine.activate();
  state.current = t;
  if (queue?.length) state.queue = [...queue];
  if (state.sheet === 'comments' && entryKey(comments.track) !== entryKey(t)) {
    commentParent = 'player';
    void comments.open(t);
  }
  state.playback = 'loading';
  state.message =
    t.source === 'local' ? '正在载入音频…' : '正在获取' + sourceNames[t.source] + '音轨…';
  state.lyrics = [];
  state.lyricStatus = t.source === 'local' ? '这是一首器乐曲' : '正在查找歌词…';
  paintPlayback();
  void loadLyrics(t, id);
  try {
    const streams =
      t.source === 'local'
        ? [
            {
              url: t.file,
              quality: 'FLAC · 44.1 kHz',
              codec: 'FLAC',
              mimeType: 'audio/flac',
              lossless: true,
            },
          ]
        : await api.resolve(t);
    if (id !== playToken) return;
    state.message = '正在连接音频…';
    renderDeck();
    const selected = await engine.start(streams);
    if (!selected || id !== playToken) return;
    if (resume?.position > 0) engine.seek(resume.position);
    if (resume?.paused) engine.pause();
    library.played(t);
    state.playback = engine.media.paused ? 'paused' : 'playing';
    state.message = engine.media.paused && !resume?.paused ? '音频已就绪，点播放继续。' : '';
  } catch (e) {
    if (id !== playToken) return;
    state.playback = 'error';
    state.message = e.message || '音源无法播放';
    notify(state.message);
  }
  paintPlayback();
}
function step(direction, automatic = false) {
  const q = state.queue;
  if (!q.length) return;
  const i = q.findIndex((t) => entryKey(t) === entryKey(state.current));
  if (automatic && i === q.length - 1 && !state.loop) {
    state.playback = 'ended';
    state.message = '';
    paintPlayback();
    return;
  }
  return playTrack(q[(i + direction + q.length) % q.length], q);
}
async function toggle() {
  if (state.playback === 'playing') {
    engine.pause();
    return;
  }
  if (state.playback === 'loading') {
    engine.activate();
    if (engine.media.hasAttribute('src') && !engine.media.loop) void engine.play().catch(() => {});
    return;
  }
  if (state.playback === 'paused' && engine.stream) {
    try {
      await engine.play();
    } catch (e) {
      notify(e.message);
    }
    return;
  }
  return playTrack(state.current, state.queue);
}
function saveTrack(item) {
  const added = library.toggle('tracks', item);
  notify(added ? '已加入喜欢的歌曲' : '已从喜欢的歌曲移除');
  renderView();
  renderDeck();
  if (state.sheet === 'info') drawInfo();
}
function showSheet(kind, html) {
  if (state.sheet === 'player' && ['dsp', 'info'].includes(kind))
    returnToPlayer = true;
  state.sheet = kind;
  $('#sheet').dataset.kind = kind;
  $('#sheet').classList.remove('immersive-sheet');
  $('#sheet-body').innerHTML = html;
  if (!$('#sheet').open) $('#sheet').showModal();
  $('#sheet').scrollTop = 0;
}
function closeSheet(restore = false) {
  if (state.sheet === 'comments') {
    const parent = commentParent;
    commentParent = null;
    clearInterval(commentRefreshTimer);
    comments.close();
    if (restore && parent === 'info') {
      void openInfo(state.selected);
      return;
    }
    if (restore && parent === 'player') {
      returnToPlayer = false;
      showSheet('player', panel(true));
      refreshTime();
      return;
    }
  }
  const back = restore && returnToPlayer;
  returnToPlayer = false;
  state.sheet = null;
  infoToken++;
  if (back) {
    showSheet('player', panel(true));
    refreshTime();
    return;
  }
  if ($('#sheet').open) $('#sheet').close();
  $('#sheet').classList.remove('immersive-sheet');
}
function sheetHead(title) {
  return `<div class="deck-head"><h2 id="sheet-title">${esc(title)}</h2>${iconButton('close', '关闭', 'close')}</div>`;
}
async function openInfo(t) {
  if (!t) return;
  const id = ++infoToken;
  state.selected = t;
  state.related = [];
  state.relatedStatus = t.source === 'local' ? '' : '正在读取关联资料…';
  showSheet('info', '');
  drawInfo();
  if (t.source === 'local') return;
  try {
    const entities = await api.entities(t);
    if (id !== infoToken) return;
    state.related = entities;
    state.relatedStatus = entities.length ? '' : '此曲目暂未提供关联资料';
  } catch (e) {
    if (id !== infoToken) return;
    state.relatedStatus = e.message || '关联资料暂时无法读取';
  }
  if (state.sheet === 'info') drawInfo();
}
function drawInfo() {
  const t = state.selected,
    saved = library.has('tracks', t);
  detailEntities = state.related;
  $('#sheet-body').innerHTML =
    sheetHead('曲目详情') +
    `<div class="info-song">${cover(t, 'entity-hero')}<div><small>${sourceNames[t.source]}</small><h3>${esc(t.title)}</h3><p>${esc(t.artist)}</p></div></div>
    <div class="info-actions"><button class="primary" ${action('play-selected')}>${icon('play', 14)} 播放</button><button class="secondary" ${action('save-selected')}>${icon(saved ? 'check' : 'heart', 15)} ${saved ? '已收藏' : '收藏歌曲'}</button>${t.source === 'netease' ? `<button class="secondary" ${action('comments', 'selected')}>${icon('comments', 14)} 评论</button>` : ''}</div>
    ${t.source === 'local' ? '<p class="status">山间来信 · FLAC · 16 bit / 44.1 kHz</p>' : '<h3 class="info-label">相关资料</h3>'}
    ${detailEntities.map((e, i) => `<button class="relation" ${action('related', i)}>${icon(sectionInfo[e.type]?.[1] || 'album', 18)}<span><small>${shortType[e.type]}</small><strong>${esc(e.title)}</strong></span>${icon('chevron', 15)}</button>`).join('')}${state.relatedStatus ? `<p class="status">${esc(state.relatedStatus)}</p>` : ''}`;
}
function openComments(track) {
  if (!track || track.source !== 'netease') return;
  commentParent = state.sheet;
  showSheet('comments', '');
  $('#sheet').scrollTop = 0;
  void comments.open(track, 'hot');
  clearInterval(commentRefreshTimer);
  commentRefreshTimer = setInterval(() => {
    if (
      state.sheet === 'comments' &&
      !document.hidden &&
      comments.track?.source === 'netease' &&
      !comments.busy &&
      comments.sort === 'new' &&
      comments.page === 1 &&
      $('#sheet').scrollTop < 12
    )
      void comments.load();
  }, 60000);
}
function drawComments() {
  const track = comments.track;
  if (!track || state.sheet !== 'comments') return;
  const keepPosition = $('#sheet').scrollTop;
  const supported = track.source === 'netease';
  const buttons = [
    ['hot', '热门'],
    ['new', '最新'],
  ]
    .map(
      ([value, label]) =>
        `<button class="chip ${comments.sort === value ? 'selected' : ''}" aria-pressed="${comments.sort === value}" ${action('comment-sort', value)}>${label}</button>`,
    )
    .join('');
  const list = comments.items
    .map((item) => {
      const user = item.user || '网易云用户';
      const avatar = /^https:\/\//i.test(item.avatar)
        ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(item.avatar)}" alt="">`
        : '';
      const time = Number(item.time);
      const date =
        Number.isFinite(time) && time > 0 && time < 8640000000000000
          ? commentDate.format(time)
          : '';
      const likes =
        Number.isSafeInteger(item.likes) && item.likes > 0
          ? `<span class="comment-likes">${icon('heart', 12)} ${item.likes.toLocaleString('zh-CN')}</span>`
          : '';
      return `<article class="comment"><span class="comment-avatar">${icon('user', 15)}${avatar}</span><div class="comment-main">
      <div class="comment-meta"><strong class="comment-name">${esc(user)}</strong><time>${esc(date)}</time>${likes}</div>
      <p class="comment-text">${esc(item.text)}</p></div></article>`;
    })
    .join('');
  let status = '';
  if (!supported)
    status = '当前曲目来自' + sourceNames[track.source] + '。播放网易云歌曲时可查看对应评论。';
  else if (comments.error) status = comments.error;
  else if (comments.busy) status = '正在读取评论…';
  else if (!comments.items.length)
    status = comments.sort === 'hot' ? '这首歌曲暂时没有热门评论。' : '这首歌曲暂时没有最新评论。';
  const controls =
    state.queue.length > 1 && entryKey(track) === entryKey(state.current)
      ? `<div class="comment-controls">${iconButton('prev', '上一首', 'previous')}${iconButton('next', '下一首', 'next')}</div>`
      : '';
  $('#sheet-body').innerHTML = `<div class="comment-header">${sheetHead('网易云评论')}</div>
    <div class="comment-track">${cover(track, 'mini-art')}<div><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></div>${controls}</div>
    ${supported ? `<div class="comment-tabs">${buttons}${comments.total != null ? `<small>${comments.total.toLocaleString('zh-CN')} 条评论</small>` : ''}<button class="comment-refresh" ${action('comment-refresh')} ${comments.busy ? 'disabled' : ''}>刷新</button></div>` : ''}
    <div class="comment-list">${list}</div>${status ? `<p role="status" class="comment-status">${esc(status)}</p>` : ''}
    ${comments.hasMore && !comments.busy ? `<button class="more comment-more" ${action('comment-more')}>加载更多</button>` : ''}`;
  $('#sheet').scrollTop = keepPosition;
}
function dspView(withHeading = true) {
  const d = engine.dsp;
  return (
    (withHeading ? sheetHead('DSP 调音台') : '') +
    `<div class="dsp-status"><span>${icon('sliders', 21)}<b>均衡器</b></span><label class="switch"><input type="checkbox" data-dsp="enabled" ${d.enabled ? 'checked' : ''} aria-label="启用 DSP"><i></i></label></div>
    <div class="preset"><label for="preset">预设</label><select id="preset" data-dsp="preset">${DSP_PRESETS.map((p) => `<option value="${esc(p.id)}" ${d.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}${d.preset === 'custom' ? '<option value="custom" selected>自定义</option>' : ''}</select></div>
    <div class="bands">${EQ_BANDS.map((hz, i) => `<label><output data-band-db="${i}">${d.bands[i]} dB</output><input type="range" data-band="${i}" min="-12" max="12" step="0.5" value="${d.bands[i]}" aria-label="${hz} Hz 增益"><span>${hz >= 1000 ? hz / 1000 + 'k' : hz}</span></label>`).join('')}</div>
    <div class="dsp-row"><label for="preamp">前级增益</label><input id="preamp" type="range" data-dsp="preamp" min="-24" max="12" step=".5" value="${d.preamp}"><output id="preamp-value">${d.preamp} dB</output></div>
    <div class="dsp-row"><label for="limit">输出限幅</label><label class="switch"><input id="limit" type="checkbox" data-dsp="limiter" ${d.limiter ? 'checked' : ''}><i></i></label></div>`
  );
}
function updateCustom() {
  const select = $('#preset');
  if (engine.dsp.preset === 'custom' && select) {
    if (!select.querySelector('[value="custom"]')) select.add(new Option('自定义', 'custom'));
    select.value = 'custom';
  }
}
function dispatch(act, val) {
  switch (act) {
    case 'nav':
      navigate(val);
      break;
    case 'source':
      goSource(val);
      break;
    case 'search-kind':
      state.searchType = val;
      resetSearch();
      renderView();
      if ($('#global-search').value.trim() && val !== 'collection') runSearch();
      else $('#global-search').focus();
      break;
    case 'retry-search':
      runSearch(state.searchPage + 1);
      break;
    case 'more-search':
      runSearch(state.searchPage + 1);
      break;
    case 'library-search':
      goSource(
        ['artist', 'album'].includes(val)
          ? state.searchSource === 'netease'
            ? 'netease'
            : 'kuwo'
          : 'bilibili',
        Object.hasOwn(shortType, val) ? val : 'track',
      );
      break;
    case 'session-play':
      playTrack(session[0], session);
      break;
    case 'track':
      playTrack(rows[Number(val)], rows);
      break;
    case 'info':
      openInfo(rows[Number(val)]);
      break;
    case 'related':
      openEntity(detailEntities[Number(val)]);
      break;
    case 'current-info':
      openInfo(state.current);
      break;
    case 'comments':
      openComments(val === 'selected' ? state.selected : state.current);
      break;
    case 'comment-sort':
      if (comments.track && ['new', 'hot'].includes(val) && comments.sort !== val) {
        $('#sheet').scrollTop = 0;
        void comments.open(comments.track, val);
      }
      break;
    case 'comment-refresh':
      void comments.load();
      break;
    case 'comment-more':
      void comments.load(true);
      break;
    case 'entity':
      openEntity(entityCards[Number(val)]);
      break;
    case 'entity-back': {
      const parent = entityParents.pop();
      if (parent) {
        state.entity = parent.entity;
        entityTab(parent.tab);
      } else navigate(previousPage);
      break;
    }
    case 'entity-tab':
      entityTab(val);
      break;
    case 'account':
      void changeAccount();
      break;
    case 'example':
      $('#global-search').value =
        val === 'kuwo'
          ? 'https://www.kuwo.cn/play_detail/28721197'
          : 'https://space.bilibili.com/486906719';
      runSearch();
      break;
    case 'browse-retry':
    case 'browse-more':
      browse(state.entityPage + 1);
      break;
    case 'save-entity': {
      const added = library.toggle(state.entity.type, state.entity);
      renderView();
      notify(added ? '已收藏' + shortType[state.entity.type] : '已取消收藏');
      break;
    }
    case 'play-selected': {
      const t = state.selected;
      closeSheet();
      const q = rows.some((x) => entryKey(x) === entryKey(t)) ? rows : [t];
      playTrack(t, q);
      break;
    }
    case 'save-current':
      saveTrack(state.current);
      break;
    case 'save-selected':
      saveTrack(state.selected);
      break;
    case 'queue-track':
      playTrack(state.queue[Number(val)], state.queue);
      break;
    case 'previous':
      step(-1);
      break;
    case 'next':
      step(1);
      break;
    case 'toggle':
      toggle();
      break;
    case 'cancel-loading':
      playToken++;
      engine.stop();
      state.playback = 'ready';
      state.message = '';
      paintPlayback();
      break;
    case 'find-alternative': {
      const t = state.current;
      closeSheet();
      resetSearch();
      state.searchSource = val;
      state.searchType = 'track';
      $('#global-search').value =
        t.source === 'bilibili'
          ? t.title.match(/《([^》]+)》/)?.[1] || t.title
          : [t.title, t.artist].filter(Boolean).join(' ');
      void runSearch();
      break;
    }
    case 'loop':
      state.loop = !state.loop;
      renderTransport();
      renderDeck();
      notify(state.loop ? '已开启队列循环' : '已关闭队列循环');
      break;
    case 'mute':
      engine.setVolume(engine.volume > 0 ? 0 : 0.75);
      renderTransport();
      renderDeck();
      break;
    case 'show-queue':
      state.playerDsp = false;
      state.deck = 'queue';
      renderDeck();
      showSheet('player', panel(true));
      break;
    case 'queue-view':
      state.playerDsp = false;
      state.deck = 'queue';
      renderDeck();
      $('#sheet-body .deck-tabs')?.scrollIntoView({ block: 'start' });
      break;
    case 'player':
      showSheet('player', panel(true));
      refreshTime();
      break;
    case 'deck-tab':
      state.playerDsp = false;
      state.deck = val;
      renderDeck();
      if (val === 'lyrics' && state.sheet !== 'player') showSheet('player', panel(true));
      refreshTime();
      break;
    case 'player-pane':
      state.playerDsp = val === 'dsp';
      if (!state.playerDsp) state.deck = val === 'lyrics' ? 'lyrics' : 'queue';
      renderDeck();
      break;
    case 'lyric-options': {
      const menu = $('#lyric-options');
      menu.hidden = !menu.hidden;
      $('.lyric-assists > button').setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
      break;
    }
    case 'lyric-mode':
      if (!availableModes().includes(val)) break;
      state.lyricMode = val;
      try {
        localStorage.setItem('bilimusic.lyricMode', val);
      } catch {}
      renderDeck();
      $('.lyric-assists > button')?.focus({ preventScroll: true });
      break;
    case 'lyric-seek':
      if (engine.stream && state.lyrics[Number(val)]) {
        document
          .querySelectorAll('.lyric-lines')
          .forEach((el) => el.removeAttribute('data-browsing'));
        engine.seek(state.lyrics[Number(val)].time);
        refreshTime();
      }
      break;
    case 'dsp':
      showSheet('dsp', dspView());
      break;
    case 'close':
      closeSheet(true);
      break;
  }
}
document.addEventListener('click', (event) => {
  if (
    state.sheet === 'player' &&
    state.deck === 'lyrics' &&
    !event.target.closest('.lyric-assists')
  ) {
    const menu = $('#lyric-options');
    if (menu && !menu.hidden) {
      menu.hidden = true;
      $('.lyric-assists > button').setAttribute('aria-expanded', 'false');
    }
  }
  const button = event.target.closest('[data-action]');
  if (button) dispatch(button.dataset.action, button.dataset.value);
  else if (event.target === $('#sheet')) {
    const rect = $('#sheet').getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeSheet(true);
  }
});
$('#sheet').addEventListener('cancel', (event) => {
  event.preventDefault();
  const menu = $('#lyric-options');
  if (menu && !menu.hidden) {
    menu.hidden = true;
    const trigger = $('.lyric-assists > button');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
    return;
  }
  closeSheet(true);
});
$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#global-search').blur();
  runSearch();
});
document.addEventListener('keydown', (event) => {
  if (
    event.target.matches('input,select,textarea') ||
    $('#sheet').open ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (event.key === '/') {
    event.preventDefault();
    $('#global-search').focus();
  }
  if (event.code === 'Space' && !event.target.closest('button')) {
    event.preventDefault();
    toggle();
  }
});
document.addEventListener('input', ({ target: el }) => {
  if (el.matches('[data-volume]')) {
    engine.setVolume(+el.value);
    refreshTime();
  }
  if (el.matches('[data-band]')) {
    const i = Number(el.dataset.band),
      bands = [...engine.dsp.bands];
    bands[i] = +el.value;
    engine.setDSP({ bands });
    document.querySelector(`[data-band-db="${i}"]`).textContent = el.value + ' dB';
    updateCustom();
  }
  if (el.matches('[data-dsp="preamp"]')) {
    engine.setDSP({ preamp: +el.value });
    $('#preamp-value').textContent = el.value + ' dB';
    updateCustom();
  }
});
document.addEventListener('change', ({ target: el }) => {
  if (el.matches('[data-seek]') && engine.stream) engine.seek(+el.value);
  if (el.matches('[data-dsp="enabled"],[data-dsp="limiter"]'))
    engine.setDSP({ [el.dataset.dsp]: el.checked });
  if (el.matches('[data-dsp="preset"]') && el.value !== 'custom') {
    engine.applyPreset(el.value);
    if (state.sheet === 'player') renderDeck();
    else $('#sheet-body').innerHTML = dspView();
  }
  if (el.matches('[data-dsp],[data-band]')) sidebar();
});
document.addEventListener(
  'error',
  (e) => {
    if (e.target instanceof HTMLImageElement) e.target.hidden = true;
  },
  true,
);
engine.media.addEventListener('timeupdate', refreshTime);
engine.media.addEventListener('durationchange', refreshTime);
engine.media.addEventListener('ended', () => step(1, true));
engine.media.addEventListener('pause', () => {
  if (state.playback === 'playing' && !engine.media.ended) {
    state.playback = 'paused';
    paintPlayback();
  }
});
engine.media.addEventListener('playing', () => {
  if (engine.stream) {
    state.playback = 'playing';
    state.message = '';
    paintPlayback();
  }
});
engine.addEventListener('streamchange', (e) => {
  if (!e.detail) return;
  state.playback = engine.media.paused ? 'paused' : 'playing';
  state.message = '';
  paintPlayback();
});
engine.addEventListener('playbackerror', (e) => {
  state.playback = 'error';
  state.message = e.detail.message;
  notify(state.message);
  paintPlayback();
});
$('#mobile-library').innerHTML = '<img class="mobile-app-icon" src="./icons/v021-180.png" alt="">';
$('#search-symbol').innerHTML = icon('search', 17);
renderView();
renderDeck();
renderTransport();
// Shared links lead to the matching result; the listener's tap starts audio.
const initialQuery = new URLSearchParams(window.location?.search || '').get('q')?.trim();
if (initialQuery && initialQuery.length <= 256) {
  $('#global-search').value = initialQuery;
  void runSearch();
}
