/**
 * XAU AI Sniper Command Center — Service Worker
 * ------------------------------------------------------------
 * Network-first PWA worker with OneSignal Web Push v16 imported into the
 * same root-scope worker. The page can query the worker to distinguish a
 * healthy PWA worker from a PWA worker whose OneSignal import failed.
 */
let oneSignalWorkerImported = false;
let oneSignalWorkerError = "";

try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
  oneSignalWorkerImported = true;
} catch (error) {
  oneSignalWorkerError = String(error?.message || error || "OneSignal worker import failed");
  // Push remains optional for the rest of the PWA, but registration UI must
  // report this state rather than claiming that notifications are available.
  console.warn("[XauAI] OneSignal worker unavailable; push remains disabled.", error);
}

const WORKER_VERSION = "xau-pwa-onesignal-device-v1";
const CACHE_NAME = "xauai-cloud-v" + Date.now();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) return;

  const isCritical = /\.(?:html|js|css|json)$/.test(url.pathname) || req.mode === "navigate";
  if (isCritical) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh && fresh.ok && url.origin === self.location.origin) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch (error) {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("/");
          throw error;
        }
      })(),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((response) => {
      if (response && response.ok && url.origin === self.location.origin) {
        caches.open(CACHE_NAME).then((cache) => cache.put(req, response.clone()).catch(() => {}));
      }
      return response;
    })),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "SKIP_WAITING") self.skipWaiting();
  if (data === "CLEAR_CACHES") {
    caches.keys().then((names) => names.forEach((name) => caches.delete(name)));
  }

  if (data?.type === "XAU_PUSH_DIAGNOSTICS") {
    const response = {
      type: "XAU_PUSH_DIAGNOSTICS_RESULT",
      worker_version: WORKER_VERSION,
      onesignal_worker_imported: oneSignalWorkerImported,
      onesignal_worker_error: oneSignalWorkerError ? oneSignalWorkerError.slice(0, 180) : "",
      scope: self.registration?.scope || "",
    };
    if (event.ports?.[0]) event.ports[0].postMessage(response);
    else event.source?.postMessage?.(response);
  }
});

// Push and notificationclick events are owned by OneSignal's imported worker.
