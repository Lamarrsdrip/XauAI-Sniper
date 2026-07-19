// OneSignal Web Push v16 registration authority.
//
// Browser permission, OneSignal user identity, and the browser's push
// subscription are separate asynchronous states. A registration is accepted
// only after all three are complete and the backend has stored this specific
// device subscription.
const REGISTRATION_VERSION = "onesignal-web-v16-device-v1";
const DEVICE_INSTANCE_STORAGE_KEY = "xauai.onesignal.device_instance_id.v1";
const DEFAULT_TIMEOUT_MS = 20000;

let initPromise = null;
let sdkInstance = null;
let initializedAppId = null;

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateDeviceInstanceId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(DEVICE_INSTANCE_STORAGE_KEY);
    if (existing) return existing;
    const created = makeId();
    window.localStorage.setItem(DEVICE_INSTANCE_STORAGE_KEY, created);
    return created;
  } catch (_) {
    // Private-mode/storage failures must not prevent registration. The value is
    // stable for this page session and the OneSignal subscription id remains
    // the backend's unique key.
    if (!window.__xauOneSignalDeviceInstanceId) window.__xauOneSignalDeviceInstanceId = makeId();
    return window.__xauOneSignalDeviceInstanceId;
  }
}

export function isInstalledStandalonePwa() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
    navigator.standalone === true
  );
}

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  const platform = String(navigator.platform || "");
  return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

function browserPermissionState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission || "default";
}

function errorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.message) return detail.message;
  if (error?.response?.data?.message) return error.response.data.message;
  return error?.message || fallback;
}

function maskId(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 10) return `${text.slice(0, 3)}…${text.slice(-2)}`;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

async function waitForServiceWorkerController(timeoutMs = 5000) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return false;
  if (navigator.serviceWorker.controller) return true;
  return new Promise((resolve) => {
    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener?.("controllerchange", onChange);
      resolve(value);
    };
    const onChange = () => done(Boolean(navigator.serviceWorker.controller));
    const timer = setTimeout(() => done(Boolean(navigator.serviceWorker.controller)), timeoutMs);
    navigator.serviceWorker.addEventListener?.("controllerchange", onChange);
  });
}

async function queryServiceWorkerDiagnostics(registration, timeoutMs = 2000) {
  const worker = registration?.active || registration?.waiting || registration?.installing;
  if (!worker || typeof MessageChannel === "undefined") {
    return { provider_import_known: false, onesignal_worker_imported: null };
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { channel.port1.close(); } catch (_) {}
      try { channel.port2.close(); } catch (_) {}
      resolve(value);
    };
    channel.port1.onmessage = (event) => {
      const data = event?.data || {};
      finish({
        provider_import_known: true,
        onesignal_worker_imported: data.onesignal_worker_imported === true,
        worker_version: data.worker_version || "",
      });
    };
    const timer = setTimeout(() => finish({ provider_import_known: false, onesignal_worker_imported: null }), timeoutMs);
    try {
      worker.postMessage({ type: "XAU_PUSH_DIAGNOSTICS" }, [channel.port2]);
    } catch (_) {
      finish({ provider_import_known: false, onesignal_worker_imported: null });
    }
  });
}

async function ensureRootServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return {
      ok: false,
      code: "SERVICE_WORKER_UNSUPPORTED",
      message: "This browser does not support service workers.",
      service_worker_active: false,
      service_worker_controlling: false,
      service_worker_scope: "",
    };
  }
  try {
    const registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const activeRegistration = ready || registration;
    const controlling = await waitForServiceWorkerController();
    const provider = await queryServiceWorkerDiagnostics(activeRegistration);
    if (provider.provider_import_known && provider.onesignal_worker_imported === false) {
      return {
        ok: false,
        code: "ONESIGNAL_WORKER_UNAVAILABLE",
        message: "The app service worker loaded, but the OneSignal push worker did not.",
        service_worker_active: Boolean(activeRegistration?.active),
        service_worker_controlling: controlling,
        service_worker_scope: activeRegistration?.scope || "",
        ...provider,
      };
    }
    return {
      ok: Boolean(activeRegistration?.active),
      code: activeRegistration?.active ? "SERVICE_WORKER_READY" : "SERVICE_WORKER_NOT_ACTIVE",
      message: activeRegistration?.active ? "Service worker ready." : "Service worker is not active yet.",
      registration: activeRegistration,
      service_worker_active: Boolean(activeRegistration?.active),
      service_worker_controlling: controlling,
      service_worker_scope: activeRegistration?.scope || "",
      ...provider,
    };
  } catch (error) {
    return {
      ok: false,
      code: "SERVICE_WORKER_REGISTRATION_FAILED",
      message: errorMessage(error, "Service worker registration failed."),
      service_worker_active: false,
      service_worker_controlling: false,
      service_worker_scope: "",
    };
  }
}

export function ensureOneSignalInitialized(appId) {
  if (typeof window === "undefined" || !appId) return Promise.resolve(null);
  if (sdkInstance && initializedAppId === appId) return Promise.resolve(sdkInstance);
  if (initializedAppId && initializedAppId !== appId) {
    return Promise.reject(new Error("OneSignal App ID changed during this browser session. Reload the app."));
  }
  if (initPromise) return initPromise;

  initializedAppId = appId;
  initPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OneSignal SDK initialization timed out.")), 15000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId,
          serviceWorkerParam: { scope: "/" },
          serviceWorkerPath: "/service-worker.js",
          autoResubscribe: true,
        });
        sdkInstance = OneSignal;
        clearTimeout(timeout);
        resolve(OneSignal);
      } catch (error) {
        clearTimeout(timeout);
        initPromise = null;
        initializedAppId = null;
        // eslint-disable-next-line no-console
        console.warn("[XauAi] OneSignal init failed", error);
        reject(error);
      }
    });
  });
  return initPromise;
}

export function getOneSignalRegistrationSnapshot(oneSignal = sdkInstance, expectedExternalId = "", serviceWorker = {}) {
  const push = oneSignal?.User?.PushSubscription;
  const subscriptionId = String(push?.id || "").trim();
  const token = String(push?.token || "").trim();
  const onesignalId = String(oneSignal?.User?.onesignalId || "").trim();
  const externalId = String(oneSignal?.User?.externalId || "").trim();
  const permission = browserPermissionState();
  return {
    permission,
    one_signal_permission: oneSignal?.Notifications?.permission === true,
    opted_in: push?.optedIn === true,
    subscription_id: subscriptionId,
    subscription_id_masked: maskId(subscriptionId),
    token_present: Boolean(token),
    onesignal_id: onesignalId,
    onesignal_id_masked: maskId(onesignalId),
    external_id: externalId,
    external_id_linked: Boolean(expectedExternalId && externalId === String(expectedExternalId)),
    one_signal_initialized: Boolean(oneSignal),
    service_worker_active: Boolean(serviceWorker?.service_worker_active),
    service_worker_controlling: Boolean(serviceWorker?.service_worker_controlling),
    service_worker_scope: serviceWorker?.service_worker_scope || "",
    onesignal_worker_imported: serviceWorker?.onesignal_worker_imported ?? null,
    standalone_mode: isInstalledStandalonePwa(),
    ios_device: isIosDevice(),
  };
}

function isCompleteSnapshot(snapshot, expectedExternalId) {
  return Boolean(
    snapshot.permission === "granted" &&
    snapshot.one_signal_permission &&
    snapshot.opted_in &&
    snapshot.subscription_id &&
    snapshot.token_present &&
    snapshot.onesignal_id &&
    snapshot.external_id === String(expectedExternalId)
  );
}

export async function waitForCompleteOneSignalRegistration(
  oneSignal,
  expectedExternalId,
  performActions,
  { timeoutMs = DEFAULT_TIMEOUT_MS, serviceWorker = {} } = {},
) {
  const push = oneSignal?.User?.PushSubscription;
  const user = oneSignal?.User;
  const notifications = oneSignal?.Notifications;
  if (!push || !user || !notifications) {
    return {
      ok: false,
      code: "SDK_STATE_UNAVAILABLE",
      message: "OneSignal did not expose its user or push-subscription state.",
      ...getOneSignalRegistrationSnapshot(oneSignal, expectedExternalId, serviceWorker),
    };
  }

  let timeout;
  let settled = false;
  let resolveWait;
  const waitPromise = new Promise((resolve) => { resolveWait = resolve; });

  const cleanup = () => {
    clearTimeout(timeout);
    try { push.removeEventListener?.("change", onChange); } catch (_) {}
    try { user.removeEventListener?.("change", onChange); } catch (_) {}
    try { notifications.removeEventListener?.("permissionChange", onChange); } catch (_) {}
  };

  const finish = (result) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveWait(result);
  };

  const check = () => {
    const snapshot = getOneSignalRegistrationSnapshot(oneSignal, expectedExternalId, serviceWorker);
    if (isCompleteSnapshot(snapshot, expectedExternalId)) {
      finish({ ok: true, code: "DEVICE_READY", message: "OneSignal device subscription is complete.", ...snapshot });
    }
  };

  function onChange() { check(); }

  push.addEventListener?.("change", onChange);
  user.addEventListener?.("change", onChange);
  notifications.addEventListener?.("permissionChange", onChange);
  timeout = setTimeout(() => {
    const snapshot = getOneSignalRegistrationSnapshot(oneSignal, expectedExternalId, serviceWorker);
    finish({
      ok: false,
      code: "REGISTRATION_TIMEOUT",
      message: "OneSignal did not finish creating and linking this device within 20 seconds.",
      ...snapshot,
    });
  }, timeoutMs);

  check();
  if (!settled) {
    try {
      await performActions();
      check();
    } catch (error) {
      const snapshot = getOneSignalRegistrationSnapshot(oneSignal, expectedExternalId, serviceWorker);
      finish({
        ok: false,
        code: "REGISTRATION_ACTION_FAILED",
        message: errorMessage(error, "OneSignal registration action failed."),
        ...snapshot,
      });
    }
  }
  return waitPromise;
}

function platformName() {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgentData?.platform || navigator.platform || "";
}

function browserName() {
  if (typeof navigator === "undefined") return "";
  const ua = String(navigator.userAgent || "");
  if (/CriOS|Chrome/i.test(ua)) return "Chrome";
  if (/FxiOS|Firefox/i.test(ua)) return "Firefox";
  if (/EdgiOS|Edg/i.test(ua)) return "Edge";
  if (/Safari/i.test(ua)) return "Safari";
  return "Web";
}

export async function ensureOneSignalDeviceRegistered({
  apiClient,
  requestPermission = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = {
    ok: false,
    code: "REGISTRATION_FAILED",
    message: "Device registration failed.",
    permission: browserPermissionState(),
    service_worker_active: false,
  };

  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { ...base, code: "BROWSER_REQUIRED", message: "Notifications require a browser." };
  }
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || typeof PushManager === "undefined") {
    return { ...base, code: "PUSH_UNSUPPORTED", message: "This browser does not support web push notifications." };
  }
  if (isIosDevice() && !isInstalledStandalonePwa()) {
    return {
      ...base,
      code: "IOS_PWA_INSTALL_REQUIRED",
      message: "On iPhone, add XAU AI Sniper to your Home Screen and open it from the Home Screen icon before enabling notifications.",
      standalone_mode: false,
      ios_device: true,
    };
  }
  if (!apiClient?.get || !apiClient?.post) {
    return { ...base, code: "API_CLIENT_MISSING", message: "Notification registration API client is unavailable." };
  }

  try {
    const [{ data: appData }, { data: idData }] = await Promise.all([
      apiClient.get("/outlook/notifications/onesignal-app-id"),
      apiClient.get("/outlook/notifications/my-user-id"),
    ]);
    if (!appData?.configured || !appData?.app_id) {
      return { ...base, code: "SERVER_NOT_CONFIGURED", message: "Push server is not configured yet." };
    }
    const externalId = String(idData?.user_id || "").trim();
    if (!externalId) {
      return { ...base, code: "AUTHENTICATED_USER_MISSING", message: "The authenticated notification user ID is unavailable." };
    }

    const serviceWorker = await ensureRootServiceWorker();
    if (!serviceWorker.ok) return { ...base, ...serviceWorker };

    const oneSignal = await ensureOneSignalInitialized(appData.app_id);
    const supported = await Promise.resolve(oneSignal?.Notifications?.isPushSupported?.());
    if (!supported) {
      return { ...base, ...serviceWorker, code: "PUSH_UNSUPPORTED", message: "OneSignal reports that web push is unsupported on this browser." };
    }

    const currentPermission = browserPermissionState();
    if (currentPermission === "denied") {
      return {
        ...base,
        ...serviceWorker,
        ...getOneSignalRegistrationSnapshot(oneSignal, externalId, serviceWorker),
        code: "PERMISSION_DENIED",
        message: "Notifications are blocked in browser or iPhone settings.",
      };
    }
    if (currentPermission === "default" && !requestPermission) {
      return {
        ...base,
        ...serviceWorker,
        ...getOneSignalRegistrationSnapshot(oneSignal, externalId, serviceWorker),
        code: "PERMISSION_REQUIRED",
        message: "Tap Retry registration to grant notification permission.",
      };
    }

    const ready = await waitForCompleteOneSignalRegistration(
      oneSignal,
      externalId,
      async () => {
        await oneSignal.login(externalId);
        if (browserPermissionState() === "default" && requestPermission) {
          await oneSignal.Notifications.requestPermission();
        }
        if (browserPermissionState() !== "granted" && oneSignal.Notifications.permission !== true) {
          throw new Error("Notification permission was not granted.");
        }
        await Promise.resolve(oneSignal.User.PushSubscription.optIn());
      },
      { timeoutMs, serviceWorker },
    );
    if (!ready.ok) return ready;

    const deviceInstanceId = getOrCreateDeviceInstanceId();
    const syncBody = {
      onesignal_subscription_id: ready.subscription_id,
      onesignal_id: ready.onesignal_id,
      external_id: externalId,
      device_instance_id: deviceInstanceId,
      device_label: String(navigator.userAgent || "").slice(0, 120),
      platform: platformName().slice(0, 80),
      browser: browserName().slice(0, 40),
      timezone_offset_minutes: -new Date().getTimezoneOffset(),
      permission_state: ready.permission,
      opted_in: ready.opted_in,
      token_present: ready.token_present,
      service_worker_scope: ready.service_worker_scope || "/",
      registration_version: REGISTRATION_VERSION,
    };
    const { data: backend } = await apiClient.post("/outlook/notifications/subscribe", syncBody);
    if (!backend?.ok) {
      return { ...ready, ok: false, code: "BACKEND_SYNC_FAILED", message: backend?.message || "Backend device synchronization failed." };
    }
    return {
      ...ready,
      ok: true,
      code: "DEVICE_REGISTERED",
      message: "This device is registered for notifications.",
      backend_device_id: backend.device_id,
      active_device_count: backend.active_device_count,
      backend_device_record_present: true,
      device_instance_id: deviceInstanceId,
      registration_version: REGISTRATION_VERSION,
    };
  } catch (error) {
    return {
      ...base,
      code: error?.response?.data?.detail?.code || "REGISTRATION_FAILED",
      message: errorMessage(error, "Device registration failed."),
    };
  }
}

export async function logoutOneSignalUser(apiClient = null) {
  try {
    if (!sdkInstance && apiClient?.get) {
      const { data } = await apiClient.get("/outlook/notifications/onesignal-app-id");
      if (data?.configured && data?.app_id) await ensureOneSignalInitialized(data.app_id);
    }
    const snapshot = getOneSignalRegistrationSnapshot(sdkInstance, sdkInstance?.User?.externalId || "", {});
    if (apiClient?.post && (snapshot.subscription_id || snapshot.external_id)) {
      try {
        await apiClient.post("/outlook/notifications/unsubscribe", {
          onesignal_subscription_id: snapshot.subscription_id || null,
          device_instance_id: getOrCreateDeviceInstanceId(),
          external_id: snapshot.external_id || null,
        });
      } catch (_) {
        // SDK logout still prevents future external-id targeting even if the
        // backend association could not be marked inactive during a network
        // interruption.
      }
    }
    if (sdkInstance?.logout) await sdkInstance.logout();
    return { ok: true };
  } catch (error) {
    return { ok: false, code: "ONESIGNAL_LOGOUT_FAILED", message: errorMessage(error, "OneSignal logout failed.") };
  }
}

// Test-only reset. Not called by production code.
export function __resetOneSignalForTests() {
  initPromise = null;
  sdkInstance = null;
  initializedAppId = null;
}
