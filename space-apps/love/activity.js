const INTERVAL_MS = 30 * 1000;
let last = 0;

function ping() {
  const now = Date.now();
  if (now - last < INTERVAL_MS || document.visibilityState !== 'visible') return;
  last = now;
  fetch('api/activity', { method: 'POST', keepalive: true }).catch(() => {});
}

for (const type of ['keydown', 'pointerdown', 'wheel']) {
  window.addEventListener(type, ping, { capture: true, passive: true });
}
