import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, test, vi } from "vitest";

const memory = vi.hoisted(() => new Map<string, Record<string, unknown>[]>());
const sendEmailDetailed = vi.hoisted(() => vi.fn());

function rows(name: string): Record<string, unknown>[] {
  const existing = memory.get(name) ?? [];
  memory.set(name, existing);
  return existing;
}

vi.mock("../db.js", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      insertOne: async (document: Record<string, unknown>) => {
        const sameKey = name === "transactional_email_events" && rows(name).some((row) => row["event_key"] === document["event_key"]);
        const sameJti = (name === "used_email_verification_tokens" || name === "used_password_reset_tokens") && rows(name).some((row) => row["jti"] === document["jti"]);
        if (sameKey || sameJti) throw Object.assign(new Error("duplicate"), { code: 11000 });
        rows(name).push({ ...document });
        return { acknowledged: true };
      },
      updateOne: async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
        const row = rows(name).find((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value));
        if (!row) return { matchedCount: 0 };
        Object.assign(row, update["$set"] ?? {});
        return { matchedCount: 1 };
      },
      findOne: async (filter: Record<string, unknown>) => rows(name).find((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value)) ?? null,
    }),
  }),
}));
vi.mock("./email.js", () => ({ sendEmailDetailed }));
vi.mock("./adminOpsControl.js", () => ({
  publishedTransactionalRender: vi.fn(async () => null),
  renderTransactional: vi.fn(async (_document: unknown, subject: string, text: string, context: Record<string, string>) => ({
    subject,
    text,
    html: `<div style="background:#FFFFFF;color:#111114">${context["verify_url"] ?? context["reset_url"] ?? "welcome"}</div>`,
  })),
}));
vi.mock("./emailBranding.js", () => ({ emailBranding: vi.fn(async () => ({ sender_name: "XauCloud", support_email: "support@xaucloud.io", command_center_url: "https://xaucloud.io/command" })) }));
vi.mock("../env.js", () => ({ env: { JWT_SECRET: "account-recovery-test-secret", PUBLIC_SITE_URL: "https://xaucloud.io" } }));

import {
  consumePasswordResetToken,
  passwordResetToken,
  sendPasswordResetEmailForUser,
  sendSignupTransactionalEmails,
  sendVerificationEmailForUser,
  verifyEmailToken,
} from "./accountRecovery.js";

const user = { id: "user-1", email: "trader@example.test", full_name: "Tala Trader", email_verified: false };

beforeEach(() => {
  memory.clear();
  sendEmailDetailed.mockReset();
  sendEmailDetailed.mockResolvedValue({ ok: true });
  rows("cloud_users").push({ ...user });
});

describe("account transactional mail", () => {
  test("signup sends welcome and verification once, through the premium renderer", async () => {
    await sendSignupTransactionalEmails(user);
    await sendSignupTransactionalEmails(user);

    expect(sendEmailDetailed).toHaveBeenCalledTimes(2);
    expect(rows("admin_email_log").map((row) => row["template_id"])).toEqual(["welcome", "account_verification"]);
    expect(rows("transactional_email_events")).toHaveLength(2);
    const html = String(sendEmailDetailed.mock.calls[0]?.[2] ?? "");
    expect(html).toContain("background:#FFFFFF");
    expect(html).toContain("color:#111114");
  });

  test("verified accounts do not receive an automatic verification email, while manual resend remains available", async () => {
    await sendVerificationEmailForUser({ ...user, email_verified: true }, "account_signup", "account_created:user-1:account_verification");
    expect(sendEmailDetailed).not.toHaveBeenCalled();

    await sendVerificationEmailForUser(user, "admin_resend");
    await sendVerificationEmailForUser(user, "admin_resend");
    expect(sendEmailDetailed).toHaveBeenCalledTimes(2);
  });

  test("failed delivery is recorded and never breaks the completed signup workflow", async () => {
    sendEmailDetailed.mockResolvedValue({ ok: false, error: "Delivery provider rejected the message (SMTP_ERROR)." });
    await expect(sendSignupTransactionalEmails(user)).resolves.toHaveLength(2);
    expect(rows("admin_email_log").every((row) => row["status"] === "failed")).toBe(true);
    expect(rows("transactional_email_events").every((row) => row["status"] === "failed")).toBe(true);
  });

  test("forgot-password mail is delivered automatically and never writes its token to delivery history", async () => {
    await sendPasswordResetEmailForUser(user, "customer_forgot_password");
    expect(sendEmailDetailed).toHaveBeenCalledTimes(1);
    const html = String(sendEmailDetailed.mock.calls[0]?.[2] ?? "");
    const token = new URL(String(html.match(/https:\/\/xaucloud\.io\/command\/reset-password\?token=[^"\s<]+/)?.[0] ?? "")).searchParams.get("token");
    expect(token).toBeTruthy();
    expect(JSON.stringify(rows("admin_email_log"))).not.toContain(String(token));
  });

  test("verification and reset tokens expire and cannot be used twice", async () => {
    const expiredReset = jwt.sign({ sub: user.id, type: "password_reset", jti: "expired-reset" }, "account-recovery-test-secret", { expiresIn: -1 });
    await expect(consumePasswordResetToken(expiredReset)).rejects.toThrow("expired");

    const reset = passwordResetToken(user.id, "single-use-reset");
    await expect(consumePasswordResetToken(reset)).resolves.toBe(user.id);
    await expect(consumePasswordResetToken(reset)).rejects.toThrow("already been used");

    const verification = jwt.sign({ sub: user.id, type: "email_verification", jti: "single-use-verify" }, "account-recovery-test-secret", { expiresIn: "24h" });
    await expect(verifyEmailToken(verification)).resolves.toMatchObject({ verified: true });
    await expect(verifyEmailToken(verification)).rejects.toThrow("already been used");
  });
});
