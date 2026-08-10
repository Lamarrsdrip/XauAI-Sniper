
/*
 * XauCloud legacy push-worker retirement endpoint.
 *
 * OneSignal is no longer a notification authority.
 * This file intentionally contains NO OneSignal SDK import.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch (_) {}

      try {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });

        for (const client of clients) {
          client.postMessage({
            type: "XAU_PUSH_WORKER_RETIRED",
            provider: "legacy",
          });
        }
      } catch (_) {}
    })()
  );
});

// Never show notifications from this retired worker.
self.addEventListener("push", () => {});
