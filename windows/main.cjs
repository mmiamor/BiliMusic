const { app, BrowserWindow, ipcMain, Menu, protocol, session, shell } = require('electron');
const sourceLinks = require('../src/hifi-links.json');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { checkedSource, requestText, streamMedia } = require('./network.cjs');
const { staticFileResponse } = require('./static.cjs');
const biliSession = require('./bili-session.cjs');

app.setName('BiliMusic');
protocol.registerSchemesAsPrivileged([{ scheme: 'bilimusic',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const origin = 'bilimusic://app/';
const mediaPrefix = origin + '__media/';
const media = new Map();
let window;

function fromApp(event) {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame ||
      !event.senderFrame.url.startsWith(origin)) throw new Error('无效的请求来源');
}

function windowState() {
  return { maximized: window.isMaximized(), focused: window.isFocused() };
}

function sendWindowState() {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('bili:window-state', windowState());
  }
}

async function route(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
    if (request.url.startsWith(mediaPrefix)) {
      if (request.method !== 'GET') return new Response(null, { status: 403 });
      const source = media.get(request.url);
      return source ? await streamMedia(source, request) : new Response(null, { status: 404 });
    }
    return await staticFileResponse(request, path.join(__dirname, '..', 'src'));
  } catch {
    return new Response('资源无法读取', { status: 502 });
  }
}

app.whenReady().then(async () => {
  protocol.handle('bilimusic', route);
  ipcMain.handle('bili:request', (event, input) => { fromApp(event); return requestText(input); });
  ipcMain.handle('bili:media', (event, input) => {
    fromApp(event);
    const url = mediaPrefix + randomUUID();
    media.set(url, checkedSource(input));
    return url;
  });
  ipcMain.handle('bili:release', (event, url) => { fromApp(event); media.delete(url); });
  ipcMain.handle('bili:login', (event) => { fromApp(event); return biliSession.login(window); });
  ipcMain.handle('bili:logout', (event) => { fromApp(event); return biliSession.logout(); });
  ipcMain.handle('bili:open-source', (event, id) => {
    fromApp(event);
    if (typeof id !== 'string' || !Object.hasOwn(sourceLinks, id)) throw new Error('未知音源');
    return shell.openExternal(sourceLinks[id]);
  });
  ipcMain.handle('bili:window', (event, command) => {
    fromApp(event);
    switch (command) {
      case 'state': return windowState();
      case 'minimize': window.minimize(); break;
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case 'close': window.close(); return;
      default: throw new Error('无效的窗口操作');
    }
    return windowState();
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1330, height: 860, minWidth: 430, minHeight: 540,
    frame: false,
    backgroundColor: '#f5f5f7', title: 'BiliMusic', icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  for (const event of ['maximize', 'unmaximize', 'focus', 'blur', 'restore']) {
    window.on(event, sendWindowState);
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    if (!event.url.startsWith(origin)) event.preventDefault();
  });
  window.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) media.clear();
  });
  await window.loadURL(origin + 'index.html');
});
app.on('window-all-closed', () => app.quit());
