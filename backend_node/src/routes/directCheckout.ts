import type { FastifyInstance } from "fastify";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { MongoServerError } from "mongodb";
import { getDb } from "../db.js";
import { clientIp, rateLimit, requireAdmin } from "../auth.js";
import { getSettings } from "../services/settings.js";
import { getBankTransferSettings, bankTransferIsConfigured } from "../services/paymentMethods.js";
import { generateUniquePin } from "../services/paymentFulfillment.js";
import { notifyAdminPaymentStarted, notifyAdminNewSale, sendPinEmail, recordFulfillmentEmailResult } from "../services/paymentEmails.js";

const WALLET_NETWORKS: Record<string, string[]> = { USDT: ["ERC20", "TRC20"], USDC: ["ERC20"] };
const ETH_WALLET = /^0x[0-9a-fA-F]{40}$/;
const TRON_WALLET = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const ETH_HASH = /^0x[0-9a-fA-F]{64}$/;
const TRON_HASH = /^(?:0x)?[0-9a-fA-F]{64}$/;
const RATE_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;

const isoCountry = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);
const quoteSchema = z.object({
  country: isoCountry,
  buyer_name: z.string().trim().min(2).max(120),
  buyer_email: z.string().trim().toLowerCase().email().max(254),
  asset: z.string().optional().default(""),
  network: z.string().optional().default(""),
});
const submitSchema = z.object({ payment_reference: z.string().trim().min(5).max(180) });
const reviewSchema = z.object({
  evidence_reference: z.string().trim().min(6).max(200),
  verification_notes: z.string().trim().min(12).max(1500),
});
const walletSchema = z.object({ asset: z.enum(["USDT", "USDC"]), network: z.enum(["ERC20", "TRC20"]), address: z.string().trim().max(256) });
const adminConfigSchema = z.object({
  price_usd_cents: z.number().int().positive().max(100_000_000).optional(),
  usd_ngn_rate: z.string().max(30).optional(),
  bank_enabled: z.boolean().optional(),
  crypto_enabled: z.boolean().optional(),
  crypto_countries: z.array(isoCountry).max(249).optional(),
  wallets: z.array(walletSchema).max(20).optional(),
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
    bank_enabled: settings["direct_bank_enabled"] === true,
    crypto_enabled: settings["direct_crypto_enabled"] === true,
    crypto_countries: Array.isArray(settings["direct_crypto_countries"]) ? settings["direct_crypto_countries"] as string[] : [],
    wallets: wallets.filter((w) => isApprovedWallet(String(w["asset"]), String(w["network"]), String(w["address"]))),
  };
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
}

export async function registerDirectCheckoutRoutes(app: FastifyInstance): Promise<void> {
  app.get("/purchase/direct/config", async (request) => {
    rateLimit("direct_config:" + clientIp(request), 60, 60);
    const cfg = getCfg(await getSettings());
    return {
      currency: "USD", price_usd_cents: cfg.price_usd_cents,
      price_formatted: cfg.price_usd_cents != null ? usdFormatted(cfg.price_usd_cents) : null,
      bank_enabled: cfg.bank_enabled, crypto_enabled: cfg.crypto_enabled,
      crypto_countries: cfg.crypto_countries,
      crypto_options: cfg.crypto_enabled ? cfg.wallets.map((w) => ({ asset: w["asset"], network: w["network"] })) : [],
      trial_days: 3,
    };
  });

  app.post("/purchase/direct/quote", async (request, reply) => {
    rateLimit("direct_quote:" + clientIp(request), 8, 600);
    const req = quoteSchema.parse(request.body);
    const cfg = getCfg(await getSettings());
    const cents = cfg.price_usd_cents;
    if (cents == null) return reply.code(503).send({ detail: "Administrator has not configured the USD price." });
    const method = req.country === "NG" ? "BANK" : "CRYPTO";
    let amountMinor: number;
    let currency: string;
    let details: Record<string, string>;
    const stamp = new Date();
    if (method === "BANK") {
      const bank = await getBankTransferSettings();
      if (!cfg.bank_enabled || !bank.enabled || !bankTransferIsConfigured(bank)) {
        return reply.code(503).send({ detail: "Nigerian bank checkout is not configured." });
      }
      const updated = cfg.rate_as_of ? new Date(cfg.rate_as_of) : null;
      if (!cfg.usd_ngn_rate || !updated || !Number.isFinite(updated.getTime()) ||
          updated.getTime() > stamp.getTime() || stamp.getTime() - updated.getTime() > 86400000) {
        return reply.code(503).send({ detail: "A current USD/NGN rate is unavailable; checkout paused." });
      }
      try { amountMinor = toNgnKobo(cents, cfg.usd_ngn_rate); }
      catch { return reply.code(503).send({ detail: "A valid exchange rate is unavailable; checkout paused." }); }
      currency = "NGN";
      details = { bank_name: bank.bank_name, account_name: bank.account_name,
                  account_number: bank.account_number, fx_rate: String(cfg.usd_ngn_rate), rate_as_of: String(cfg.rate_as_of) };
    } else {
      if (!cfg.crypto_enabled || !cfg.crypto_countries.includes(req.country)) {
        return reply.code(403).send({ detail: "Crypto checkout is not available in this country." });
      }
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
      buyer_name: req.buyer_name, buyer_email: req.buyer_email,
      quote_details: details, created_at: stamp.toISOString(), expires_at: expires,
      payment_status: "MANUAL_PENDING", pin_generated: null, state_transitions: {},
    };
    await getDb().collection("payment_transactions").insertOne(tx);
    try { await notifyAdminPaymentStarted("Manual " + method, reference, req.buyer_name, req.buyer_email, amountFormatted); }
    catch (e) { app.log.error({ err: e, reference }, "Manual payment start notification failed"); }
    return { reference, method, usd_price: usdFormatted(cents), currency,
             amount_minor: amountMinor, amount_formatted: amountFormatted,
             details, expires_at: expires, status: "MANUAL_PENDING" };
  });

  app.post("/purchase/direct/:reference/submit", async (request, reply) => {
    rateLimit("direct_submit:" + clientIp(request), 12, 600);
    const { reference } = request.params as { reference: string };
    const req = submitSchema.parse(request.body);
    const tx = await getDb().collection("payment_transactions").findOne(
      { provider: "MANUAL_DIRECT", reference }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    const status = await effectiveStatus(tx);
    if (status === "MANUAL_SUBMITTED") return { reference, status };
    if (status !== "MANUAL_PENDING") return reply.code(409).send({ detail: "Order expired or closed. Contact support if you already paid." });
    const proof = req.payment_reference;
    const valid = tx["method"] === "BANK" ? /^[A-Za-z0-9 _./-]{5,160}$/.test(proof)
      : (tx["quote_details"] as Record<string, string>)["network"] === "ERC20" ? ETH_HASH.test(proof) : TRON_HASH.test(proof);
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
    return { reference, status: "MANUAL_SUBMITTED" };
  });

  app.get("/purchase/direct/:reference/status", async (request, reply) => {
    rateLimit("direct_status:" + clientIp(request), 60, 60);
    const { reference } = request.params as { reference: string };
    const tx = await getDb().collection("payment_transactions").findOne(
      { provider: "MANUAL_DIRECT", reference }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    return { reference, status: await effectiveStatus(tx), method: tx["method"],
             amount_minor: tx["amount_minor"], currency: tx["currency"],
             created_at: tx["created_at"], expires_at: tx["expires_at"] };
  });

  app.get("/admin/direct-checkout/config", { preHandler: requireAdmin }, async () => getCfg(await getSettings()));
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
    if (req.bank_enabled !== undefined) updates["direct_bank_enabled"] = req.bank_enabled;
    if (req.crypto_enabled !== undefined) updates["direct_crypto_enabled"] = req.crypto_enabled;
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
    return getCfg(await getSettings());
  });

  app.get("/admin/direct-checkout/orders", { preHandler: requireAdmin }, async () => {
    const entries = await getDb().collection("payment_transactions").find(
      { provider: "MANUAL_DIRECT" }, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(200).toArray();
    for (const tx of entries) tx["payment_status"] = await effectiveStatus(tx);
    return { entries };
  });

  app.post("/admin/direct-checkout/:reference/approve", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const req = reviewSchema.parse(request.body);
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const tx = await getDb().collection("payment_transactions").findOne(
      { reference, provider: "MANUAL_DIRECT" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Order not found." });
    if (tx["payment_status"] === "FULFILLED") return { status: "already_fulfilled" };
    if (tx["payment_status"] !== "MANUAL_SUBMITTED" && tx["payment_status"] !== "FULFILLING") {
      return reply.code(409).send({ detail: "Only independently verified submissions can be approved." });
    }
    if (tx["payment_status"] === "FULFILLING" && tx["approved_by"] !== admin["email"]) {
      return reply.code(409).send({ detail: "Order is being fulfilled by another reviewer." });
    }
    const claimed = tx["payment_status"] === "FULFILLING" ||
      (await getDb().collection("payment_transactions").updateOne(
        { reference, provider: "MANUAL_DIRECT", payment_status: "MANUAL_SUBMITTED" },
        { $set: { payment_status: "FULFILLING", approved_by: admin["email"],
                  verified_external_reference: req.evidence_reference,
                  verification_notes: req.verification_notes, approved_at: utc() } })).modifiedCount === 1;
    if (!claimed) return reply.code(409).send({ detail: "Another reviewer claimed this order." });
    // Reuse the existing pin schema and unique payment_ref index for idempotency.
    let license = await getDb().collection("pin_licenses").findOne({ payment_ref: reference });
    let pin = String(license?.["pin"] ?? "");
    if (!pin) {
      pin = generateUniquePin();
      const doc = {
        id: randomUUID(), pin, buyer_name: tx["buyer_name"], buyer_email: tx["buyer_email"],
        is_active: true, is_used: false, activated_at: null, mt5_account: null,
        created_at: utc(), notes: "Verified manual direct " + tx["method"] + " - " + reference,
        payment_ref: reference, provider: "MANUAL_DIRECT",
      };
      try { await getDb().collection("pin_licenses").insertOne(doc); }
      catch (err) {
        if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
        license = await getDb().collection("pin_licenses").findOne({ payment_ref: reference });
        if (!license) throw err;
        pin = String(license["pin"]);
      }
    }
    const finish = await getDb().collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, payment_status: "FULFILLING" },
      { $set: { payment_status: "FULFILLED", pin_generated: pin, fulfilled_at: utc(),
                fulfillment_email_status: "PENDING" } });
    if (finish.modifiedCount) {
      await getDb().collection("payment_review_log").insertOne({
        id: randomUUID(), reference, action: "APPROVE", by: admin["email"], at: utc(),
        evidence_reference: req.evidence_reference, verification_notes: req.verification_notes,
      });
      try {
        const sent = await sendPinEmail(String(tx["buyer_email"]), String(tx["buyer_name"]), pin);
        await recordFulfillmentEmailResult(reference, String(tx["buyer_name"]), String(tx["buyer_email"]), pin, sent);
        await getDb().collection("payment_transactions").updateOne(
          { reference }, { $set: { fulfillment_email_status: sent ? "SENT" : "RETRYABLE" } });
      } catch (err) {
        app.log.error({ err, reference }, "Manual checkout fulfillment email failed");
        await getDb().collection("payment_transactions").updateOne(
          { reference }, { $set: { fulfillment_email_status: "RETRYABLE" } });
      }
      try {
        await notifyAdminNewSale(reference, String(tx["buyer_name"]), String(tx["buyer_email"]),
          usdFormatted(Number(tx["price_usd_cents"])), pin, "Manual " + tx["method"], "XauCloud EA license",
          req.evidence_reference);
      } catch (err) { app.log.error({ err, reference }, "Manual sale notification failed"); }
    }
    return { status: "FULFILLED" };
  });

  app.post("/admin/direct-checkout/:reference/reject", { preHandler: requireAdmin }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const req = reviewSchema.parse(request.body);
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const result = await getDb().collection("payment_transactions").updateOne(
      { provider: "MANUAL_DIRECT", reference, payment_status: { $in: ["MANUAL_PENDING", "MANUAL_SUBMITTED"] } },
      { $set: { payment_status: "MANUAL_REJECTED", rejected_at: utc(),
                rejected_by: admin["email"], verification_notes: req.verification_notes } });
    if (!result.modifiedCount) return reply.code(409).send({ detail: "Order not found or no longer rejectable." });
    await getDb().collection("payment_review_log").insertOne({
      id: randomUUID(), reference, action: "REJECT", by: admin["email"],
      verification_notes: req.verification_notes, at: utc(),
    });
    return { status: "MANUAL_REJECTED" };
  });
}
