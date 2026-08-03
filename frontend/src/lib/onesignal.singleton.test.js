import {
  __resetOneSignalForTests,
  ensureOneSignalInitialized,
} from "./onesignal";

jest.mock("../registerSW", () => ({
  ensureServiceWorkerRegistered: jest.fn(),
}));

function sdk(initImpl = () => Promise.resolve()) {
  return {
    init: jest.fn(initImpl),
    User: { PushSubscription: {} },
    Notifications: {},
  };
}

describe("OneSignal global initialization authority", () => {
  beforeEach(() => {
    __resetOneSignalForTests();
  });

  test("concurrent callers initialize exactly once", async () => {
    const first = ensureOneSignalInitialized("app-1");
    const second = ensureOneSignalInitialized("app-1");
    expect(first).toBe(second);
    expect(window.OneSignalDeferred).toHaveLength(1);

    const oneSignal = sdk();
    await window.OneSignalDeferred[0](oneSignal);
    await Promise.all([first, second]);
    expect(oneSignal.init).toHaveBeenCalledTimes(1);
  });

  test("same-app already-initialized SDK is reused", async () => {
    const promise = ensureOneSignalInitialized("app-1");
    const oneSignal = sdk(() => Promise.reject(new Error("SDK already initialized")));
    await window.OneSignalDeferred[0](oneSignal);
    await expect(promise).resolves.toBe(oneSignal);
  });

  test("genuine initialization failure clears the promise for retry", async () => {
    const failed = ensureOneSignalInitialized("app-1");
    const badSdk = sdk(() => Promise.reject(new Error("network failure")));
    await window.OneSignalDeferred[0](badSdk);
    await expect(failed).rejects.toThrow("network failure");

    const retry = ensureOneSignalInitialized("app-1");
    expect(retry).not.toBe(failed);
  });
});
