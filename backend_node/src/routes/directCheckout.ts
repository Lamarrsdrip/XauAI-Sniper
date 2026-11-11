import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { MongoServerError } from "mongodb";
import { getDb } from "../db.js";
import { clientIp, rateLimit, requireAdmin } from "../auth.js";
import { getSettings } from "../services/settings.js";
import { sendEmail } from "../services/email.js";
import { sendDirectManualPaymentInstructions } from "../services/manualCheckoutInstructions.js";
import { getBankTransferSettings, bankTransferIsConfigured } from "../services/paymentMethods.js";
import { generateUniquePin } from "../services/paymentFulfillment.js";
import { notifyAdminPaymentStarted, notifyAdminNewSale, sendPinEmailDetailed, recordFulfillmentEmailResult } from "../services/paymentEmails.js";

const WALLET_NETWORKS: Record<string, string[]> = { USDT: ["ERC20", "TRC20"], USDC: ["ERC20"] };
const ETH_WALLET = /^0x[0-9a-fA-F]{40}$/;
const TRON_WALLET = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const ETH_HASH = /^0x[0-9a-fA-F]{64}$/;
const TRON_HASH = /^(?:0x)?[0-9a-fA-F]{64}$/;
const RATE_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;
function escapeEmailHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const isoCountry = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);
const quoteSchema = z.object({
  country: isoCountry,
  buyer_name: z.string().trim().min(2).max(120),
  buyer_email: z.string().trim().toLowerCase().email().max(254),
  asset: z.string().optional().default(""),
  network: z.string().optional().default(""),
  method: z.enum(["BANK", "CRYPTO"]).optional(),
});
const submitSchema = z.object({
  payment_reference: z.string().max(180).optional(),
  sender_account_name: z.string().max(80).optional(),
});
function normalizeSenderName(raw: string | undefined): string | null {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return null;
  let letters = 0;
  for (const ch of name) {
    if (/\p{L}/u.test(ch)) letters += 1;
    else if (!/[0-9 .'\-]/.test(ch)) return null;
  }
  return letters >= 2 ? name : null;
}
const walletSchema = z.object({ asset: z.enum(["USDT", "USDC"]), network: z.enum(["ERC20", "TRC20"]), address: z.string().trim().max(256) });
const adminConfigSchema = z.object({
  price_usd_cents: z.number().int().positive().max(100_000_000).optional(),
  usd_ngn_rate: z.string().max(30).optional(),
  bank_enabled: z.boolean().optional(),
  crypto_enabled: z.boolean().optional(),
  crypto_countries: z.array(isoCountry).max(249).optional(),
  wallets: z.array(walletSchema).max(20).optional(),
  bank_name: z.string().trim().max(120).optional(),
  account_name: z.string().trim().max(120).optional(),
  account_number: z.string().trim().regex(/^\d{6,20}$/).optional(),
  instructions: z.string().trim().max(1000).optional(),
});

function isApprovedWallet(asset: string, network: string, address: string): boolean {
  return Boolean(WALLET_NETWORKS[asset]?.includes(network) &&
    (network === "ERC20" ? ETH_WALLET : TRON_WALLET).test(address));
}
function usdFormatted(cents: number): string { return "USD " + (cents / 100).toFixed(2); }
function rateScaled(rate: string): bigint {
  if (!RATE_RE.test(rate)) throw new Error("Invalid USD/NGN rate");
  const [whole, fraction = ""] = rate.split(".");
  const scaled = BigInt(whole ?? "0") * 100000000n + BigInt(fraction.padEnd(8, "0") || "0");
  if (scaled < 1000000n || scaled > 100000000000000n) throw new Error("FX rate outside accepted bounds");
  return scaled;
}
function toNgnKobo(usdCents: number, rate: string): number {
  const result = (BigInt(usdCents) * rateScaled(rate) + 50000000n) / 100000000n;
  if (result < 1n || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("NGN value outside supported bounds");
  return Number(result);
}
function utc(): string { return new Date().toISOString(); }
function getCfg(settings: Record<string, unknown>) {
  const raw = settings["direct_usd_cents"];
  const price = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  const wallets = Array.isArray(settings["direct_wallets"]) ? settings["direct_wallets"] as Record<string, unknown>[] : [];
  return {
    price_usd_cents: price,
    usd_ngn_rate: typeof settings["direct_usd_ngn_rate"] === "string" ? settings["direct_usd_ngn_rate"] : null,
    rate_as_of: typeof settings["direct_fx_as_of"] === "string" ? settings["direct_fx_as_of"] : null,
    // Reuse an already enabled legacy beneficiary when migrating to direct
    // checkout. An explicit direct-checkout disable still takes precedence.
    bank_enabled: typeof settings["direct_bank_enabled"] === "boolean"
      ? settings["direct_bank_enabled"] : settings["bank_transfer_enabled"] === true,
    crypto_enabled: settings["direct_crypto_enabled"] === true,
    crypto_countries: Array.isArray(settings["direct_crypto_countries"]) ? settings["direct_crypto_countries"] as string[] : [],
    wallets: wallets.filter((w) => isApprovedWallet(String(w["asset"]), String(w["network"]), String(w["address"]))),
  };
}
function bankUnavailableReason(cfg: ReturnType<typeof getCfg>, bank: Awaited<ReturnType<typeof getBankTransferSettings>>): string | null {
  if (cfg.price_usd_cents == null) return "USD_PRICE_MISSING";
  if (!cfg.bank_enabled) return "BANK_DISABLED";
  if (!bankTransferIsConfigured(bank)) return "BANK_DETAILS_MISSING";
  try { if (!cfg.usd_ngn_rate) return "FX_RATE_MISSING"; rateScaled(cfg.usd_ngn_rate); }
  catch { return "FX_RATE_INVALID"; }
  const fxTime = cfg.rate_as_of ? Date.parse(cfg.rate_as_of) : NaN;
  if (!Number.isFinite(fxTime)) return "FX_TIMESTAMP_MISSING";
  if (fxTime > Date.now() || Date.now() - fxTime > 86400000) return "FX_RATE_STALE";
  return null;
}
async function effectiveStatus(tx: Record<string, unknown>): Promise<string> {
  const status = String(tx["payment_status"]);
  if (status === "MANUAL_PENDING" && utc() > String(tx["expires_at"])) {
    const res = await getDb().collection("payment_transactions").updateOne(
      { reference: tx["reference"], payment_status: "MANUAL_PENDING" },
      { $set: { payment_status: "MANUAL_EXPIRED" } });
    if (res.modifiedCount === 1) return "MANUAL_EXPIRED";
    const fresh = await getDb().collection("payment_transactions").findOne({ reference: tx["reference"] });
    return String(fresh?.["payment_status"] ?? status);
  }
  return status;
}

export async function ensureDirectCheckoutIndexes(): Promise<void> {
  await getDb().collection("payment_transactions").createIndex(
    { provider: 1, submitted_reference: 1 },
    { unique: true, partialFilterExpression: { provider: "MANUAL_DIRECT", submitted_reference: { $type: "string" } } },
  );
  // These constraints must be present before accepting approvals, rather than
  // relying on the general startup task's best-effort index installation.
  await getDb().collection("payment_transactions").createIndex("reference", { unique: true });
  await getDb().collection("pin_licenses").createIndex("payment_ref",
    { unique: true, partialFilterExpression: { payment_ref: { $type: "string" } } });
  await getDb().collection("pin_licenses").createIndex("pin", { unique: true });
  await getDb().collection("payment_review_log").createIndex("id",
    { unique: true, partialFilterExpression: { id: { $type: "string" } } });
}


const LICENSE_PIN_PATTERN = /^ASE-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const DELIVERY_LEASE_MS = 10 * 60_000;
const APPROVABLE_STATES = ["MANUAL_PENDING", "MANUAL_SUBMITTED", "MANUAL_EXPIRED"];

class DirectFulfillmentError extends Error {
  constructor(readonly stage: string, message: string) { super(message); }
}

function directLicenseMatches(tx: Record<string, unknown>, license: Record<string, unknown> | null): boolean {
  return Boolean(license && LICENSE_PIN_PATTERN.test(String(license["pin"] || "")) &&
    String(license["buyer_email"] || "").trim().toLowerCase() === String(tx["buyer_email"] || "").trim().toLowerCase() &&
    license["is_active"] === true && license["payment_ref"] === tx["reference"]);
}

function validDirectOrder(tx: Record<string, unknown>): boolean {
  const details = tx["quote_details"] as Record<string, unknown> | undefined;
  const product = tx["product_id"] ?? tx["plan_id"] ?? "BOT_LIFETIME";
  if (product !== "BOT_LIFETIME" || !Number.isSafeInteger(tx["amount_minor"]) || Number(tx["amount_minor"]) <= 0 ||
      !Number.isSafeInteger(tx["price_usd_cents"]) || Number(tx["price_usd_cents"]) <= 0 ||
      !z.string().email().safeParse(tx["buyer_email"]).success || !details) return false;
  if (tx["method"] === "BANK") {
    try { return tx["country"] === "NG" && tx["currency"] === "NGN" &&
      Boolean(details["bank_name"] && details["account_name"] && details["account_number"]) &&
      toNgnKobo(Number(tx["price_usd_cents"]), String(details["fx_rate"])) === tx["amount_minor"]; }
    catch { return false; }
  }
  return tx["method"] === "CRYPTO" && details["asset"] === tx["currency"] &&
    tx["amount_minor"] === tx["price_usd_cents"] &&
    isApprovedWallet(String(details["asset"]), String(details["network"]), String(details["address"]));
}

async function ensureDirectLicense(tx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const reference = String(tx["reference"]);
  const licenses = getDb().collection("pin_licenses");
  let existing = await licenses.findOne({ payment_ref: reference });
  // Recover a previously assigned order license rather than minting a second one.
  if (!existing && tx["pin_generated"]) {
    const assigned = await licenses.findOne({ pin: tx["pin_generated"] });
    if (!assigned || assigned["payment_ref"] && assigned["payment_ref"] !== reference ||
        String(assigned["buyer_email"] || "").trim().toLowerCase() !== String(tx["buyer_email"]).trim().toLowerCase()) {
      throw new DirectFulfillmentError("LICENSE", "Previously assigned license cannot be verified for this purchaser and order.");
    }
    await licenses.updateOne({ pin: assigned["pin"], payment_ref: assigned["payment_ref"] === undefined ? { $exists: false } : assigned["payment_ref"] }, { $set: { payment_ref: reference } });
    existing = await licenses.findOne({ payment_ref: reference });
  }
  if (existing) {
    if (!directLicenseMatches(tx, existing)) throw new DirectFulfillmentError("LICENSE", "Existing order license is inactive or belongs to a different purchaser. License validation must be resolved before fulfillment.");
    const email = String(tx["buyer_email"]).trim().toLowerCase();
    if (existing["buyer_email"] !== email) {
      await licenses.updateOne({ payment_ref: reference, pin: existing["pin"], buyer_email: existing["buyer_email"] },
        { $set: { buyer_email: email } });
      existing["buyer_email"] = email;
    }
    return existing;
  }
  let pin = generateUniquePin();
  while (await licenses.findOne({ pin })) pin = generateUniquePin();
  const doc = {
    id: randomUUID(), pin, buyer_name: tx["buyer_name"], buyer_email: String(tx["buyer_email"]).trim().toLowerCase(),
    is_active: true, is_used: false, activated_at: null, mt5_account: null,
    created_at: utc(), license_activated_at: utc(), product_id: "BOT_LIFETIME",
    notes: "Owner-approved manual " + tx["method"] + " - " + reference,
    payment_ref: reference, provider: "MANUAL_DIRECT",
  };
  try { await licenses.insertOne(doc); }
  catch (err) { if (!(err instanceof MongoServerError && err.code === 11000)) throw err; }
  existing = await licenses.findOne({ payment_ref: reference });
  if (!directLicenseMatches(tx, existing)) throw new DirectFulfillmentError("LICENSE", "License issuance could not be verified; no second license was created.");
  return existing!;
}

async function linkDirectLicenseToCustomer(tx: Record<string, unknown>, license: Record<string, unknown>): Promise<string> {
  const db = getDb();
  const reference = String(tx["reference"]);
  const email = String(tx["buyer_email"] || "").trim().toLowerCase();
  const user = await db.collection("cloud_users").findOne({ email });
  if (!user) {
    // getUserLicense resolves a purchased active license by email after signup.
    await db.collection("payment_transactions").updateOne({ provider: "MANUAL_DIRECT", reference },
      { $set: { account_link_status: "AWAITING_SIGNUP" } });
    return "AWAITING_SIGNUP";
  }
  if (user["disabled_at"]) throw new DirectFulfillmentError("ACCOUNT", "Customer account is disabled. Resolve the account restriction before retrying fulfillment.");
  const pin = String(license["pin"]);
  const activeKey = String(user["license_key"] || user["command_license_key"] || "").trim();
  if (activeKey && activeKey !== pin) {
    const previous = await db.collection("pin_licenses").findOne({ pin: activeKey });
    if (!previous || String(previous["buyer_email"] || "").toLowerCase().trim() !== email) {
      throw new DirectFulfillmentError("ACCOUNT", "Customer's existing license link does not match their ownership. Resolve the account link before retrying fulfillment.");
    }
  }
  const updated = await db.collection("cloud_users").updateOne(
    { id: user["id"], email, license_key: user["license_key"] === undefined ? { $exists: false } : user["license_key"],
      command_license_key: user["command_license_key"] === undefined ? { $exists: false } : user["command_license_key"] },
    { $set: { license_key: pin, command_license_key: pin, license_linked_at: utc() },
      $addToSet: { purchased_license_keys: pin } },
  );
  if (updated.matchedCount !== 1) throw new DirectFulfillmentError("ACCOUNT", "Customer account changed during license linking. Retry fulfillment.");
  await db.collection("payment_transactions").updateOne({ provider: "MANUAL_DIRECT", reference },
    { $set: { account_link_status: "LINKED", linked_cloud_user_id: user["id"] } });
  return "LINKED";
}

async function deliverDirectLicenseEmail(app: FastifyInstance, tx: Record<string, unknown>): Promise<string> {
  const payments = getDb().collection("payment_transactions");
  const reference = String(tx["reference"]);
  const license = await getDb().collection("pin_licenses").findOne({ payment_ref: reference });
  if (!directLicenseMatches(tx, license)) throw new DirectFulfillmentError("EMAIL", "Official license delivery is blocked: valid purchased license missing.");
  if (tx["fulfillment_email_status"] === "SENT") return "SENT";
  const emailClaimId = randomUUID();
  const claim = await payments.updateOne(
    { provider: "MANUAL_DIRECT", reference, approved_by: tx["approved_by"],
      $or: [{ fulfillment_email_status: { $in: ["PENDING", "RETRYABLE"] } }, { fulfillment_email_status: { $exists: false } }] },
    { $set: { fulfillment_email_status: "SENDING", fulfillment_email_claimed_at: utc(), fulfillment_email_claim_id: emailClaimId } });
  if (!claim.modifiedCount) {
    const fresh = await payments.findOne({ provider: "MANUAL_DIRECT", reference });
    if (fresh?.["fulfillment_email_status"] === "SENT") return "SENT";
    throw new DirectFulfillmentError("EMAIL", "Official license email is sending or its delivery outcome is unknown. Check the sender delivery log before another send; a duplicate email was prevented.");
  }
  const result = await sendPinEmailDetailed(String(tx["buyer_email"]), String(tx["buyer_name"]), String(license!["pin"]),
    `<xaucloud-license-${reference}@xaucloud.io>`);
  // Never reclaim an ambiguous SMTP delivery: SMTP has no idempotency API.
  // A process interruption after send is similarly left SENDING for reconciliation.
  await payments.updateOne({ provider: "MANUAL_DIRECT", reference, fulfillment_email_claim_id: emailClaimId },
    { $set: { fulfillment_email_status: result.ok ? "SENT" : result.deliveryUnknown ? "DELIVERY_UNKNOWN" : "RETRYABLE",
      fulfillment_email_error: result.error ?? null, fulfillment_email_attempted_at: utc(),
      fulfillment_email_failed: !result.ok } });
  // Save the delivery outcome before history/alerts: an audit-log outage must
  // never turn an accepted message into a second automatic delivery.
  try {
    const id = `direct-license:${reference}:${emailClaimId}`;
    await getDb().collection("admin_email_log").updateOne({ id }, { $setOnInsert: {
      id, delivery_id: id, template_id: "license_delivery", template_version: "published_or_code_default",
      subject: "Official XauCloud license delivery", reference,
      canonical_recipient: String(tx["buyer_email"]), to: String(tx["buyer_email"]),
      related_user_id: tx["linked_cloud_user_id"] ?? null, context_ref: { kind: "payment", reference },
      source: "manual_payment_approval", status: result.ok ? "sent" : result.deliveryUnknown ? "delivery_unknown" : "failed",
      sent: result.ok ? 1 : 0, failed: result.ok ? 0 : 1,
      provider_response_summary: result.error ?? "accepted", canonical_retryable: false,
      retry_instruction: "Use Pending Payments → Retry Fulfillment to preserve order validation and delivery deduplication.",
      created_at: utc(), at: utc(),
    } }, { upsert: true });
    await recordFulfillmentEmailResult(reference, String(tx["buyer_name"]), String(tx["buyer_email"]), String(license!["pin"]), result.ok);
  } catch (err) { app.log.error({ err, reference }, "License email outcome saved; history or failure alert could not be recorded"); }
  if (!result.ok) throw new DirectFulfillmentError("EMAIL", result.error || "Official license email was not delivered. Check email configuration and retry fulfillment.");
  return "SENT";
}

async function completeDirectFulfillment(app: FastifyInstance, tx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = getDb();
  const reference = String(tx["reference"]);
  const claimId = String(tx["fulfillment_claim_id"]);
  let stage = "AUDIT";
  try {
    // Approval itself is recorded atomically on the order. Materialize the separate
    // audit row before granting any entitlement, including when recovering a crash.
    await db.collection("payment_review_log").updateOne({ id: "APPROVE:" + reference },
      { $setOnInsert: { id: "APPROVE:" + reference, reference, action: "APPROVE", by: tx["approved_by"], at: tx["approved_at"] } }, { upsert: true });
    if (tx["fulfillment_retried_by"]) {
      await db.collection("payment_review_log").updateOne({ id: "RETRY:" + claimId },
        { $setOnInsert: { id: "RETRY:" + claimId, reference, action: "RETRY_FULFILLMENT",
          by: tx["fulfillment_retried_by"], at: tx["fulfillment_retried_at"] } }, { upsert: true });
    }
    stage = "LICENSE";
    const license = await ensureDirectLicense(tx);
    stage = "ACCOUNT";
    const accountStatus = await linkDirectLicenseToCustomer(tx, license);
    await db.collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, payment_status: "FULFILLING", fulfillment_claim_id: claimId },
      { $set: { pin_generated: license["pin"], entitlement_fulfilled_at: utc() } });
    stage = "EMAIL";
    const current = await db.collection("payment_transactions").findOne({ provider: "MANUAL_DIRECT", reference, fulfillment_claim_id: claimId });
    if (!current || current["payment_status"] !== "FULFILLING") throw new DirectFulfillmentError("ORDER", "Order changed during fulfillment. Refresh its status.");
    const emailStatus = await deliverDirectLicenseEmail(app, current);
    const finished = await db.collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, payment_status: "FULFILLING", fulfillment_claim_id: claimId },
      { $set: { payment_status: "FULFILLED", fulfilled_at: utc(), fulfillment_error: null, fulfillment_stage: null } });
    if (!finished.modifiedCount) throw new DirectFulfillmentError("ORDER", "Order changed while fulfillment was completing. Refresh its status.");
    const notificationClaim = await db.collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, fulfillment_admin_status: { $exists: false } },
      { $set: { fulfillment_admin_status: "SENDING" } });
    if (notificationClaim.modifiedCount) {
      try {
        const sent = await notifyAdminNewSale(reference, String(tx["buyer_name"]), String(tx["buyer_email"]),
          usdFormatted(Number(tx["price_usd_cents"])), String(license["pin"]), "Manual " + tx["method"], "One-Time XauCloud MT5 License");
        await db.collection("payment_transactions").updateOne({ provider: "MANUAL_DIRECT", reference },
          { $set: { fulfillment_admin_status: sent === false ? "RETRYABLE" : "SENT" } });
      } catch (err) { app.log.error({ err, reference }, "Admin sale notification failed"); }
    }
    return { status: "FULFILLED", license_status: "ISSUED", account_link_status: accountStatus, fulfillment_email_status: emailStatus };
  } catch (err) {
    const failureStage = err instanceof DirectFulfillmentError ? err.stage : stage;
    const error = err instanceof DirectFulfillmentError ? err.message
      : `${failureStage === "EMAIL" ? "Official email delivery" : failureStage === "ACCOUNT" ? "Customer license activation" : failureStage === "AUDIT" ? "Approval audit recording" : "License issuance"} failed (${err instanceof MongoServerError ? "database error " + err.code : "service error"}). Retry fulfillment.`;
    app.log.error({ err, reference, stage: failureStage }, "Manual payment fulfillment failed");
    await db.collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, payment_status: "FULFILLING", fulfillment_claim_id: claimId },
      { $set: { payment_status: "FULFILLMENT_FAILED", fulfillment_failure_at: utc(), fulfillment_stage: failureStage, fulfillment_error: error } });
    const current = await db.collection("payment_transactions").findOne({ provider: "MANUAL_DIRECT", reference });
    const existingLicense = await db.collection("pin_licenses").findOne({ payment_ref: reference });
    return { status: "FULFILLMENT_FAILED", fulfillment_error: error, fulfillment_stage: failureStage,
      license_status: directLicenseMatches(tx, existingLicense) ? "ISSUED" : "NOT_ISSUED",
      account_link_status: current?.["account_link_status"] ?? "NOT_LINKED",
      fulfillment_email_status: current?.["fulfillment_email_status"] ?? "NOT_SENT" };
  }
}

async function adminDirectConfig() {
  const cfg = getCfg(await getSettings());
  const bank = await getBankTransferSettings();
  return {
    ...cfg,
    bank_name: bank.bank_name,
    account_name: bank.account_name,
    account_number: bank.account_number,
    instructions: bank.instructions,
    bank_unavailable_reason: bankUnavailableReason(cfg, bank),
  };
}

export async function registerDirectCheckoutRoutes(app: FastifyInstance): Promise<void> {
  app.get("/purchase/direct/config", async (request) => {
    rateLimit("direct_config:" + clientIp(request), 60, 60);
    const cfg = getCfg(await getSettings());
    const bank = await getBankTransferSettings();
    const bankReason = bankUnavailableReason(cfg, bank);
    const bankReady = bankReason === null;
    const cryptoReady = cfg.price_usd_cents != null && cfg.crypto_enabled && cfg.wallets.length > 0;
    return {
      currency: "USD", price_usd_cents: cfg.price_usd_cents,
      price_formatted: cfg.price_usd_cents != null ? usdFormatted(cfg.price_usd_cents) : null,
      bank_enabled: bankReady, crypto_enabled: cryptoReady,
      bank_unavailable_reason: bankReason,
      crypto_countries: cfg.crypto_countries,
      crypto_options: cryptoReady ? cfg.wallets.map((w) => ({ asset: w["asset"], network: w["network"] })) : [],
      trial_days: 3,
    };
  });

  app.post("/purchase/direct/quote", async (request, reply) => {
    rateLimit("direct_quote:" + clientIp(request), 8, 600);
    const req = quoteSchema.parse(request.body);
    const cfg = getCfg(await getSettings());
    const cents = cfg.price_usd_cents;
    if (cents == null) return reply.code(503).send({ detail: "Administrator has not configured the USD price." });
    const requested = req.method;
    let method: "BANK" | "CRYPTO";
    if (req.country !== "NG") {
      if (requested === "BANK") return reply.code(403).send({ detail: "Bank transfer is only available in Nigeria." });
      method = "CRYPTO";
    } else if (requested === "CRYPTO") method = "CRYPTO";
    else method = "BANK";
    let amountMinor: number;
    let currency: string;
    let details: Record<string, string>;
    const stamp = new Date();
    if (method === "BANK") {
      const bank = await getBankTransferSettings();
      if (!cfg.bank_enabled || !bankTransferIsConfigured(bank)) {
        return reply.code(503).send({ detail: "Nigerian bank transfer is not configured." });
      }
      const updated = cfg.rate_as_of ? new Date(cfg.rate_as_of) : null;
      if (!cfg.usd_ngn_rate || !updated || !Number.isFinite(updated.getTime()) ||
          updated.getTime() > stamp.getTime() || stamp.getTime() - updated.getTime() > 86400000) {
        return reply.code(503).send({ detail: "Nigerian bank transfer needs a current verified USD/NGN rate. Crypto checkout is unchanged." });
      }
      try { amountMinor = toNgnKobo(cents, cfg.usd_ngn_rate); }
      catch { return reply.code(503).send({ detail: "Nigerian bank transfer needs a valid USD/NGN rate. Crypto checkout is unchanged." }); }
      currency = "NGN";
      details = { bank_name: bank.bank_name, account_name: bank.account_name,
                  account_number: bank.account_number, fx_rate: String(cfg.usd_ngn_rate), rate_as_of: String(cfg.rate_as_of),
                  instructions: bank.instructions, support_contact: bank.support_contact };
    } else {
      if (!cfg.crypto_enabled) return reply.code(403).send({ detail: "Crypto checkout is not available." });
      const asset = req.asset.toUpperCase();
      const network = req.network.toUpperCase();
      const wallet = cfg.wallets.find((w) => w["asset"] === asset && w["network"] === network);
      if (!wallet) return reply.code(503).send({ detail: "Selected stablecoin/network wallet is not approved or configured." });
      amountMinor = cents;
      currency = asset;
      details = { asset, network, address: String(wallet["address"]),
                  quote_policy: "Nominal USD peg: 1 stablecoin token = 1 USD; network fees excluded." };
    }
    const reference = "XC-" + randomBytes(10).toString("hex").toUpperCase();
    const expires = new Date(stamp.getTime() + 1800000).toISOString();
    const amountFormatted = currency === "NGN" ? "NGN " + (amountMinor / 100).toFixed(2) : (amountMinor / 100).toFixed(2) + " " + currency;
    const tx = {
      id: randomUUID(), provider: "MANUAL_DIRECT", reference, country: req.country,
      method, price_usd_cents: cents, currency, amount_minor: amountMinor,
      product_id: "BOT_LIFETIME", product_name: "One-Time XauCloud MT5 License",
      buyer_name: req.buyer_name, buyer_email: req.buyer_email,
      quote_details: details, created_at: stamp.toISOString(), expires_at: expires,
      payment_status: "MANUAL_PENDING", pin_generated: null, state_transitions: {}, instructions_resend_count: 0,
    };
    await getDb().collection("payment_transactions").insertOne(tx);
    // Send the buyer a permanent copy of the exact instructions at order creation.
    // A failed SMTP attempt never marks the order paid or prevents the quote being shown.
    let instructionsEmailSent = false;
    try {
      instructionsEmailSent = await sendDirectManualPaymentInstructions({
        buyerName: req.buyer_name, buyerEmail: req.buyer_email, reference,
        method, amountFormatted, usdPrice: usdFormatted(cents),
        details, expiresAt: expires,
      });
    } catch (e) { app.log.error({ err: e, reference }, "Manual customer instructions email failed"); }
    await getDb().collection("payment_transactions").updateOne(
      { reference, provider: "MANUAL_DIRECT" },
      { $set: { instructions_email_status: instructionsEmailSent ? "SENT" : "FAILED",
                instructions_email_attempted_at: utc() } },
    );
    try { await notifyAdminPaymentStarted("Manual " + method, reference, req.buyer_name, req.buyer_email, amountFormatted); }
    catch (e) { app.log.error({ err: e, reference }, "Manual payment start notification failed"); }
    return { reference, method, usd_price: usdFormatted(cents), currency,
             amount_minor: amountMinor, amount_formatted: amountFormatted,
             details, expires_at: expires, status: "MANUAL_PENDING",
             instructions_email_sent: instructionsEmailSent };
  });

  // Allow at most two retries, always sending only to the original buyer email.
  // Never allow a client to supply a destination address, account or amount.
  app.post("/purchase/direct/:reference/resend-instructions", async (request, reply) => {
    rateLimit("direct_email_retry:" + clientIp(request), 4, 600);
    const { reference } = request.params as { reference: string };
    const tx = await getDb().collection("payment_transactions").findOne(
      { reference, provider: "MANUAL_DIRECT" });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    if (await effectiveStatus(tx) !== "MANUAL_PENDING") {
      return reply.code(409).send({ detail: "This order is no longer awaiting transfer." });
    }
    const claimed = await getDb().collection("payment_transactions").updateOne(
      { reference, provider: "MANUAL_DIRECT", payment_status: "MANUAL_PENDING",
        instructions_resend_count: { $lt: 2 } },
      { $inc: { instructions_resend_count: 1 } });
    if (!claimed.modifiedCount) return reply.code(429).send({ detail: "Email retry limit reached. Please copy the payment details shown on screen." });
    let sent = false;
    try {
      sent = await sendDirectManualPaymentInstructions({
        buyerName: String(tx["buyer_name"]), buyerEmail: String(tx["buyer_email"]),
        reference, method: tx["method"] as "BANK" | "CRYPTO",
        amountFormatted: tx["currency"] === "NGN"
          ? "NGN " + (Number(tx["amount_minor"]) / 100).toFixed(2)
          : (Number(tx["amount_minor"]) / 100).toFixed(2) + " " + tx["currency"],
        usdPrice: usdFormatted(Number(tx["price_usd_cents"])),
        details: tx["quote_details"] as Record<string, string>,
        expiresAt: String(tx["expires_at"]),
      });
    } catch (err) { app.log.error({ err, reference }, "Manual customer email retry failed"); }
    await getDb().collection("payment_transactions").updateOne(
      { reference, provider: "MANUAL_DIRECT" },
      { $set: { instructions_email_status: sent ? "SENT" : "FAILED",
                instructions_email_attempted_at: utc() } });
    return { sent };
  });

  app.post("/purchase/direct/:reference/submit", async (request, reply) => {
    rateLimit("direct_submit:" + clientIp(request), 12, 600);
    const { reference } = request.params as { reference: string };
    const req = submitSchema.parse(request.body);
    const tx = await getDb().collection("payment_transactions").findOne(
      { provider: "MANUAL_DIRECT", reference }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    const status = await effectiveStatus(tx);
    if (status === "MANUAL_SUBMITTED") return { reference, status, submitted_at: tx["submitted_at"] ?? null };
    if (status !== "MANUAL_PENDING") return reply.code(409).send({ detail: "Order expired or closed. Contact support if you already paid." });
    if (tx["method"] === "BANK") {
      const sender = normalizeSenderName(req.sender_account_name);
      if (!sender) return reply.code(422).send({ detail: "Enter the account name the transfer was sent from." });
      const result = await getDb().collection("payment_transactions").updateOne(
        { reference, provider: "MANUAL_DIRECT", payment_status: "MANUAL_PENDING" },
        { $set: { sender_account_name: sender, payment_status: "MANUAL_SUBMITTED", submitted_at: utc() } });
      if (!result.modifiedCount) return reply.code(409).send({ detail: "Order status changed; refresh it." });
      const submitted = await getDb().collection("payment_transactions").findOne({ reference, provider: "MANUAL_DIRECT" });
      return { reference, status: "MANUAL_SUBMITTED", submitted_at: submitted?.["submitted_at"] ?? null };
    }
    const proof = String(req.payment_reference ?? "").trim();
    const valid = (tx["quote_details"] as Record<string, string>)["network"] === "ERC20" ? ETH_HASH.test(proof) : TRON_HASH.test(proof);
    if (!valid) return reply.code(422).send({ detail: "Invalid payment reference or transaction hash." });
    try {
      const result = await getDb().collection("payment_transactions").updateOne(
        { reference, provider: "MANUAL_DIRECT", payment_status: "MANUAL_PENDING" },
        { $set: { submitted_reference: proof, payment_status: "MANUAL_SUBMITTED", submitted_at: utc() } });
      if (!result.modifiedCount) return reply.code(409).send({ detail: "Order status changed; refresh it." });
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        return reply.code(409).send({ detail: "This payment reference was already submitted for another order." });
      }
      throw err;
    }
    const submitted = await getDb().collection("payment_transactions").findOne({ reference, provider: "MANUAL_DIRECT" });
    return { reference, status: "MANUAL_SUBMITTED", submitted_at: submitted?.["submitted_at"] ?? null };
  });

  // Receipt images are not accepted. Matching uses the sender account name or transaction hash.
  app.post("/purchase/direct/:reference/proof", { bodyLimit: 1024 }, async (_request, reply) => {
    return reply.code(410).send({ detail: "Receipt uploads are no longer accepted. Submit the account name or transaction hash instead." });
  });

  app.get("/purchase/direct/:reference/status", async (request, reply) => {
    rateLimit("direct_status:" + clientIp(request), 60, 60);
    const { reference } = request.params as { reference: string };
    const tx = await getDb().collection("payment_transactions").findOne(
      { provider: "MANUAL_DIRECT", reference }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    return { reference, status: await effectiveStatus(tx), method: tx["method"],
             amount_minor: tx["amount_minor"], currency: tx["currency"],
             fulfillment_email_status: tx["fulfillment_email_status"] ?? null,
             fulfillment_failed: tx["payment_status"] === "FULFILLMENT_FAILED",
             created_at: tx["created_at"], submitted_at: tx["submitted_at"] ?? null, expires_at: tx["expires_at"],
             has_proof: Boolean(tx["evidence_uploaded_at"] || tx["evidence_image"]) };
  });

  app.get("/admin/direct-checkout/config", { preHandler: requireAdmin }, async () => adminDirectConfig());
  app.put("/admin/direct-checkout/config", { preHandler: requireAdmin }, async (request, reply) => {
    const req = adminConfigSchema.parse(request.body);
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const updates: Record<string, unknown> = {};
    if (req.price_usd_cents !== undefined) updates["direct_usd_cents"] = req.price_usd_cents;
    if (req.usd_ngn_rate !== undefined) {
      try { rateScaled(req.usd_ngn_rate); }
      catch { return reply.code(422).send({ detail: "Rate must be valid, positive, and within supported range." }); }
      updates["direct_usd_ngn_rate"] = req.usd_ngn_rate;
      updates["direct_fx_as_of"] = utc();
    }
    if (req.bank_enabled !== undefined) {
      updates["direct_bank_enabled"] = req.bank_enabled;
      updates["bank_transfer_enabled"] = req.bank_enabled;
    }
    if (req.crypto_enabled !== undefined) updates["direct_crypto_enabled"] = req.crypto_enabled;
    if (req.bank_name !== undefined) updates["bank_transfer_bank_name"] = req.bank_name;
    if (req.account_name !== undefined) updates["bank_transfer_account_name"] = req.account_name;
    if (req.account_number !== undefined) updates["bank_transfer_account_number"] = req.account_number;
    if (req.instructions !== undefined) updates["bank_transfer_instructions"] = req.instructions;
    if (req.crypto_countries !== undefined) {
      const values = [...new Set(req.crypto_countries)].filter((c) => c !== "NG").sort();
      if (values.length !== req.crypto_countries.length) return reply.code(422).send({ detail: "Duplicate country or invalid Nigeria crypto rule." });
      updates["direct_crypto_countries"] = values;
    }
    if (req.wallets !== undefined) {
      if (req.wallets.some((w) => !isApprovedWallet(w.asset, w.network, w.address))) {
        return reply.code(422).send({ detail: "Invalid supported asset/network or receiving wallet." });
      }
      const keys = req.wallets.map((w) => w.asset + ":" + w.network);
      if (new Set(keys).size !== keys.length) return reply.code(422).send({ detail: "Duplicate asset/network pair." });
      updates["direct_wallets"] = req.wallets;
    }
    if (Object.keys(updates).length) {
      await getDb().collection("admin_settings").updateOne({ key: "main" }, { $set: updates }, { upsert: true });
      await getDb().collection("payment_config_audit_log").insertOne({
        id: randomUUID(), provider: "MANUAL_DIRECT", changed_fields: Object.keys(updates),
        admin_email: admin["email"], at: utc(),
      });
    }
    return adminDirectConfig();
  });

  app.get("/admin/direct-checkout/orders", { preHandler: requireAdmin }, async (request) => {
    const q = z.object({ q: z.string().trim().max(254).optional().default(""),
      status: z.enum(["all", "pending", "approved", "rejected", "failed"]).optional().default("all"),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0) }).parse(request.query);
    const groups: Record<string, string[]> = {
      pending: APPROVABLE_STATES,
      approved: ["FULFILLING", "FULFILLED"],
      rejected: ["MANUAL_REJECTED"],
      failed: ["FULFILLMENT_FAILED"],
    };
    const query: Record<string, unknown> = { provider: "MANUAL_DIRECT" };
    if (q.status === "failed") query["$or"] = [
      { payment_status: "FULFILLMENT_FAILED" },
      { payment_status: "FULFILLING", fulfillment_error: { $exists: true, $ne: null } },
      { payment_status: "FULFILLED", fulfillment_email_status: { $in: ["NOT_SENT", "PENDING", "RETRYABLE", "SENDING", "DELIVERY_UNKNOWN"] } },
      { payment_status: "FULFILLED", fulfillment_email_status: { $exists: false } },
      { payment_status: "FULFILLED", pin_generated: { $exists: false } },
      { payment_status: "FULFILLED", pin_generated: { $in: [null, ""] } },
      { payment_status: "FULFILLED", fulfillment_email_failed: true },
      { payment_status: "FULFILLED", fulfillment_error: { $exists: true, $ne: null } },
      { payment_status: "FULFILLED", account_link_status: "EXISTING_LINK_REQUIRES_REVIEW" },
    ];
    else if (q.status !== "all") query["payment_status"] = { $in: groups[q.status] };
    if (q.q) {
      const search = q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query["$and"] = [{ $or: ["buyer_name", "buyer_email", "reference"].map((field) => ({ [field]: { $regex: search, $options: "i" } })) }];
    }
    const collection = getDb().collection("payment_transactions");
    const total = await collection.countDocuments(query);
    const entries = await collection.find(query, { projection: { _id: 0, evidence_image: 0 } })
      .sort({ created_at: -1 }).skip(q.offset).limit(q.limit).toArray();
    for (const tx of entries) {
      // Expired payment instructions stay reviewable when the owner has received funds.
      tx["product_id"] = tx["product_id"] ?? "BOT_LIFETIME";
      tx["product_name"] = tx["product_name"] ?? "One-Time XauCloud MT5 License";
      tx["has_proof"] = Boolean(tx["evidence_image"] || tx["evidence_uploaded_at"]);
      const license = await getDb().collection("pin_licenses").findOne({ payment_ref: tx["reference"] });
      tx["license_status"] = !license ? "NOT_ISSUED" : directLicenseMatches(tx, license) ? "ISSUED" : "REQUIRES_REVIEW";
      tx["account_link_status"] = tx["account_link_status"] || "NOT_LINKED";
      delete tx["evidence_image"];
    }
    return { entries, total, limit: q.limit, offset: q.offset };
  });

  app.get("/admin/direct-checkout/:reference", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const tx = await getDb().collection("payment_transactions").findOne(
      { provider: "MANUAL_DIRECT", reference }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    return { order: tx };
  });

  app.post("/admin/direct-checkout/:reference/approve", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();
    const tx = await db.collection("payment_transactions").findOne({ reference, provider: "MANUAL_DIRECT" });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    if (tx["payment_status"] === "FULFILLED") {
      const license = await db.collection("pin_licenses").findOne({ payment_ref: reference });
      if (!directLicenseMatches(tx, license)) return reply.code(409).send({ detail: "Fulfilled order license validation failed. Use Retry Fulfillment to recover it." });
      return { status: "already_fulfilled", license_status: "ISSUED", fulfillment_email_status: tx["fulfillment_email_status"] ?? "NOT_SENT" };
    }
    if (!APPROVABLE_STATES.includes(String(tx["payment_status"]))) {
      return reply.code(409).send({ detail: tx["approved_by"] ? "Payment already approved. Use Retry Fulfillment if delivery failed." : "This payment is no longer pending." });
    }
    if (!validDirectOrder(tx)) return reply.code(409).send({ detail: "Stored order product, purchaser, amount or payment instructions are invalid. Approval was blocked." });
    const at = utc();
    const claim = await db.collection("payment_transactions").updateOne(
      { reference, provider: "MANUAL_DIRECT", payment_status: { $in: APPROVABLE_STATES } },
      { $set: { payment_status: "FULFILLING", payment_approved: true, approved_by: admin["email"], approved_at: at,
        approval_event: { action: "APPROVE", by: admin["email"], at },
        fulfillment_claim_id: randomUUID(), fulfillment_claimed_at: at } });
    if (!claim.modifiedCount) return reply.code(409).send({ detail: "Another request already handled this payment. Refresh its status." });
    const approved = await db.collection("payment_transactions").findOne({ provider: "MANUAL_DIRECT", reference });
    return completeDirectFulfillment(app, approved!);
  });

  async function retryFulfillment(request: FastifyRequest, reply: FastifyReply) {
    const { reference } = request.params as { reference: string };
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();
    const tx = await db.collection("payment_transactions").findOne({ provider: "MANUAL_DIRECT", reference });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    if (!tx["approved_by"] || !tx["approved_at"] || !validDirectOrder(tx)) return reply.code(409).send({ detail: "A valid order and recorded administrator approval are required for fulfillment." });
    const prior = String(tx["payment_status"]);
    if (!["FULFILLING", "FULFILLMENT_FAILED", "FULFILLED"].includes(prior)) return reply.code(409).send({ detail: "This payment has not been approved." });
    if (prior === "FULFILLED" && tx["fulfillment_email_status"] === "SENT") {
      const license = await db.collection("pin_licenses").findOne({ payment_ref: reference });
      if (directLicenseMatches(tx, license) && !tx["fulfillment_error"] &&
          ["LINKED", "AWAITING_SIGNUP"].includes(String(tx["account_link_status"]))) {
        return { status: "already_fulfilled", license_status: "ISSUED", fulfillment_email_status: "SENT" };
      }
    }
    if (["SENDING", "DELIVERY_UNKNOWN"].includes(String(tx["fulfillment_email_status"]))) {
      return reply.code(409).send({ detail: tx["fulfillment_email_error"] || "Official email is sending or its delivery outcome is unknown. Check the sender delivery log before another send; duplicate delivery was prevented." });
    }
    const staleBefore = new Date(Date.now() - DELIVERY_LEASE_MS).toISOString();
    const recovered = await db.collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, payment_status: prior,
        ...(prior === "FULFILLING" ? tx["fulfillment_error"]
          ? { fulfillment_error: tx["fulfillment_error"] }
          : { $or: [{ fulfillment_claimed_at: { $exists: false } }, { fulfillment_claimed_at: { $lt: staleBefore } }] } : {}) },
      { $set: { payment_status: "FULFILLING", fulfillment_claim_id: randomUUID(), fulfillment_claimed_at: utc(),
        fulfillment_retried_by: admin["email"], fulfillment_retried_at: utc(), fulfillment_error: null, fulfillment_stage: null } });
    if (!recovered.modifiedCount) return reply.code(409).send({ detail: "Fulfillment is in progress. Refresh its status; a duplicate attempt was prevented." });
    const current = await db.collection("payment_transactions").findOne({ provider: "MANUAL_DIRECT", reference });
    return completeDirectFulfillment(app, current!);
  }
  app.post("/admin/direct-checkout/:reference/retry-fulfillment", { preHandler: requireAdmin }, retryFulfillment);
  // Backward-compatible endpoint; successful delivery is never automatically repeated.
  app.post("/admin/direct-checkout/:reference/resend-license", { preHandler: requireAdmin }, retryFulfillment);

  app.post("/admin/direct-checkout/:reference/reject", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();
    const tx = await db.collection("payment_transactions").findOne({ reference, provider: "MANUAL_DIRECT" });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    if (tx["payment_status"] === "MANUAL_REJECTED") return { status: "MANUAL_REJECTED" };
    if (await db.collection("pin_licenses").findOne({ payment_ref: reference })) {
      return reply.code(409).send({ detail: "A license already exists for this order. Rejection is blocked to preserve the purchased entitlement." });
    }
    const at = utc();
    const result = await db.collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, payment_status: { $in: APPROVABLE_STATES } },
      { $set: { payment_status: "MANUAL_REJECTED", rejected_at: at, rejected_by: admin["email"],
        rejection_event: { action: "REJECT", by: admin["email"], at } } });
    if (!result.modifiedCount) return reply.code(409).send({ detail: "Payment already approved or closed; rejection was blocked." });
    await db.collection("payment_review_log").insertOne({ id: randomUUID(), reference, action: "REJECT", by: admin["email"], at });
    try {
      const sent = await sendEmail(String(tx["buyer_email"]), "XauCloud payment review — " + reference,
        '<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto"><h2>XauCloud payment review</h2><p>Hello ' +
        escapeEmailHtml(tx["buyer_name"]) + ',</p><p>Your payment for order <strong>' + escapeEmailHtml(reference) +
        '</strong> was rejected. Contact XauCloud support with your order reference if you believe there is a mistake.</p></div>');
      await db.collection("payment_transactions").updateOne({ provider: "MANUAL_DIRECT", reference },
        { $set: { rejection_email_status: sent ? "SENT" : "RETRYABLE" } });
    } catch (error) { app.log.error({ error, reference }, "Payment rejection notification failed"); }
    return { status: "MANUAL_REJECTED" };
  });
}
