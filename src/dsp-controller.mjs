import { renderDSP, renderCurve, formatDSPValue, formatDSPMeter } from './dsp-view.mjs';
import { parseApo, toApo, sanitizeFilter, eqMaxBoost, EQ_LIMITS, FILTER_TYPES, CROSSFEED_PRESETS } from './dsp-math.mjs';
import { openDSPPresets } from './dsp-presets.mjs';

const get = (object, path) => path.split('.').reduce((v, key) => v?.[key], object);
const fields = new Set(['enabled','preset','preamp','autoPreamp','eq.enabled','crossfeed.enabled','crossfeed.cutoff','crossfeed.feed',
  'matrix.width','matrix.balance','matrix.mono','matrix.swap','matrix.invertL','matrix.invertR','limiter','limiterSettings.ceiling','limiterSettings.release',
  'output.sampleRate','output.latencyHint','output.sinkId','meterTap']);
const numeric = new Set(['preamp','crossfeed.cutoff','crossfeed.feed','matrix.width','matrix.balance','limiterSettings.ceiling','limiterSettings.release','output.sampleRate']);
const patchFor = (path, value) => path.includes('.') ? { [path.split('.')[0]]: { [path.split('.')[1]]: value } } : { [path]: value };

export class DSPController {
  constructor({engine,storage,helpers,onChange,notify}) {
    Object.assign(this,{engine,helpers,onChange,notify});
    this.presets = openDSPPresets(storage);
    this.tab = 'eq'; this.devices = []; this.ui = {}; this.drag = null; this.timer = null; this.undo = null;
  }
  name() { return this.presets.get(this.engine.dsp.preset)?.name; }
  view() {
    return renderDSP({dsp:this.engine.dsp,tab:this.tab,status:this.engine.dspStatus,meters:this.engine.getMeters(),
      presets:this.presets.list(),devices:this.devices,ui:this.ui},this.helpers);
  }
  changed(render = true) { this.onChange(render); }
  feedback(message, error = false) { Object.assign(this.ui,{message,error}); this.changed(); }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const root = document.querySelector('.dsp-console');
      if (!root || !root.closest('dialog')?.open) { clearInterval(this.timer); this.timer=null; return; }
      const meters = this.engine.getMeters();
      for(const element of root.querySelectorAll('[data-dsp-meter]')) element.textContent=formatDSPMeter(element.dataset.dspMeter,meters);
      const status = this.engine.dspStatus;
      const signature = JSON.stringify([status.worklet,status.sampleRate,status.sinkError,status.contextError]);
      if (signature !== this.statusSignature && !this.drag && !root.contains(document.activeElement)) { this.statusSignature=signature; this.changed(); }
    },250);
  }
  syncCurve() {
    const root=document.querySelector('.dsp-console'); if(!root)return;
    const dsp=this.engine.dsp,status=this.engine.dspStatus;
    const svg=root.querySelector('[data-dsp-curve]'); if(svg)svg.outerHTML=renderCurve(dsp,status);
    for(const el of root.querySelectorAll('[data-dsp-value]')) {
      const key=el.dataset.dspValue;
      const value=key==='maxBoost'?status.maxBoost:key==='preamp'&&dsp.autoPreamp?status.preampDb:get(dsp,key);
      el.textContent=formatDSPValue(key,value);
    }
    const preamp=root.querySelector('[data-dsp-field="preamp"]');
    if(preamp&&dsp.autoPreamp&&Number.isFinite(status.preampDb))preamp.value=status.preampDb;
    const preset=root.querySelector('[data-dsp-field="preset"]');
    if(preset && dsp.preset==='custom') {
      if(!preset.querySelector('[value="custom"]'))preset.add(new Option('自定义','custom'));
      preset.value='custom';
    }
  }
  setFilters(filters, extra={}) {
    this.undo=null; this.ui.canUndo=false;
    this.engine.setDSP({preset:'custom',eq:{filters:filters.map(sanitizeFilter),...extra}});
  }
  input(el) {
    if(el.matches('[data-dsp-preset-name]')) { this.ui.presetName=el.value; return true; }
    if(el.matches('[data-dsp-import-text]')) { this.ui.importText=el.value; return true; }
    if(el.matches('[data-dsp-filter]')) {
      if(el.type==='checkbox'||el.tagName==='SELECT')return true;
      if(el.value===''||!Number.isFinite(Number(el.value)))return true;
      this.editFilter(el);this.syncCurve();return true;
    }
    if(el.matches('input[type="range"][data-dsp-field]')) {
      const key=el.dataset.dspField;
      if(!numeric.has(key)||!Number.isFinite(Number(el.value)))return true;
      this.engine.setDSP(patchFor(key,Number(el.value)));this.syncCurve();return true;
    }
    return false;
  }
  editFilter(el) {
    const i=Number(el.dataset.dspFilter),key=el.dataset.filterField,filters=this.engine.dsp.eq.filters;
    if(!filters[i]||!['on','type','fc','gain','q'].includes(key))return;
    const value=key==='on'?el.checked:key==='type'?el.value:Number(el.value);
    if(['fc','gain','q'].includes(key)&&(el.value===''||!Number.isFinite(value)))return;
    filters[i]={...filters[i],[key]:value};this.setFilters(filters);
  }
  async change(el) {
    try {
      if(el.matches('[data-dsp-filter]')) {this.editFilter(el);this.changed();return true;}
      if(!el.matches('[data-dsp-field]'))return false;
      const key=el.dataset.dspField;if(!fields.has(key))return true;
      const value=el.type==='checkbox'?el.checked:numeric.has(key)?Number(el.value):el.value;
      if(numeric.has(key)&&(!Number.isFinite(value)||el.value==='')) {this.changed();return true;}
      if(key==='preset') {
        const saved=this.presets.get(value);
        if(saved)this.engine.setDSP({enabled:true,preset:saved.id,preamp:saved.preamp,autoPreamp:saved.autoPreamp,eq:{enabled:true,filters:saved.filters}});
        else this.engine.applyPreset(value);
        this.undo=null;this.ui.canUndo=false;
      } else if(key==='output.sinkId') {
        await this.engine.setOutputDevice(value);
      } else this.engine.setDSP(patchFor(key,value));
      if(['output.sampleRate','output.latencyHint'].includes(key))this.ui.message='输出设置已保存，下次加载应用时生效。';
      this.ui.error=false;this.changed();return true;
    } catch(error) {this.feedback(error.message||'无法保存 DSP 设置。',true);return true;}
  }
  async command(action,value) {
    try {
      this.ui.message='';this.ui.error=false;
      switch(action) {
        case 'dsp-tab':
          if(['overview','eq','fx','output'].includes(value))this.tab=value;
          this.changed();this.start();return;
        case 'dsp-save-open':this.ui.saveOpen=true;break;
        case 'dsp-save-cancel':this.ui.saveOpen=false;break;
        case 'dsp-save-confirm':{
          const item=this.presets.save(this.ui.presetName,this.engine.dsp);
          this.engine.setDSP({preset:item.id});this.ui.saveOpen=false;this.ui.presetName='';this.ui.message='已保存个人预设。';break;
        }
        case 'dsp-preset-delete':
          if(!this.presets.get(value))return;
          this.presets.remove(value);this.engine.setDSP({preset:'custom'});this.ui.message='已移除预设，当前音效参数仍保留。';break;
        case 'dsp-filter-add': {
          const filters=this.engine.dsp.eq.filters;
          if(filters.length>=EQ_LIMITS.maxFilters)throw Error('最多添加 24 个滤波器。');
          this.setFilters([...filters,{type:'PK',fc:1000,gain:0,q:1.41,on:true}],{enabled:true});break;
        }
        case 'dsp-filter-delete':this.setFilters(this.engine.dsp.eq.filters.filter((_,i)=>i!==Number(value)));break;
        case 'dsp-filter-clear':
          this.undo=this.engine.dsp.eq.filters;this.engine.setDSP({preset:'custom',eq:{filters:[]}});this.ui.canUndo=true;this.ui.message='已清空滤波器，可以撤销。';break;
        case 'dsp-filter-undo':
          if(this.undo)this.engine.setDSP({preset:'custom',eq:{filters:this.undo}});
          this.undo=null;this.ui.canUndo=false;break;
        case 'dsp-crossfeed-preset':{
          const preset=CROSSFEED_PRESETS[value];if(preset)this.engine.setDSP({crossfeed:{...preset,enabled:true}});break;
        }
        case 'dsp-import-open':this.ui.importOpen=true;break;
        case 'dsp-import-cancel':this.ui.importOpen=false;break;
        case 'dsp-import-file':this.importFile();return;
        case 'dsp-import-apply':{
          const text=this.ui.importText||'';
          if(text.length>131072)throw Error('文件内容过大，最多导入 128 KB。');
          const result=parseApo(text);
          if(result.errors.length)throw Error(result.errors.join('；'));
          if(!result.filters.length)throw Error('没有找到可用滤波器，请导入 ParametricEQ.txt 参数格式。');
          this.setFilters(result.filters,{enabled:true});
          this.engine.setDSP({enabled:true,...(result.preamp==null?{}:{preamp:result.preamp,autoPreamp:false})});
          this.ui.importOpen=false;this.ui.message=`已导入 ${result.filters.length} 个滤波器。`;break;
        }
        case 'dsp-export':
          this.ui.exportText=toApo(this.engine.dsp.eq.filters,this.engine.dsp.autoPreamp
            ? (this.engine.dspStatus.preampDb ?? (this.engine.dsp.eq.enabled ? -eqMaxBoost(this.engine.dsp.eq.filters,this.engine.dsp.output.sampleRate || 48000) : 0)) : this.engine.dsp.preamp);
          this.ui.exportOpen=true;break;
        case 'dsp-export-close':this.ui.exportOpen=false;break;
        case 'dsp-export-download':{
          const url=URL.createObjectURL(new Blob([this.ui.exportText||''],{type:'text/plain;charset=utf-8'}));
          const anchor=document.createElement('a');anchor.href=url;anchor.download='BiliMusic-ParametricEQ.txt';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);return;
        }
        case 'dsp-output-refresh':
          this.ui.devicesLoading=true;this.changed();
          try{this.devices=await this.engine.listOutputDevices();this.ui.deviceError='';}catch(error){this.ui.deviceError=error.message;}
          finally{this.ui.devicesLoading=false;}break;
        case 'dsp-output-apply':location.reload();return;
        case 'dsp-meter-reset':this.engine.resetMeters();break;
        default:return;
      }
      this.changed();
    }catch(error){this.feedback(error.message||'操作未完成，请重试。',true);}
  }
  importFile() {
    const picker=document.createElement('input');picker.type='file';picker.accept='.txt,text/plain';
    picker.addEventListener('change',async()=>{
      try{const file=picker.files?.[0];if(!file)return;if(file.size>131072)throw Error('文件过大，最多导入 128 KB。');
        this.ui.importText=await file.text();this.ui.importOpen=true;this.changed();
      }catch(error){this.feedback(error.message,true);}finally{picker.remove();}
    },{once:true});picker.click();
  }
  curvePosition(event,svg) {
    const r=svg.getBoundingClientRect(),x=(event.clientX-r.left)/r.width*640,y=(event.clientY-r.top)/r.height*232;
    return {fc:Math.round(20*1000**Math.max(0,Math.min(1,(x-46)/578))),gain:Math.round(Math.max(-24,Math.min(24,24-(y-18)/174*48))*10)/10};
  }
  pointerDown(event) {
    const point=event.target.closest?.('[data-dsp-point]');if(!point||event.button!==0)return;
    const svg=point.closest('[data-dsp-curve]'),root=point.closest('.dsp-console');
    this.drag={index:Number(point.dataset.dspPoint),rect:svg.getBoundingClientRect(),root,id:event.pointerId};root.setPointerCapture(event.pointerId);event.preventDefault();
  }
  pointerMove(event) {
    if(!this.drag||event.pointerId!==this.drag.id)return;
    const filters=this.engine.dsp.eq.filters,f=filters[this.drag.index];if(!f)return;
    const pos=this.curvePosition(event,{getBoundingClientRect:()=>this.drag.rect});
    filters[this.drag.index]={...f,fc:pos.fc,...(FILTER_TYPES[f.type].gain?{gain:pos.gain}:{})};this.setFilters(filters);this.syncCurve();
    const root=this.drag.root;
    for(const el of root.querySelectorAll('[data-dsp-filter]'))if(Number(el.dataset.dspFilter)===this.drag.index&&['fc','gain'].includes(el.dataset.filterField))el.value=filters[this.drag.index][el.dataset.filterField];
  }
  pointerUp(event) {
    if(!this.drag||event.pointerId!==this.drag.id)return;
    this.drag=null;this.changed();
  }
  curveDoubleClick(event) {
    const svg=event.target.closest?.('[data-dsp-curve]');if(!svg||event.target.closest('[data-dsp-point]'))return;
    const filters=this.engine.dsp.eq.filters;if(filters.length>=EQ_LIMITS.maxFilters)return;
    this.setFilters([...filters,{type:'PK',q:1.41,on:true,...this.curvePosition(event,svg)}],{enabled:true});this.changed();
  }
  curveWheel(event) {
    const point=event.target.closest?.('[data-dsp-point]');if(!point)return;
    event.preventDefault();const filters=this.engine.dsp.eq.filters,i=Number(point.dataset.dspPoint);if(!filters[i])return;
    filters[i]={...filters[i],q:Math.max(.1,Math.min(24,Math.round((filters[i].q+(event.deltaY<0?.1:-.1))*100)/100))};this.setFilters(filters);this.changed();
  }
}
