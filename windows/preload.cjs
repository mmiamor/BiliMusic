const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('biliNative', {
  platform: 'windows',
  request: (input, options) => ipcRenderer.invoke('bili:request',
    typeof input === 'string' ? { ...options, url: input } : input),
  prepareMedia: (source) => ipcRenderer.invoke('bili:media', source),
  releaseMedia: (url) => ipcRenderer.invoke('bili:release', url),
  loginBilibili: () => ipcRenderer.invoke('bili:login'),
  logoutBilibili: () => ipcRenderer.invoke('bili:logout'),
  windowControls: {
    getState: () => ipcRenderer.invoke('bili:window', 'state'),
    minimize: () => ipcRenderer.invoke('bili:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('bili:window', 'toggle-maximize'),
    close: () => ipcRenderer.invoke('bili:window', 'close'),
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, state) => callback({
        maximized: state.maximized === true, focused: state.focused === true,
      });
      ipcRenderer.on('bili:window-state', listener);
      return () => ipcRenderer.removeListener('bili:window-state', listener);
    },
  },
});
