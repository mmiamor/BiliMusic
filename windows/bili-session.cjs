const { BrowserWindow, session } = require('electron');

const domainMatches = domain => /(^|\.)bilibili\.com$/i.test(domain || '');
const isOfficial = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && domainMatches(url.hostname);
  } catch { return false; }
};
let pending;
let loginWindow;

function login(parent) {
  if (loginWindow) { loginWindow.focus(); return pending; }
  const cookies = session.defaultSession.cookies;
  loginWindow = new BrowserWindow({
    parent, modal: true, width: 780, height: 740, title: '哔哩哔哩官方登录', autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, devTools: false, session: session.defaultSession },
  });
  const onCookie = (_event, cookie, _cause, removed) => {
    if (!removed && cookie.name === 'SESSDATA' && domainMatches(cookie.domain)) loginWindow?.close();
  };
  const web = loginWindow.webContents;
  web.on('will-navigate', (event) => { if (!isOfficial(event.url)) event.preventDefault(); });
  web.on('will-redirect', (event) => {
    if (event.isMainFrame && !isOfficial(event.url)) event.preventDefault();
  });
  web.setWindowOpenHandler(({ url }) => {
    if (isOfficial(url)) web.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });
  cookies.on('changed', onCookie);
  pending = new Promise(resolve => {
    loginWindow.once('closed', () => {
      cookies.off('changed', onCookie);
      loginWindow = null;
      pending = null;
      resolve();
    });
  });
  const result = pending;
  web.loadURL('https://passport.bilibili.com/login').catch(() => {});
  return result;
}

async function logout() {
  loginWindow?.close();
  const jar = session.defaultSession.cookies;
  for (const cookie of await jar.get({})) {
    if (!domainMatches(cookie.domain)) continue;
    const host = cookie.domain.replace(/^\./, '');
    await jar.remove('https://' + host + (cookie.path || '/'), cookie.name);
  }
  await jar.flushStore();
}

module.exports = { login, logout };
