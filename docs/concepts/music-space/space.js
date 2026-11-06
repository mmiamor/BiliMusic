(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const root = $('#music-space'), page = $('#page'), frame = $('#player-frame'), sheet = $('#sheet');
  frame.srcdoc = window.biliPlayerDocument.replace('<head>',`<head><base href="${new URL('../spatial-player/',location.href).href}"><script>window.biliEmbedded=true;<\/script>`);
  const {tracks, collections, sources, samples} = window.musicCatalog;
  const allItems = [...tracks, ...samples], storageKey = 'bilimusic:music-space:v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => `${Math.floor(Math.max(0,n || 0)/60)}:${String(Math.floor(Math.max(0,n || 0)%60)).padStart(2,'0')}`;
  const paths = {
    play:'<path d="m9 5 10 7-10 7z" fill="currentColor" stroke="none"/>', pause:'<path d="M8 5v14m8-14v14" stroke-width="3"/>',
    next:'<path d="M19 5v14M6 6l10 6-10 6z" fill="currentColor"/>', previous:'<path d="M5 5v14m13-13L8 12l10 6z" fill="currentColor"/>',
    heart:'<path d="M20.4 5.4a5.1 5.1 0 0 0-7.2 0L12 6.7l-1.2-1.3a5.1 5.1 0 0 0-7.2 7.2L12 21l8.4-8.4a5.1 5.1 0 0 0 0-7.2Z"/>',
    moon:'<path d="M20.6 14a8.8 8.8 0 0 1-10.5-10.5A8.8 8.8 0 1 0 20.6 14Z"/>', sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    settings:'<path d="M5 3v7m0 4v7M12 3v3m0 4v11M19 3v10m0 4v4"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="10" y="6" width="4" height="4" rx="1"/><rect x="17" y="13" width="4" height="4" rx="1"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', back:'<path d="M20 12H4m6-6-6 6 6 6"/>',
    plus:'<path d="M12 4v16M4 12h16"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>', queue:'<path d="M3 6h18M3 12h12M3 18h7m6-4 5 3-5 3z"/>',
    wave:'<path d="M3 10v4m4-8v12m5-15v18m5-14v10m4-7v4"/>', check:'<path d="m5 12 4 4L19 6"/>', grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.wave}</svg>`;
  const defaults = () => ({version:1, likes:[], playlists:[], recent:[], queries:[], theme:'day', motion:true, hires:true});
  let preferences = defaults(), storageAvailable = true;
  const validId = id => allItems.some(t => t.id === id);
  const safeIds = ids => Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && validId(id)))].slice(0,200) : [];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && saved.version === 1) {
      preferences = {...defaults(), likes:safeIds(saved.likes), recent:safeIds(saved.recent),
        queries:Array.isArray(saved.queries) ? saved.queries.filter(q => typeof q === 'string').map(q => q.slice(0,80)).slice(0,8) : [],
        playlists:Array.isArray(saved.playlists) ? saved.playlists.filter(p => /^custom-[\w-]+$/.test(p?.id) && typeof p.name === 'string').slice(0,50).map(p => ({id:p.id, name:p.name.slice(0,40), items:safeIds(p.items)})) : [],
        theme:saved.theme === 'night' ? 'night' : 'day', motion:saved.motion !== false, hires:saved.hires !== false};
    }
  } catch { storageAvailable = false; }
  const state = {route:'discover', query:'', kind:'all', source:'all', quality:'all', tab:'playlists', category:'全部',
    results:{}, scenarios:{bili:'ready',kuwo:'ready',netease:'ready'}, generation:0, ready:false, opened:false,
    player:{index:0, playing:false, currentTime:0, duration:28.263, volume:.55, muted:false}, seeking:false, activePlaylist:null};
  let toastTimer, opener, sheetOpener, mediaIndex = -1, pendingTrack = null;
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'),3000); }
  function save() { try { localStorage.setItem(storageKey,JSON.stringify(preferences)); } catch { storageAvailable = false; toast('浏览器未允许保存，当前修改仅保留在本次会话。'); } }
  function command(command, values = {}) { frame.contentWindow?.postMessage({type:'bilimusic:command',command,...values},'*'); }
  function syncAppearance() {
    root.dataset.theme = preferences.theme;
    document.documentElement.style.colorScheme = preferences.theme === 'night' ? 'dark' : 'light';
    root.dataset.motion = preferences.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'on' : 'off';
    $('#theme-switch').innerHTML = icon(preferences.theme === 'day' ? 'moon' : 'sun');
    $('#theme-switch').setAttribute('aria-label',preferences.theme === 'day' ? '切换夜间主题' : '切换日光主题');
    document.querySelectorAll('[data-theme-choice]').forEach(b=>{const active=b.dataset.themeChoice===preferences.theme;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    document.querySelector('[data-setting="motion"]')?.setAttribute('aria-checked',String(preferences.motion));
    if (state.ready) { command('theme',{value:preferences.theme}); command('motion',{value:preferences.motion}); }
  }
  function syncLikes() {
    if(state.ready)command('liked',{indices:tracks.filter(t=>preferences.likes.includes(t.id)).map(t=>t.index)});
    document.querySelectorAll('[data-favorite]').forEach(b=>{const t=allItems.find(t=>t.id===b.dataset.favorite);if(!t)return;const liked=preferences.likes.includes(t.id);b.setAttribute('aria-pressed',String(liked));b.setAttribute('aria-label',(liked?'取消收藏':'收藏')+' '+t.title);if(b.classList.contains('primary-button'))b.innerHTML=icon('heart')+' '+(liked?'取消收藏':'收藏条目');});
    syncPlayer();
  }
  function quality(item) { if(item.kind==='person')return '<span class="quality-tag">音乐人示例</span>';if(item.kind==='collection')return '<span class="quality-tag">内容编排示例</span>';return item.index !== undefined ? '<span class="quality-tag" data-kind="local">FLAC · 内置试听</span>' : item.quality === 'title' ? '<span class="quality-tag" data-kind="title">标题标注 Hi-Res</span>' : '<span class="quality-tag" data-kind="unknown">音质待核验</span>'; }
  function row(item, position = 0, removable = false) {
    const local = item.index !== undefined, liked = preferences.likes.includes(item.id);
    return `<div class="track-row"><span class="track-index">${String(position+1).padStart(2,'0')}</span><button class="track-open" ${local ? `data-play="${item.index}"` : `data-preview="${item.id}"`} aria-label="${local?'播放':'查看示例'} ${esc(item.title)}"><img class="track-art" src="${item.art}" alt=""><span class="track-copy"><strong>${esc(item.title)}</strong><small>${esc(item.artist)}${local?'':' · 离线示例'}</small></span></button>${quality(item)}<span class="track-duration">${item.duration ? fmt(item.duration) : '—'}</span><button class="icon-button like-button" data-favorite="${item.id}" aria-label="${liked?'取消收藏':'收藏'} ${esc(item.title)}" aria-pressed="${liked}">${icon('heart')}</button><button class="icon-button" ${removable ? `data-remove="${item.id}"` : `data-add="${item.id}"`} aria-label="${removable?'从歌单移除':'加入歌单'} ${esc(item.title)}">${icon(removable?'close':'plus')}</button></div>`;
  }
  function collectionCard(c) {
    const items = c.items || c.tracks.map(i => tracks[i].id), art = c.art || (allItems.find(t => t.id === items[0])?.art || 'art/ambient.svg');
    return `<article class="collection-card"><button data-detail="${c.id}" aria-label="打开歌单 ${esc(c.title || c.name)}"><div class="collection-art"><img src="${art}" alt="" loading="lazy"><span class="art-play">${icon('arrow')}</span></div><div class="collection-info"><h3>${esc(c.title || c.name)}</h3><p>${esc(c.subtitle || `${items.length} 个条目 · 我的歌单`)}</p></div></button></article>`;
  }
  function navigate(route, params = {}) { const query = new URLSearchParams(params).toString(); const next = '#'+route+(query?'?'+query:''); if(location.hash === next) render(); else location.hash = next; }
  function routeInfo() { const [route,search] = location.hash.replace(/^#\/?/,'').split('?'); return {route:route || 'discover',params:new URLSearchParams(search || '')}; }
  function render(focus = true) {
    const active = document.activeElement;
    const focusKey = !focus && page.contains(active) ? [...active.attributes].find(a=>a.name.startsWith('data-')) : null;
    const focusId = !focus && page.contains(active) ? active.id : '';
    const {route,params} = routeInfo(); state.route = route;
    state.generation++; state.results = {};
    const current = ['collection','artist'].includes(route) ? 'library' : route;
    document.querySelectorAll('.main-nav [data-route]').forEach(b => { b.classList.toggle('active',b.dataset.route === current); if(b.dataset.route === current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); });
    page.classList.remove('page-enter');
    page.classList.toggle('is-search-results',route==='search'&&!!params.get('q'));
    if(route === 'search') { state.query = (params.get('q') || '').slice(0,80); page.innerHTML = searchPage(); if(state.query)runSearch(); }
    else if(route === 'library') page.innerHTML = libraryPage();
    else if(route === 'collection') page.innerHTML = detailPage(params.get('id'));
    else if(route === 'artist') page.innerHTML = artistPage();
    else if(route === 'settings') page.innerHTML = settingsPage();
    else { state.route = 'discover'; page.innerHTML = discoverPage(); }
    page.classList.add('page-enter'); document.title = `BiliMusic · ${{discover:'发现',search:'多源检索',library:'资料库',collection:'歌单',artist:'音乐人',settings:'设置'}[state.route] || '音乐空间'}`;
    if(focus) { page.focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'}); }
    else if(focusKey || focusId) { const target = focusId ? page.querySelector('#'+CSS.escape(focusId)) : page.querySelector(`[${focusKey.name}="${CSS.escape(focusKey.value)}"]`); (target || page).focus({preventScroll:true}); }
  }
  function discoverPage() {
    const visible = collections.slice(1).filter(c => state.category === '全部' || c.tag === state.category).slice(0,4);
    return `<div class="page-topline"><p class="eyebrow">DISCOVER / 给耳朵一点新鲜感</p><button class="text-button" data-route="search">在不同来源间探索 ${icon('arrow')}</button></div>
      <section class="discovery-hero"><div class="hero-copy"><p class="eyebrow accent">本周聆听 · 原创器乐</p><h1 class="hero-title">让世界慢一点，<br>让声音近一点。</h1><p class="hero-description">从一封山间来信开始。<br>三段旋律，留住薄雾、溪流和日暮。</p><div class="hero-actions"><button class="primary-button" data-play="0" data-open-player>${icon('play')} 开始聆听</button><button class="text-button" data-detail="forest">探索这张 EP ${icon('arrow')}</button></div><p class="hero-footnote">3 首原创试听 · FLAC / 44.1 kHz</p></div><div class="hero-art"><img src="../../../src/assets/forest.jpg" alt="薄雾中的森林与远山"><div class="hero-caption"><span>FIELD SESSIONS / VOL. 01</span><strong>Letters<br><em>from the Forest</em></strong><small>BILIMUSIC STUDIO</small></div></div></section>
      <section class="discovery-collections"><div class="section-heading"><div><p class="eyebrow">A MOOD, A PLACE</p><h2>此刻，想听什么</h2></div><div class="filter-group" aria-label="发现主题">${['全部','雨天','专注','夜晚'].map(tag=>`<button data-category="${tag}" class="${state.category===tag?'active':''}" aria-pressed="${state.category===tag}">${tag}</button>`).join('')}</div></div><div class="collection-grid">${visible.map(collectionCard).join('')}</div><p class="section-note">主题封面与编排为原型设计，歌单使用三首内置原创器乐试听。</p></section>
      <section class="discovery-lower"><div><div class="section-heading"><div><p class="eyebrow">LISTEN CLOSER</p><h2>留给细节的时间</h2></div><button class="text-button" data-route="artist">BiliMusic Studio ${icon('arrow')}</button></div><div class="track-list">${tracks.map((t,i)=>row(t,i)).join('')}</div></div><aside class="editor-note"><span class="editor-number">01—03</span><p class="eyebrow">跨越来源，不错过好声音</p><h2>一个词，<br>打开三个音乐世界。</h2><p>同时查看哔哩哔哩、酷我与网易云的检索视面。BILI 优先，音质标注一目了然。</p><button class="text-button" data-query="钢琴">试试「钢琴」 ${icon('arrow')}</button><small>当前为本地示例检索，尚未连接平台。</small></aside></section>`;
  }
  function searchPage() {
    return `<div class="search-intro"><p class="eyebrow">ONE QUERY / DIFFERENT WORLDS</p><h1>寻找声音，<br><span>不止一个入口。</span></h1><p>一个关键词，同时展开不同来源。让选择留在眼前。</p></div><form class="search-form" id="search-form" role="search">${icon('search')}<input id="search-input" name="query" type="search" maxlength="80" value="${esc(state.query)}" placeholder="歌曲、音乐人、专辑或合集" aria-label="音乐检索关键词" autocomplete="off"><button type="submit" class="primary-button">检索 ${icon('arrow')}</button></form>
      <div class="search-suggestions"><span>${preferences.queries.length?'最近检索':'试着寻找'}</span>${(preferences.queries.length?preferences.queries.slice(0,5):['钢琴','山间','人声','爵士','雨']).map(q=>`<button data-query="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="search-tools"><div class="filter-group" aria-label="结果类型">${[['all','全部'],['track','曲目'],['collection','专辑 / 合集'],['person','音乐人 / UP 主']].map(([v,t])=>`<button data-kind="${v}" class="${state.kind===v?'active':''}" aria-pressed="${state.kind===v}">${t}</button>`).join('')}</div><div class="filter-group quality-filter"><button data-quality="all" class="${state.quality==='all'?'active':''}" aria-pressed="${state.quality==='all'}">全部音质</button><button data-quality="title" class="${state.quality==='title'?'active':''}" aria-pressed="${state.quality==='title'}">Hi-Res 标注</button></div></div>
      <div class="search-context"><p><span class="context-dot"></span><strong>离线示例</strong> · 非平台实时结果；Hi-Res 音轨待核验。</p><button class="text-button" data-action="scenarios">状态演练 ${icon('arrow')}</button></div>
      <div class="source-select filter-group" aria-label="查看来源">${[['all','全部来源'],...sources.map(s=>[s.id,s.name])].map(([v,t])=>`<button data-source-filter="${v}" class="${state.source===v?'active':''}" aria-pressed="${state.source===v}">${t}</button>`).join('')}</div>
      <section class="source-stage" aria-label="按来源展示检索结果">${sources.map(s=>`<article class="source-plane" data-source="${s.id}" ${state.source!=='all'&&state.source!==s.id?'hidden':''}><header class="source-header"><div><span class="source-overline">${s.number} / ${s.short}${s.id==='bili'?' · 优先探索':''}</span><h2>${s.name}</h2><p>${s.description}</p></div><span class="source-mark">${s.id==='bili'?'b.':s.id==='kuwo'?'k.':'n.'}</span></header><div id="results-${s.id}" class="source-results" aria-live="polite">${sourceEmpty('输入一个关键词','各个来源将在这里展开。')}</div></article>`).join('')}</section>
      <div class="search-bottom-note"><span>${icon('wave')}</span><p>想先听一段真实的声音？</p><button class="text-button" data-detail="forest">打开内置试听 EP ${icon('arrow')}</button></div>`;
  }
  function sourceEmpty(title,text) { return `<div class="source-status"><span class="status-line"></span><h3>${title}</h3><p>${text}</p></div>`; }
  function runSearch(onlySource = null) {
    const generation = onlySource ? state.generation : ++state.generation, query = state.query.trim();
    if(!query) return;
    const targets = onlySource ? sources.filter(s=>s.id===onlySource) : sources;
    for(const source of targets) {
      const node = $('#results-'+source.id); if(!node)continue;
      state.results[source.id] = {status:'loading',items:[]};
      node.innerHTML = `<div class="source-status loading"><span class="status-line"></span><h3>正在检索「${esc(query)}」</h3><p>读取本地 ${source.name} 示例目录</p><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`;
      node.setAttribute('aria-busy','true');
      // Small, cancellable delays expose independent source states in the UI concept.
      setTimeout(() => {
        if(generation !== state.generation || state.route !== 'search')return;
        const normalized = query.toLocaleLowerCase().replace(/hi[- ]?res/g,'hires');
        let items = samples.filter(t=>t.source === source.id && `${t.title} ${t.artist} ${t.keywords}`.toLocaleLowerCase().includes(normalized));
        if(state.kind !== 'all')items = items.filter(t=>t.kind===state.kind);
        if(state.quality === 'title')items = items.filter(t=>t.quality==='title');
        if(preferences.hires)items.sort((a,b)=>Number(b.quality==='title')-Number(a.quality==='title'));
        const mode = state.scenarios[source.id];
        state.results[source.id] = {status:mode==='error'?'error':mode==='empty'||!items.length?'empty':'ready',items:mode==='empty'?[]:items};
        paintSource(source.id);
      },180 + sources.indexOf(source)*170);
    }
  }
  function paintSource(sourceId) {
    const node = $('#results-'+sourceId), result = state.results[sourceId]; if(!node || !result)return;
    node.setAttribute('aria-busy','false');
    if(result.status==='error')node.innerHTML = sourceEmpty('暂时没有连上','这是失败状态演示；其他来源仍可浏览。')+`<button class="text-button source-retry" data-retry="${sourceId}">重试这个来源 ${icon('arrow')}</button>`;
    else if(result.status==='empty')node.innerHTML = sourceEmpty('暂时没有找到','试试「钢琴」「山间」或放宽筛选。');
    else node.innerHTML = `<p class="result-count">${result.items.length} 个匹配示例</p>`+result.items.map(t=>`<button class="result-item" data-preview="${t.id}"><img src="${t.art}" alt=""><span class="result-info"><strong class="result-title">${esc(t.title)}</strong><span class="result-meta">${esc(t.artist)} · ${t.kind==='track'?'曲目':t.kind==='person'?(sourceId==='bili'?'UP 主':'歌手'):(sourceId==='bili'?'合集':sourceId==='kuwo'?'专辑':'歌单')}</span>${quality(t)}</span><span class="result-arrow">${icon('arrow')}</span></button>`).join('');
  }
  function libraryPage() {
    let body;
    if(state.tab==='playlists')body = `<div class="playlist-grid collection-grid">${preferences.playlists.map(collectionCard).join('')}<button class="new-playlist-tile" data-action="create-playlist">${icon('plus')}<strong>新建一张歌单</strong><span>把喜欢的声音留在一起</span></button></div><div class="section-heading"><div><p class="eyebrow">FROM BILIMUSIC</p><h2>从这里开始收藏</h2></div></div><div class="collection-grid">${collections.slice(0,4).map(collectionCard).join('')}</div>`;
    else { const ids = state.tab==='likes'?preferences.likes:preferences.recent; const items = ids.map(id=>allItems.find(t=>t.id===id)).filter(Boolean); body = items.length?`<div class="track-list library-tracks">${items.map((t,i)=>row(t,i)).join('')}</div>`:`<div class="empty-state">${icon(state.tab==='likes'?'heart':'wave')}<h2>${state.tab==='likes'?'喜欢，值得被留下。':'还没有播放记录。'}</h2><p>${state.tab==='likes'?'点击歌曲旁的收藏按钮，声音会在这里相遇。':'从一首原创器乐开始，最近播放会自动出现在这里。'}</p><button class="primary-button" data-route="discover">去发现音乐 ${icon('arrow')}</button></div>`; }
    return `<div class="page-heading"><p class="eyebrow">YOUR OWN COLLECTION</p><h1>音乐的归处。</h1><p>喜欢的、听过的，以及只属于你的编排。</p></div><div class="library-toolbar"><div class="library-tabs filter-group">${[['playlists','我的歌单',preferences.playlists.length],['likes','喜欢的声音',preferences.likes.length],['recent','最近播放',preferences.recent.length]].map(([v,t,n])=>`<button data-library-tab="${v}" class="${state.tab===v?'active':''}" aria-pressed="${state.tab===v}">${t}<small>${n}</small></button>`).join('')}</div><button class="secondary-button" data-action="create-playlist">${icon('plus')} 新建歌单</button></div>${body}<p class="library-summary">${storageAvailable?'歌单与收藏保存在当前浏览器。':'当前浏览器无法持久保存，内容仅保留在本次会话。'} · 示例条目可收藏，内置器乐可真实播放。</p>`;
  }
  function getPlaylist(id) { const custom = preferences.playlists.find(p=>p.id===id); if(custom)return {...custom,title:custom.name,art:allItems.find(t=>t.id===custom.items[0])?.art || 'art/ambient.svg',description:'属于你的声音编排，保存在当前浏览器。',custom:true}; const built = collections.find(c=>c.id===id); return built ? {...built,items:built.tracks.map(i=>tracks[i].id)} : null; }
  function detailPage(id) {
    const c = getPlaylist(id); if(!c)return '<div class="empty-state"><h1>这张歌单暂时不在这里。</h1><button class="text-button" data-route="library">返回资料库</button></div>';
    state.activePlaylist = c.id;
    const items = c.items.map(id=>allItems.find(t=>t.id===id)).filter(Boolean), localCount = items.filter(t=>t.index!==undefined).length;
    return `<div class="page-topline"><button class="text-button" data-route="library">${icon('back')} 资料库</button><span class="eyebrow">${c.custom?'YOUR PLAYLIST':'CURATED LISTENING'}</span></div><section class="detail-hero"><div class="detail-art"><img src="${c.art}" alt="${esc(c.title)} 歌单封面"></div><div class="detail-copy"><p class="eyebrow">${c.custom?'我的歌单':'BILIMUSIC · 主题歌单'}</p><h1>${esc(c.title)}</h1><p>${esc(c.description)}</p><div class="detail-meta"><span>${items.length} 个条目</span><span>${localCount} 首可试听</span><span>本地保存</span></div><div class="detail-actions"><button class="primary-button" data-playlist-play="${c.id}" ${localCount?'':'disabled'}>${icon('play')} 播放内置曲目</button>${c.custom?`<button class="secondary-button" data-rename="${c.id}">编辑歌单</button>`:`<button class="secondary-button" data-save-collection="${c.id}">${icon('plus')} 保存到我的歌单</button>`}</div></div></section><div class="section-heading"><div><p class="eyebrow">THE TRACKLIST</p><h2>按这个顺序，慢慢听</h2></div>${c.custom?'<button class="text-button" data-action="add-local-tracks">添加试听曲目 '+icon('plus')+'</button>':''}</div><div class="track-list">${items.length?items.map((t,i)=>row(t,i,c.custom)).join(''):'<div class="empty-state"><p>歌单还空着，从三首原创器乐开始。</p></div>'}</div>${items.some(t=>t.source)?'<p class="section-note">平台示例条目尚无可播放音轨，播放时仅使用歌单内的真实内置器乐。</p>':''}`;
  }
  function artistPage() { return `<div class="page-topline"><button class="text-button" data-route="discover">${icon('back')} 返回发现</button></div><section class="detail-hero artist-hero"><div class="detail-art"><img src="art/ambient.svg" alt="BiliMusic Studio 抽象绿色封面"></div><div class="detail-copy"><p class="eyebrow">THE PEOPLE BEHIND THE SOUND</p><h1>BiliMusic<br>Studio</h1><p>用声音记录片刻。当前原型收录三段原创器乐试听，适合体验真实播放与空间唱片。</p><div class="detail-actions"><button class="primary-button" data-play="0" data-open-player>${icon('play')} 聆听作品</button><button class="secondary-button" data-detail="forest">查看 EP ${icon('arrow')}</button></div></div></section><div class="section-heading"><h2>原创器乐</h2><span>3 首 / 山间来信</span></div><div class="track-list">${tracks.map((t,i)=>row(t,i)).join('')}</div>`; }
  function settingsPage() {
    return `<div class="page-heading"><p class="eyebrow">MAKE YOURSELF AT HOME</p><h1>调成，你的习惯。</h1><p>光线、声音与收藏，都可以有自己的方式。</p></div><div class="settings-layout"><nav class="settings-nav" aria-label="设置分区"><a href="#appearance">外观与动态</a><a href="#listening">聆听偏好</a><a href="#accounts">账号与来源</a><a href="#local-data">本地资料</a></nav><div class="settings-body"><section id="appearance" class="settings-section"><h2>外观与动态</h2><div class="setting-row"><div><h3>昼夜光线</h3><p>在温润纸色与安静暖墨之间切换。</p></div><div class="filter-group">${[['day','日光'],['night','夜间']].map(([v,t])=>`<button data-theme-choice="${v}" class="${preferences.theme===v?'active':''}" aria-pressed="${preferences.theme===v}">${t}</button>`).join('')}</div></div><div class="setting-row"><div><h3>空间动态</h3><p>控制唱片旋转、视差与界面过渡；遵循系统减少动态设置。</p></div><button class="toggle-button" data-setting="motion" role="switch" aria-checked="${preferences.motion}" aria-label="空间动态"><span></span></button></div></section><section id="listening" class="settings-section"><h2>聆听偏好</h2><div class="setting-row"><div><h3>BILI 优先，细节优先</h3><p>哔哩哔哩保持首位；优先排列标题标注 Hi-Res 的示例曲目。实际音质以可用音轨为准。</p></div><button class="toggle-button" data-setting="hires" role="switch" aria-checked="${preferences.hires}" aria-label="Hi-Res 标注优先"><span></span></button></div><div class="setting-row"><div><h3>声音的形状</h3><p>在空间播放器中预览 DSP 曲线与预设。</p></div><button class="text-button" data-action="open-player">打开播放器 ${icon('arrow')}</button></div></section><section id="accounts" class="settings-section"><h2>账号与来源</h2><div class="account-panel"><div class="account-monogram">M</div><div><h3>让收藏，跟你一起走。</h3><p>登录入口原型。当前未连接账号服务，不会提交凭据或产生登录状态。</p></div><button class="primary-button" data-action="login">查看登录入口</button></div><div class="setting-row"><div><h3>哔哩哔哩账号</h3><p>正式接入时通过官方授权完成；当前原型不访问或修改平台账号。</p></div><button class="text-button" data-action="bili-account">查看授权流程 ${icon('arrow')}</button></div></section><section id="local-data" class="settings-section"><h2>本地资料</h2><div class="setting-row"><div><h3>${preferences.playlists.length} 张歌单 · ${preferences.likes.length} 个收藏</h3><p>仅保存在当前浏览器，可导出 JSON 留存。</p></div><button class="secondary-button" data-action="export">导出资料</button></div><div class="setting-row"><div><h3>关于这套空间</h3><p>发现、多源检索、资料库与 3D 播放器的完整交互提案。</p></div><button class="text-button" data-action="about">原型说明 ${icon('arrow')}</button></div></section></div></div>`;
  }
  function openSheet(title,html,kicker='YOUR MUSIC SPACE') { if(!sheet.open)sheetOpener=document.activeElement; $('#sheet-title').textContent=title; $('#sheet-kicker').textContent=kicker; $('#sheet-body').innerHTML=html; if(!sheet.open)sheet.showModal(); const input=$('#sheet-body input:not([type=checkbox])'); if(input)input.focus();else $('#sheet-close').focus(); }
  function closeSheet() { sheet.close(); if(sheetOpener?.isConnected)sheetOpener.focus({preventScroll:true});else page.focus({preventScroll:true}); }
  function preview(id) { const t=allItems.find(t=>t.id===id); if(!t)return; const source=sources.find(s=>s.id===t.source); openSheet(t.title,`<div class="preview-detail"><img src="${t.art}" alt=""><div><p>${esc(t.artist)} · ${source?.name || '内置试听'}</p>${quality(t)}<p class="preview-disclaimer">这是本地设计示例，不是平台返回的内容，尚无可播放音轨。可以将条目收藏或编入本地歌单，体验完整浏览路径。</p></div></div><div class="sheet-actions"><button class="primary-button" data-favorite="${t.id}">${icon('heart')} ${preferences.likes.includes(t.id)?'取消收藏':'收藏条目'}</button><button class="secondary-button" data-add="${t.id}">${icon('plus')} 加入歌单</button></div>`,'OFFLINE SAMPLE / 来源示例'); }
  function playlistForm(id=null) { const c=id?getPlaylist(id):null; openSheet(c?'编辑歌单':'给这段声音，一个名字。',`<form id="playlist-form" data-id="${c?.id || ''}"><label class="form-field"><span>歌单名称</span><input name="name" maxlength="40" required value="${esc(c?.title || '')}" placeholder="例如：一个人的雨天" autocomplete="off"></label>${c?'':`<fieldset class="track-choices"><legend>挑选几首内置试听（也可以稍后添加）</legend>${tracks.map(t=>`<label><input type="checkbox" name="track" value="${t.id}"><span>${t.title}</span><small>${fmt(t.duration)}</small></label>`).join('')}</fieldset>`}<p class="form-hint">只保存在此浏览器，不会写入线上账号。</p><div class="sheet-actions"><button class="primary-button" type="submit">${c?'保存名称':'创建歌单'}</button>${c?`<button class="text-button danger" type="button" data-delete-playlist="${c.id}">删除这张歌单</button>`:''}</div></form>`); }
  function addToPlaylist(id) { openSheet('放进哪张歌单？',`<p class="form-hint">${esc(allItems.find(t=>t.id===id)?.title)}</p>${preferences.playlists.map(p=>`<button class="playlist-option" data-add-target="${p.id}" data-item="${id}"><span>${icon('queue')}<strong>${esc(p.name)}</strong></span><small>${p.items.includes(id)?'已添加':p.items.length+' 个条目'}</small></button>`).join('') || '<p class="empty-hint">还没有自建歌单。创建后就能收藏这条声音。</p>'}<button class="secondary-button" data-new-for-item="${id}">${icon('plus')} 创建新歌单并加入</button>`); }
  function addItem(playlistId,itemId) { const p=preferences.playlists.find(p=>p.id===playlistId); if(!p||!validId(itemId))return; if(p.items.includes(itemId)){toast('这条声音已经在歌单里。');return;}p.items.push(itemId);save();closeSheet();toast('已加入「'+p.name+'」。');if(state.route==='collection'||state.route==='library')render(false); }
  function toggleLike(id) { if(!validId(id))return; const index=preferences.likes.indexOf(id); if(index<0)preferences.likes.unshift(id);else preferences.likes.splice(index,1);save();syncLikes();if(['library','settings'].includes(state.route))render(false);toast(index<0?'已收入喜欢的声音。':'已取消收藏。'); }
  function openPlayer(trigger=document.activeElement) { opener=trigger;state.opened=true;$('#player-stage').hidden=false;$('.shell-header').inert=true;page.inert=true;$('.mini-player').inert=true;document.body.classList.add('player-open');command('active',{value:true});frame.focus(); }
  function closePlayer() { state.opened=false;command('active',{value:false});$('#player-stage').hidden=true;$('.shell-header').inert=false;page.inert=false;$('.mini-player').inert=false;document.body.classList.remove('player-open');if(opener?.isConnected)opener.focus({preventScroll:true});else $('#expand-player').focus({preventScroll:true}); }
  function playTrack(index,expand=false) { if(!Number.isInteger(index)||index<0||index>=tracks.length)return;if(!state.ready){pendingTrack={index,expand};toast('正在准备试听音频…');return;}command('track',{index,play:true});if(expand)openPlayer(); }
  function syncPlayer() { const t=tracks[state.player.index] || tracks[0],queue=state.player.queue || [0,1,2],position=queue.indexOf(state.player.index);$('#mini-title').textContent=t.title;$('#mini-play').innerHTML=icon(state.player.playing?'pause':'play');$('#mini-play').setAttribute('aria-label',state.player.playing?'暂停':'播放');$('#mini-prev').disabled=!state.player.repeat&&position<=0;$('#mini-next').disabled=!state.player.repeat&&position>=queue.length-1;$('#mini-elapsed').textContent=fmt(state.player.currentTime);$('#mini-duration').textContent=fmt(state.player.duration);$('#mini-seek').max=state.player.duration || t.duration;if(!state.seeking)$('#mini-seek').value=state.player.currentTime || 0;$('#mini-like').setAttribute('aria-pressed',String(preferences.likes.includes(t.id)));$('#mini-like').setAttribute('aria-label',preferences.likes.includes(t.id)?'取消收藏当前歌曲':'收藏当前歌曲'); }
  function rememberTrack(index) { const id=tracks[index]?.id;if(!id)return;preferences.recent=[id,...preferences.recent.filter(t=>t!==id)].slice(0,30);save();if(state.route==='library')render(false); }
  window.addEventListener('message',event=>{
    if(event.source!==frame.contentWindow)return;
    if(event.data?.type==='bilimusic:close'){closePlayer();return;}
    if(event.data?.type==='bilimusic:preference'){
      const {key,value}=event.data;
      if(key==='theme'&&['day','night'].includes(value)){preferences.theme=value;save();syncAppearance();}
      if(key==='motion'&&typeof value==='boolean'){preferences.motion=value;save();syncAppearance();}
      if(key==='liked'&&Array.isArray(value)){preferences.likes=[...preferences.likes.filter(id=>!id.startsWith('local-')),...tracks.filter(t=>value.includes(t.index)).map(t=>t.id)];save();syncLikes();if(['library','settings'].includes(state.route))render(false);}
      return;
    }
    if(event.data?.type!=='bilimusic:state'||!event.data.state)return;
    const data=event.data.state;if(!Number.isInteger(data.index)||!tracks[data.index])return;
    const first=!state.ready;state.ready=true;state.player={...state.player,...data};syncPlayer();
    if(data.playing&&mediaIndex!==data.index){mediaIndex=data.index;rememberTrack(data.index);}
    if(first){syncAppearance();syncLikes();command('active',{value:state.opened});if(pendingTrack){const p=pendingTrack;pendingTrack=null;playTrack(p.index,p.expand);}}
  });
  frame.addEventListener('load',()=>command('requestState'));
  $('#mini-play').addEventListener('click',()=>state.ready?command('toggle'):playTrack(0));
  $('#mini-prev').addEventListener('click',()=>command('previous'));
  $('#mini-next').addEventListener('click',()=>command('next'));
  $('#expand-player').addEventListener('click',()=>openPlayer());
  $('#mini-like').addEventListener('click',()=>toggleLike(tracks[state.player.index].id));
  $('#mini-queue').addEventListener('click',()=>openSheet('接下来播放',`<div class="queue-sheet">${(state.player.queue || [0,1,2]).map((index,i)=>row(tracks[index],i)).join('')}</div><p class="form-hint">按当前歌单中的内置曲目顺序播放。</p>`));
  $('#mini-seek').addEventListener('pointerdown',()=>state.seeking=true);
  $('#mini-seek').addEventListener('input',e=>$('#mini-elapsed').textContent=fmt(+e.target.value));
  $('#mini-seek').addEventListener('change',e=>{command('seek',{value:+e.target.value});state.seeking=false;});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(name,()=>{if(state.seeking)requestAnimationFrame(()=>{state.seeking=false;syncPlayer();});});
  $('#theme-switch').addEventListener('click',()=>{preferences.theme=preferences.theme==='day'?'night':'day';save();syncAppearance();if(state.route==='settings')render(false);});
  $('#sheet-close').addEventListener('click',closeSheet);sheet.addEventListener('cancel',e=>{e.preventDefault();closeSheet();});
  document.addEventListener('click',event=>{
    const b=event.target.closest('button,a');if(!b)return;const d=b.dataset;
    if(d.route){event.preventDefault();navigate(d.route);return;}
    if(d.query!==undefined){state.source='all';navigate('search',{q:d.query});return;}
    if(d.detail){navigate('collection',{id:d.detail});return;}
    if(d.play!==undefined){if(sheet.open)closeSheet();playTrack(+d.play,'openPlayer' in d);return;}
    if(d.category){state.category=d.category;render(false);return;}
    if(d.preview){preview(d.preview);return;}
    if(d.favorite){toggleLike(d.favorite);return;}
    if(d.add){addToPlaylist(d.add);return;}
    if(d.kind){state.kind=d.kind;render(false);return;}
    if(d.quality){state.quality=d.quality;render(false);return;}
    if(d.sourceFilter){state.source=d.sourceFilter;document.querySelectorAll('[data-source-filter]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});document.querySelectorAll('.source-plane').forEach(x=>x.hidden=state.source!=='all'&&x.dataset.source!==state.source);return;}
    if(d.retry){state.scenarios[d.retry]='ready';runSearch(d.retry);return;}
    if(d.libraryTab){state.tab=d.libraryTab;render(false);return;}
    if(d.rename){playlistForm(d.rename);return;}
    if(d.addTarget){addItem(d.addTarget,d.item);return;}
    if(d.newForItem){playlistForm();$('#playlist-form').dataset.pending=d.newForItem;return;}
    if(d.playlistPlay){const c=getPlaylist(d.playlistPlay), indices=c?.items.map(id=>tracks.find(t=>t.id===id)?.index).filter(i=>i!==undefined);if(indices?.length){command('queue',{indices,play:true});toast(`已按歌单顺序加入 ${indices.length} 首内置曲目。${indices.length<c.items.length?'无音轨的示例条目已跳过。':''}`);}return;}
    if(d.saveCollection){const c=getPlaylist(d.saveCollection);if(!c)return;preferences.playlists.push({id:'custom-'+Date.now().toString(36),name:c.title,items:[...c.items]});save();toast('已保存到我的歌单。');return;}
    if(d.remove){const c=preferences.playlists.find(p=>p.id===state.activePlaylist);if(c){c.items=c.items.filter(id=>id!==d.remove);save();render(false);toast('已从这张歌单移除。');}return;}
    if(d.deletePlaylist){const p=preferences.playlists.find(p=>p.id===d.deletePlaylist);openSheet('删除这张歌单？',`<p>「${esc(p?.name)}」会从当前浏览器移除，歌曲收藏不受影响。</p><div class="sheet-actions"><button class="primary-button" data-confirm-delete="${d.deletePlaylist}">确认删除</button><button class="secondary-button" data-action="close-sheet">保留歌单</button></div>`);return;}
    if(d.confirmDelete){preferences.playlists=preferences.playlists.filter(p=>p.id!==d.confirmDelete);save();closeSheet();navigate('library');toast('已删除歌单。');return;}
    if(d.themeChoice){preferences.theme=d.themeChoice;save();syncAppearance();render(false);return;}
    if(d.setting){preferences[d.setting]=!preferences[d.setting];save();syncAppearance();b.setAttribute('aria-checked',String(preferences[d.setting]));return;}
    if(b.closest('.settings-nav')){event.preventDefault();document.querySelector(b.getAttribute('href'))?.scrollIntoView({behavior:root.dataset.motion==='on'?'smooth':'instant',block:'start'});return;}
    const action=d.action;
    if(action==='create-playlist')playlistForm();
    if(action==='close-sheet')closeSheet();
    if(action==='open-player')openPlayer();
    if(action==='add-local-tracks')openSheet('添入一段新的声音',`<div class="track-choices">${tracks.map(t=>`<button class="playlist-option" data-add-target="${state.activePlaylist}" data-item="${t.id}"><span>${t.title}</span>${icon('plus')}</button>`).join('')}</div>`);
    if(action==='login')openSheet('欢迎回到你的音乐空间。',`<p class="login-intro">登录界面演示，未连接账号服务。请勿输入真实密码。</p><form id="login-form"><label class="form-field"><span>账号</span><input name="username" required maxlength="40" placeholder="示例账号" autocomplete="off"></label><label class="form-field"><span>示例密码</span><input name="password" required minlength="6" maxlength="100" type="password" placeholder="仅用于表单预览" autocomplete="off"></label><p id="login-status" role="status"></p><button class="primary-button" type="submit">预览登录反馈 ${icon('arrow')}</button></form><p class="form-hint">本表单不发送网络请求、不保存凭据，也不会建立登录会话。</p>`,'ACCOUNT / 登录入口原型');
    if(action==='bili-account')openSheet('连接你的哔哩哔哩',`<ol class="flow-steps"><li><strong>打开官方授权</strong><p>正式版通过平台官方页面完成登录。</p></li><li><strong>确认账号状态</strong><p>返回后展示头像、账号名与连接状态。</p></li><li><strong>随时断开连接</strong><p>在设置中撤销本应用的登录状态。</p></li></ol><p class="form-hint">当前为流程预览，未调用授权、扫码或任何平台账号接口。</p>`,'CONNECTED SOURCES');
    if(action==='scenarios')openSheet('每个来源，都有自己的状态。',`<p class="form-hint">仅改变离线检索的展示状态，不模拟真实平台故障。重试会恢复该来源。</p><form id="scenario-form">${sources.map(s=>`<label class="form-field"><span>${s.name}</span><select name="${s.id}">${[['ready','正常示例结果'],['empty','无结果'],['error','加载失败']].map(([v,t])=>`<option value="${v}" ${state.scenarios[s.id]===v?'selected':''}>${t}</option>`).join('')}</select></label>`).join('')}<button class="primary-button" type="submit">应用状态</button></form>`,'SEARCH STATES / 原型演练');
    if(action==='about')openSheet('一个完整、连续的音乐空间。','<div class="about-copy"><p>发现页用主题与留白建立浏览节奏；检索用不同视面呈现三个来源；资料库让收藏、编排与播放形成连续路径。</p><p>这是一套离线交互原型。发现主题与平台结果包含示例内容；只有三首 BiliMusic Studio 内置器乐可真实试听。登录与 DSP 为界面方案，尚未连接账号或音效处理。</p><p>所有页面共用一个播放器，浏览时音乐继续。暖纸与暖墨主题、键盘操作、手机布局和减少动态保持一致。</p></div>','BILIMUSIC / MUSIC SPACE');
    if(action==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(preferences,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='BiliMusic-音乐空间资料.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出本地歌单、收藏与偏好。');}
  });
  document.addEventListener('submit',event=>{
    const form=event.target;event.preventDefault();const data=new FormData(form);
    if(form.id==='search-form'){const q=String(data.get('query') || '').trim().slice(0,80);if(q){preferences.queries=[q,...preferences.queries.filter(s=>s!==q)].slice(0,8);save();}navigate('search',q?{q}:{});}
    if(form.id==='playlist-form'){const name=String(data.get('name') || '').trim();if(!name){form.elements.name.setCustomValidity('请输入歌单名称。');form.elements.name.reportValidity();return;}const id=form.dataset.id;let p=preferences.playlists.find(p=>p.id===id);if(p)p.name=name;else {p={id:'custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),name,items:safeIds([...data.getAll('track'),form.dataset.pending])};preferences.playlists.push(p);}save();closeSheet();navigate('collection',{id:p.id});toast(id?'歌单名称已更新。':'歌单已创建。');}
    if(form.id==='login-form'){$('#login-status').textContent='表单格式有效。此原型尚未连接账号服务，未登录、未保存密码。';form.elements.password.value='';}
    if(form.id==='scenario-form'){sources.forEach(s=>state.scenarios[s.id]=String(data.get(s.id)));closeSheet();if(state.query)runSearch();else toast('状态已设置，输入关键词后可查看。');}
  });
  document.addEventListener('input',event=>{if(event.target.matches('#playlist-form input[name=name]'))event.target.setCustomValidity('');});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.opened){event.preventDefault();closePlayer();}if(event.key==='/'&&!event.target.closest('input,textarea,select')&&!sheet.open&&!state.opened){event.preventDefault();navigate('search');setTimeout(()=>$('#search-input')?.focus(),0);}});
  window.addEventListener('hashchange',()=>render());
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',syncAppearance);
  $('#mini-prev').innerHTML=icon('previous');$('#mini-next').innerHTML=icon('next');$('#mini-like').innerHTML=icon('heart');$('#mini-queue').innerHTML=icon('queue');$('#sheet-close').innerHTML=icon('close');$('.header-tools [data-route=settings]').innerHTML=icon('settings');
  syncAppearance();syncPlayer();render(false);
  if(!storageAvailable)toast('本地资料暂时无法读取，当前使用空白会话。');
  window.musicSpace = {state, get preferences(){return preferences;}};
})();
