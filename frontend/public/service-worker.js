/**
 * XAU AI Sniper Command Center — Service Worker
 * ------------------------------------------------------------

 * same root-scope worker. The page can query the worker to distinguish a
 * healthy PWA worker from a PWA worker whose OneSignal import failed.
 */

// worker at the /push/ scope. This worker handles PWA caching only.
const WORKER_VERSION = "xaucloud-pwa-v2-firstparty-push";
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
      first_party_push: true,
      scope: self.registration?.scope || "",
    };
    if (event.ports?.[0]) event.ports[0].postMessage(response);
    else event.source?.postMessage?.(response);
  }
});


// ── XauCloud first-party Web Push ────────────────────────────────────────────
// Push delivery is owned directly by XauCloud's VAPID Web Push backend.
// No third-party push SDK or service-worker authority is used.

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch (_) {
      data = {};
    }
  }

  const title = data.title || "XauCloud";
  const options = {
    body: data.body || "Open XauCloud for the latest update.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.tag || data.category || "xaucloud",
    renotify: false,
    data: {
      deep_link: data.deep_link || "/command/dashboard",
      category: data.category || "SYSTEM",
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const deepLink =
    event.notification?.data?.deep_link || "/command/dashboard";

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        try {
          const url = new URL(client.url);
          const target = new URL(deepLink, url.origin);

          if (url.origin === target.origin) {
            await client.focus();

            if ("navigate" in client) {
              await client.navigate(target.href);
            }

            return;
          }
        } catch (_) {}
      }

      if (clients.openWindow) {
        await clients.openWindow(deepLink);
      }
    })()
  );
});
