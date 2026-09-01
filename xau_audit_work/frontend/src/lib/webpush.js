// ── XauCloud first-party Web Push (VAPID) client ──────────────────────────────
// Opt-in only. Registers a dedicated push worker at the "/push/" scope so it
// never collides with the main service worker / OneSignal. All calls take the
// caller's authenticated axios instance so cookies are sent.

const PUSH_SCOPE = "/push/";
const PUSH_SW = "/push-sw.js";

export const webPushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  window.isSecureContext;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Register the push worker and wait until it has an active worker (required
// before pushManager.subscribe).
async function getActiveRegistration() {
  const reg = await navigator.serviceWorker.register(PUSH_SW, { scope: PUSH_SCOPE });
  if (reg.active) return reg;
  const worker = reg.installing || reg.waiting;
  if (!worker) return reg;
  await new Promise((resolve) => {
    const done = () => { if (worker.state === "activated") resolve(); };
    worker.addEventListener("statechange", done);
    // safety timeout so we never hang the UI
    setTimeout(resolve, 4000);
  });
  return reg;
}

export async function webPushStatus() {
  if (!webPushSupported()) return { supported: false, permission: "unsupported", subscribed: false };
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
    if (reg) subscribed = Boolean(await reg.pushManager.getSubscription());
  } catch (_) { /* ignore */ }
  return { supported: true, permission: Notification.permission, subscribed };
}

export async function enableWebPush(api) {
  if (!webPushSupported()) throw new Error("Push isn't supported on this device or browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications permission was not granted.");
  const { data } = await api.get("/notifications/web-push/key");
  const key = data && data.public_key;
  if (!key) throw new Error("Push isn't configured on the server yet.");
  const reg = await getActiveRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  }
  await api.post("/notifications/web-push/subscribe", { subscription: sub.toJSON() });
  return true;
}

export async function disableWebPush(api) {
  try {
    const reg = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await api.post("/notifications/web-push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch (_) { /* ignore */ }
  return true;
}

export async function testWebPush(api) {
  const { data } = await api.post("/notifications/web-push/test");
  return data;
}
