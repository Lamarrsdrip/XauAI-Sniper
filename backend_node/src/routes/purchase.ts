import type { FastifyInstance } from "fastify";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { clientIp, rateLimit, requireCloudUser } from "../auth.js";
import { getSettings } from "../services/settings.js";
import { buildPriceDisplay, detectDisplayCurrency, detectCountryCode } from "../services/currencyDisplay.js";
import { getPaymentMethodsSettings, paymentMethodAvailability, getBankTransferSettings, bankTransferIsConfigured, PAYMENT_METHOD_COPY } from "../services/paymentMethods.js";
import { getActiveNombaCredentials, getNombaConfig, decryptNombaEnvBlock } from "../services/nombaConfig.js";
import { createCheckoutOrder, extractOrderReference, extractWebhookSignatureFields, verifyWebhookSignature } from "../services/nombaService.js";
import type { NombaEnvBlock } from "../services/nombaConfig.js";
import { fulfillNombaPayment, fulfillPayment, transitionPaymentState, bankTransferEffectiveStatus, PAYSTACK_BASE_URL } from "../services/paymentFulfillment.js";
import { notifyAdminBankTransferSubmitted, notifyAdminPaymentStarted, sendBankTransferInstructionsEmail } from "../services/paymentEmails.js";
import { sendPaymentFailedEmail } from "../services/accountLifecycleEmails.js";
import { TRIAL_MARKET_DAY_LIMIT } from "../services/signalTrial.js";
import type { SignalPlan } from "../services/signalSubscriptions.js";

const PurchaseInitRequestSchema = z.object({
  buyer_name: z.string(),
  buyer_email: z.string(),
  origin_url: z.string(),
  display_currency: z.string().nullable().optional(),
});
const BankTransferInitiateRequestSchema = z.object({ buyer_name: z.string(), buyer_email: z.string() });
const BankTransferProofRequestSchema = z.object({ proof_image: z.string() });

const SIGNAL_PLAN_IDS = ["SIGNALS_WEEKLY", "SIGNALS_MONTHLY"] as const;
const SignalPlanInitRequestSchema = z.object({ plan_id: z.enum(SIGNAL_PLAN_IDS), origin_url: z.string() });
const SignalPlanLabel: Record<SignalPlan, string> = { SIGNALS_WEEKLY: "Weekly Signals", SIGNALS_MONTHLY: "Monthly Signals" };

/** Server-authoritative price lookup for a signal plan -- never trust a client-supplied amount. Same defensive-default pattern as pin_price_kobo. */
function signalPlanPriceKobo(settings: Record<string, unknown>, planId: SignalPlan): number {
  return Number(settings[planId === "SIGNALS_WEEKLY" ? "signals_weekly_price_kobo" : "signals_monthly_price_kobo"] ?? (planId === "SIGNALS_WEEKLY" ? 2_000_000 : 5_000_000));
}

/** Port of server.py:1487 `_verify_paystack_signature` -- HMAC-SHA512 over the raw body, constant-time compare. */
function verifyPaystackSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const computed = createHmac("sha512", secret).update(rawBody).digest("hex");
  const computedBuf = Buffer.from(computed, "utf8");
  const givenBuf = Buffer.from(signature, "utf8");
  if (computedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(computedBuf, givenBuf);
}

/** Port of server.py's purchase/payment routes (lines 1356-2122). */
export async function registerPurchaseRoutes(app: FastifyInstance): Promise<void> {
  // GET /purchase/price -- server.py:1356
  app.get("/purchase/price", async (request) => {
    const q = z.object({ display_currency: z.string().nullable().optional() }).parse(request.query);
    const detected = detectDisplayCurrency(request, q.display_currency);
    const priceDisplay = await buildPriceDisplay(detected);
    const settings = await getPaymentMethodsSettings();
    const availability = await paymentMethodAvailability(request);
    const availableMethods = settings.payment_method_order.filter((m) => availability[m]);
    return { ...priceDisplay, payment_method: availableMethods[0] ?? "unavailable" };
  });

  // GET /purchase/plans -- authoritative price list for the 4-tier product (trial/weekly/monthly/lifetime).
  // The frontend renders prices from here; it never hardcodes an NGN literal.
  app.get("/purchase/plans", async () => {
    const settings = await getSettings();
    const lifetimeKobo = Number(settings["pin_price_kobo"] ?? 30_000_000);
    return {
      trial: { plan_id: "TRIAL", label: "Free Signal Trial", price_kobo: 0, market_days: TRIAL_MARKET_DAY_LIMIT },
      signals_weekly: { plan_id: "SIGNALS_WEEKLY", label: SignalPlanLabel.SIGNALS_WEEKLY, price_kobo: signalPlanPriceKobo(settings, "SIGNALS_WEEKLY") },
      signals_monthly: { plan_id: "SIGNALS_MONTHLY", label: SignalPlanLabel.SIGNALS_MONTHLY, price_kobo: signalPlanPriceKobo(settings, "SIGNALS_MONTHLY") },
      bot_lifetime: { plan_id: "BOT_LIFETIME", label: "XauCloud Bot — Lifetime", price_kobo: lifetimeKobo },
      currency: "NGN",
    };
  });

  // POST /purchase/signals/paystack/initialize -- authenticated signal-subscription checkout (Paystack).
  // Reuses the exact same payment_transactions/transitionPaymentState/fulfillPayment engine as the
  // lifetime-license flow below; only plan_id + the authenticated user_id differ.
  app.post("/purchase/signals/paystack/initialize", { preHandler: requireCloudUser }, async (request, reply) => {
    const req = SignalPlanInitRequestSchema.parse(request.body);
    const user = (request as typeof request & { cloudUser?: Record<string, unknown> }).cloudUser!;
    rateLimit(`signal_purchase_init_ip:${clientIp(request)}`, 10, 600);

    const paymentSettings = await getPaymentMethodsSettings();
    if (!paymentSettings.paystack_enabled) return reply.code(503).send({ detail: "Card payment is not currently available." });
    const s = await getSettings();
    const pk = String(s["paystack_secret_key"] ?? "");
    if (!pk) return reply.code(503).send({ detail: "Payment system not configured yet." });

    const kobo = signalPlanPriceKobo(s, req.plan_id);
    const ref = `ASE-SIG-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const callbackUrl = `${env.PUBLIC_SITE_URL}/purchase/success?reference=${ref}`;
    const buyerEmail = String(user["email"] ?? "");
    const buyerName = String(user["full_name"] ?? "");

    const tx = {
      id: randomUUID(), reference: ref, amount_kobo: kobo, currency: "NGN", provider: "PAYSTACK",
      plan_id: req.plan_id, user_id: String(user["id"] ?? ""),
      buyer_name: buyerName, buyer_email: buyerEmail, payment_status: "PENDING", pin_generated: null,
      state_transitions: {}, created_at: new Date().toISOString(),
    };
    await getDb().collection("payment_transactions").insertOne({ ...tx });
    await notifyAdminPaymentStarted("Paystack", ref, buyerName, buyerEmail, `₦${(kobo / 100).toLocaleString("en-US")}`, SignalPlanLabel[req.plan_id]);

    const resp = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: buyerEmail, amount: kobo, reference: ref, callback_url: callbackUrl, metadata: { buyer_name: buyerName, plan_id: req.plan_id }, currency: "NGN" }),
    });
    if (resp.status !== 200) {
      await getDb().collection("payment_transactions").updateOne({ reference: ref }, { $set: { payment_status: "FAILED" } });
      return reply.code(502).send({ detail: "Payment init failed" });
    }
    const data = (await resp.json()) as { status: boolean; data?: { authorization_url: string }; message?: string };
    if (!data.status) {
      await getDb().collection("payment_transactions").updateOne({ reference: ref }, { $set: { payment_status: "FAILED" } });
      return reply.code(502).send({ detail: data.message ?? "Failed" });
    }
    return { authorization_url: data.data!.authorization_url, reference: ref };
  });

  // POST /purchase/signals/nomba/initialize -- authenticated signal-subscription checkout (Nomba).
  app.post("/purchase/signals/nomba/initialize", { preHandler: requireCloudUser }, async (request, reply) => {
    const req = SignalPlanInitRequestSchema.parse(request.body);
    const user = (request as typeof request & { cloudUser?: Record<string, unknown> }).cloudUser!;
    rateLimit(`signal_purchase_init_ip:${clientIp(request)}`, 10, 600);

    const paymentSettings = await getPaymentMethodsSettings();
    if (!paymentSettings.nomba_enabled) return reply.code(503).send({ detail: "Nomba is not currently available. Please choose Manual Bank Transfer or Paystack instead." });
    const [nombaCfg, creds] = await getActiveNombaCredentials();
    if (!creds) return reply.code(503).send({ detail: "Payment system not configured yet." });

    const s = await getSettings();
    const kobo = signalPlanPriceKobo(s, req.plan_id);
    const naira = kobo / 100;
    const ref = `ASE-SIG-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const callbackUrl = `${env.PUBLIC_SITE_URL}/purchase/success?reference=${ref}`;
    const buyerEmail = String(user["email"] ?? "");
    const buyerName = String(user["full_name"] ?? "");

    const tx = {
      id: randomUUID(), reference: ref, amount_kobo: kobo, currency: "NGN", provider: "NOMBA",
      plan_id: req.plan_id, user_id: String(user["id"] ?? ""),
      nomba_order_reference: ref, nomba_transaction_id: null,
      buyer_name: buyerName, buyer_email: buyerEmail, payment_status: "PENDING", pin_generated: null,
      created_at: new Date().toISOString(), state_transitions: {},
    };
    await getDb().collection("payment_transactions").insertOne({ ...tx });
    await notifyAdminPaymentStarted("Nomba (card/transfer/USSD)", ref, buyerName, buyerEmail, `₦${naira.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, SignalPlanLabel[req.plan_id]);

    try {
      const result = await createCheckoutOrder(creds, {
        order_reference: ref, amount: naira, currency: String(nombaCfg["currency"] ?? "NGN"),
        callback_url: callbackUrl, customer_email: buyerEmail,
        allowed_payment_methods: (nombaCfg["allowed_payment_methods"] as string[] | undefined) ?? null,
        idempotency_key: ref,
      });
      return { authorization_url: result.checkout_link, reference: result.order_reference };
    } catch {
      return reply.code(502).send({ detail: "Payment init failed" });
    }
  });

  // POST /purchase/signals/bank-transfer/initiate -- authenticated signal-subscription checkout (bank transfer).
  app.post("/purchase/signals/bank-transfer/initiate", { preHandler: requireCloudUser }, async (request, reply) => {
    const req = SignalPlanInitRequestSchema.parse(request.body);
    const user = (request as typeof request & { cloudUser?: Record<string, unknown> }).cloudUser!;
    rateLimit(`signal_bank_transfer_init_ip:${clientIp(request)}`, 10, 600);
    const country = detectCountryCode(request);
    const settings = await getBankTransferSettings();
    if (!settings.enabled) return reply.code(503).send({ detail: "Bank transfer is not currently available." });
    if (!bankTransferIsConfigured(settings)) return reply.code(503).send({ detail: "Bank transfer is not fully configured yet." });

    const s = await getSettings();
    const kobo = signalPlanPriceKobo(s, req.plan_id);
    const naira = kobo / 100;
    const ref = `ASE-SIGBT-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const timeoutMinutes = settings.timeout_minutes;
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60_000).toISOString();
    const buyerEmail = String(user["email"] ?? "");
    const buyerName = String(user["full_name"] ?? "");

    const tx = {
      id: randomUUID(), reference: ref, amount_kobo: kobo, currency: "NGN", provider: "BANK_TRANSFER",
      plan_id: req.plan_id, user_id: String(user["id"] ?? ""),
      buyer_name: buyerName, buyer_email: buyerEmail, payment_status: "BANK_TRANSFER_PENDING", pin_generated: null,
      created_at: new Date().toISOString(), state_transitions: {}, expires_at: expiresAt,
      detected_country: country, bank_transfer_proof: null, admin_notes: [],
    };
    await getDb().collection("payment_transactions").insertOne({ ...tx });

    const order = {
      reference: ref, amount_naira: naira, amount_formatted: `₦${naira.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      bank_name: settings.bank_name, account_name: settings.account_name, account_number: settings.account_number,
      expires_at: expiresAt, timeout_minutes: timeoutMinutes, proof_required: settings.proof_required,
      instructions: settings.instructions, support_contact: settings.support_contact,
    };
    await sendBankTransferInstructionsEmail(buyerEmail, buyerName, order);
    await notifyAdminPaymentStarted("Bank Transfer", ref, buyerName, buyerEmail, order.amount_formatted, SignalPlanLabel[req.plan_id]);
    return order;
  });

  // POST /purchase/initialize (Nomba) -- server.py:1374
  app.post("/purchase/initialize", async (request, reply) => {
    const req = PurchaseInitRequestSchema.parse(request.body);
    rateLimit(`purchase_init_ip:${clientIp(request)}`, 10, 600);

    const paymentSettings = await getPaymentMethodsSettings();
    if (!paymentSettings.nomba_enabled) {
      return reply.code(503).send({ detail: "Nomba is not currently available. Please choose Manual Bank Transfer or Paystack instead." });
    }
    const [nombaCfg, creds] = await getActiveNombaCredentials();
    if (!creds) return reply.code(503).send({ detail: "Payment system not configured yet." });

    const settings = await getSettings();
    const kobo = Number(settings["pin_price_kobo"] ?? 30_000_000);
    const naira = kobo / 100;
    const ref = `ASE-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const callbackUrl = `${env.PUBLIC_SITE_URL}/purchase/success?reference=${ref}`;
    const displayPrice = await buildPriceDisplay(detectDisplayCurrency(request, req.display_currency));

    const tx = {
      id: randomUUID(),
      reference: ref,
      amount_kobo: kobo,
      currency: "NGN",
      provider: "NOMBA",
      nomba_order_reference: ref,
      nomba_transaction_id: null,
      buyer_name: req.buyer_name,
      buyer_email: req.buyer_email,
      payment_status: "PENDING",
      pin_generated: null,
      display_currency: displayPrice.display_currency,
      display_amount: displayPrice.display_amount,
      fx_rate: displayPrice.fx_rate,
      fx_rate_as_of: displayPrice.fx_rate_as_of,
      created_at: new Date().toISOString(),
      state_transitions: {},
    };
    await getDb().collection("payment_transactions").insertOne({ ...tx });
    await notifyAdminPaymentStarted("Nomba (card/transfer/USSD)", ref, req.buyer_name, req.buyer_email, `₦${naira.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

    try {
      const result = await createCheckoutOrder(creds, {
        order_reference: ref,
        amount: naira,
        currency: String(nombaCfg["currency"] ?? "NGN"),
        callback_url: callbackUrl,
        customer_email: req.buyer_email,
        allowed_payment_methods: (nombaCfg["allowed_payment_methods"] as string[] | undefined) ?? null,
        idempotency_key: ref,
      });
      return { authorization_url: result.checkout_link, reference: result.order_reference };
    } catch {
      return reply.code(502).send({ detail: "Payment init failed" });
    }
  });

  // POST /purchase/paystack/initialize -- server.py:1431
  app.post("/purchase/paystack/initialize", async (request, reply) => {
    const req = PurchaseInitRequestSchema.parse(request.body);
    rateLimit(`purchase_paystack_init_ip:${clientIp(request)}`, 10, 600);

    const paymentSettings = await getPaymentMethodsSettings();
    if (!paymentSettings.paystack_enabled) return reply.code(503).send({ detail: "Card payment is not currently available." });
    const s = await getSettings();
    const pk = String(s["paystack_secret_key"] ?? "");
    if (!pk) return reply.code(503).send({ detail: "Payment system not configured yet." });

    const kobo = Number(s["pin_price_kobo"] ?? 30_000_000);
    const naira = kobo / 100;
    const ref = `ASE-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const callbackUrl = `${env.PUBLIC_SITE_URL}/purchase/success?reference=${ref}`;
    const displayPrice = await buildPriceDisplay(detectDisplayCurrency(request, req.display_currency));

    const tx = {
      id: randomUUID(),
      reference: ref,
      amount_kobo: kobo,
      currency: "NGN",
      provider: "PAYSTACK",
      buyer_name: req.buyer_name,
      buyer_email: req.buyer_email,
      payment_status: "PENDING",
      pin_generated: null,
      state_transitions: {},
      display_currency: displayPrice.display_currency,
      display_amount: displayPrice.display_amount,
      fx_rate: displayPrice.fx_rate,
      fx_rate_as_of: displayPrice.fx_rate_as_of,
      created_at: new Date().toISOString(),
    };
    await getDb().collection("payment_transactions").insertOne({ ...tx });
    await notifyAdminPaymentStarted("Paystack", ref, req.buyer_name, req.buyer_email, `₦${naira.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

    const resp = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pk}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: req.buyer_email,
        amount: kobo,
        reference: ref,
        callback_url: callbackUrl,
        metadata: { buyer_name: req.buyer_name },
        currency: "NGN",
      }),
    });
    if (resp.status !== 200) {
      await getDb().collection("payment_transactions").updateOne({ reference: ref }, { $set: { payment_status: "FAILED" } });
      return reply.code(502).send({ detail: "Payment init failed" });
    }
    const data = (await resp.json()) as { status: boolean; data?: { authorization_url: string }; message?: string };
    if (!data.status) {
      await getDb().collection("payment_transactions").updateOne({ reference: ref }, { $set: { payment_status: "FAILED" } });
      return reply.code(502).send({ detail: data.message ?? "Failed" });
    }
    return { authorization_url: data.data!.authorization_url, reference: ref };
  });

  // GET /purchase/payment-methods -- server.py:1815
  app.get("/purchase/payment-methods", async (request) => {
    rateLimit(`payment_methods_ip:${clientIp(request)}`, 60, 60);
    const settings = await getPaymentMethodsSettings();
    const availability = await paymentMethodAvailability(request);
    const country = detectCountryCode(request);

    const methods = settings.payment_method_order.map((method) => {
      const copy = PAYMENT_METHOD_COPY[method]!;
      return { method, label: copy.label, description: copy.description, instant: copy.instant, available: availability[method] };
    });

    let defaultMethod: string | null = settings.default_payment_method;
    if (!availability[defaultMethod]) {
      defaultMethod = methods.find((m) => m.available)?.method ?? null;
    }
    return { methods, default_method: defaultMethod, detected_country: country || null };
  });

  // GET /purchase/bank-transfer/eligibility -- server.py:1858
  app.get("/purchase/bank-transfer/eligibility", async (request) => {
    rateLimit(`bank_transfer_eligibility_ip:${clientIp(request)}`, 60, 60);
    const country = detectCountryCode(request);
    const settings = await getBankTransferSettings();
    const eligible = settings.enabled && bankTransferIsConfigured(settings);
    return { eligible, detected_country: country || null };
  });

  // POST /purchase/bank-transfer/initiate -- server.py:1868
  app.post("/purchase/bank-transfer/initiate", async (request, reply) => {
    const req = BankTransferInitiateRequestSchema.parse(request.body);
    rateLimit(`bank_transfer_init_ip:${clientIp(request)}`, 10, 600);
    const country = detectCountryCode(request);
    const settings = await getBankTransferSettings();
    if (!settings.enabled) return reply.code(503).send({ detail: "Bank transfer is not currently available." });
    if (!bankTransferIsConfigured(settings)) return reply.code(503).send({ detail: "Bank transfer is not fully configured yet." });

    const s = await getSettings();
    const kobo = Number(s["pin_price_kobo"] ?? 30_000_000);
    const naira = kobo / 100;
    const ref = `ASE-BT-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const timeoutMinutes = settings.timeout_minutes;
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60_000).toISOString();

    const tx = {
      id: randomUUID(),
      reference: ref,
      amount_kobo: kobo,
      currency: "NGN",
      provider: "BANK_TRANSFER",
      buyer_name: req.buyer_name,
      buyer_email: req.buyer_email,
      payment_status: "BANK_TRANSFER_PENDING",
      pin_generated: null,
      created_at: new Date().toISOString(),
      state_transitions: {},
      expires_at: expiresAt,
      detected_country: country,
      bank_transfer_proof: null,
      admin_notes: [],
    };
    await getDb().collection("payment_transactions").insertOne({ ...tx });

    const order = {
      reference: ref,
      amount_naira: naira,
      amount_formatted: `₦${naira.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      bank_name: settings.bank_name,
      account_name: settings.account_name,
      account_number: settings.account_number,
      expires_at: expiresAt,
      timeout_minutes: timeoutMinutes,
      proof_required: settings.proof_required,
      instructions: settings.instructions,
      support_contact: settings.support_contact,
    };
    await sendBankTransferInstructionsEmail(req.buyer_email, req.buyer_name, order);
    await notifyAdminPaymentStarted("Bank Transfer", ref, req.buyer_name, req.buyer_email, order.amount_formatted);
    return order;
  });

  // POST /purchase/bank-transfer/:reference/submitted -- server.py:1912
  app.post("/purchase/bank-transfer/:reference/submitted", async (request, reply) => {
    const { reference } = request.params as { reference: string };
    rateLimit(`bank_transfer_submit_ip:${clientIp(request)}`, 20, 600);
    const tx = await getDb().collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    const effective = await bankTransferEffectiveStatus(tx);
    if (effective === "BANK_TRANSFER_EXPIRED") return reply.code(410).send({ detail: "This order has expired." });
    const won = await transitionPaymentState(reference, ["BANK_TRANSFER_PENDING"], "BANK_TRANSFER_SUBMITTED");
    if (!won) {
      const fresh = await getDb().collection("payment_transactions").findOne({ reference }, { projection: { _id: 0 } });
      return { status: fresh?.["payment_status"] ?? effective };
    }
    await notifyAdminBankTransferSubmitted(tx);
    return { status: "BANK_TRANSFER_SUBMITTED" };
  });

  // POST /purchase/bank-transfer/:reference/proof -- server.py:1935
  app.post("/purchase/bank-transfer/:reference/proof", async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const req = BankTransferProofRequestSchema.parse(request.body);
    rateLimit(`bank_transfer_proof_ip:${clientIp(request)}`, 10, 600);
    if (!req.proof_image.startsWith("data:image/")) return reply.code(400).send({ detail: "Proof must be an image." });
    if (req.proof_image.length > 7_000_000) return reply.code(400).send({ detail: "Image too large (max ~5MB)." });
    const tx = await getDb().collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    if (!["BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED"].includes(String(tx["payment_status"]))) {
      return reply.code(409).send({ detail: "Cannot attach proof at this stage." });
    }
    await getDb()
      .collection("payment_transactions")
      .updateOne({ reference }, { $set: { bank_transfer_proof: req.proof_image, proof_uploaded_at: new Date().toISOString() } });
    return { status: "ok" };
  });

  // GET /purchase/bank-transfer/:reference/status -- server.py:1953
  app.get("/purchase/bank-transfer/:reference/status", async (request, reply) => {
    const { reference } = request.params as { reference: string };
    rateLimit(`bank_transfer_status_ip:${clientIp(request)}`, 60, 60);
    const tx = await getDb().collection("payment_transactions").findOne({ reference, provider: "BANK_TRANSFER" }, { projection: { _id: 0 } });
    if (!tx) return reply.code(404).send({ detail: "Not found" });
    const status = await bankTransferEffectiveStatus(tx);
    return {
      reference,
      status,
      pin: status === "FULFILLED" ? (tx["pin_generated"] ?? null) : null,
      expires_at: tx["expires_at"] ?? null,
      rejection_reason: tx["rejection_reason"] ?? null,
      has_proof: Boolean(tx["bank_transfer_proof"]),
    };
  });

  // GET /purchase/verify/:reference -- server.py:1974
  app.get("/purchase/verify/:reference", async (request, reply) => {
    const { reference } = request.params as { reference: string };
    rateLimit(`purchase_verify_ip:${clientIp(request)}`, 60, 60);
    const tx = await getDb().collection("payment_transactions").findOne({ reference }, { projection: { _id: 0, provider: 1 } });
    const provider = tx?.["provider"] ?? "PAYSTACK";
    const result = provider === "NOMBA" ? await fulfillNombaPayment(reference, "poll") : await fulfillPayment(reference, "poll");
    if (result.status === "success") {
      return { status: "success", payment_status: "success", pin: result.pin, buyer_name: result.buyer_name ?? "" };
    }
    if (result.status === "not_found") return reply.code(404).send({ detail: "Not found" });
    if (result.status === "failed") {
      return { status: "failed", payment_status: "failed", pin: null, reason: result.reason ?? "" };
    }
    return { status: "pending", payment_status: "pending", pin: null };
  });

  // POST /webhook/paystack -- server.py:1998
  app.post("/webhook/paystack", async (request, reply) => {
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const signature = String(request.headers["x-paystack-signature"] ?? "");
    const s = await getSettings();
    const secret = String(s["paystack_secret_key"] ?? "");
    if (!verifyPaystackSignature(rawBody, signature, secret)) {
      return reply.code(401).send({ detail: "Invalid signature" });
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return reply.code(400).send({ detail: "Invalid JSON" });
    }
    if (body["event"] !== "charge.success") return { status: "ignored" };
    const ref = String((body["data"] as Record<string, unknown> | undefined)?.["reference"] ?? "");
    if (!ref) return reply.code(400).send({ detail: "Missing reference" });
    await fulfillPayment(ref, "webhook");
    return { status: "ok" };
  });

  // POST /webhook/nomba -- server.py:2031
  app.post("/webhook/nomba", async (request, reply) => {
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const signature = String(request.headers["nomba-signature"] ?? "");
    const timestamp = String(request.headers["nomba-timestamp"] ?? "");

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return reply.code(400).send({ detail: "Invalid JSON" });
    }

    const eventType = String(body["event_type"] ?? "");
    let orderRef: string | null = null;
    try {
      orderRef = extractOrderReference(body);
    } catch {
      /* ignore */
    }

    const cfg = await getNombaConfig();
    const sigFields = extractWebhookSignatureFields(body);
    let valid = false;
    for (const envName of ["sandbox", "production"] as const) {
      const envBlock = (cfg[envName] as NombaEnvBlock | undefined) ?? undefined;
      if (!envBlock) continue;
      const creds = decryptNombaEnvBlock(envBlock, envName);
      if (!creds || !creds.webhook_signature_key) continue;
      if (
        verifyWebhookSignature({
          signature_header: signature,
          timestamp_header: timestamp,
          webhook_signature_key: creds.webhook_signature_key,
          ...sigFields,
        })
      ) {
        valid = true;
        break;
      }
    }
    if (!valid) return reply.code(401).send({ detail: "Invalid signature" });

    if (!["payment_success", "payment_failed", "payment_reversal"].includes(eventType)) {
      return { status: "ignored" };
    }
    if (!orderRef) return reply.code(400).send({ detail: "Missing order reference" });

    if (eventType === "payment_success") {
      await fulfillNombaPayment(orderRef, "webhook");
    } else if (eventType === "payment_failed") {
      // `won` guards idempotency: a replayed webhook for an order already in
      // FAILED (or that raced to a different state) does not match `fromStates`,
      // so modifiedCount stays 0 and no duplicate email is sent -- same pattern
      // every other transitionPaymentState() caller in this file relies on.
      const won = await transitionPaymentState(orderRef, ["PENDING", "VERIFYING"], "FAILED");
      if (won) {
        const tx = await getDb().collection("payment_transactions").findOne({ reference: orderRef }, { projection: { _id: 0, buyer_email: 1, buyer_name: 1 } });
        const buyerEmail = String(tx?.["buyer_email"] ?? "");
        if (buyerEmail) await sendPaymentFailedEmail(buyerEmail, String(tx?.["buyer_name"] ?? ""), orderRef);
      }
    } else if (eventType === "payment_reversal") {
      const db = getDb();
      await db
        .collection("payment_transactions")
        .updateOne({ reference: orderRef }, { $set: { payment_status: "REVERSED", "state_transitions.REVERSED": new Date().toISOString() } });
      await db.collection("pin_licenses").updateMany({ payment_ref: orderRef }, { $set: { review_required: true, review_reason: "PAYMENT_REVERSED" } });
    }
    return { status: "ok" };
  });
}
