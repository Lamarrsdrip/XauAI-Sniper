import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, emails: 0 }));
vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../auth.js", () => ({ requireAdmin: async (request: { admin?: unknown }) => {
  request.admin = { email: "owner@example.test" };
} }));
vi.mock("../../services/paymentEmails.js", () => ({ sendBankTransferRejectedEmail: async () => { state.emails++; } }));
const { registerAdminBankTransferRoutes } = await import("./bankTransfers.js");

describe("legacy bank payment state protection", () => {
  beforeEach(() => { state.db = new FakeDb(); state.emails = 0; });

  it.each(["FULFILLED", "FULFILLING", "PAID"])("cannot reject or expire %s payments", async (payment_status) => {
    const app = Fastify();
    await registerAdminBankTransferRoutes(app);
    await state.db.collection("payment_transactions").insertOne({ reference: "legacy-order", provider: "BANK_TRANSFER", payment_status });
    for (const action of ["reject", "mark-expired"]) {
      const response = await app.inject({ method: "POST", url: `/admin/bank-transfers/legacy-order/${action}` });
      expect(response.statusCode).toBe(409);
    }
    expect((await state.db.collection("payment_transactions").findOne({ reference: "legacy-order" }))?.["payment_status"]).toBe(payment_status);
    expect(state.emails).toBe(0);
    await app.close();
  });

  it("rejects without fields and preserves one audit entry across duplicate clicks", async () => {
    const app = Fastify();
    await registerAdminBankTransferRoutes(app);
    await state.db.collection("payment_transactions").insertOne({ reference: "legacy-order", provider: "BANK_TRANSFER", payment_status: "BANK_TRANSFER_SUBMITTED" });
    const first = await app.inject({ method: "POST", url: "/admin/bank-transfers/legacy-order/reject" });
    const repeat = await app.inject({ method: "POST", url: "/admin/bank-transfers/legacy-order/reject" });
    expect(first.statusCode).toBe(200);
    expect(repeat.statusCode).toBe(200);
    expect(state.db.collection("payment_review_log").docs).toHaveLength(1);
    expect(state.emails).toBe(1);
    expect((await state.db.collection("payment_transactions").findOne({ reference: "legacy-order" }))?.["rejected_by"]).toBe("owner@example.test");
    await app.close();
  });
});
