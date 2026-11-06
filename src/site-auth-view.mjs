/** Passwords are never accepted as renderer input or placed in generated HTML. */
export function renderSiteLogin({ busy = false, error = '', username = 'Music', checking = false } = {}, { esc, icon }) {
  const pending = busy || checking;
  const disabled = pending ? 'disabled' : '';
  return `<main class="site-login" aria-label="BiliMusic 登录">
    <header class="site-login-masthead"><div><p class="site-login-eyebrow">A PERSONAL MUSIC LIBRARY</p><h1>BiliMusic<span aria-hidden="true">.</span></h1></div><span class="site-login-edition">声音，值得收藏</span></header>
    <div class="site-login-layout">
      <section class="site-login-intro" aria-label="关于 BiliMusic"><p class="site-login-kicker">LISTEN. COLLECT. RETURN.</p><h2>把喜欢的声音，<br>留在这里。</h2><p class="site-login-description">从一次偶然听见，到一张反复播放的歌单。<br>登录后，建立歌单、收藏音乐，让喜欢有迹可循。</p>
        <svg class="site-login-art" viewBox="0 0 540 300" aria-hidden="true" focusable="false">
          <path d="M46 249H498M92 53V268M450 53V268" class="auth-art-grid"/><path d="M143 211a117 117 0 0 1 234-1" class="auth-art-arc"/>
          <ellipse cx="263" cy="249" rx="157" ry="22" fill="#eae4d8"/>
          <path d="M178 217V79l178-35v146h-18V66L196 94v123Z" fill="#ad593e"/><path d="M196 94v123h-18V79l178-35v22Z" fill="#c5876b"/>
          <ellipse cx="154" cy="221" rx="43" ry="29" transform="rotate(-17 154 221)" fill="#24231f"/><ellipse cx="316" cy="195" rx="43" ry="29" transform="rotate(-17 316 195)" fill="#24231f"/>
          <ellipse cx="154" cy="216" rx="43" ry="24" transform="rotate(-17 154 216)" fill="#6e7465"/><ellipse cx="316" cy="190" rx="43" ry="24" transform="rotate(-17 316 190)" fill="#d0bb93"/>
          <ellipse cx="154" cy="216" rx="21" ry="12" transform="rotate(-17 154 216)" fill="none" stroke="#c6c7b7"/><ellipse cx="316" cy="190" rx="21" ry="12" transform="rotate(-17 316 190)" fill="none" stroke="#f4f2eb"/>
          <path d="M378 118h48m-24-24v48M68 170h22m-11-11v22" class="auth-art-detail"/><circle cx="430" cy="224" r="23" fill="none" stroke="#b56b50"/><circle cx="430" cy="224" r="17" fill="none" stroke="#d4aa95"/><path d="M62 284h416" class="auth-art-grid"/>
        </svg>
        <div class="site-login-caption"><span>YOUR EVERYDAY SOUNDTRACK</span><span>听见 · 收藏 · 再听</span></div>
      </section>
      <section class="site-login-panel" aria-labelledby="site-login-title"><div class="site-login-panel-heading"><span>WELCOME BACK</span><h2 id="site-login-title">欢迎回来</h2><p>登录你的 BiliMusic 音乐空间。</p></div>
        <form data-site-login aria-busy="${pending}" ${error ? 'aria-describedby="site-auth-error"' : ''}>
          <label class="site-auth-field"><span>用户名</span><input name="username" type="text" value="${esc(username)}" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="120" ${disabled}></label>
          <label class="site-auth-field"><span>密码</span><span class="site-auth-password"><input name="password" type="password" autocomplete="current-password" required ${disabled}><button type="button" data-auth-action="toggle-password" aria-label="显示密码" aria-pressed="false" ${disabled}>显示</button></span></label>
          ${error ? `<div class="site-auth-error" id="site-auth-error" role="alert"><p>${esc(error)}</p><button type="button" data-auth-action="retry" ${disabled}>重新检查</button></div>` : ''}
          <button class="site-auth-submit" type="submit" ${disabled}>${checking ? '正在确认登录状态…' : busy ? '正在登录…' : '登录音乐空间'}${!pending ? icon('arrow',18) : ''}</button>
          <p class="site-auth-status" role="status" aria-live="polite">${checking ? '正在连接你的音乐空间，请稍候。' : busy ? '正在核对账号，请稍候。' : '进入后即可继续整理你的歌单与收藏。'}</p>
        </form><p class="site-login-note">这是 BiliMusic 账号。哔哩哔哩音源授权可在登录后的设置中管理。</p>
      </section>
    </div><footer class="site-login-footer"><span>BiliMusic</span><span>FOR THE LOVE OF LISTENING</span></footer>
  </main>`;
}
