(() => {
  'use strict';
  const tracks = [
    {id:'local-0',index:0,title:'薄雾序曲',artist:'BiliMusic Studio',duration:28.263,art:'../../../src/assets/forest.jpg'},
    {id:'local-1',index:1,title:'溪流之间',artist:'BiliMusic Studio',duration:23.258,art:'../../../src/assets/forest.jpg'},
    {id:'local-2',index:2,title:'暮色回声',artist:'BiliMusic Studio',duration:31.184,art:'../../../src/assets/forest.jpg'}
  ];
  const collections = [
    {id:'forest',title:'山间来信',subtitle:'薄雾、溪流与暮色',description:'三段短小的原创器乐，把忙碌的日常留在山的另一边。',art:'../../../src/assets/forest.jpg',tracks:[0,1,2],tag:'原创试听'},
    {id:'rain',title:'雨落，万物安静',subtitle:'给窗边的片刻留白',description:'雨声般的轻柔层次，为一个人的下午留出呼吸。此主题以三首内置器乐呈现试听。',art:'art/rain.svg',tracks:[1,0,2],tag:'雨天'},
    {id:'piano',title:'留一盏灯给钢琴',subtitle:'温暖的木色与琴键',description:'不急着抵达任何地方。用安静的旋律，把注意力慢慢收回来。此为主题歌单原型。',art:'art/piano.svg',tracks:[0,2,1],tag:'专注'},
    {id:'night',title:'凌晨之后',subtitle:'世界睡去，耳朵醒来',description:'低一点的光线，近一点的声音。适合在夜间模式中聆听的主题选择。',art:'art/night.svg',tracks:[2,1,0],tag:'夜晚'},
    {id:'voice',title:'人声，近在耳边',subtitle:'听见每一次呼吸',description:'从清晰人声开始探索不同来源。本原型歌单使用内置器乐，不冒充真实人声内容。',art:'art/voice.svg',tracks:[0,1],tag:'人声'},
    {id:'jazz',title:'周末慢半拍',subtitle:'让生活有一点摇摆',description:'给周末一段没有日程的时间。封面与主题为设计示例，曲目为原创器乐试听。',art:'art/jazz.svg',tracks:[1,2],tag:'放松'},
    {id:'ambient',title:'进入绿色的频率',subtitle:'留给自己的声音',description:'由自然颜色展开的聆听主题。轻盈、安静，保留细节。',art:'art/ambient.svg',tracks:[0,1,2],tag:'自然'}
  ];
  const sources = [
    {id:'bili',name:'哔哩哔哩',short:'BILI',description:'投稿、UP 主与合集',number:'01'},
    {id:'kuwo',name:'酷我音乐',short:'KUWO',description:'单曲、歌手与专辑',number:'02'},
    {id:'netease',name:'网易云音乐',short:'NETEASE',description:'单曲、歌手与歌单',number:'03'}
  ];
  const samples = [];
  const themes = [
    ['山间','山间来信','自然录音室','ambient'],['钢琴','雨落琴键','窗边钢琴社','piano'],
    ['人声','风里的独白','声音收藏馆','voice'],['爵士','慢半拍的周末','夜间爵士社','jazz'],
    ['雨','雨后第一束光','山雨工作室','rain'],['夜','夜行的微光','月下录音室','night']
  ];
  sources.forEach((source,s)=>themes.forEach(([keyword,title,artist,art],t)=>{
    samples.push({id:`${source.id}-${t}-track`,source:source.id,kind:'track',title:`${title}${s===0?' · 现场录音':s===1?' · 钢琴版':' · 夜间版本'}`,artist,keywords:[keyword,title,artist,'音乐','hifi',t<3?'hires':'',s===1?'钢琴':''].join(' '),art:`art/${art}.svg`,quality:t<3?'title':'unknown',duration:210+t*13+s*7});
    if(t<3)samples.push({id:`${source.id}-${t}-collection`,source:source.id,kind:'collection',title:`${title} · ${s===0?'合集':s===1?'专辑':'歌单'}`,artist,keywords:[keyword,title,artist,'音乐','hifi'].join(' '),art:`art/${art}.svg`,quality:'unknown',duration:0});
    if(t<2)samples.push({id:`${source.id}-${t}-person`,source:source.id,kind:'person',title:artist,artist:s===0?'UP 主':'歌手',keywords:[keyword,artist,'音乐'].join(' '),art:`art/${art}.svg`,quality:'unknown',duration:0});
  }));
  window.musicCatalog = {tracks,collections,sources,samples};
})();
