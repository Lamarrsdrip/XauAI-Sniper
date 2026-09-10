import { randomBytes, randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { getDb } from "../db.js";
import { getSettings } from "./settings.js";
import { getActiveNombaCredentials } from "./nombaConfig.js";
import { NombaError, verifyTransaction } from "./nombaService.js";
import { notifyAdminNewSale, notifyAdminNewSignalSale, recordFulfillmentEmailResult, recordSubscriptionEmailResult, sendPinEmail, sendSignalSubscriptionEmail } from "./paymentEmails.js";
import { activateSignalSubscription, type SignalPlan } from "./signalSubscriptions.js";

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

const SIGNAL_PLAN_IDS = new Set<string>(["SIGNALS_WEEKLY", "SIGNALS_MONTHLY"]);
export function isSignalPlan(planId: unknown): planId is SignalPlan { return SIGNAL_PLAN_IDS.has(String(planId ?? "")); }
const PLAN_LABEL: Record<SignalPlan, string> = { SIGNALS_WEEKLY: "Weekly Signals", SIGNALS_MONTHLY: "Monthly Signals" };

/**
 * The SIGNALS_WEEKLY/SIGNALS_MONTHLY sibling of mintLicenseForReference,
 * called from the exact same FULFILLING-state choke point in all three
 * fulfillment functions below. Never mints a pin_licenses row -- a signal
 * subscription is a separate product from the lifetime bot license.
 */
async function activateSubscriptionForReference(reference: string, tx: Record<string, unknown>): Promise<Awaited<ReturnType<typeof activateSignalSubscription>>> {
  const planId = tx["plan_id"] as SignalPlan;
  return activateSignalSubscription(reference, tx, planId);
}

const DELIVERY_CLAIM_STALE_MS = 10 * 60_000;

/** Email and admin notification are durable tasks, separate from entitlement creation. */
async function deliverFulfillmentNotifications(reference: string, tx: Record<string, unknown>, gateway: string, providerReference = reference): Promise<void> {
  const db = getDb();
  const buyerEmail = String(tx["buyer_email"] ?? "");
  const buyerName = String(tx["buyer_name"] ?? "");
  const amountFormatted = `₦${(Number(tx["amount_kobo"] ?? 0) / 100).toLocaleString("en-US")}`;
  const staleBefore = new Date(Date.now() - DELIVERY_CLAIM_STALE_MS).toISOString();
  const retryableClaim = (field: string, claimedField: string) => ({
    reference,
    payment_status: "FULFILLED",
    $or: [
      { [field]: { $in: ["PENDING", "RETRYABLE"] } },
      { [field]: "SENDING", [claimedField]: { $lt: staleBefore } },
    ],
  });

  const emailClaim = await db.collection("payment_transactions").updateOne(
    retryableClaim("fulfillment_email_status", "fulfillment_email_claimed_at"),
    { $set: { fulfillment_email_status: "SENDING", fulfillment_email_claimed_at: new Date().toISOString() } },
  );
  if (emailClaim.modifiedCount === 1) {
    try {
      let sent: boolean;
      if (isSignalPlan(tx["plan_id"])) {
        const sub = await activateSubscriptionForReference(reference, tx);
        const label = PLAN_LABEL[tx["plan_id"]];
        sent = await sendSignalSubscriptionEmail(buyerEmail, buyerName, label, sub.activated_at, sub.expires_at);
        await recordSubscriptionEmailResult(reference, buyerName, buyerEmail, label, sent);
      } else {
        const pin = String(tx["pin_generated"] ?? "");
        sent = await sendPinEmail(buyerEmail, buyerName, pin);
        await recordFulfillmentEmailResult(reference, buyerName, buyerEmail, pin, sent);
      }
      await db.collection("payment_transactions").updateOne(
        { reference, fulfillment_email_status: "SENDING" },
        { $set: { fulfillment_email_status: sent ? "SENT" : "RETRYABLE", fulfillment_email_attempted_at: new Date().toISOString() } },
      );
    } catch {
      await db.collection("payment_transactions").updateOne(
        { reference, fulfillment_email_status: "SENDING" },
        { $set: { fulfillment_email_status: "RETRYABLE", fulfillment_email_attempted_at: new Date().toISOString() } },
      );
    }
  }

  const adminClaim = await db.collection("payment_transactions").updateOne(
    retryableClaim("fulfillment_admin_status", "fulfillment_admin_claimed_at"),
    { $set: { fulfillment_admin_status: "SENDING", fulfillment_admin_claimed_at: new Date().toISOString() } },
  );
  if (adminClaim.modifiedCount === 1) {
    try {
      const sent = isSignalPlan(tx["plan_id"])
        ? await notifyAdminNewSignalSale(reference, buyerName, buyerEmail, amountFormatted, PLAN_LABEL[tx["plan_id"]], gateway)
        : await notifyAdminNewSale(reference, buyerName, buyerEmail, amountFormatted, String(tx["pin_generated"] ?? ""), gateway, "", providerReference);
      await db.collection("payment_transactions").updateOne(
        { reference, fulfillment_admin_status: "SENDING" },
        { $set: { fulfillment_admin_status: sent === false ? "RETRYABLE" : "SENT", fulfillment_admin_attempted_at: new Date().toISOString() } },
      );
    } catch {
      await db.collection("payment_transactions").updateOne(
        { reference, fulfillment_admin_status: "SENDING" },
        { $set: { fulfillment_admin_status: "RETRYABLE", fulfillment_admin_attempted_at: new Date().toISOString() } },
      );
    }
  }
}

/** Port of server.py:638 `generate_unique_pin`. */
export function generateUniquePin(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const pick = (n: number): string => Array.from(randomBytes(n)).map((b) => chars[b % chars.length]).join("");
  return `ASE-${pick(4)}-${pick(4)}`;
}

/** Port of server.py:1499 `_transition_payment_state` -- the MongoDB filter (reference + current state IN from_states) IS the concurrency control. */
export async function transitionPaymentState(reference: string, fromStates: string[], toState: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const result = await getDb()
    .collection("payment_transactions")
    .updateOne(
      { reference, payment_status: { $in: fromStates } },
      { $set: { payment_status: toState, [`state_transitions.${toState}`]: nowIso } },
    );
  return result.modifiedCount === 1;
}

/** Port of server.py:1842 `_bank_transfer_effective_status` -- lazily expires an order past its deadline. */
export async function bankTransferEffectiveStatus(tx: Record<string, unknown>): Promise<string> {
  const status = String(tx["payment_status"] ?? "");
  const expiresAt = tx["expires_at"] as string | undefined;
  if (["BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED"].includes(status) && expiresAt) {
    if (new Date().toISOString() > expiresAt) {
      const won = await transitionPaymentState(String(tx["reference"]), [status], "BANK_TRANSFER_EXPIRED");
      if (won) return "BANK_TRANSFER_EXPIRED";
      const fresh = await getDb().collection("payment_transactions").findOne({ reference: tx["reference"] }, { projection: { _id: 0 } });
      return String(fresh?.["payment_status"] ?? status);
    }
  }
  return status;
}

interface PinLicenseDoc {
  id: string;
  pin: string;
  buyer_name: string;
  buyer_email: string;
  is_active: boolean;
  is_used: boolean;
  activated_at: string | null;
  mt5_account: string | null;
  created_at: string;
  notes: string;
  payment_ref: string | null;
  provider?: string;
}

async function mintLicenseForReference(reference: string, tx: Record<string, unknown>, source: string, provider?: string): Promise<string> {
  const db = getDb();
  let pin = generateUniquePin();
  while (await db.collection("pin_licenses").findOne({ pin })) pin = generateUniquePin();

  const doc: PinLicenseDoc = {
    id: randomUUID(),
    pin,
    buyer_name: String(tx["buyer_name"] ?? ""),
    buyer_email: String(tx["buyer_email"] ?? ""),
    is_active: true,
    is_used: false,
    activated_at: null,
    mt5_account: null,
    created_at: new Date().toISOString(),
    notes: `${source} - ${reference}`,
    payment_ref: reference,
  };
  if (provider) doc.provider = provider;

  try {
    await db.collection("pin_licenses").insertOne({ ...doc });
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      const existing = await db.collection("pin_licenses").findOne({ payment_ref: reference });
      pin = (existing?.["pin"] as string | undefined) ?? pin;
    } else {
      throw err;
    }
  }
  return pin;
}

interface FulfillResult {
  status: "success" | "pending" | "failed" | "not_found";
  pin?: string;
  buyer_name?: string;
  reason?: string;
}

interface BankTransferApprovalResult {
  status: "already_fulfilled" | "approved" | "conflict" | "not_found" | "not_ready";
  pin?: string;
  effective?: string;
}

/**
 * Port of server.py:3370 `admin_approve_bank_transfer`. Idempotent via the
 * same atomic transitionPaymentState() conditional update the Nomba/Paystack
 * paths use, backed by pin_licenses' unique index on payment_ref as
 * defense-in-depth.
 */
export async function approveBankTransfer(reference: string, adminEmail: string): Promise<BankTransferApprovalResult> {
  const db = getDb();
  const tx = await db.collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
  if (!tx) return { status: "not_found" };
  // A signal-plan order never sets pin_generated, so "already fulfilled"
  // must be recognized from payment_status alone -- not just the
  // pin_generated marker, which only applies to BOT_LIFETIME orders.
  if (tx["payment_status"] === "FULFILLED") {
    await deliverFulfillmentNotifications(reference, tx, "Bank Transfer");
    return { status: "already_fulfilled", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined };
  }
  const effective = await bankTransferEffectiveStatus(tx);
  if (!["BANK_TRANSFER_SUBMITTED", "UNDER_ADMIN_REVIEW", "FULFILLING"].includes(effective)) {
    return { status: "not_ready", effective };
  }
  const won = effective === "FULFILLING" || await transitionPaymentState(reference, [effective], "FULFILLING");
  if (!won) {
    const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (fresh?.["payment_status"] === "FULFILLED") return { status: "already_fulfilled", pin: fresh["pin_generated"] ? String(fresh["pin_generated"]) : undefined };
    return { status: "conflict" };
  }

  if (isSignalPlan(tx["plan_id"])) {
    // Same safety ordering as the lifetime-license path below: the actual
    // entitlement artifact (here, the signal_subscriptions row) is created
    // BEFORE payment_status flips to FULFILLED. If this throws, the order
    // stays in FULFILLING (not falsely marked done), so it is never
    // reported "already_fulfilled" on retry without ever having granted
    // anything.
    const sub = await activateSubscriptionForReference(reference, tx);
    await db.collection("payment_transactions").updateOne(
      { reference, payment_status: "FULFILLING" },
      { $set: { payment_status: "FULFILLED", approved_by: adminEmail, approved_at: new Date().toISOString(), entitlement_fulfilled_at: new Date().toISOString(), signal_activated_at: sub.activated_at, signal_expires_at: sub.expires_at, fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } },
    );
    const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (fresh) await deliverFulfillmentNotifications(reference, fresh, "Bank Transfer");
    return { status: "approved" };
  }

  const pin = await mintLicenseForReference(reference, tx, "BankTransfer", "BANK_TRANSFER");
  await db.collection("payment_transactions").updateOne(
    { reference },
    { $set: { pin_generated: pin, payment_status: "FULFILLED", approved_by: adminEmail, approved_at: new Date().toISOString(), entitlement_fulfilled_at: new Date().toISOString(), fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } },
  );
  const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
  if (fresh) await deliverFulfillmentNotifications(reference, fresh, "Bank Transfer");
  return { status: "approved", pin };
}

async function resumeDurableFulfillmentV2(reference: string, tx: Record<string, unknown>, source: string, gatewayLabel: string): Promise<FulfillResult | null> {
  const db = getDb(); let status = String(tx["payment_status"] ?? "");
  if (!["PAID", "FULFILLING"].includes(status)) return null;
  if (status === "PAID") {
    await transitionPaymentState(reference, ["PAID"], "FULFILLING");
    const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (!fresh) return { status: "not_found" }; tx = fresh; status = String(tx["payment_status"] ?? "");
  }
  if (status === "FULFILLED") return { status: "success", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined, buyer_name: String(tx["buyer_name"] ?? "") };
  if (status !== "FULFILLING") return { status: "pending" };
  if (isSignalPlan(tx["plan_id"])) {
    const sub = await activateSubscriptionForReference(reference, tx);
    await db.collection("payment_transactions").updateOne({ reference, payment_status: "FULFILLING" }, { $set: { payment_status: "FULFILLED", entitlement_fulfilled_at: new Date().toISOString(), signal_activated_at: sub.activated_at, signal_expires_at: sub.expires_at, fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } });
    const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (fresh) await deliverFulfillmentNotifications(reference, fresh, gatewayLabel);
    return { status: "success", buyer_name: String(tx["buyer_name"] ?? "") };
  }
  const pin = await mintLicenseForReference(reference, tx, source);
  await db.collection("payment_transactions").updateOne({ reference, payment_status: "FULFILLING" }, { $set: { pin_generated: pin, payment_status: "FULFILLED", entitlement_fulfilled_at: new Date().toISOString(), fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } });
  const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
  if (fresh) await deliverFulfillmentNotifications(reference, fresh, gatewayLabel);
  return { status: "success", pin, buyer_name: String(tx["buyer_name"] ?? "") };
} // ASTRA_REPAIR_V2_6287 / 021

/**
 * Port of server.py:1517 `_fulfill_payment` -- the single canonical
 * Paystack fulfillment path, used by BOTH the webhook and the browser's
 * /purchase/verify polling. Never trusts a webhook body's claims alone,
 * even after signature verification -- always re-verifies directly with
 * Paystack first, and cross-checks the real paid amount/currency.
 */
export async function fulfillPayment(reference: string, source: string): Promise<FulfillResult> {
  const db = getDb();
  let tx = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
  if (!tx) return { status: "not_found" };
  if (tx["payment_status"] === "FULFILLED") {
    await deliverFulfillmentNotifications(reference, tx, "Paystack");
    return { status: "success", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined, buyer_name: String(tx["buyer_name"] ?? "") };
  }
  const resumed = await resumeDurableFulfillmentV2(reference, tx, source, "Paystack");
  if (resumed) return resumed;

  const wonVerifying = await transitionPaymentState(reference, ["PENDING"], "VERIFYING");
  if (!wonVerifying) {
    tx = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (tx?.["payment_status"] === "FULFILLED") return { status: "success", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined, buyer_name: String(tx["buyer_name"] ?? "") };
    return { status: "pending" };
  }

  const settings = await getSettings();
  const pk = String(settings["paystack_secret_key"] ?? "");
  if (!pk) {
    await transitionPaymentState(reference, ["VERIFYING"], "PENDING");
    return { status: "pending" };
  }

  let resp: Response;
  try {
    resp = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${pk}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    await transitionPaymentState(reference, ["VERIFYING"], "PENDING");
    return { status: "pending" };
  }
  if (resp.status !== 200) {
    await transitionPaymentState(reference, ["VERIFYING"], "PENDING");
    return { status: "pending" };
  }

  const data = (await resp.json()) as { status: boolean; data?: Record<string, unknown> };
  const vdata = data.status ? (data.data ?? {}) : {};
  if (vdata["status"] !== "success") {
    await transitionPaymentState(reference, ["VERIFYING"], "PENDING");
    return { status: "pending" };
  }

  const expectedAmount = Number(tx["amount_kobo"] ?? 0);
  const expectedCurrency = String(tx["currency"] ?? "NGN");
  const paidAmount = Number(vdata["amount"] ?? 0);
  const paidCurrency = String(vdata["currency"] ?? "");
  if (paidAmount < expectedAmount || paidCurrency !== expectedCurrency) {
    await transitionPaymentState(reference, ["VERIFYING"], "REJECTED_AMOUNT_MISMATCH");
    return { status: "failed", reason: "amount_mismatch" };
  }

  await transitionPaymentState(reference, ["VERIFYING"], "PAID");
  const wonFulfilling = await transitionPaymentState(reference, ["PAID"], "FULFILLING");
  if (!wonFulfilling) {
    tx = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (tx?.["payment_status"] === "FULFILLED") return { status: "success", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined, buyer_name: String(tx["buyer_name"] ?? "") };
    return { status: "pending" };
  }

  if (isSignalPlan(tx["plan_id"])) {
    // Same safety ordering as mintLicenseForReference below: grant the
    // entitlement before marking FULFILLED, so a failure here can never be
    // silently reported "already fulfilled" on retry without ever granting
    // anything.
    const sub = await activateSubscriptionForReference(reference, tx);
    await db.collection("payment_transactions").updateOne({ reference, payment_status: "FULFILLING" }, { $set: { payment_status: "FULFILLED", entitlement_fulfilled_at: new Date().toISOString(), signal_activated_at: sub.activated_at, signal_expires_at: sub.expires_at, fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } });
    const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (fresh) await deliverFulfillmentNotifications(reference, fresh, "Paystack");
    return { status: "success", buyer_name: String(tx["buyer_name"] ?? "") };
  }

  const pin = await mintLicenseForReference(reference, tx, source);
  await db.collection("payment_transactions").updateOne({ reference, payment_status: "FULFILLING" }, { $set: { pin_generated: pin, payment_status: "FULFILLED", entitlement_fulfilled_at: new Date().toISOString(), fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } });
  const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
  if (fresh) await deliverFulfillmentNotifications(reference, fresh, "Paystack");
  return { status: "success", pin, buyer_name: String(tx["buyer_name"] ?? "") };
}

/**
 * Port of server.py:1615 `_fulfill_nomba_payment` -- mirrors _fulfill_payment's
 * exact state-machine/idempotency structure; only the provider verification
 * call differs (nomba_service.verify_transaction instead of a direct
 * Paystack HTTP call).
 */
export async function fulfillNombaPayment(reference: string, source: string): Promise<FulfillResult> {
  const db = getDb();
  let tx = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
  if (!tx) return { status: "not_found" };
  if (tx["payment_status"] === "FULFILLED") {
    await deliverFulfillmentNotifications(reference, tx, "Nomba");
    return { status: "success", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined, buyer_name: String(tx["buyer_name"] ?? "") };
  }
  const resumed = await resumeDurableFulfillmentV2(reference, tx, source, "Nomba");
  if (resumed) return resumed;

  const wonVerifying = await transitionPaymentState(reference, ["PENDING"], "VERIFYING");
  if (!wonVerifying) {
    tx = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (tx?.["payment_status"] === "FULFILLED") return { status: "success", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined, buyer_name: String(tx["buyer_name"] ?? "") };
    return { status: "pending" };
  }

  const [, creds] = await getActiveNombaCredentials();
  if (!creds) {
    await transitionPaymentState(reference, ["VERIFYING"], "PENDING");
    return { status: "pending" };
  }

  let result;
  try {
    result = await verifyTransaction(creds, reference);
  } catch (err) {
    if (err instanceof NombaError) {
      await transitionPaymentState(reference, ["VERIFYING"], "PENDING");
      return { status: "pending" };
    }
    throw err;
  }

  if (result.status === "NOT_FOUND" || result.status !== "SUCCESS") {
    await transitionPaymentState(reference, ["VERIFYING"], "PENDING");
    return { status: "pending" };
  }

  const expectedNaira = Number(tx["amount_kobo"] ?? 0) / 100;
  const expectedCurrency = String(tx["currency"] ?? "NGN");
  if (result.amount === null || result.amount < expectedNaira - 0.01 || (result.currency && result.currency !== expectedCurrency)) {
    await transitionPaymentState(reference, ["VERIFYING"], "REJECTED_AMOUNT_MISMATCH");
    return { status: "failed", reason: "amount_mismatch" };
  }

  await transitionPaymentState(reference, ["VERIFYING"], "PAID");
  const wonFulfilling = await transitionPaymentState(reference, ["PAID"], "FULFILLING");
  if (!wonFulfilling) {
    tx = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (tx?.["payment_status"] === "FULFILLED") return { status: "success", pin: tx["pin_generated"] ? String(tx["pin_generated"]) : undefined, buyer_name: String(tx["buyer_name"] ?? "") };
    return { status: "pending" };
  }

  if (isSignalPlan(tx["plan_id"])) {
    // Same safety ordering as mintLicenseForReference below: grant the
    // entitlement before marking FULFILLED.
    const sub = await activateSubscriptionForReference(reference, tx);
    await db
      .collection("payment_transactions")
      .updateOne({ reference, payment_status: "FULFILLING" }, { $set: { payment_status: "FULFILLED", nomba_transaction_id: result.nomba_transaction_id, entitlement_fulfilled_at: new Date().toISOString(), signal_activated_at: sub.activated_at, signal_expires_at: sub.expires_at, fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } });
    const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
    if (fresh) await deliverFulfillmentNotifications(reference, fresh, "Nomba", result.nomba_transaction_id ?? reference);
    return { status: "success", buyer_name: String(tx["buyer_name"] ?? "") };
  }

  const pin = await mintLicenseForReference(reference, tx, source, "NOMBA");
  await db
    .collection("payment_transactions")
    .updateOne({ reference, payment_status: "FULFILLING" }, { $set: { pin_generated: pin, payment_status: "FULFILLED", nomba_transaction_id: result.nomba_transaction_id, entitlement_fulfilled_at: new Date().toISOString(), fulfillment_email_status: "PENDING", fulfillment_admin_status: "PENDING" } });
  const fresh = await db.collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
  if (fresh) await deliverFulfillmentNotifications(reference, fresh, "Nomba", result.nomba_transaction_id ?? reference);
  return { status: "success", pin, buyer_name: String(tx["buyer_name"] ?? "") };
}
