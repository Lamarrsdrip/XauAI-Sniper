import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, sent: [] as { to: string; subject: string }[] }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));
vi.mock("./adminOpsControl.js", () => ({ publishedTransactionalRender: vi.fn(async () => null) }));
vi.mock("./emailBranding.js", () => ({
  emailBranding: vi.fn(async () => ({ sender_name: "XauCloud", command_center_url: "https://xaucloud.io/command" })),
  emailLinkButton: () => "",
}));
vi.mock("./email.js", () => ({
  sendEmail: vi.fn(async (to: string, subject: string) => { state.sent.push({ to, subject }); return true; }),
}));

const { sweepSignalLifecycleEmails } = await import("./signalLifecycleEmails.js");

describe("signal lifecycle email sweep", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.sent = [];
  });

  it("sends a trial-ending email once for a trial expiring within 12h, never twice", async () => {
    await state.db.collection("cloud_users").insertOne({ id: "u1", email: "trader@example.com", full_name: "Trader" });
    await state.db.collection("signal_trials").insertOne({
      user_id: "u1", trial_started_at: new Date().toISOString(), trial_expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });
    await sweepSignalLifecycleEmails();
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.subject).toMatch(/trial ends soon/i);

    await sweepSignalLifecycleEmails();
    expect(state.sent).toHaveLength(1); // idempotent, no repeat
  });

  it("sends a trial-expired email once for a trial past expiry", async () => {
    await state.db.collection("cloud_users").insertOne({ id: "u2", email: "expired@example.com", full_name: "Trader Two" });
    await state.db.collection("signal_trials").insertOne({
      user_id: "u2", trial_started_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), trial_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await sweepSignalLifecycleEmails();
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.subject).toMatch(/trial.*ended/i);
    await sweepSignalLifecycleEmails();
    expect(state.sent).toHaveLength(1);
  });

  it("sends subscription expiring/expired emails once each, never spamming", async () => {
    await state.db.collection("cloud_users").insertOne({ id: "u3", email: "sub@example.com", full_name: "Subscriber" });
    await state.db.collection("signal_subscriptions").insertOne({
      user_id: "u3", plan: "WEEKLY", status: "ACTIVE", source_payment_ref: "ref-a",
      activated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    });
    await sweepSignalLifecycleEmails();
    expect(state.sent.filter((s) => /expires soon/i.test(s.subject))).toHaveLength(1);

    state.db.collection("signal_subscriptions").docs[0]!["expires_at"] = new Date(Date.now() - 3_600_000).toISOString();
    await sweepSignalLifecycleEmails();
    expect(state.sent.filter((s) => /has expired/i.test(s.subject))).toHaveLength(1);

    await sweepSignalLifecycleEmails();
    expect(state.sent.filter((s) => /has expired/i.test(s.subject))).toHaveLength(1); // still just one
  });

  it("does not email a cancelled subscription", async () => {
    await state.db.collection("cloud_users").insertOne({ id: "u4", email: "cancelled@example.com", full_name: "Cancelled" });
    await state.db.collection("signal_subscriptions").insertOne({
      user_id: "u4", plan: "MONTHLY", status: "CANCELLED", source_payment_ref: "ref-b",
      activated_at: new Date().toISOString(), expires_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    await sweepSignalLifecycleEmails();
    expect(state.sent).toHaveLength(0);
  });
});
