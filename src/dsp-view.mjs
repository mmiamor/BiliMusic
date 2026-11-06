import { DSP_PRESETS } from './audio.mjs';
import { CURVE_FREQS, CROSSFEED_PRESETS, EQ_LIMITS, FILTER_TYPES, eqResponse, sanitizeFilter } from './dsp-math.mjs';

const finite = (value, fallback = 0) => value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const signed = value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

export function formatDSPValue(path, value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (path === 'matrix.width') return `${Math.round(n * 100)}%`;
  if (path === 'matrix.balance') return Math.abs(n) < .015 ? '居中' : `${n < 0 ? '左' : '右'} ${Math.round(Math.abs(n) * 100)}%`;
  if (path === 'crossfeed.cutoff') return `${Math.round(n)} Hz`;
  if (path === 'limiterSettings.release') return `${Math.round(n)} ms`;
  if (path === 'limiterSettings.ceiling') return `${signed(n)} dBFS`;
  if (path === 'crossfeed.feed') return `${n.toFixed(1)} dB`;
  return `${signed(n)} dB`;
}

export function formatDSPMeter(name, meters = {}) {
  if (!meters.available) return '—';
  const [key, index] = name.split('.');
  const value = index === undefined ? meters[key] : meters[key]?.[Number(index)];
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (key === 'peak' || key === 'rms' || key === 'tpMax') {
    return `${n > 0 ? (20 * Math.log10(n)).toFixed(1) : '−∞'} ${key === 'tpMax' ? 'dBTP' : 'dBFS'}`;
  }
  if (key === 'clips') return String(Math.max(0, Math.round(n)));
  if (key === 'corr') return n.toFixed(2);
  if (key === 'limiterReduction') return `${n.toFixed(1)} dB`;
  return `${n.toFixed(1)} ${key === 'lra' ? 'LU' : 'LUFS'}`;
}

/** Static EQ preview. Coordinates form the pointer interaction contract. */
export function renderCurve(dsp = {}, status = {}) {
  const filters = (dsp.eq?.filters || []).slice(0, EQ_LIMITS.maxFilters).map(sanitizeFilter);
  const fs = finite(status.sampleRate, 48000) || 48000;
  const response = eqResponse(filters, fs);
  const x = hz => 46 + Math.log(clamp(hz, 20, 20000) / 20) / Math.log(1000) * 578;
  const y = db => 18 + (24 - clamp(finite(db), -24, 24)) / 48 * 174;
  const line = (values, offset = 0) => Array.from(values, (value, index) => `${index ? 'L' : 'M'}${x(CURVE_FREQS[index]).toFixed(2)},${y(value + offset).toFixed(2)}`).join(' ');
  const enabled = dsp.enabled !== false && dsp.eq?.enabled === true;
  const preamp = finite(status.preampDb, dsp.autoPreamp ? 0 : finite(dsp.preamp));
  const gridX = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(hz => `<line x1="${x(hz)}" x2="${x(hz)}" y1="18" y2="192"/>`).join('');
  const gridY = [-24, -12, 0, 12, 24].map(db => `<line class="${db === 0 ? 'dsp-zero' : ''}" x1="46" x2="624" y1="${y(db)}" y2="${y(db)}"/><text x="36" y="${y(db) + 4}" text-anchor="end">${db > 0 ? '+' : ''}${db}</text>`).join('');
  const ticks = [[20,'20'],[100,'100'],[1000,'1k'],[10000,'10k'],[20000,'20k']].map(([hz,label]) => `<text x="${x(hz)}" y="212" text-anchor="${hz === 20 ? 'start' : hz === 20000 ? 'end' : 'middle'}">${label}</text>`).join('');
  return `<svg data-dsp-curve viewBox="0 0 640 232" preserveAspectRatio="none" class="dsp-curve ${enabled ? '' : 'is-bypassed'}" aria-label="均衡器频率响应。可拖动节点调整频率和增益，也可使用下方参数输入。">
    <g class="dsp-curve-grid">${gridX}${gridY}${ticks}<text x="624" y="229" text-anchor="end">Hz</text><text x="12" y="12">dB</text></g>
    <g class="dsp-filter-curves">${response.each.map((values,i) => filters[i].on ? `<path d="${line(values)}"/>` : '').join('')}</g>
    ${enabled && Math.abs(preamp) > .05 ? `<path class="dsp-response-effective" d="${line(response.total, preamp)}"/>` : ''}
    <path class="dsp-response-total" d="${line(response.total)}"/>
    ${filters.map((filter,i) => { const cx = x(filter.fc), cy = y(FILTER_TYPES[filter.type].gain ? filter.gain : 0); return `<g class="dsp-curve-node ${filter.on ? '' : 'is-off'}"><circle class="dsp-point-target" data-dsp-point="${i}" cx="${cx}" cy="${cy}" r="20"/><circle class="dsp-point-dot" cx="${cx}" cy="${cy}" r="8"/><text x="${cx}" y="${cy + 3.7}" text-anchor="middle">${i + 1}</text></g>`; }).join('')}
  </svg>`;
}

export function renderDSP(
  { dsp = {}, tab = 'eq', status = {}, meters = {}, presets = [], devices = [], ui = {} } = {},
  { icon, esc, action },
) {
  const currentTab = ['overview','eq','fx','output'].includes(tab) ? tab : 'eq';
  const filters = (dsp.eq?.filters || []).slice(0, EQ_LIMITS.maxFilters).map(sanitizeFilter);
  const customPresets = presets.filter(item => item && typeof item.id === 'string' && !DSP_PRESETS.some(preset => preset.id === item.id));
  const currentPreset = [...DSP_PRESETS, ...customPresets].find(item => item.id === dsp.preset);
  const button = (label, name, value = '', kind = '', disabled = false, accessibleLabel = '') => `<button type="button" class="dsp-button ${kind}" ${action(name,value)} ${disabled ? 'disabled' : ''} ${accessibleLabel ? `aria-label="${esc(accessibleLabel)}"` : ''}>${label}</button>`;
  const field = path => `data-dsp-field="${esc(path)}"`;
  const toggle = (path, label, checked, description = '') => `<label class="dsp-toggle-row"><span><strong>${esc(label)}</strong>${description ? `<small>${esc(description)}</small>` : ''}</span><span class="dsp-toggle"><input type="checkbox" role="switch" ${field(path)} aria-label="${esc(label)}" ${checked ? 'checked' : ''}><i aria-hidden="true"></i></span></label>`;
  const range = (path, label, value, min, max, step, disabled = false) => `<label class="dsp-slider-row"><span class="dsp-control-label">${esc(label)}<output data-dsp-value="${esc(path)}">${esc(formatDSPValue(path,value))}</output></span><input type="range" ${field(path)} min="${min}" max="${max}" step="${step}" value="${finite(value,min)}" ${disabled ? 'disabled' : ''} aria-label="${esc(label)}"></label>`;
  const select = (path, label, options, value, hint = '', disabled = false) => `<label class="dsp-select-row"><span><strong>${esc(label)}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</span><select ${field(path)} aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}>${options.map(([key,title]) => `<option value="${esc(key)}" ${String(key) === String(value) ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
  const card = (title, body, extra = '') => `<section class="dsp-card ${extra}"><h3>${esc(title)}</h3>${body}</section>`;
  const stat = (label, name) => `<div class="dsp-metric"><span>${esc(label)}</span><strong data-dsp-meter="${esc(name)}">${esc(formatDSPMeter(name,meters))}</strong></div>`;
  const note = text => `<p class="dsp-note">${esc(text)}</p>`;
  const tabs = [['overview','概览'],['eq','均衡器'],['fx','效果'],['output','输出']];
  const worklet = {ready:'AudioWorklet 已就绪',fallback:'兼容处理模式',pending:'正在准备音频处理',idle:'播放后启用音频处理'}[status.worklet] || '播放后启用音频处理';
  let body = '';

  if (currentTab === 'overview') {
    const chain = Array.isArray(status.chain) ? status.chain.filter(value => typeof value === 'string') : [];
    body = card('当前处理', `<div class="dsp-engine-status"><strong>${dsp.enabled === false ? '音效已旁通' : 'DSP 已开启'}</strong><span>${esc(worklet)}</span></div>${note(dsp.enabled === false ? '已旁通音效，保留播放器音量。' : '已开启的处理会按信号链顺序生效。')}<ol class="dsp-signal-chain">${chain.length ? chain.map((stage,i) => `<li><span>${i + 1}</span>${esc(stage)}</li>`).join('') : '<li class="dsp-chain-empty">播放后显示当前处理链路</li>'}</ol>`)
      + `<div class="dsp-overview-grid">${card('输出电平', `${select('meterTap','计量位置',[['post','最终输出'],['pre','DSP 之前']],dsp.meterTap || 'post')}<div class="dsp-metrics">${stat('左声道峰值','peak.0')}${stat('右声道峰值','peak.1')}${stat('左声道 RMS','rms.0')}${stat('右声道 RMS','rms.1')}${stat('声道相关度','corr')}${stat('削波样本','clips')}</div>`)}${card('响度', `<div class="dsp-metrics">${stat('瞬时响度','momentary')}${stat('短期响度','shortTerm')}${stat('整合响度','integrated')}${stat('响度范围','lra')}${stat('真峰值估计','tpMax')}${stat('限幅衰减','limiterReduction')}</div>${button('清零本曲统计','dsp-meter-reset','', '',!meters.available)}${note('未取得的读数显示为“—”。真峰值为测量估计，不代表声卡输出规格。')}`)}</div>`;
  }

  if (currentTab === 'eq') {
    const presetSelect = `<label class="dsp-preset-select"><span>预设</span><select ${field('preset')} aria-label="均衡器预设">${!currentPreset ? '<option value="custom" selected>自定义</option>' : ''}<optgroup label="内置预设">${DSP_PRESETS.map(item => `<option value="${esc(item.id)}" ${item.id === dsp.preset ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>${customPresets.length ? `<optgroup label="我的预设">${customPresets.map(item => `<option value="${esc(item.id)}" ${item.id === dsp.preset ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>` : ''}</select></label>`;
    const presetTools = `<div class="dsp-preset-tools">${presetSelect}${button('另存为','dsp-save-open')}${customPresets.some(item => item.id === dsp.preset) ? button('删除预设','dsp-preset-delete',dsp.preset,'dsp-danger') : ''}</div>`;
    const save = ui.saveOpen ? `<section class="dsp-inline-panel" aria-label="保存预设"><label>预设名称<input type="text" data-dsp-preset-name maxlength="60" value="${esc(ui.presetName || '')}" placeholder="为这组设置命名" autocomplete="off"></label><div class="dsp-actions">${button('取消','dsp-save-cancel')}${button('保存预设','dsp-save-confirm','','dsp-primary')}</div></section>` : '';
    const curve = `<section class="dsp-card dsp-curve-card"><div class="dsp-section-header"><h3>频率响应</h3><span>${dsp.eq?.enabled ? `${filters.filter(f => f.on).length} 段已启用` : '均衡器已旁通'}</span></div>${renderCurve(dsp,status)}<div class="dsp-curve-legend"><span><i></i>EQ 设定</span><span><i class="is-dashed"></i>含前级增益</span></div>${note(status.sampleRate ? '拖动节点调节频率和增益；滚轮调节 Q。也可在下方输入精确参数。' : '尚未播放，曲线按 48 kHz 预览。可在下方输入精确参数。')}</section>`;
    const preamp = card('前级', toggle('autoPreamp','自动防削波',dsp.autoPreamp !== false,'根据均衡器最大提升量自动降低前级，预留信号余量。') + range('preamp','前级增益',dsp.autoPreamp !== false ? finite(status.preampDb,0) : finite(dsp.preamp),-24,12,.1,dsp.autoPreamp !== false) + `<p class="dsp-note">EQ 最大提升 <strong data-dsp-value="maxBoost">${esc(formatDSPValue('maxBoost',status.maxBoost))}</strong></p>`);
    const filterRow = (filter,index) => {
      const data = key => `data-dsp-filter="${index}" data-filter-field="${key}"`;
      const number = (key,label,min,max,step,digits,disabled=false) => `<label class="dsp-filter-number"><span>${label}</span><input type="number" ${data(key)} aria-label="滤波器 ${index+1} ${label}" min="${min}" max="${max}" step="${step}" value="${filter[key].toFixed(digits)}" ${disabled?'disabled':''}></label>`;
      return `<article class="dsp-filter-row ${filter.on ? '' : 'is-off'}"><div class="dsp-filter-identity"><strong>${index + 1}</strong><label class="dsp-filter-enable"><input type="checkbox" ${data('on')} ${filter.on ? 'checked' : ''} aria-label="启用滤波器 ${index+1}"><span>启用</span></label></div><label class="dsp-filter-type"><span>类型</span><select ${data('type')} aria-label="滤波器 ${index+1} 类型">${Object.entries(FILTER_TYPES).map(([key,type]) => `<option value="${key}" ${key === filter.type ? 'selected' : ''}>${esc(type.label)}</option>`).join('')}</select></label>${number('fc','频率 Hz',EQ_LIMITS.fcMin,EQ_LIMITS.fcMax,1,0)}${number('gain','增益 dB',EQ_LIMITS.gainMin,EQ_LIMITS.gainMax,.1,1,!FILTER_TYPES[filter.type].gain)}${number('q','Q',EQ_LIMITS.qMin,EQ_LIMITS.qMax,.01,2)}${button(`${icon('close',14)}<span class="dsp-delete-label">删除</span>`,'dsp-filter-delete',index,'dsp-filter-remove',false,`删除滤波器 ${index+1}`)}</article>`;
    };
    const filterTools = `<div class="dsp-actions dsp-filter-tools">${button('添加滤波器','dsp-filter-add','','dsp-primary',filters.length>=EQ_LIMITS.maxFilters)}${button('清空','dsp-filter-clear','','dsp-danger',!filters.length)}${ui.canUndo ? button('恢复已清空滤波器','dsp-filter-undo') : ''}<span>${filters.length} / ${EQ_LIMITS.maxFilters} 段</span></div>`;
    const filterList = card('参数滤波器', `<div class="dsp-filter-list">${filters.length ? filters.map(filterRow).join('') : '<p class="dsp-empty">暂未添加滤波器。选择预设、导入耳机校正参数，或添加一个滤波器。</p>'}</div>${filterTools}${note('高通、低通、带通和陷波不使用增益参数。可用 Q 调整滤波器的带宽或斜率。')}`);
    const importPanel = ui.importOpen ? `<section class="dsp-inline-panel" aria-label="粘贴均衡器参数"><label>Equalizer APO / AutoEQ 参数<textarea data-dsp-import-text rows="6" spellcheck="false" placeholder="Preamp: -6.0 dB&#10;Filter 1: ON PK Fc 1000 Hz Gain 3.0 dB Q 1.41">${esc(ui.importText || '')}</textarea></label><div class="dsp-actions">${button('取消','dsp-import-cancel')}${button('导入参数','dsp-import-apply','','dsp-primary')}</div></section>` : '';
    const exportPanel = ui.exportOpen ? `<section class="dsp-inline-panel" aria-label="导出均衡器参数"><label>Equalizer APO 参数<textarea data-dsp-export-text readonly rows="6" spellcheck="false">${esc(ui.exportText || '')}</textarea></label>${note('可选中并复制文本，或下载参数文件。')}<div class="dsp-actions">${button('关闭','dsp-export-close')}${button('下载文件','dsp-export-download','','dsp-primary')}</div></section>` : '';
    body = toggle('eq.enabled','参数均衡器',dsp.eq?.enabled===true,'关闭时保留滤波器和预设。') + presetTools + save + `<div class="dsp-eq-top">${curve}${preamp}</div>` + filterList + card('耳机校正与参数文件', `<div class="dsp-actions">${button('导入文件','dsp-import-file')}${button('粘贴参数','dsp-import-open')}${button('导出参数','dsp-export')}</div>${note('支持 AutoEQ / Equalizer APO 的 ParametricEQ.txt，前级增益会一并导入。')}${importPanel}${exportPanel}`);
  }

  if (currentTab === 'fx') {
    const cf=dsp.crossfeed||{}, mx=dsp.matrix||{}, limiter=dsp.limiterSettings||{};
    const crossfeedPresets = `<div class="dsp-crossfeed-presets">${Object.entries(CROSSFEED_PRESETS).map(([key,value]) => `<button type="button" class="dsp-button ${value.cutoff===cf.cutoff&&value.feed===cf.feed?'is-selected':''}" ${action('dsp-crossfeed-preset',key)} aria-pressed="${value.cutoff===cf.cutoff&&value.feed===cf.feed}">${esc(key.split('（')[0])}</button>`).join('')}</div>`;
    body = `<div class="dsp-effects-grid">${card('耳机 Crossfeed',toggle('crossfeed.enabled','启用交叉馈送',cf.enabled===true,'将少量低频送至对侧声道，调整耳机声场。')+crossfeedPresets+range('crossfeed.cutoff','截止频率',finite(cf.cutoff,700),300,1200,10)+range('crossfeed.feed','馈送衰减',finite(cf.feed,4.5),1,15,.5))}${card('声道',range('matrix.width','声场宽度',finite(mx.width,1),0,2,.01)+range('matrix.balance','左右平衡',finite(mx.balance),-1,1,.01)+toggle('matrix.mono','单声道',mx.mono===true)+toggle('matrix.swap','左右互换',mx.swap===true)+toggle('matrix.invertL','左声道反相',mx.invertL===true)+toggle('matrix.invertR','右声道反相',mx.invertR===true))}</div>`
      +card('输出限幅',toggle('limiter','启用限幅器',dsp.limiter===true,'对过高电平进行衰减，降低数字削波风险。')+range('limiterSettings.ceiling','电平上限',finite(limiter.ceiling,-.1),-6,0,.1)+range('limiterSettings.release','释放时间',finite(limiter.release,80),20,500,5)+`<div class="dsp-readout-row"><span>当前增益衰减</span><strong data-dsp-meter="limiterReduction">${esc(formatDSPMeter('limiterReduction',meters))}</strong></div>`+note(status.worklet==='fallback'?'当前使用兼容限幅处理。':status.worklet==='ready'?'前视限幅已就绪，使用立体声联动。':'播放后会显示当前限幅处理状态。'));
  }

  if (currentTab === 'output') {
    const output=dsp.output||{}, deviceOptions=[['','系统默认输出'],...devices.filter(item=>item&&item.id).map(item=>[item.id,item.label||'未命名设备'])];
    if(output.sinkId&&!deviceOptions.some(([id])=>id===output.sinkId))deviceOptions.push([output.sinkId,'已保存的设备（未连接）']);
    body=card('输出设备',select('output.sinkId','播放设备',deviceOptions,output.sinkId||'','切换设备会影响当前音频输出。',ui.devicesLoading===true)+button(`${icon('history',15)} ${ui.devicesLoading?'正在刷新…':'刷新设备列表'}`,'dsp-output-refresh','','',ui.devicesLoading===true)+(ui.deviceError?`<p class="dsp-feedback is-error" role="status">${esc(ui.deviceError)}</p>`:''))
      +card('引擎设置',select('output.sampleRate','引擎采样率',[[0,'自动'],...[44100,48000,88200,96000,176400,192000].map(rate=>[rate,`${rate/1000} kHz`])],output.sampleRate||0,'自动使用设备与浏览器协商的采样率。')+select('output.latencyHint','缓冲策略',[['playback','稳定优先'],['balanced','均衡'],['interactive','低延迟']],output.latencyHint||'playback')+`<div class="dsp-reload-note">${note('采样率与缓冲修改在下次加载生效。重新加载会中断当前播放。')}${button('重新加载应用','dsp-output-apply')}</div>`)
      +card('当前运行状态',`<dl class="dsp-runtime"><div><dt>音频处理</dt><dd>${esc(worklet)}</dd></div><div><dt>引擎采样率</dt><dd>${status.sampleRate?`${finite(status.sampleRate)/1000} kHz`:'播放后显示'}</dd></div><div><dt>基础延迟</dt><dd>${status.baseLatency!=null&&Number.isFinite(status.baseLatency)?`${(status.baseLatency*1000).toFixed(1)} ms`:'—'}</dd></div></dl>${note('这里显示音频引擎状态，不代表音源位深或声卡硬件输出规格。DSP 旁通仍保留播放器音量。')}`);
  }

  return `<div class="dsp-console" data-dsp-console data-dsp-tab="${currentTab}">
    <div class="dsp-console-header"><div><strong>DSP 调音台</strong><span>${dsp.enabled===false?'音效已旁通':esc(currentPreset?.name||'自定义设置')}</span></div><label class="dsp-master"><span>启用 DSP</span><span class="dsp-toggle"><input type="checkbox" role="switch" ${field('enabled')} aria-label="启用 DSP" ${dsp.enabled!==false?'checked':''}><i aria-hidden="true"></i></span></label></div>
    <nav class="dsp-tabs" role="tablist" aria-label="DSP 面板">${tabs.map(([id,label])=>`<button type="button" role="tab" aria-selected="${currentTab===id}" tabindex="${currentTab===id?'0':'-1'}" ${action('dsp-tab',id)}>${label}</button>`).join('')}</nav>
    ${dsp.enabled===false?'<p class="dsp-bypass-note" role="status">音效已旁通。修改会被保存，重新开启 DSP 后生效。</p>':''}
    ${ui.message?`<p class="dsp-feedback ${ui.error?'is-error':''}" role="status">${esc(ui.message)}</p>`:''}
    <div class="dsp-tab-content" role="tabpanel" aria-label="${esc(tabs.find(([id])=>id===currentTab)[1])}">${body}</div>
  </div>`;
}
