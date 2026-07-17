// v6.25.3 owner directive 2026-07-17 -- OneSignal Web Push SDK bootstrap.
// Replaces the retired self-hosted VAPID/pywebpush implementation, which
// was permanently blocked by a missing Python package in production.
// OneSignal's SDK is loaded via <script defer> in public/index.html and
// exposes window.OneSignalDeferred as a queue that works even before that
// script tag has finished loading. Points the SDK at OUR EXISTING service
// worker (public/service-worker.js, which importScripts()'s OneSignal's own
// worker code) instead of letting it register a second, competing service
// worker at the same scope.
let initPromise = null;

export function ensureOneSignalInitialized(appId) {
  if (typeof window === "undefined" || !appId) return Promise.resolve(false);
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId,
          serviceWorkerParam: { scope: "/" },
          serviceWorkerPath: "service-worker.js",
        });
        resolve(true);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[XauAi] OneSignal init failed", e);
        resolve(false);
      }
    });
  });
  return initPromise;
}
