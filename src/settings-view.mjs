import { DISCOVERY_CATEGORIES } from './discovery-categories.mjs';
import { DSP_PRESETS } from './audio.mjs';

/** Render settings without reading account, playback or storage state. */
export function renderSettings(
  { account = {}, loginAvailable = false, defaultCategory = 'hires', dsp = {}, platform, version } = {},
  { icon, esc, action },
) {
  const statuses = new Set(['unknown', 'loading', 'signed-in', 'signed-out', 'error']);
  const status = statuses.has(account.status) ? account.status : 'unknown';
  const busy = account.busy === 'login' || account.busy === 'logout';
  const checking = status === 'loading';
  const name = status === 'signed-out' ? '' : String(account.name || '').trim();
  const authorizationAction = busy ? account.busy : status === 'signed-in' ? 'logout' : status === 'signed-out' ? 'login' : null;
  const stateText = {
    unknown: '尚未检查登录状态',
    loading: '正在检查登录状态…',
    'signed-in': '已登录',
    'signed-out': '尚未登录',
    error: '暂时无法确认登录状态',
  }[status];
  const description = account.busy === 'login'
    ? '请在哔哩哔哩官方页面完成登录。'
    : account.busy === 'logout'
      ? '正在退出账号，请稍候。'
      : status === 'error'
        ? account.error || '连接暂时不可用，请稍后重新检查。'
        : status === 'signed-in'
          ? '已连接哔哩哔哩，播放时会确认当前账号可用的音质。'
          : status === 'signed-out'
            ? '登录后，可按你的账号权益获取音源。'
            : checking
              ? '正在向哔哩哔哩确认，请稍候。'
              : '检查现有登录状态，或通过官方页面登录。';
  const disabled = busy || checking ? 'disabled' : '';
  const authorizationDisabled = busy || checking || !loginAvailable ? 'disabled' : '';
  const category = DISCOVERY_CATEGORIES.some(item => item.id === defaultCategory) ? defaultCategory : 'hires';
  const preset = DSP_PRESETS.find(item => item.id === dsp.preset)?.name || '自定义';
  const platformName = { windows: 'Windows', ios: 'iOS', pwa: '网页版' }[platform];

  return `<div class="settings-page">
    <header class="settings-heading"><h1>设置</h1><p>管理账号和播放偏好。</p></header>

    <section class="settings-section" aria-labelledby="settings-account-heading">
      <h2 id="settings-account-heading">账号</h2>
      <div class="settings-card">
        <div class="settings-account" aria-busy="${busy || checking}">
          <span class="settings-account-icon" aria-hidden="true">${icon('bili', 22)}</span>
          <div class="settings-account-body">
            <h3>哔哩哔哩</h3>
            <div class="settings-account-status ${status === 'error' ? 'is-error' : ''}" role="status" aria-live="polite">
              ${name ? `<p class="settings-account-name">${status === 'error' ? '上次确认：' : ''}${esc(name)}</p>` : ''}
              <p class="settings-status-label ${status === 'signed-in' ? 'is-connected' : ''}">${esc(stateText)}</p>
              <p class="settings-description">${esc(description)}</p>
            </div>
            <div class="settings-account-actions">
              ${authorizationAction === 'logout'
                ? `<button type="button" class="settings-button" ${action('settings-logout')} ${authorizationDisabled}>${account.busy === 'logout' ? '正在退出…' : '退出登录'}</button>`
                : authorizationAction === 'login'
                  ? `<button type="button" class="settings-button settings-primary" ${action('settings-login')} ${authorizationDisabled}>${account.busy === 'login' ? '等待登录完成…' : '通过官方页面登录'} ${icon('upRight', 14)}</button>`
                  : ''}
              <button type="button" class="settings-button" ${action('settings-account-refresh')} ${disabled}>${icon('history', 15)} ${checking ? '正在检查…' : status === 'error' ? '重新检查' : '刷新登录状态'}</button>
            </div>
            ${!loginAvailable ? '<p class="settings-availability">当前版本暂不支持在应用内登录哔哩哔哩。</p>' : ''}
          </div>
        </div>
        <p class="settings-card-note">酷我音乐、网易云音乐等其他音源暂不提供应用内账号登录。</p>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="settings-playback-heading">
      <h2 id="settings-playback-heading">播放</h2>
      <div class="settings-card settings-preferences">
        <div class="settings-row">
          <div class="settings-row-copy"><label for="settings-start-category">默认发现分类</label><p id="settings-category-hint">下次打开应用时，优先显示这个音乐分类。</p></div>
          <select id="settings-start-category" data-setting="start-category" aria-describedby="settings-category-hint">${DISCOVERY_CATEGORIES.map(item => `<option value="${esc(item.id)}" ${item.id === category ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select>
        </div>
        <div class="settings-row">
          <div class="settings-row-copy"><label for="settings-dsp-enabled">DSP 音效</label><p id="settings-dsp-hint">${dsp.enabled === false ? '已旁通音效，保留播放器音量。' : `已开启 · ${esc(preset)}预设`}</p></div>
          <label class="settings-toggle" for="settings-dsp-enabled"><input id="settings-dsp-enabled" type="checkbox" role="switch" data-setting="dsp-enabled" aria-describedby="settings-dsp-hint" ${dsp.enabled !== false ? 'checked' : ''}><span aria-hidden="true"></span></label>
        </div>
        <div class="settings-row">
          <div class="settings-row-copy"><h3>调音台</h3><p>调整均衡器、前级增益和输出限幅。</p></div>
          <button type="button" class="settings-button" ${action('dsp')}>${icon('sliders', 16)} 打开调音台 ${icon('chevron', 13)}</button>
        </div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="settings-about-heading">
      <h2 id="settings-about-heading">关于</h2>
      <div class="settings-card settings-about">
        <div class="settings-version"><strong>BiliMusic${platformName ? ` <span>${esc(platformName)}</span>` : ''}</strong><span>版本 ${esc(version || '未提供')}</span></div>
        <p>登录在哔哩哔哩官方授权页面完成。应用会保存授权的登录状态，你可以随时退出登录。</p>
      </div>
    </section>
  </div>`;
}
