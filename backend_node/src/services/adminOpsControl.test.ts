import { vi } from "vitest";
const state = vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-secret";
  return {};
});
void state;
vi.mock("../db.js", () => ({ getDb: () => ({ collection: () => ({}) }) }));
vi.mock("./settings.js", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("./emailBranding.js", () => ({ emailBranding: vi.fn(async () => ({ sender_name: "XauCloud", support_email: "support@xaucloud.io", command_center_url: "https://xaucloud.io/command", website_url: "https://xaucloud.io" })) }));
vi.mock("./releaseManifest.js", () => ({ currentEaRelease: vi.fn(async () => null), loadEaReleaseManifest: vi.fn(async () => ({ current_version: null, releases: {} })) }));
vi.mock("./email.js", () => ({ resolveEmailSender: vi.fn(async () => ({ name: "XauCloud", address: "support@xaucloud.io", formatted: "XauCloud <support@xaucloud.io>" })), sendEmailDetailed: vi.fn(async () => ({ ok: true })) }));

import { describe, expect, it } from "vitest";
import { actionPermissions, maskEmail, sanitizeLicense, sanitizeOrder, sanitizeUser } from "./adminOpsControl.js";

describe("adminOpsControl redaction and safe summaries", () => {
  it("masks email without leaking the local part", () => {
    expect(maskEmail("customer@example.com")).toBe("cu***@example.com");
  });
  it("never returns password hashes in user summaries", () => {
    const out = sanitizeUser({ id: "u1", email: "user@example.com", password_hash: "never-return", full_name: "User" });
    expect(out).toMatchObject({ id: "u1", email: "user@example.com", name: "User" });
    expect(out).not.toHaveProperty("password_hash");
  });
  it("masks license PINs by default", () => {
    const out = sanitizeLicense({ id: "l1", pin: "ABC123456", buyer_email: "u@example.com", is_active: true });
    expect(out.pin).not.toBe("ABC123456");
  });
  it("returns only sanitized order fields", () => {
    const out = sanitizeOrder({ reference: "r1", buyer_email: "u@example.com", amount_kobo: 30000, payment_status: "FULFILLED", provider_secret: "nope" });
    expect(out.reference).toBe("r1");
    expect(out).not.toHaveProperty("provider_secret");
  });
  it("defaults to a bounded permission set rather than shell/database access", () => {
    expect(actionPermissions().has("admin.read")).toBe(true);
    expect([...actionPermissions()].some((p) => String(p).includes("shell"))).toBe(false);
  });
});
