import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  sendMail: vi.fn(),
}));
vi.mock("./settings.js", () => ({ getSettings: async () => state.settings }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: state.sendMail }) } }));
const { sendEmailDetailed } = await import("./email.js");

describe("transactional SMTP outcomes", () => {
  beforeEach(() => {
    state.settings = { smtp_email: "sender@example.test", smtp_password: "test-only", email_sender_name: "XauCloud" };
    state.sendMail.mockReset().mockResolvedValue({});
  });
  it("preserves a stable message ID for official license delivery", async () => {
    expect(await sendEmailDetailed("customer@example.test", "License", "<p>License</p>", { messageId: "<license-order@example.test>" })).toEqual({ ok: true });
    expect(state.sendMail.mock.calls[0]![0]).toMatchObject({ to: "customer@example.test", messageId: "<license-order@example.test>" });
  });
  it("reports missing configuration as a known failure that can be retried", async () => {
    state.settings = {};
    expect(await sendEmailDetailed("customer@example.test", "License", "License")).toEqual({ ok: false, error: "Email delivery is not configured." });
    expect(state.sendMail).not.toHaveBeenCalled();
  });
  it.each(["EAUTH", "EENVELOPE", "EMESSAGE"])("reports %s without leaking credentials and permits safe retry", async (code) => {
    state.sendMail.mockRejectedValue({ code, message: "PRIVATE PROVIDER RESPONSE test-only" });
    const result = await sendEmailDetailed("customer@example.test", "License", "License");
    expect(result).toEqual({ ok: false, deliveryUnknown: false, error: `Delivery provider rejected the message (${code}).` });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("test-only");
  });
  it("distinguishes an explicit provider rejection from an ambiguous connection failure", async () => {
    state.sendMail.mockRejectedValue({ code: "ECONNECTION", responseCode: 550 });
    expect(await sendEmailDetailed("customer@example.test", "License", "License")).toMatchObject({ ok: false, deliveryUnknown: false });
    state.sendMail.mockRejectedValue({ code: "ETIMEDOUT" });
    expect(await sendEmailDetailed("customer@example.test", "License", "License")).toMatchObject({ ok: false, deliveryUnknown: true });
  });
  it.each(["CONN", "AUTH PLAIN", "MAIL FROM", "RCPT TO"])("allows safe retry when SMTP failed during %s before message submission", async (command) => {
    state.sendMail.mockRejectedValue({ code: "ETIMEDOUT", command });
    expect(await sendEmailDetailed("customer@example.test", "License", "License")).toMatchObject({ ok: false, deliveryUnknown: false });
  });
  it("preserves uncertain DATA delivery to prevent duplicate automatic email", async () => {
    state.sendMail.mockRejectedValue({ code: "ETIMEDOUT", command: "DATA" });
    expect(await sendEmailDetailed("customer@example.test", "License", "License")).toMatchObject({ ok: false, deliveryUnknown: true });
  });
});
