/**
 * XAU AI Sniper Command Center — Service Worker
 * ------------------------------------------------------------
 * Goal: installed PWA must auto-update the moment new code ships.
 *
 * Strategy:
 *   - Network-first for ALL HTML / JS / CSS → always fetches fresh from server
 *   - If network is down → fall back to last cached version (offline safety)
 *   - On activate: PURGES every old cache → no stale JS chunks ever
 *   - skipWaiting + clients.claim → new SW takes over instantly without
 *     requiring the user to close & reopen the app
 * ------------------------------------------------------------
 */
const CACHE_NAME = 'xauai-cloud-v' + Date.now();

self.addEventListener('install', (event) => {
  // Skip the "waiting" phase — new SW activates immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete ALL old caches from previous deploys
      const names = await caches.keys();
      await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
      // Take control of all open clients (tabs) right now
      await self.clients.claim();
      // Notify clients so they can hard-reload
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache API calls — they must always be fresh
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML/JS/CSS (the stuff that updates on each deploy)
  const isCritical = /\.(?:html|js|css|json)$/.test(url.pathname) || req.mode === 'navigate';

  if (isCritical) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: 'no-store' });
          // Cache the fresh copy for offline fallback
          if (fresh && fresh.ok && url.origin === self.location.origin) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch (_) {
          // Network failed → serve last cached if we have it
          const cached = await caches.match(req);
          if (cached) return cached;
          // Navigation fallback — return the root index
          if (req.mode === 'navigate') return caches.match('/');
          throw _;
        }
      })()
    );
    return;
  }

  // For images/fonts/icons — cache-first (these rarely change, fine to serve cached)
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.ok && url.origin === self.location.origin) {
        caches.open(CACHE_NAME).then(c => c.put(req, res.clone()).catch(() => {}));
      }
      return res;
    }))
  );
});

// Let the page force an SW update / cache flush on demand (for manual "Check for updates" buttons)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHES') {
    caches.keys().then(names => names.forEach(n => caches.delete(n)));
  }
});
