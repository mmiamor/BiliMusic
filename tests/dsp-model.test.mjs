import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDSP, patchDSP } from '../src/dsp-model.mjs';
import { parseApo, toApo, sanitizeFilter, eqResponse, eqMaxBoost } from '../src/dsp-math.mjs';
import { AudioEngine } from '../src/audio.mjs';

test('v1 migration preserves manual preamp, every EQ band and bypass without enabling new effects', () => {
  const bands=[-1,-1,-1,-2,-1,1,3,1.5,0,0];
  const s=normalizeDSP({enabled:false,preset:'vocal',preamp:-3.5,bands,limiter:false});
  assert.equal(s.enabled,false); assert.equal(s.autoPreamp,false); assert.equal(s.preamp,-3.5);
  assert.deepEqual(s.bands,bands); assert.equal(s.eq.enabled,true); assert.equal(s.eq.filters.length,10);
  assert.ok(s.eq.filters.every(f=>f.type==='PK'&&f.q===1.41&&f.on));
  assert.equal(s.crossfeed.enabled,false); assert.equal(s.matrix.width,1); assert.equal(s.limiter,false);
  assert.deepEqual(normalizeDSP(s),s);
});

test('deep patches retain unrelated parameters and explicit personal preset identity', () => {
  const s=normalizeDSP({version:2,eq:{enabled:true,filters:[{type:'PK',fc:700,gain:3,q:2,on:true}]},matrix:{width:1.6},crossfeed:{enabled:true,cutoff:900},limiterSettings:{ceiling:-2,release:150}});
  const n=patchDSP(s,{matrix:{mono:true},preset:'user:test'});
  assert.equal(n.preset,'user:test'); assert.equal(n.matrix.width,1.6); assert.equal(n.matrix.mono,true);
  assert.equal(n.crossfeed.cutoff,900); assert.equal(n.limiterSettings.release,150);
  assert.equal(patchDSP(n,{preamp:-3}).preset,'custom');
  assert.equal(patchDSP(n,{eq:{enabled:false}}).preset,'user:test');
  n.eq.filters[0].gain=10; assert.equal(s.eq.filters[0].gain,3);
});

test('DSP rejects malformed settings and clamps finite values without losing supported output modes', () => {
  const s=normalizeDSP({version:2,preamp:Infinity,eq:{enabled:true,filters:Array.from({length:30},()=>({type:'BAD',fc:Infinity,gain:100,q:-1}))},matrix:{width:4,balance:-9},output:{sampleRate:12345,latencyHint:'oops'}});
  assert.equal(s.preamp,0); assert.equal(s.eq.filters.length,24); assert.equal(s.eq.filters[0].type,'PK');
  assert.equal(s.eq.filters[0].gain,24); assert.equal(s.eq.filters[0].q,.1); assert.equal(s.matrix.width,2);
  assert.equal(s.matrix.balance,-1); assert.equal(s.output.sampleRate,0); assert.equal(s.output.latencyHint,'playback');
  assert.equal(normalizeDSP({output:{sampleRate:96000,latencyHint:'balanced'}}).output.sampleRate,96000);
  assert.equal(sanitizeFilter(null).fc,1000);
});

test('APO imports active and bypassed filters with preamp and shelf Q round-trip precision', () => {
  const text='Preamp: -3.25 dB\nFilter 1: ON PK Fc 1000 Hz Gain 3.5 dB Q 1.41\nFilter 2: OFF LS Fc 85 Hz Gain 4 dB Q 0.707107';
  const result=parseApo(text);
  assert.deepEqual(result.errors,[]); assert.equal(result.preamp,-3.25); assert.equal(result.filters[1].on,false);
  const again=parseApo(toApo(result.filters,result.preamp));
  assert.deepEqual(again,result);
});

test('APO invalid numeric values and unsupported processing cannot silently become a different EQ', () => {
  for(const text of ['Preamp: bananas dB','Filter 1: ON PK Fc 1000 Hz Gain 3 dB Q nope','Filter 1: ON PK Fc 1.2.3 Hz Gain 3 dB Q 1','Filter 1: ON PK Fc 1000 Hz Q 1','GraphicEQ: 20 3; 100 0','Include: other.txt']) assert.ok(parseApo(text).errors.length,text);
  assert.ok(parseApo('x'.repeat(131073)).errors.length);
});

test('response and auto-preamp ignore disabled filters and retain center-gain evidence', () => {
  const filters=[sanitizeFilter({fc:1000,gain:6,q:2}),sanitizeFilter({fc:1000,gain:12,q:1,on:false})];
  const curve=eqResponse(filters,48000,[1000]);
  assert.ok(Math.abs(curve.total[0]-6)<1e-8); assert.equal(curve.each.length,2);
  assert.ok(Math.abs(eqMaxBoost(filters,48000)-6)<1e-8);
});

test('saved audio state migrates without changing master volume and getter mutations do not leak', t => {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify({volume:.37,dsp:{enabled:false,preamp:-4,bands:[2,0,0,0,0,0,0,0,0,0],limiter:true}}),setItem(){}}});
  t.after(()=>previous?Object.defineProperty(globalThis,'localStorage',previous):delete globalThis.localStorage);
  const media=Object.assign(new EventTarget(),{setAttribute(){}}), engine=new AudioEngine(media);
  assert.equal(engine.volume,.37); assert.equal(engine.dsp.autoPreamp,false); assert.equal(engine.dsp.limiterSettings.ceiling,-1);
  const snapshot=engine.dsp; snapshot.eq.filters[0].gain=24; snapshot.matrix.width=2;
  assert.equal(engine.dsp.eq.filters[0].gain,2); assert.equal(engine.dsp.matrix.width,1);
  assert.equal(engine.dspStatus.worklet,'idle'); assert.equal(engine.getMeters().available,false);
});
