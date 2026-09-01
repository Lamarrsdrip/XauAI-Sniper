import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin } from "../../auth.js";
import { approveBankTransfer, bankTransferEffectiveStatus, transitionPaymentState } from "../../services/paymentFulfillment.js";
import { sendBankTransferRejectedEmail } from "../../services/paymentEmails.js";

const BankTransferAdminActionRequestSchema = z.object({ reason: z.string().nullable().optional().default("") });

/** Port of server.py:3340 `_redact_bank_transfer_entry` -- list view never returns the (potentially large) base64 proof image. */
function redactBankTransferEntry(tx: Record<string, unknown>): Record<string, unknown> {
  const { bank_transfer_proof: _proof, ...rest } = tx;
  return { ...rest, has_proof: Boolean(tx["bank_transfer_proof"]) };
}

/** Port of server.py's admin bank-transfer review-queue routes (lines 3348-3452). */
export async function registerAdminBankTransferRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/bank-transfers -- server.py:3348
  app.get("/admin/bank-transfers", { preHandler: requireAdmin }, async (request) => {
    const q = z.object({ status: z.string().nullable().optional(), limit: z.coerce.number().int().optional().default(100) }).parse(request.query);
    const query: Record<string, unknown> = { provider: "BANK_TRANSFER" };
    if (q.status) query["payment_status"] = q.status;
    const entries = await getDb()
      .collection("payment_transactions")
      .find(query, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(Math.min(q.limit, 500))
      .toArray();
    const resolved: Record<string, unknown>[] = [];
    for (const tx of entries) {
      tx["payment_status"] = await bankTransferEffectiveStatus(tx);
      resolved.push(redactBankTransferEntry(tx));
    }
    return { total: resolved.length, entries: resolved };
  });

  // GET /admin/bank-transfers/:reference -- server.py:3362
  app.get("/admin/bank-transfers/:reference", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const tx = await getDb().collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    tx["payment_status"] = await bankTransferEffectiveStatus(tx);
    return tx;
  });

  // POST /admin/bank-transfers/:reference/approve -- server.py:3370
  app.post("/admin/bank-transfers/:reference/approve", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const result = await approveBankTransfer(reference, String(admin["email"]));
    if (result.status === "not_found") return reply.code(404).send({ detail: "Not found" });
    if (result.status === "already_fulfilled") return { status: "already_fulfilled", pin: result.pin };
    if (result.status === "not_ready") return reply.code(409).send({ detail: `Order is ${result.effective}, not ready for approval.` });
    if (result.status === "conflict") return reply.code(409).send({ detail: "Another request already claimed approval for this order." });
    return { status: "approved", pin: result.pin };
  });

  // POST /admin/bank-transfers/:reference/reject -- server.py:3414
  app.post("/admin/bank-transfers/:reference/reject", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const req = BankTransferAdminActionRequestSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();
    const tx = await db.collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    const effective = await bankTransferEffectiveStatus(tx);
    const won = await transitionPaymentState(reference, [effective], "BANK_TRANSFER_REJECTED");
    if (!won) return reply.code(409).send({ detail: `Cannot reject an order in state ${effective}.` });
    await db.collection("payment_transactions").updateOne(
      { reference },
      { $set: { rejected_by: admin["email"], rejected_at: new Date().toISOString(), rejection_reason: req.reason ?? "" } },
    );
    await sendBankTransferRejectedEmail(String(tx["buyer_email"] ?? ""), String(tx["buyer_name"] ?? ""), reference, req.reason ?? "");
    return { status: "rejected" };
  });

  // POST /admin/bank-transfers/:reference/mark-expired -- server.py:3432
  app.post("/admin/bank-transfers/:reference/mark-expired", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const tx = await getDb().collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    const effective = await bankTransferEffectiveStatus(tx);
    if (effective === "BANK_TRANSFER_EXPIRED") return { status: "BANK_TRANSFER_EXPIRED", no_op: true };
    const won = await transitionPaymentState(reference, [effective], "BANK_TRANSFER_EXPIRED");
    if (!won) return reply.code(409).send({ detail: `Cannot expire an order in state ${effective}.` });
    return { status: "BANK_TRANSFER_EXPIRED", no_op: false };
  });

  // POST /admin/bank-transfers/:reference/request-info -- server.py:3445
  app.post("/admin/bank-transfers/:reference/request-info", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const req = BankTransferAdminActionRequestSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();
    const tx = await db.collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    const note = { admin_email: admin["email"], note: req.reason ?? "", at: new Date().toISOString(), action: "request_info" };
    await db.collection("payment_transactions").updateOne({ reference }, { $push: { admin_notes: note } } as never);
    return { status: "ok" };
  });
}
