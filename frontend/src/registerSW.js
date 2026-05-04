/**
 * Service Worker registration + auto-update handler.
 * Call once at app bootstrap from src/index.js.
 *
 * What it does:
 *   - Registers /service-worker.js on production hosts
 *   - Polls for SW updates every 60s
 *   - When a new SW takes control, auto-reloads the page ONCE
 *     so the user is instantly on the freshest build with NO
 *     manual cache clear required.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Register after page load so it doesn't slow initial render
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });

      // Poll the SW file for updates every 60s — catches new deploys fast
      setInterval(() => { reg.update().catch(() => {}); }, 60 * 1000);

      // When an update is found, auto-activate + reload
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            // New version ready — activate it NOW
            newSW.postMessage('SKIP_WAITING');
          }
        });
      });

      // When a new SW takes over, reload exactly once
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        // eslint-disable-next-line no-console
        console.log('[XauAi] New version live — reloading');
        window.location.reload();
      });

      // Also listen for explicit "SW_UPDATED" broadcast from activate hook
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'SW_UPDATED' && !reloaded) {
          reloaded = true;
          window.location.reload();
        }
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[XauAi] SW register failed', e);
    }
  });
}

/** Manual "Clear cache & reload" helper — useful if user hits a stuck state. */
export async function forceRefreshApp() {
  try {
    // Tell SW to nuke every cache
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage('CLEAR_CACHES');
    }
    // Unregister all SWs so next load gets a brand-new one
    const regs = await (navigator.serviceWorker?.getRegistrations?.() || []);
    await Promise.all(regs.map(r => r.unregister()));
    // Nuke caches directly too
    if (window.caches) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } finally {
    // Hard reload bypassing HTTP cache
    window.location.reload();
  }
}
