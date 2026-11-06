// Native controls are available only in the isolated Windows desktop bridge.
const controls = window.biliNative?.platform === 'windows' && window.biliNative.windowControls;

if (controls) {
  document.documentElement.classList.add('desktop-shell');
  const titlebar = document.createElement('header');
  titlebar.className = 'window-chrome';
  titlebar.setAttribute('aria-label', '窗口标题栏');
  titlebar.innerHTML = `
    <div class="window-controls" role="group" aria-label="窗口操作">
      <button type="button" class="window-button window-minimize" data-window="minimize" aria-label="最小化窗口" title="最小化窗口"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10"/></svg></button>
      <button type="button" class="window-button window-maximize" data-window="toggleMaximize" aria-label="最大化窗口" title="最大化窗口"><svg viewBox="0 0 12 12" aria-hidden="true"><path class="maximize-mark" d="M1.5 1.5h9v9h-9z"/><path class="restore-mark" d="M4 3.5V1.5h6.5V8H8.5M1.5 3.5h7v7h-7z"/></svg></button>
      <button type="button" class="window-button window-close" data-window="close" aria-label="关闭窗口" title="关闭窗口"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9"/></svg></button>
    </div>
    <span class="window-title">BiliMusic</span>`;
  document.body.prepend(titlebar);

  function updateState(state) {
    if (!state) return;
    const root = document.documentElement;
    root.classList.toggle('window-maximized', state.maximized);
    root.classList.toggle('window-inactive', !state.focused);
    const maximize = titlebar.querySelector('.window-maximize');
    const label = state.maximized ? '还原窗口' : '最大化窗口';
    maximize.setAttribute('aria-label', label);
    maximize.title = label;
  }

  async function run(command) {
    try {
      updateState(await controls[command]());
    } catch {
      // Closing the native window can dispose its renderer before IPC resolves.
    }
  }

  titlebar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-window]');
    if (button && titlebar.contains(button)) void run(button.dataset.window);
  });
  // The caption region uses native drag/double-click behavior. The selectable
  // title is a no-drag target, so handle its double-click explicitly as well.
  titlebar.querySelector('.window-title').addEventListener('dblclick', () => void run('toggleMaximize'));
  const unsubscribe = controls.onState(updateState);
  void controls.getState().then(updateState).catch(() => {});

  // showModal() makes the rest of the document inert, including a body-level
  // titlebar. Move this same bar into the active sheet so window controls keep
  // working with lyrics, DSP and other modal panels open.
  const sheet = document.querySelector('#sheet');
  const observer = new MutationObserver(() => {
    if (sheet.open) sheet.append(titlebar);
    else document.body.prepend(titlebar);
  });
  if (sheet) observer.observe(sheet, { attributes: true, attributeFilter: ['open'] });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    unsubscribe();
  }, { once: true });
}
