/**
 * XauCloud first-party Web Push worker (VAPID).
 * Deliberately isolated from the main service worker (which imports OneSignal)
 * by registering at the narrow "/push/" scope, so the two push channels never
 * double-handle a single push event during the OneSignal → first-party
 * transition. This worker only shows notifications and routes clicks.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    try { data = { title: "XauCloud", body: event.data ? event.data.text() : "" }; } catch (__) { data = {}; }
  }
  const title = data.title || "XauCloud";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/favicon-64.png",
    tag: data.tag || "xaucloud",
    renotify: true,
    data: { deep_link: data.deep_link || "/command/dashboard", category: data.category || "SYSTEM" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.deep_link) || "/command/dashboard";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          try { await client.navigate(link); } catch (_) { /* cross-origin or blocked */ }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })(),
  );
});
