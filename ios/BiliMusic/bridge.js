(() => {
  const send = (action, input) => window.webkit.messageHandlers.nativePlayer.postMessage({ ...input, action });
  window.biliNative = Object.freeze({
    platform: 'ios',
    request: (input, options) => send('request', typeof input === 'string' ? { ...options, url: input } : input),
    async prepareMedia(source) {
      const local = new URL(source.url, location.href);
      if (local.protocol === 'bilimusic:' && local.host === 'app') {
        const response = await fetch(local.href);
        if (!response.ok) throw new Error('无法读取随附音频');
        return URL.createObjectURL(await response.blob());
      }
      // AVFoundation cannot attach provider headers to HTMLAudioElement. Build a
      // seekable same-document Blob from native cached bytes for Web Audio DSP.
      const file = await send('media', source);
      try {
        const chunks = [];
        for (let offset = 0; offset < file.size;) {
          const binary = atob(await send('chunk', { id: file.id, offset }));
          if (!binary.length) throw new Error('音频文件未完整下载');
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index);
          offset += bytes.length;
          chunks.push(bytes);
        }
        return URL.createObjectURL(new Blob(chunks, { type: source.mimeType || file.mimeType }));
      } finally { await send('release', { id: file.id }); }
    },
    releaseMedia(url) { URL.revokeObjectURL(url); },
    loginBilibili: () => send('loginBilibili', {}),
    logoutBilibili: () => send('logoutBilibili', {}),
  });
})();
