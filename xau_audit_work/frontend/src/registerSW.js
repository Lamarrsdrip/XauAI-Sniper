/**
 * The application's single service-worker registration authority.
 *
 * Both the PWA bootstrap and OneSignal call ensureServiceWorkerRegistered().
 * A window-global promise survives React remounts and duplicated bundles, so
 * only one registration request can own the root scope at a time.
 */
const SW_PROMISE_KEY = "__XAU_SERVICE_WORKER_PROMISE__";
const SW_WIRED_KEY = "__XAU_SERVICE_WORKER_UPDATE_WIRED__";
const SW_BOOTSTRAP_KEY = "__XAU_SERVICE_WORKER_BOOTSTRAP_WIRED__";
const CANONICAL_WORKER_PATH = "/service-worker.js";

function globalWindow() {
  return typeof window === "undefined" ? null : window;
}

function registrationUsesCanonicalWorker(registration) {
  const worker = registration?.active || registration?.waiting || registration?.installing;
  const scriptURL = String(worker?.scriptURL || "");
  return scriptURL.endsWith(CANONICAL_WORKER_PATH);
}

export function ensureServiceWorkerRegistered() {
  const w = globalWindow();
  if (!w || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (w[SW_PROMISE_KEY]) return w[SW_PROMISE_KEY];

  const promise = (async () => {
    const existing = await navigator.serviceWorker.getRegistration?.("/");
    if (existing && registrationUsesCanonicalWorker(existing)) return existing;
    return navigator.serviceWorker.register(CANONICAL_WORKER_PATH, { scope: "/" });
  })();

  w[SW_PROMISE_KEY] = promise;
  promise.catch(() => {
    if (w[SW_PROMISE_KEY] === promise) delete w[SW_PROMISE_KEY];
  });
  return promise;
}

function wireUpdateLifecycle(registration) {
  const w = globalWindow();
  if (!w || !registration || w[SW_WIRED_KEY]) return;
  w[SW_WIRED_KEY] = true;

  const updateTimer = window.setInterval(() => {
    registration.update().catch(() => {});
  }, 60 * 1000);
  w.__XAU_SERVICE_WORKER_UPDATE_TIMER__ = updateTimer;

  registration.addEventListener("updatefound", () => {
    const newSW = registration.installing;
    if (!newSW) return;
    newSW.addEventListener("statechange", () => {
      if (newSW.state === "installed" && navigator.serviceWorker.controller) {
        newSW.postMessage("SKIP_WAITING");
      }
    });
  });

  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    // eslint-disable-next-line no-console
    console.log("[XauAi] New service worker live — reloading");
    window.location.reload();
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_UPDATED" && !reloaded) {
      reloaded = true;
      window.location.reload();
    }
  });
}

/** Call once at app bootstrap. Repeated calls are harmless. */
export function registerServiceWorker() {
  const w = globalWindow();
  if (!w || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (w[SW_BOOTSTRAP_KEY]) return;
  w[SW_BOOTSTRAP_KEY] = true;

  const start = async () => {
    try {
      const registration = await ensureServiceWorkerRegistered();
      wireUpdateLifecycle(registration);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[XauAi] SW register failed", error);
    }
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

/** Manual "Clear cache & reload" helper for a genuinely stale installation. */
export async function forceRefreshApp() {
  const w = globalWindow();
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage("CLEAR_CACHES");
    }
    const registrations = await (navigator.serviceWorker?.getRegistrations?.() || []);
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if (window.caches) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    if (w?.__XAU_SERVICE_WORKER_UPDATE_TIMER__) {
      window.clearInterval(w.__XAU_SERVICE_WORKER_UPDATE_TIMER__);
    }
    if (w) {
      delete w[SW_PROMISE_KEY];
      delete w[SW_WIRED_KEY];
      delete w[SW_BOOTSTRAP_KEY];
      delete w.__XAU_SERVICE_WORKER_UPDATE_TIMER__;
    }
  } finally {
    window.location.reload();
  }
}

// Test-only reset. Not called by production code.
export function __resetServiceWorkerForTests() {
  const w = globalWindow();
  if (!w) return;
  if (w.__XAU_SERVICE_WORKER_UPDATE_TIMER__) window.clearInterval(w.__XAU_SERVICE_WORKER_UPDATE_TIMER__);
  delete w[SW_PROMISE_KEY];
  delete w[SW_WIRED_KEY];
  delete w[SW_BOOTSTRAP_KEY];
  delete w.__XAU_SERVICE_WORKER_UPDATE_TIMER__;
}
