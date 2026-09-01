import { createHmac, timingSafeEqual } from "node:crypto";

/** Port of backend/nomba_service.py -- Nomba Checkout payment provider integration. */

const PRODUCTION_BASE_URL = "https://api.nomba.com";
const SANDBOX_BASE_URL = "https://sandbox.nomba.com";
const PRODUCTION_CHECKOUT_PREFIX = "/v1/checkout/";
const SANDBOX_CHECKOUT_PREFIX = "/sandbox/checkout/";

const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS = 60;

export class NombaError extends Error {}

export interface NombaCredentials {
  client_id: string;
  client_secret: string;
  account_id: string;
  webhook_signature_key: string;
  environment: "sandbox" | "production";
}

function baseUrl(creds: NombaCredentials): string {
  return creds.environment === "sandbox" ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
}
function checkoutPrefix(creds: NombaCredentials): string {
  return creds.environment === "sandbox" ? SANDBOX_CHECKOUT_PREFIX : PRODUCTION_CHECKOUT_PREFIX;
}

const tokenCache = new Map<string, { accessToken: string; expiresAtEpoch: number }>();

function parseIso8601ToEpoch(iso: string): number {
  return new Date(iso).getTime() / 1000;
}

/** Port of nomba_service.py:89 `get_access_token`. */
export async function getAccessToken(creds: NombaCredentials, forceRefresh = false): Promise<string> {
  const cacheKey = `${creds.environment}:${creds.account_id}`;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now() / 1000;
  if (!forceRefresh && cached && cached.expiresAtEpoch - TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS > now) {
    return cached.accessToken;
  }

  const url = `${baseUrl(creds)}/v1/auth/token/issue`;
  const body = { grant_type: "client_credentials", client_id: creds.client_id, client_secret: creds.client_secret };
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", accountId: creds.account_id },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (exc) {
    throw new NombaError(`Network/timeout error requesting Nomba access token: ${String(exc)}`);
  }
  if (resp.status !== 200) throw new NombaError(`Nomba token issuance returned HTTP ${resp.status}`);

  let accessToken: string, expiresAtIso: string;
  try {
    const payload = (await resp.json()) as { data: { access_token: string; expiresAt: string } };
    accessToken = payload.data.access_token;
    expiresAtIso = payload.data.expiresAt;
  } catch (exc) {
    throw new NombaError(`Malformed response from Nomba token endpoint: ${String(exc)}`);
  }

  const expiresAtEpoch = parseIso8601ToEpoch(expiresAtIso);
  tokenCache.set(cacheKey, { accessToken, expiresAtEpoch });
  return accessToken;
}

export interface CheckoutOrderResult {
  checkout_link: string;
  order_reference: string;
}

/** Port of nomba_service.py:144 `create_checkout_order`. */
export async function createCheckoutOrder(
  creds: NombaCredentials,
  opts: {
    order_reference: string;
    amount: number;
    currency: string;
    callback_url: string;
    customer_email: string;
    allowed_payment_methods?: string[] | null;
    idempotency_key?: string | null;
  },
): Promise<CheckoutOrderResult> {
  const token = await getAccessToken(creds);
  const url = `${baseUrl(creds)}${checkoutPrefix(creds)}order`;
  const orderBody: Record<string, unknown> = {
    orderReference: opts.order_reference,
    amount: opts.amount.toFixed(2),
    currency: opts.currency,
    callbackUrl: opts.callback_url,
    customerEmail: opts.customer_email,
  };
  if (opts.allowed_payment_methods) orderBody["allowedPaymentMethods"] = opts.allowed_payment_methods;
  const body = { order: orderBody };
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, accountId: creds.account_id, "Content-Type": "application/json" };
  if (opts.idempotency_key) headers["X-Idempotent-key"] = opts.idempotency_key;

  let resp: Response;
  try {
    resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (exc) {
    throw new NombaError(`Network/timeout error creating Nomba checkout order: ${String(exc)}`);
  }
  if (resp.status !== 200) throw new NombaError(`Nomba checkout order creation returned HTTP ${resp.status}`);

  try {
    const payload = (await resp.json()) as { data: { checkoutLink: string; orderReference: string } };
    return { checkout_link: payload.data.checkoutLink, order_reference: payload.data.orderReference };
  } catch (exc) {
    throw new NombaError(`Malformed response from Nomba checkout order endpoint: ${String(exc)}`);
  }
}

export interface NombaVerificationResult {
  status: "SUCCESS" | "PENDING" | "FAILED" | "NOT_FOUND" | "ERROR";
  amount: number | null;
  currency: string | null;
  order_reference: string | null;
  nomba_transaction_id: string | null;
  raw: Record<string, unknown>;
}

/** Port of nomba_service.py:224 `verify_transaction` -- the authoritative check; a valid webhook signature alone is never sufficient. */
export async function verifyTransaction(creds: NombaCredentials, orderReference: string): Promise<NombaVerificationResult> {
  const token = await getAccessToken(creds);
  const url = new URL(`${baseUrl(creds)}${checkoutPrefix(creds)}transaction`);
  url.searchParams.set("idType", "orderReference");
  url.searchParams.set("id", orderReference);

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, accountId: creds.account_id },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (exc) {
    throw new NombaError(`Network/timeout error verifying Nomba transaction: ${String(exc)}`);
  }

  if (resp.status === 404) {
    return { status: "NOT_FOUND", amount: null, currency: null, order_reference: orderReference, nomba_transaction_id: null, raw: {} };
  }
  if (resp.status !== 200) throw new NombaError(`Nomba transaction verification returned HTTP ${resp.status}`);

  let payload: Record<string, unknown>;
  try {
    payload = (await resp.json()) as Record<string, unknown>;
  } catch (exc) {
    throw new NombaError(`Malformed response from Nomba transaction verification: ${String(exc)}`);
  }

  const data = (payload["data"] as Record<string, unknown> | undefined) ?? {};
  const order = (data["order"] as Record<string, unknown> | undefined) ?? {};
  const txnDetails = (data["transactionDetails"] as Record<string, unknown> | undefined) ?? {};
  const success = Boolean(data["success"]);
  const statusCode = String(txnDetails["statusCode"] ?? "").toUpperCase();

  let status: NombaVerificationResult["status"];
  if (success || statusCode.includes("SUCCESSFUL")) status = "SUCCESS";
  else if (statusCode === "" || statusCode === "PENDING") status = "PENDING";
  else status = "FAILED";

  const amountRaw = order["amount"];
  const amount = amountRaw !== undefined && amountRaw !== null && Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null;

  return {
    status,
    amount,
    currency: (order["currency"] as string | undefined) ?? null,
    order_reference: (order["orderReference"] as string | undefined) ?? orderReference,
    nomba_transaction_id: (txnDetails["paymentReference"] as string | undefined) ?? null,
    raw: payload,
  };
}

/**
 * Port of nomba_service.py:297 `verify_webhook_signature` -- recomputes
 * Nomba's HMAC-SHA256 webhook signature and compares it (constant-time)
 * against the nomba-signature header. 9-field colon-separated string,
 * every field defaults to "" (never omitted) exactly matching Nomba's own
 * documented behavior for fields absent on checkout-order webhooks.
 */
export function verifyWebhookSignature(opts: {
  signature_header: string;
  timestamp_header: string;
  webhook_signature_key: string;
  event_type: string;
  request_id: string;
  merchant_user_id: string;
  merchant_wallet_id?: string;
  transaction_id: string;
  transaction_type: string;
  transaction_time: string;
  transaction_response_code?: string;
}): boolean {
  if (!opts.signature_header || !opts.webhook_signature_key) return false;
  const hashingPayload = [
    opts.event_type || "",
    opts.request_id || "",
    opts.merchant_user_id || "",
    opts.merchant_wallet_id || "",
    opts.transaction_id || "",
    opts.transaction_type || "",
    opts.transaction_time || "",
    opts.transaction_response_code || "",
    opts.timestamp_header || "",
  ].join(":");
  const computed = createHmac("sha256", opts.webhook_signature_key).update(hashingPayload, "utf8").digest("base64");
  const computedBuf = Buffer.from(computed, "utf8");
  const givenBuf = Buffer.from(opts.signature_header, "utf8");
  if (computedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(computedBuf, givenBuf);
}

/** Port of nomba_service.py:344 `extract_webhook_signature_fields`. */
export function extractWebhookSignatureFields(payload: Record<string, unknown>): {
  event_type: string;
  request_id: string;
  merchant_user_id: string;
  merchant_wallet_id: string;
  transaction_id: string;
  transaction_type: string;
  transaction_time: string;
  transaction_response_code: string;
} {
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? {};
  const merchant = (data["merchant"] as Record<string, unknown> | undefined) ?? {};
  const transaction = (data["transaction"] as Record<string, unknown> | undefined) ?? {};
  return {
    event_type: String(payload["event_type"] ?? ""),
    request_id: String(payload["requestId"] ?? ""),
    merchant_user_id: String(merchant["userId"] ?? ""),
    merchant_wallet_id: String(merchant["walletId"] ?? ""),
    transaction_id: String(transaction["transactionId"] ?? ""),
    transaction_type: String(transaction["type"] ?? ""),
    transaction_time: String(transaction["time"] ?? ""),
    transaction_response_code: String(transaction["responseCode"] ?? ""),
  };
}

/** Port of nomba_service.py:366 `extract_order_reference`. */
export function extractOrderReference(payload: Record<string, unknown>): string | null {
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? {};
  const order = (data["order"] as Record<string, unknown> | undefined) ?? {};
  return (order["orderReference"] as string | undefined) ?? null;
}
