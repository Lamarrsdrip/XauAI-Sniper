import { vi } from "vitest";
vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-secret";
});

const sent = vi.hoisted(() => ({ calls: [] as { to: string; subject: string; html: string }[] }));
vi.mock("./email.js", () => ({
  sendEmail: vi.fn(async (to: string, subject: string, html: string) => { sent.calls.push({ to, subject, html }); return true; }),
}));
const overrideState = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock("./adminOpsControl.js", () => ({ publishedTransactionalRender: vi.fn(async () => overrideState.value) }));
vi.mock("./settings.js", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("../env.js", () => ({ env: { PUBLIC_SITE_URL: "https://xaucloud.io" } }));

import { beforeEach, describe, expect, it } from "vitest";
const { sendPaymentFailedEmail, sendLicenseStatusEmail, sendAccountNoticeEmail, sendPasswordChangedEmail, maskLicensePin } = await import("./accountLifecycleEmails.js");

describe("account lifecycle transactional emails", () => {
  beforeEach(() => { sent.calls = []; overrideState.value = null; });

  it("sends payment_failed with the code-default template when no admin override exists", async () => {
    const ok = await sendPaymentFailedEmail("buyer@example.com", "Ada", "REF-1", "Card declined");
    expect(ok).toBe(true);
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]!.to).toBe("buyer@example.com");
    expect(sent.calls[0]!.html).toContain("REF-1");
    expect(sent.calls[0]!.html).toContain("Card declined");
  });

  it("uses the admin-published override for payment_failed when one exists, not the code default", async () => {
    overrideState.value = { subject: "Custom subject", html: "<p>custom body</p>", text: "custom" };
    await sendPaymentFailedEmail("buyer@example.com", "Ada", "REF-2");
    expect(sent.calls[0]!.subject).toBe("Custom subject");
    expect(sent.calls[0]!.html).toBe("<p>custom body</p>");
  });

  it("sends a distinct license_status message per change type", async () => {
    await sendLicenseStatusEmail("buyer@example.com", "Ada", "deactivated", "AB****89");
    expect(sent.calls[0]!.html).toContain("deactivated");
    sent.calls = [];
    await sendLicenseStatusEmail("buyer@example.com", "Ada", "transferred", "AB****89");
    expect(sent.calls[0]!.html).toContain("transferred");
  });

  it("sends account_notice with the admin-supplied subject and message, never a fixed generic body", async () => {
    await sendAccountNoticeEmail("buyer@example.com", "Ada", "Your account needs attention", "Please verify your payout details.");
    expect(sent.calls[0]!.subject).toBe("Your account needs attention");
    expect(sent.calls[0]!.html).toContain("Please verify your payout details.");
  });

  it("sends password_changed confirming sessions were revoked", async () => {
    await sendPasswordChangedEmail("buyer@example.com", "Ada");
    expect(sent.calls[0]!.html).toMatch(/sessions have been signed out/i);
  });

  it("masks a license PIN without exposing the full value", () => {
    const masked = maskLicensePin("ABCD123456");
    expect(masked).not.toBe("ABCD123456");
    expect(masked.startsWith("AB")).toBe(true);
    expect(masked.endsWith("56")).toBe(true);
  });
});
