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
// v6.25.3 owner directive 2026-07-17 -- OneSignal push handling now runs
// inside THIS existing service worker (rather than letting the SDK
// register a second, competing worker at the same '/' scope), per
// OneSignal's documented "existing service worker" integration pattern.
// This importScripts() call is what actually installs OneSignal's push/
// notificationclick listeners; our own custom listeners for those events
// were removed below (see bottom of file) so there's no double-handling.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDKWorker.js');

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

/**
 * AI Market Outlook — Web Push notifications.
 * ------------------------------------------------------------
 * v6.25.3: push/notificationclick handling is now owned entirely by
 * OneSignal's imported worker code (see importScripts() at the top of this
 * file) -- our own custom listeners for those two events were removed here
 * to avoid double-handling the same event on this shared service worker.
 * OneSignal renders the notification and opens/focuses the `url` we send
 * in the REST API payload (see backend/notifications.py's
 * _send_onesignal()) -- no app-specific code needed here anymore.
 * ------------------------------------------------------------
 */
