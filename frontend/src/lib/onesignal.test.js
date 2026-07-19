import {
  waitForCompleteOneSignalRegistration,
  getOneSignalRegistrationSnapshot,
} from "./onesignal";

class EventTargetMock {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    const set = this.listeners.get(type) || new Set();
    set.add(handler); this.listeners.set(type, set);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, value = {}) { for (const handler of this.listeners.get(type) || []) handler(value); }
  count(type) { return this.listeners.get(type)?.size || 0; }
}

function withLiveGetters(target, getters) {
  Object.entries(getters).forEach(([key, get]) => {
    Object.defineProperty(target, key, { configurable: true, enumerable: true, get });
  });
  return target;
}

function sdkState() {
  const pushEvents = new EventTargetMock();
  const userEvents = new EventTargetMock();
  const notificationEvents = new EventTargetMock();
  const state = {
    permission: "default",
    oneSignalPermission: false,
    optedIn: false,
    subscriptionId: "",
    token: "",
    onesignalId: "",
    externalId: "",
  };
  const sdk = {
    Notifications: withLiveGetters(notificationEvents, {
      permission: () => state.oneSignalPermission,
    }),
    User: withLiveGetters(userEvents, {
      onesignalId: () => state.onesignalId,
      externalId: () => state.externalId,
    }),
  };
  sdk.User.PushSubscription = withLiveGetters(pushEvents, {
    id: () => state.subscriptionId,
    token: () => state.token,
    optedIn: () => state.optedIn,
  });
  return { sdk, state, pushEvents, userEvents, notificationEvents };
}

beforeEach(() => {
  Object.defineProperty(global, "Notification", {
    configurable: true,
    value: { permission: "default" },
  });
});

test("waits for delayed subscription id, token, optedIn, OneSignal id and external id", async () => {
  const { sdk, state, pushEvents, userEvents } = sdkState();
  const promise = waitForCompleteOneSignalRegistration(
    sdk,
    "user-123",
    async () => {
      Notification.permission = "granted";
      state.oneSignalPermission = true;
      state.optedIn = true;
      pushEvents.emit("change");
      setTimeout(() => {
        state.subscriptionId = "sub-123";
        state.token = "token-present";
        state.onesignalId = "os-user-123";
        state.externalId = "user-123";
        pushEvents.emit("change");
        userEvents.emit("change");
      }, 5);
    },
    { timeoutMs: 100 },
  );
  const result = await promise;
  expect(result.ok).toBe(true);
  expect(result.subscription_id).toBe("sub-123");
  expect(result.token_present).toBe(true);
  expect(result.external_id_linked).toBe(true);
  expect(pushEvents.count("change")).toBe(0);
  expect(userEvents.count("change")).toBe(0);
});

test("times out visibly and removes all listeners", async () => {
  const { sdk, pushEvents, userEvents, notificationEvents } = sdkState();
  const result = await waitForCompleteOneSignalRegistration(
    sdk,
    "user-timeout",
    async () => {},
    { timeoutMs: 10 },
  );
  expect(result.ok).toBe(false);
  expect(result.code).toBe("REGISTRATION_TIMEOUT");
  expect(pushEvents.count("change")).toBe(0);
  expect(userEvents.count("change")).toBe(0);
  expect(notificationEvents.count("permissionChange")).toBe(0);
});

test("snapshot keeps browser permission separate from OneSignal subscription state", () => {
  const { sdk, state } = sdkState();
  Notification.permission = "granted";
  state.oneSignalPermission = true;
  const snapshot = getOneSignalRegistrationSnapshot(sdk, "user-1", {});
  expect(snapshot.permission).toBe("granted");
  expect(snapshot.opted_in).toBe(false);
  expect(snapshot.subscription_id).toBe("");
  expect(snapshot.token_present).toBe(false);
  expect(snapshot.external_id_linked).toBe(false);
});
