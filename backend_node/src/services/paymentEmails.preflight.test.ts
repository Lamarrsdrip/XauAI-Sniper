import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ render: vi.fn(), send: vi.fn() }));
vi.mock("../db.js", () => ({ getDb: () => { throw new Error("No database access expected"); } }));
vi.mock("../env.js", () => ({ env: { PUBLIC_SITE_URL: "https://xaucloud.io" } }));
vi.mock("./email.js", () => ({ sendEmailDetailed: state.send, sendEmail: vi.fn() }));
vi.mock("./adminOpsControl.js", () => ({ publishedTransactionalRender: state.render }));
vi.mock("./releaseManifest.js", () => ({ currentEaRelease: async () => null }));
vi.mock("./emailBranding.js", () => ({ adminNotifyRow: vi.fn(), emailBranding: vi.fn(), emailLinkButton: vi.fn(), emailStep: vi.fn(), notifyAdmin: vi.fn(), TELEGRAM_SUPPORT_URL: "https://example.test/support" }));
const { sendPinEmailDetailed, sendPinEmail } = await import("./paymentEmails.js");

describe("official license email preparation failures", () => {
  beforeEach(() => {
    state.render.mockReset();
    state.send.mockReset().mockResolvedValue({ ok: true });
  });
  it("returns a known retryable result when the official template cannot render, without SMTP submission", async () => {
    state.render.mockRejectedValue(new Error("PRIVATE template/settings error"));
    const result = await sendPinEmailDetailed("customer@example.test", "Test Customer", "ASE-TEST-KEY1");
    expect(result).toEqual({ ok: false, error: "Official license email template or sender settings could not be prepared. Retry fulfillment." });
    expect(state.send).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("can safely retry after template repair and submits the official message just once", async () => {
    state.render.mockRejectedValueOnce(new Error("Invalid template"))
      .mockResolvedValue({ subject: "Official license", html: "<p>ASE-TEST-KEY1</p>", text: "ASE-TEST-KEY1" });
    expect((await sendPinEmailDetailed("customer@example.test", "Test Customer", "ASE-TEST-KEY1")).ok).toBe(false);
    expect(await sendPinEmailDetailed("customer@example.test", "Test Customer", "ASE-TEST-KEY1", "<stable-license@example.test>")).toEqual({ ok: true });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send).toHaveBeenCalledWith("customer@example.test", "Official license", "<p>ASE-TEST-KEY1</p>", { text: "ASE-TEST-KEY1", messageId: "<stable-license@example.test>" });
  });
  it("preserves the existing boolean sendPinEmail API on preparation failure", async () => {
    state.render.mockRejectedValue(new Error("Invalid template"));
    expect(await sendPinEmail("customer@example.test", "Test Customer", "ASE-TEST-KEY1")).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
  });
});
