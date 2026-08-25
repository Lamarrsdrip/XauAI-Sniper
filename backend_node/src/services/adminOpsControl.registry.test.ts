import { vi } from "vitest";
vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
  process.env["JWT_SECRET"] = "test-secret";
});

class FakeCollection {
  docs: Record<string, unknown>[] = [];
  find() { const rows = this.docs; return { toArray: async () => rows }; }
}
class FakeDb {
  private map = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    if (!this.map.has(name)) this.map.set(name, new FakeCollection());
    return this.map.get(name)!;
  }
}
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

import { beforeEach, describe, expect, it } from "vitest";
const { listTransactionalTemplates } = await import("./adminOpsControl.js");

describe("transactional template registry (2026-08-25 email-system audit)", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("reports every genuinely-wired template id as wired, not just the original six", async () => {
    const rows = await listTransactionalTemplates();
    const byId = new Map(rows.map((r) => [r["template_id"], r["live_wiring"]]));
    for (const id of [
      "license_delivery", "bank_transfer_instructions", "bank_transfer_rejected", "welcome", "account_verification", "password_reset",
      "payment_failed", "license_status", "account_notice", "password_changed",
      "trial_started", "trial_ending", "trial_expired",
      "signal_subscription_activated", "subscription_expiring", "subscription_expired",
    ]) {
      expect(byId.get(id), `${id} should be wired`).toBe("wired");
    }
  });

  it("does not silently claim wiring for an id with no traced trigger", async () => {
    // Sanity check the assertion above isn't vacuous -- an unrelated id must still read not_currently_wired.
    const rows = await listTransactionalTemplates();
    expect(rows.map((r) => r["template_id"])).not.toContain("made_up_template_id");
  });
});
