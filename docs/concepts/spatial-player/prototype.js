(() => {
  'use strict';
  const $ = selector => document.querySelector(selector), root = $('#spatial-player'), audio = $('#audio'), scene = $('.record-scene');
  const paths = {
    play:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',pause:'<path d="M8 5v14m8-14v14" stroke-width="3"/>',
    previous:'<path d="M5 5v14m13-13L8 12l10 6z" fill="currentColor"/>',next:'<path d="M19 5v14M6 6l10 6-10 6z" fill="currentColor"/>',
    repeat:'<path d="M3 11V9a3 3 0 0 1 3-3h13m-3-3 3 3-3 3m5 4v2a3 3 0 0 1-3 3H5m3-3-3 3 3 3"/>',
    heart:'<path d="M20.4 5.4a5.1 5.1 0 0 0-7.2 0L12 6.7l-1.2-1.3a5.1 5.1 0 0 0-7.2 7.2L12 21l8.4-8.4a5.1 5.1 0 0 0 0-7.2Z"/>',
    volume:'<path d="M3 9h4l5-4v14l-5-4H3zm12-1a6 6 0 0 1 0 8m3-10a9 9 0 0 1 0 12"/>',muted:'<path d="M3 9h4l5-4v14l-5-4H3zm13 1 5 5m0-5-5 5"/>',
    queue:'<path d="M3 6h18M3 12h12M3 18h7m6-4 5 3-5 3z"/>',sliders:'<path d="M5 3v7m0 4v7M12 3v3m0 4v11M19 3v10m0 4v4"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="10" y="6" width="4" height="4" rx="1"/><rect x="17" y="13" width="4" height="4" rx="1"/>',
    moon:'<path d="M20.6 14a8.8 8.8 0 0 1-10.5-10.5A8.8 8.8 0 1 0 20.6 14Z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    motion:'<path d="M3 12c3-9 5 9 8 0s5 9 10 0M5 4h3m8 16h3"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',wave:'<path d="M3 10v4m4-8v12m5-15v18m5-14v10m4-7v4"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
  function paintIcons(scope=document) { scope.querySelectorAll('[data-icon]').forEach(el => el.innerHTML=icon(el.dataset.icon)); }
  paintIcons();
  const tracks=[{title:'薄雾序曲',file:'mist',duration:28.263},{title:'溪流之间',file:'creek',duration:23.258},{title:'暮色回声',file:'dusk',duration:31.184}];
  const state={index:0,playing:false,repeat:false,liked:new Set(),wing:null,view:'listen',motion:true,angle:0,velocity:0,px:0,py:0,tx:0,ty:0,last:0,raf:0,swap:0,lowSince:0,qualityReduced:false,eq:[0,0,0],eqPreset:'flat',lyricIndex:0,manualSeek:false};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), precise = matchMedia('(pointer:fine)');
  state.systemReduced=reduced.matches;state.preferenceAt=0;
  const esc = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Math.floor(Math.max(0,n||0)/60)+':'+String(Math.floor(Math.max(0,n||0)%60)).padStart(2,'0');
  let statusTimer,wingOpener=null;
  const lyricAnimations=new Set();
  function announce(message){$('#status').textContent=message;$('#status').classList.add('visible');clearTimeout(statusTimer);statusTimer=setTimeout(()=>$('#status').classList.remove('visible'),2400);}
  function motionAllowed(){return state.motion&&!state.systemReduced&&!document.hidden;}
  function requestFrame(){if(!state.raf&&motionAllowed())state.raf=requestAnimationFrame(frame);}
  function stopFrame(){cancelAnimationFrame(state.raf);state.raf=0;state.last=0;state.velocity=0;scene.style.setProperty('--lift','0px');}
  function frame(now){
    state.raf=0;if(now-state.preferenceAt>100){state.preferenceAt=now;if(matchMedia('(prefers-reduced-motion: reduce)').matches!==state.systemReduced)syncMotion();}if(!motionAllowed()){stopFrame();return;}
    const dt=state.last?Math.min((now-state.last)/1000,.064):.016;state.last=now;
    const target=state.playing?12:0,blend=1-Math.exp(-dt/(state.playing?.35:.2));
    state.velocity+=(target-state.velocity)*blend;if(!state.playing&&state.velocity<.035)state.velocity=0;
    state.angle=(state.angle+state.velocity*dt)%360;
    const ease=1-Math.exp(-dt/.1);state.px+=(state.tx-state.px)*ease;state.py+=(state.ty-state.py)*ease;
    scene.style.setProperty('--spin-angle',state.angle+'deg');scene.style.setProperty('--pointer-x',state.px.toFixed(3));scene.style.setProperty('--pointer-y',state.py.toFixed(3));
    scene.style.setProperty('--lift',state.playing?(Math.sin(now/2500)*1.3)+'px':'0px');
    if(state.playing&&dt>.027){if(!state.lowSince)state.lowSince=now;else if(now-state.lowSince>2000){state.qualityReduced=true;state.tx=state.ty=0;}}else state.lowSince=0;
    if(state.playing||state.velocity>0||lyricAnimations.size||Math.abs(state.tx-state.px)+Math.abs(state.ty-state.py)>.001)requestFrame();else state.last=0;
  }
  function syncMotion(){state.systemReduced=matchMedia('(prefers-reduced-motion: reduce)').matches;const enabled=state.motion&&!state.systemReduced;root.dataset.motion=enabled?'on':'off';$('#motion-toggle').setAttribute('aria-pressed',String(enabled));$('#motion-toggle').setAttribute('aria-label',enabled?'关闭动态效果':'开启动效');$('.motion-label').textContent=enabled?'动效开启':'减少动态';if(!enabled){stopFrame();lyricAnimations.forEach(animation=>animation.cancel());lyricAnimations.clear();state.tx=state.ty=state.px=state.py=0;scene.style.setProperty('--pointer-x','0');scene.style.setProperty('--pointer-y','0');}else requestFrame();}
  scene.addEventListener('pointermove',e=>{if(!motionAllowed()||!precise.matches||state.qualityReduced||e.pointerType==='touch')return;const r=scene.getBoundingClientRect();state.tx=Math.max(-1,Math.min(1,(e.clientX-r.left)/r.width*2-1));state.ty=Math.max(-1,Math.min(1,(e.clientY-r.top)/r.height*2-1));requestFrame();});
  scene.addEventListener('pointerleave',()=>{state.tx=state.ty=0;requestFrame();});
  document.addEventListener('visibilitychange',()=>document.hidden?stopFrame():syncMotion());
  for(const event of ['pointerdown','keydown'])document.addEventListener(event,()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches!==state.systemReduced)syncMotion();},{capture:true,passive:true});reduced.addEventListener('change',syncMotion);
  $('#motion-toggle').addEventListener('click',()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches){syncMotion();announce('已遵循系统的减少动态设置');return;}state.motion=!state.motion;if(state.motion){state.qualityReduced=false;state.lowSince=0;}syncMotion();});
  $('#theme-toggle').addEventListener('click',()=>{const night=root.dataset.theme!=='night';root.dataset.theme=night?'night':'day';$('#theme-toggle').innerHTML=icon(night?'sun':'moon');$('#theme-toggle').setAttribute('aria-label',night?'切换至日光场景':'切换至夜间光线');$('#theme-toggle').title=$('#theme-toggle').getAttribute('aria-label');});
  function syncPlayback(){state.playing=!audio.paused&&!audio.ended;scene.dataset.playing=String(state.playing);$('#play').innerHTML=icon(state.playing?'pause':'play');$('#play').setAttribute('aria-label',state.playing?'暂停':'播放');$('#scene-state').textContent=state.playing?'声音正在此刻流动':'把片刻，留给音乐';requestFrame();}
  async function play(){try{await audio.play();}catch(error){if(error.name!=='AbortError')announce('未能播放，请再次点击播放。');syncPlayback();}}
  function toggle(){if(audio.paused)void play();else audio.pause();}
  $('#play').addEventListener('click',toggle);audio.addEventListener('playing',syncPlayback);audio.addEventListener('pause',syncPlayback);audio.addEventListener('ended',()=>{syncPlayback();if(state.index<tracks.length-1||state.repeat)void selectTrack((state.index+1)%tracks.length,true);});
  function syncTime(){const duration=Number.isFinite(audio.duration)?audio.duration:tracks[state.index].duration;$('#seek').max=duration;$('#duration').textContent=fmt(duration);$('#elapsed').textContent=fmt(audio.currentTime);if(!state.manualSeek)$('#seek').value=audio.currentTime;$('#seek').style.setProperty('--value',(audio.currentTime/duration*100||0)+'%');}
  audio.addEventListener('timeupdate',syncTime);audio.addEventListener('loadedmetadata',syncTime);audio.addEventListener('error',()=>announce('音频无法载入，请从完整原型目录打开。'));
  $('#seek').addEventListener('pointerdown',()=>state.manualSeek=true);$('#seek').addEventListener('input',e=>{$('#elapsed').textContent=fmt(+e.target.value);e.target.style.setProperty('--value',(+e.target.value/+e.target.max*100)+'%');});$('#seek').addEventListener('change',e=>{audio.currentTime=+e.target.value;state.manualSeek=false;syncTime();});$('#seek').addEventListener('pointercancel',()=>{state.manualSeek=false;syncTime();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(event,()=>{if(state.manualSeek)requestAnimationFrame(()=>{state.manualSeek=false;syncTime();});});
  audio.volume=.55;
  function syncVolume(){$('#mute').innerHTML=icon(audio.muted||audio.volume===0?'muted':'volume');$('#mute').setAttribute('aria-label',audio.muted||audio.volume===0?'取消静音':'静音');$('#volume').value=audio.muted?0:audio.volume;$('#volume').style.setProperty('--value',(audio.muted?0:audio.volume*100)+'%');}
  $('#volume').addEventListener('input',e=>{audio.volume=+e.target.value;audio.muted=false;syncVolume();});$('#mute').addEventListener('click',()=>{audio.muted=!audio.muted;if(!audio.muted&&audio.volume===0)for(const event of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(event,()=>{if(state.manualSeek)requestAnimationFrame(()=>{state.manualSeek=false;syncTime();});});
  audio.volume=.55;syncVolume();});audio.addEventListener('volumechange',syncVolume);
  function syncFavorite(){const liked=state.liked.has(state.index);$('#favorite').setAttribute('aria-pressed',String(liked));$('#favorite').setAttribute('aria-label',liked?'取消收藏':'收藏歌曲');}
  $('#favorite').addEventListener('click',()=>{if(state.liked.has(state.index))state.liked.delete(state.index);else state.liked.add(state.index);syncFavorite();});
  $('#repeat').addEventListener('click',()=>{state.repeat=!state.repeat;$('#repeat').setAttribute('aria-pressed',String(state.repeat));$('#repeat').setAttribute('aria-label',state.repeat?'关闭循环':'开启循环');});
  async function selectTrack(index,shouldPlay=state.playing){const serial=++state.swap;root.classList.toggle('is-changing',motionAllowed());state.index=index;audio.pause();audio.src='../../../src/assets/'+tracks[index].file+'.flac';$('#track-title').textContent=tracks[index].title;syncFavorite();syncTime();if(state.wing==='queue')renderWing();setTimeout(()=>{if(serial===state.swap)root.classList.remove('is-changing');},motionAllowed()?180:0);if(shouldPlay)await play();}
  $('#next').addEventListener('click',()=>void selectTrack((state.index+1)%tracks.length));$('#previous').addEventListener('click',()=>void selectTrack((state.index+tracks.length-1)%tracks.length));
  function changeView(view){closeWing(false);state.view=view;root.dataset.view=view;$('.listening-copy').hidden=view==='lyrics';$('.lyrics-space').hidden=view!=='lyrics';for(const v of ['listen','lyrics']){$('#'+v+'-view').classList.toggle('active',view===v);$('#'+v+'-view').setAttribute('aria-pressed',String(view===v));}$('.listening-stage').scrollTop=0;}
  $('#listen-view').addEventListener('click',()=>changeView('listen'));$('#lyrics-view').addEventListener('click',()=>changeView('lyrics'));$('#enter-lyrics').addEventListener('click',()=>changeView('lyrics'));
  const demoLines=['风从远处经过','把这一刻，轻轻留住','等下一束光，慢慢落下','有些声音，无需说出口','故事还在缓缓继续'];
  $('#demo-lyrics').addEventListener('click',()=>{$('.lyrics-note').hidden=true;$('#demo-lines').hidden=false;$('#demo-advance').focus({preventScroll:true});});
  $('#demo-advance').addEventListener('click',()=>{state.lyricIndex=(state.lyricIndex+1)%demoLines.length;const nodes=[$('.lyric-before'),$('.lyric-active'),$('.lyric-after')];nodes.forEach((el,i)=>{el.textContent=demoLines[(state.lyricIndex+i)%demoLines.length];if(motionAllowed()){const animation=el.animate([{opacity:0,transform:'translateY(18px)'},{opacity:i===1?1:.35,transform:'translateY(0)'}],{duration:500,easing:'cubic-bezier(.2,.8,.2,1)'});lyricAnimations.add(animation);requestFrame();animation.finished.catch(()=>{}).finally(()=>lyricAnimations.delete(animation));}});});
  function openWing(kind,opener){if(state.wing===kind){closeWing();return;}state.wing=kind;wingOpener=opener;root.classList.add('has-wing');$('.song-space').inert=true;$('#side-wing').hidden=false;renderWing();$('#wing-close').focus({preventScroll:true});}
  function closeWing(restore=true){if(!state.wing)return;state.wing=null;root.classList.remove('has-wing');$('.song-space').inert=false;$('#side-wing').hidden=true;$('#queue-toggle').setAttribute('aria-expanded','false');$('#dsp-toggle').setAttribute('aria-expanded','false');if(restore)wingOpener?.focus({preventScroll:true});}
  $('#queue-toggle').addEventListener('click',()=>openWing('queue',$('#queue-toggle')));$('#dsp-toggle').addEventListener('click',()=>openWing('dsp',$('#dsp-toggle')));$('#about-toggle').addEventListener('click',()=>openWing('about',$('#about-toggle')));$('#wing-close').addEventListener('click',()=>closeWing());
  function renderWing(){const trackFocus=document.activeElement?.dataset.track;const kind=state.wing;$('#queue-toggle').setAttribute('aria-expanded',String(kind==='queue'));$('#dsp-toggle').setAttribute('aria-expanded',String(kind==='dsp'));$('#wing-title').textContent={queue:'接下来播放',dsp:'声音的形状',about:'空间唱片'}[kind];$('#wing-kicker').textContent={queue:'3 首 · 山间来信',dsp:'SOUND SCULPTURE',about:'UI CONCEPT · 02'}[kind];
    if(kind==='queue')$('#wing-body').innerHTML=tracks.map((t,i)=>`<button class="queue-row" data-track="${i}" aria-current="${i===state.index}"><img class="queue-art" src="../../../src/assets/forest.jpg" alt=""><span><strong>${esc(t.title)}</strong><small>BiliMusic Studio</small></span><small>${fmt(t.duration)}</small></button>`).join('')+'<p class="wing-note">播放在原位继续，队列轻轻展开。<br>所列曲目均为应用内置的原创器乐试听。</p>';
    if(kind==='dsp')$('#wing-body').innerHTML=`<p class="wing-note">界面演示：这些参数只改变曲线预览，尚未处理试听音频。</p><div class="wing-pills"><button data-preset="flat" class="${state.eqPreset==='flat'?'active':''}">原声</button><button data-preset="warm" class="${state.eqPreset==='warm'?'active':''}">温暖</button><button data-preset="vocal" class="${state.eqPreset==='vocal'?'active':''}">清晰人声</button></div><svg class="eq-chart" viewBox="0 0 360 120" role="img" aria-label="音效参数的视觉预览"><line x1="0" y1="60" x2="360" y2="60"/><path id="eq-curve" d="M0 60Q90 60 180 60T360 60"/></svg><div class="eq-labels"><span>低频</span><span>中频</span><span>高频</span></div>${['低频','中频','高频'].map((name,i)=>`<label class="eq-control"><span>${name}</span><input type="range" data-eq="${i}" min="-6" max="6" step=".5" value="${state.eq[i]}" aria-label="${name}增益"><output>${state.eq[i]} dB</output></label>`).join('')}<p class="wing-note">正式版接入现有参数均衡器与 DSP 引擎；3D 场景仅表达播放状态，不代替音频计量。</p>`;
    if(kind==='about')$('#wing-body').innerHTML='<div class="design-copy"><h3>一个连续的聆听空间</h3><p>用光线与深度建立层次，去掉页头、主体、底栏之间的硬分割。让封面、文字和控制留在同一画面里。</p><h3>运动有因，停止有时</h3><p>唱片随真实播放缓起、暂停缓停；切歌轻轻抬起，歌词进入前景。工具展开时，主播放位置保持稳定。</p><h3>白天温润，夜晚安静</h3><p>日光采用暖纸与赭红，夜间采用暖墨与浅金。手机使用单列、固定控制；系统减少动态时全部停稳。</p><h3>原型范围</h3><p>支持三首内置音频试听、进度与音量、切歌、歌词动效演示、队列和 DSP 外观。未连接线上账号或改变正式播放器。</p></div>';
    $('#wing-body').scrollTop=0;if(kind==='queue'&&trackFocus!==undefined)$('#wing-body').querySelector('[data-track="'+trackFocus+'"]')?.focus({preventScroll:true});if(kind==='dsp')drawEQ();
  }
  function drawEQ(){const curve=$('#eq-curve');if(!curve)return;const y=state.eq.map(v=>60-v*6);curve.setAttribute('d',`M0 ${y[0]} C60 ${y[0]} 110 ${y[1]} 180 ${y[1]} S300 ${y[2]} 360 ${y[2]}`);document.querySelectorAll('[data-eq]').forEach(el=>{const v=state.eq[+el.dataset.eq];el.value=v;el.style.setProperty('--value',((v+6)/12*100)+'%');el.nextElementSibling.textContent=(v>0?'+':'')+v+' dB';});}
  $('#wing-body').addEventListener('click',e=>{const track=e.target.closest('[data-track]');if(track){void selectTrack(+track.dataset.track,true);return;}const preset=e.target.closest('[data-preset]');if(preset){state.eqPreset=preset.dataset.preset;state.eq={flat:[0,0,0],warm:[3,.5,-1],vocal:[-1,2,1]}[preset.dataset.preset];document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b===preset));drawEQ();}});
  $('#wing-body').addEventListener('input',e=>{if(e.target.matches('[data-eq]')){state.eqPreset=null;state.eq[+e.target.dataset.eq]=+e.target.value;document.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('active'));drawEQ();}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.wing){e.preventDefault();closeWing();return;}if(e.code==='Space'&&!e.target.closest('button,input,a')){e.preventDefault();toggle();}});
  $('.wordmark').addEventListener('click',e=>{e.preventDefault();changeView('listen');});
  syncMotion();syncVolume();syncTime();syncPlayback();
  window.prototypeState=state;
})();
