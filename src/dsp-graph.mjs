import { FILTER_TYPES, SHELF_Q, biquadCoeffs, eqMaxBoost } from './dsp-math.mjs';

const dbToGain = db => 10 ** (db / 20);
const gainToDb = gain => gain > 0 ? 20 * Math.log10(gain) : -Infinity;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const biquadType = { PK: 'peaking', LSC: 'lowshelf', HSC: 'highshelf', LPQ: 'lowpass', HPQ: 'highpass', NO: 'notch', BP: 'bandpass' };
const activeFilter = f => f.on && (!FILTER_TYPES[f.type].gain || Math.abs(f.gain) > 0.001);
const usesBiquad = f => !['LSC','HSC'].includes(f.type) || Math.abs(f.q - SHELF_Q) < 0.00001;
const signature = f => usesBiquad(f) ? 'biquad:' + f.type : `iir:${f.type}:${f.fc}:${f.gain}:${f.q}`;
function smooth(param, value, now) {
  if (Math.abs(param.value - value) < 1e-9) return;
  param.cancelScheduledValues(now);
  if (now === 0) param.setValueAtTime(value, now);
  else param.setTargetAtTime(value, now, 0.012);
}
function stereoGain(ctx, gain = 1) {
  const node = ctx.createGain();
  node.channelCount = 2; node.channelCountMode = 'explicit'; node.channelInterpretation = 'speakers';
  node.gain.value = gain;
  return node;
}
function makeFilter(ctx, f) {
  let node;
  if (usesBiquad(f)) {
    node = ctx.createBiquadFilter();
    node.type = biquadType[f.type];
    updateFilter(node, f, ctx, true);
  } else {
    const c = biquadCoeffs(f, ctx.sampleRate);
    node = ctx.createIIRFilter([c.b0, c.b1, c.b2], [1, c.a1, c.a2]);
  }
  node.__signature = signature(f);
  return node;
}
function updateFilter(node, f, ctx, initial = false) {
  const values = { frequency: Math.min(f.fc, ctx.sampleRate * 0.4995), gain: f.gain, Q: ['LPQ','HPQ'].includes(f.type) ? 20 * Math.log10(f.q) : f.q };
  for (const [key, value] of Object.entries(values)) {
    if (initial) node[key].value = value;
    else smooth(node[key], value, ctx.currentTime);
  }
}

export function matrixCoeffs(m) {
  const w = m.mono ? 0 : clamp(m.width, 0, 2);
  let ll = (1+w)/2, rl = (1-w)/2, lr = (1-w)/2, rr = (1+w)/2;
  if (m.swap) [ll, rl, lr, rr] = [lr, rr, ll, rl];
  const b = clamp(m.balance, -1, 1), gl = (b > 0 ? 1-b : 1) * (m.invertL ? -1 : 1), gr = (b < 0 ? 1+b : 1) * (m.invertR ? -1 : 1);
  return { ll: ll*gl, rl: rl*gl, lr: lr*gr, rr: rr*gr };
}
const matrixIsIdentity = m => !m.mono && !m.swap && !m.invertL && !m.invertR && Math.abs(m.width-1)<1e-6 && Math.abs(m.balance)<1e-6;
function makeMatrix(ctx) {
  const input = stereoGain(ctx), output = stereoGain(ctx), split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const gains = {};
  input.connect(split);
  for (const [key, from, to] of [['ll',0,0],['lr',0,1],['rl',1,0],['rr',1,1]]) {
    const node = gains[key] = ctx.createGain();
    split.connect(node,from); node.connect(merge,0,to);
  }
  merge.connect(output);
  return { input, output, set(m) { const c = matrixCoeffs(m); for (const key of Object.keys(gains)) smooth(gains[key].gain,c[key],ctx.currentTime); } };
}
function makeCrossfeed(ctx) {
  const input = stereoGain(ctx), output = stereoGain(ctx), split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  input.connect(split);
  const sides = [0,1].map(c => {
    const direct = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), delay = ctx.createDelay(.01), gain = ctx.createGain();
    direct.type = 'lowshelf'; lp.type = 'lowpass'; lp.Q.value = 20*Math.log10(.5); delay.delayTime.value=.00027;
    split.connect(direct,c); direct.connect(merge,0,c);
    split.connect(lp,c); lp.connect(delay); delay.connect(gain); gain.connect(merge,0,1-c);
    return { direct, lp, gain };
  });
  merge.connect(output);
  return { input, output, set(cf) {
    const r = dbToGain(-cf.feed), now=ctx.currentTime;
    for (const side of sides) {
      smooth(side.direct.frequency,cf.cutoff,now); smooth(side.direct.gain,gainToDb(1/(1+r)),now);
      smooth(side.lp.frequency,cf.cutoff,now); smooth(side.gain.gain,r/(1+r),now);
    }
  } };
}
function makeFallbackLimiter(ctx) {
  const input = ctx.createDynamicsCompressor(), output = stereoGain(ctx);
  input.threshold.value=-1; input.knee.value=0; input.ratio.value=20; input.attack.value=.001; input.release.value=.08;
  input.connect(output);
  return { input, output, set(l) {
    input.threshold.value=l.ceiling; input.release.value=l.release/1000;
    output.gain.value=dbToGain(.6*l.ceiling*(1-1/20));
  }, reduction:()=>Math.max(0,-input.reduction) };
}

const lufs = p => p > 0 ? -.691+10*Math.log10(p) : null;
const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
export function createMeterState() {
  let last, blocks, shorts, sub, count, clips, tpMax, momentary, shortTerm, integrated, lra;
  const reset = () => { last=null; blocks=[]; shorts=[]; sub=[]; count=0; clips=0; tpMax=0; momentary=shortTerm=integrated=lra=null; };
  reset();
  return {
    reset,
    push(d) {
      last=d; clips+=d.clip||0; if(d.tp) tpMax=Math.max(tpMax,...d.tp);
      if(!d.ms) return;
      sub.push(d.ms[0]+d.ms[1]); if(sub.length>60) sub.shift(); count++;
      if(sub.length>=8) momentary=lufs(mean(sub.slice(-8)));
      if(sub.length>=60) shortTerm=lufs(mean(sub));
      if(count%2===0&&sub.length>=8) { const p=mean(sub.slice(-8)); if(lufs(p)>-70) blocks.push(p); }
      if(count%20===0&&sub.length>=60&&shortTerm>-70) shorts.push(shortTerm);
      if(count%20===0) {
        if(blocks.length) { const threshold=mean(blocks)/10; integrated=lufs(mean(blocks.filter(p=>p>=threshold))); }
        if(shorts.length>=3) {
          const relative=lufs(mean(shorts.map(x=>10**((x+.691)/10))))-20;
          const gated=shorts.filter(x=>x>=relative).sort((a,b)=>a-b);
          if(gated.length>=2) lra=gated[Math.round(.95*(gated.length-1))]-gated[Math.round(.1*(gated.length-1))];
        }
      }
    },
    snapshot() { return { available:!!last, peak:last?.peak?.slice()||null, rms:last?.rms?.slice()||null, tp:last?.tp?.slice()||null,
      corr:last?.corr??null, clips, momentary, shortTerm, integrated, lra, tpMax:last?.tp?tpMax:null }; }
  };
}

/** Same graph factory for the player and OfflineAudioContext verification. */
export function createDSPGraph(context, input, { destination = context.destination, loadWorklet = true, onStatus = () => {} } = {}) {
  const preamp=stereoGain(context), master=stereoGain(context), cf=makeCrossfeed(context), mx=makeMatrix(context), fallback=makeFallbackLimiter(context);
  const measure=stereoGain(context), silent=stereoGain(context,0), meterState=createMeterState();
  const split=context.createChannelSplitter(2), analysers=[context.createAnalyser(),context.createAnalyser()];
  measure.connect(split); analysers.forEach((n,i)=>{ n.fftSize=2048; split.connect(n,i); });
  master.connect(destination); silent.connect(destination);
  let eqNodes=[], edges=[], dsp=null, volume=1, limiter=fallback, worklet=loadWorklet?'pending':'fallback', workletError='', limiterGr=0, meterNode;
  let maxBoost=0, preampDb=0, chain=[], lastFallbackTime=-Infinity, meterEpoch=0, disposed=false;
  const graph = {
    apply(next, nextVolume=volume) {
      dsp=next; volume=nextVolume;
      maxBoost=dsp.eq.enabled?eqMaxBoost(dsp.eq.filters,context.sampleRate):0;
      preampDb=dsp.eq.enabled?(dsp.autoPreamp?-maxBoost:dsp.preamp):0;
      smooth(preamp.gain,dbToGain(preampDb),context.currentTime); smooth(master.gain,volume,context.currentTime);
      eqNodes=(dsp.eq.enabled?dsp.eq.filters.filter(activeFilter):[]).map((f,i)=>{
        const old=eqNodes[i];
        if(old?.__signature===signature(f)) { if(usesBiquad(f)) updateFilter(old,f,context); return old; }
        return makeFilter(context,f);
      });
      cf.set(dsp.crossfeed); mx.set(dsp.matrix); fallback.set(dsp.limiterSettings);
      if(limiter.worklet) limiter.worklet.port.postMessage({ceiling:dbToGain(dsp.limiterSettings.ceiling),releaseMs:dsp.limiterSettings.release});
      const stages=[]; chain=[];
      if(dsp.enabled) {
        if(Math.abs(preampDb)>1e-6) { stages.push({input:preamp,output:preamp}); chain.push('前级'); }
        stages.push(...eqNodes.map(n=>({input:n,output:n}))); if(eqNodes.length) chain.push('参数 EQ × '+eqNodes.length);
        if(dsp.crossfeed.enabled) { stages.push(cf); chain.push('Crossfeed'); }
        if(!matrixIsIdentity(dsp.matrix)) { stages.push(mx); chain.push('声道矩阵'); }
        if(dsp.limiter) { stages.push(limiter); chain.push(worklet==='ready'?'前视限幅':'兼容限幅'); }
      }
      chain.push('音量');
      const nextEdges=[]; let previous=input;
      for(const stage of stages) { nextEdges.push([previous,stage.input]); previous=stage.output; }
      nextEdges.push([previous,master],[dsp.meterTap==='pre'?input:master,measure]);
      const has=(list,e)=>list.some(x=>x[0]===e[0]&&x[1]===e[1]);
      for(const e of edges) if(!has(nextEdges,e)) { try{e[0].disconnect(e[1]);}catch{} }
      for(const e of nextEdges) if(!has(edges,e)) e[0].connect(e[1]);
      edges=nextEdges;
    },
    get status() { return { worklet, workletError, sampleRate:context.sampleRate, baseLatency:context.baseLatency??null, outputLatency:context.outputLatency??null, preampDb:dsp?.enabled?preampDb:0, maxBoost, chain:[...chain], contextState:context.state }; },
    getMeters() {
      if(worklet!=='ready'&&context.currentTime-lastFallbackTime>.04) {
        lastFallbackTime=context.currentTime;
        const waves=analysers.map(a=>{const data=new Float32Array(a.fftSize);a.getFloatTimeDomainData(data);return data;});
        const peak=waves.map(x=>x.reduce((p,n)=>Math.max(p,Math.abs(n)),0)), rms=waves.map(x=>Math.sqrt(x.reduce((sum,n)=>sum+n*n,0)/x.length));
        meterState.push({peak,rms,tp:null,corr:null,clip:0,ms:null});
      }
      return {...meterState.snapshot(), limiterReduction:dsp?.enabled&&dsp?.limiter?(worklet==='ready'?limiterGr:fallback.reduction()):0};
    },
    resetMeters() { meterState.reset(); meterNode?.port.postMessage({reset:true,epoch:++meterEpoch}); },
    dispose() { disposed=true; for(const e of edges) { try{e[0].disconnect(e[1]);}catch{} } master.disconnect(); measure.disconnect(); silent.disconnect(); limiter.worklet?.port.close(); meterNode?.port.close(); },
  };
  graph.ready=(async()=>{
    if(!loadWorklet) return;
    try {
      if(!context.audioWorklet||!globalThis.AudioWorkletNode) throw Error('AudioWorklet 不可用');
      await context.audioWorklet.addModule(new URL('./dsp-worklet.js',import.meta.url).href);
      if(disposed) return;
      const options={channelCount:2,channelCountMode:'explicit',channelInterpretation:'speakers',numberOfInputs:1,numberOfOutputs:1};
      const node=new AudioWorkletNode(context,'bilimusic-limiter',{...options,outputChannelCount:[2],processorOptions:{ceiling:dbToGain(dsp?.limiterSettings.ceiling??-.1),releaseMs:dsp?.limiterSettings.release??80}});
      node.port.onmessage=e=>{limiterGr=Math.max(0,-gainToDb(e.data.gr));};
      meterNode=new AudioWorkletNode(context,'bilimusic-meter',{...options,outputChannelCount:[1]});
      meterNode.port.onmessage=e=>{if((e.data.epoch||0)===meterEpoch)meterState.push(e.data);};
      measure.connect(meterNode); meterNode.connect(silent);
      limiter={input:node,output:node,worklet:node}; worklet='ready';
      const failed=()=>{
        if(disposed) return;
        worklet='fallback'; workletError='音频处理器发生错误，已改用兼容限幅与采样峰值表。'; limiter=fallback;
        try { measure.disconnect(meterNode); meterNode.disconnect(); } catch {}
        meterState.reset();
        if(dsp) graph.apply(dsp,volume);
        onStatus(graph.status);
      };
      node.onprocessorerror=failed; meterNode.onprocessorerror=failed;
    } catch(error) { worklet='fallback'; workletError=error?.message||'AudioWorklet 无法加载'; }
    if(!disposed) { if(dsp) graph.apply(dsp,volume); onStatus(graph.status); }
  })();
  return graph;
}
