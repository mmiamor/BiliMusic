/** Keep the app shell still while letting its panels and native form controls scroll. */
export function installViewport() {
  if (!window.matchMedia || !document.documentElement) return () => {};
  const root = document.documentElement;
  const handheld = window.matchMedia('(max-width: 660px), (any-pointer: coarse)');
  const viewport = window.visualViewport;
  let touch, frame = 0;

  function resize() {
    frame = 0;
    if (!viewport || !handheld.matches) {
      root.style.removeProperty('--app-view-height');
      root.style.removeProperty('--app-view-top');
      return;
    }
    // During pinch-to-zoom the layout remains at its original size. Keep magnification
    // and the OS's viewport panning available to people who need larger text.
    if (Math.abs(viewport.scale - 1) > 0.015) return;
    root.style.setProperty('--app-view-height', Math.round(viewport.height) + 'px');
    root.style.setProperty('--app-view-top', Math.max(0, Math.round(viewport.offsetTop)) + 'px');
  }
  function scheduleResize() {
    if (!frame) frame = window.requestAnimationFrame(resize);
  }
  function clearTouch() { touch = null; }
  function start(event) {
    clearTouch();
    if (!handheld.matches || event.touches.length !== 1) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const point = event.touches[0];
    const ancestors = [];
    for (const el of event.composedPath()) {
      if (el === document.body || el === root) break;
      if (!(el instanceof HTMLElement)) continue;
      // Dialog backdrops target the dialog, even when the contact falls outside it.
      if (el === target && el.tagName === 'DIALOG') {
        const bounds = el.getBoundingClientRect();
        if (point.clientX < bounds.left || point.clientX > bounds.right ||
            point.clientY < bounds.top || point.clientY > bounds.bottom) break;
      }
      const style = getComputedStyle(el);
      const scrollX = /^(auto|scroll|overlay)$/.test(style.overflowX);
      const scrollY = /^(auto|scroll|overlay)$/.test(style.overflowY);
      if (scrollX || scrollY) ancestors.push({ el, scrollX, scrollY });
    }
    touch = { x: point.clientX, y: point.clientY, axis: '', ancestors };
  }
  function move(event) {
    if (!touch || !event.cancelable || event.touches.length !== 1 ||
        (viewport && Math.abs(viewport.scale - 1) > 0.015) || !handheld.matches) return;
    if (document.getSelection()?.type === 'Range') return;
    const point = event.touches[0];
    const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
    if (!touch.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
      touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    touch.x = point.clientX; touch.y = point.clientY;
    const horizontal = touch.axis === 'x';
    const delta = horizontal ? dx : dy;
    if (!delta) return;
    const innerCanMove = touch.ancestors.some(({ el, scrollX, scrollY }) => {
      if (!(horizontal ? scrollX : scrollY)) return false;
      const offset = horizontal ? el.scrollLeft : el.scrollTop;
      const max = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      return max > 1 && (delta > 0 ? offset > 1 : offset < max - 1);
    });
    // Older mobile WebKit can chain an exhausted inner scroller to its visual viewport.
    if (!innerCanMove) event.preventDefault();
  }

  handheld.addEventListener('change', scheduleResize);
  viewport?.addEventListener('resize', scheduleResize);
  viewport?.addEventListener('scroll', scheduleResize);
  document.addEventListener('touchstart', start, { passive: true, capture: true });
  document.addEventListener('touchmove', move, { passive: false, capture: true });
  document.addEventListener('touchend', clearTouch, { passive: true });
  document.addEventListener('touchcancel', clearTouch, { passive: true });
  resize();
  return () => {
    handheld.removeEventListener('change', scheduleResize);
    viewport?.removeEventListener('resize', scheduleResize);
    viewport?.removeEventListener('scroll', scheduleResize);
    document.removeEventListener('touchstart', start, true);
    document.removeEventListener('touchmove', move, true);
    document.removeEventListener('touchend', clearTouch);
    document.removeEventListener('touchcancel', clearTouch);
    if (frame) window.cancelAnimationFrame(frame);
    root.style.removeProperty('--app-view-height');
    root.style.removeProperty('--app-view-top');
  };
}
