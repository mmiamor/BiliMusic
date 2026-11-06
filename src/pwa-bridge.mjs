// Native shells install their own bridge before the first application script.
export function installWebBridge() {
  if (window.biliNative || !/^https?:$/.test(window.location?.protocol || '')) return;

  async function send(path, data = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);
    try {
      const response = await fetch('/api/' + path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-BiliMusic': '1' },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok || result.error)
        throw Error(typeof result.error === 'string' ? result.error : '音乐服务请求失败。');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw Error('音源响应超时，请重试。');
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw Error('音乐服务暂时无法连接，请检查网络后重试。');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  let sessionReady;
  async function post(path, data = {}) {
    // Gate the first parallel lyrics/resolve calls on the same HttpOnly session.
    sessionReady ??= send('session').catch((error) => {
      sessionReady = undefined;
      throw error;
    });
    await sessionReady;
    return send(path, data);
  }

  const catalog = {};
  for (const op of [
    'discover',
    'search',
    'searchEntities',
    'browse',
    'collections',
    'entities',
    'resolve',
    'lyrics',
    'comments',
  ]) {
    catalog[op] = async (...args) => (await post('catalog', { op, args })).result;
  }
  const audio = document.createElement('audio');
  catalog.resolve = async (track) => {
    const { result } = await post('catalog', { op: 'resolve', args: [track] });
    return result.filter((stream) => {
      if (!track.bvid || !stream.mimeType || !stream.codec) return true;
      const format =
        stream.mimeType === 'audio/flac'
          ? stream.mimeType
          : stream.mimeType + '; codecs="' + (stream.lossless ? 'fLaC' : stream.codec) + '"';
      return Boolean(audio.canPlayType(format));
    });
  };
  let pendingLogin;
  window.biliNative = Object.freeze({
    platform: 'pwa',
    catalog: Object.freeze(catalog),
    getAccount: () => post('account/status'),
    loginBilibili: () => {
      if (!pendingLogin)
        pendingLogin = loginDialog(post).finally(() => {
          pendingLogin = null;
        });
      return pendingLogin;
    },
    logoutBilibili: async () => {
      try {
        await post('account/logout');
      } finally {
        sessionReady = undefined;
      }
    },
  });
  if ('serviceWorker' in navigator && window.isSecureContext)
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  setupInstall();
}

async function loginDialog(post) {
  const dialog = document.createElement('dialog');
  dialog.className = 'web-login';
  dialog.setAttribute('aria-labelledby', 'login-title');
  dialog.innerHTML = `<header><h2 id="login-title">登录哔哩哔哩</h2><button type="button" data-dismiss aria-label="关闭登录窗口">关闭</button></header>
    <p>用哔哩哔哩 App 扫码，或在本机打开官方授权页。授权后回到 BiliMusic。</p>
    <div class="qr-box"><img alt="哔哩哔哩登录二维码" hidden></div>
    <p data-status role="status">正在向哔哩哔哩申请二维码…</p>
    <a class="primary" data-open target="_blank" rel="noopener noreferrer" hidden>前往哔哩哔哩授权</a>
    <button class="secondary" data-renew hidden>重新获取二维码</button>`;
  document.body.append(dialog);
  dialog.showModal();
  const find = (q) => dialog.querySelector(q);
  const status = find('[data-status]'),
    image = find('img'),
    link = find('[data-open]'),
    renew = find('[data-renew]');
  let timer,
    generation = 0,
    done = false;
  const closed = new Promise((resolve) =>
    dialog.addEventListener('close', resolve, { once: true }),
  );
  find('[data-dismiss]').onclick = () => dialog.close();
  async function start() {
    clearTimeout(timer);
    const id = ++generation;
    image.hidden = true;
    link.hidden = true;
    renew.hidden = true;
    status.textContent = '正在向哔哩哔哩申请二维码…';
    const fail = (error) => {
      if (id !== generation || !dialog.open) return;
      status.textContent = error;
      renew.hidden = false;
      link.hidden = true;
      image.hidden = true;
    };
    try {
      const qr = await post('account/qr');
      if (id !== generation || !dialog.open) return;
      const official = new URL(qr.url);
      const approved =
        (official.origin === 'https://account.bilibili.com' &&
          official.pathname === '/h5/account-h5/auth/scan-web') ||
        (official.origin === 'https://passport.bilibili.com' &&
          official.pathname === '/h5-app/passport/login/scan');
      if (!approved || !/^data:image\/png;base64,/.test(qr.image))
        throw Error('哔哩哔哩返回的二维码无效。');
      link.href = official.href;
      image.src = qr.image;
      link.hidden = image.hidden = false;
      status.textContent = '等待扫码或本机授权';
      async function poll() {
        if (id !== generation || !dialog.open) return;
        try {
          const result = await post('account/poll');
          if (id !== generation || !dialog.open) return;
          if (result.status === 'done') {
            done = true;
            dialog.close();
            return;
          }
          if (result.status === 'expired') {
            fail('二维码已过期，请重新获取。');
            return;
          }
          status.textContent =
            result.status === 'scanned' ? '已扫码，请在哔哩哔哩确认登录。' : '等待扫码或本机授权';
          timer = setTimeout(poll, 2200);
        } catch (error) {
          fail(error.message || '暂时无法查询授权状态。');
        }
      }
      timer = setTimeout(poll, 2000);
    } catch (error) {
      fail(error.message || '暂时无法取得二维码。');
    }
  }
  renew.onclick = start;
  void start();
  await closed;
  ++generation;
  clearTimeout(timer);
  dialog.remove();
  if (!done) await post('account/cancel').catch(() => {});
}

function setupInstall() {
  const trigger = document.querySelector('#pwa-install');
  const standalone = () =>
    matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let prompt;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    prompt = event;
    trigger.hidden = standalone();
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    trigger.hidden = true;
  });
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !standalone()) trigger.hidden = false;
  trigger.onclick = async () => {
    if (prompt) {
      const current = prompt;
      prompt = null;
      await current.prompt();
      await current.userChoice;
      trigger.hidden = true;
      return;
    }
    const help = document.createElement('dialog');
    help.className = 'web-login';
    help.innerHTML =
      '<h2>添加到主屏幕</h2><p>在 Safari 中点「分享」，选择「添加到主屏幕」，再点「添加」。</p><button class="primary">完成</button>';
    document.body.append(help);
    help.showModal();
    help.querySelector('button').onclick = () => help.close();
    help.addEventListener('close', () => help.remove(), { once: true });
  };
}
