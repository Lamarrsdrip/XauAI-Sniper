/** USD revenue from stored payment records. Never mutates orders.
 * Legacy naira amounts convert with that payment's own recorded FX, otherwise
 * the administrator's saved NGN-per-USD rate. No rate is invented. */

export interface PaymentRevenueReport {
  currency: "USD";
  total_revenue_usd_cents: number;
  /** USD dollars, for callers that previously read `revenue.amount`. */
  amount: number;
  formatted_revenue: string;
  successful_payments: number;
  total_orders: number;
  total_transactions: number;
  pending_payments: number;
  failed_rejected_payments: number;
  excluded_unconverted_payments: number;
  excluded_unconverted_note: string;
}

const PENDING = new Set([
  "pending", "PENDING",
  "MANUAL_PENDING", "MANUAL_SUBMITTED", "MANUAL_EXPIRED",
  "FULFILLING", "PAID", "VERIFYING",
  "BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED", "UNDER_ADMIN_REVIEW",
]);

const MAX_USD_CENTS = 100_000_000;
const DEFAULT_NGN_PER_USD = 1400;
const RATE_POLICY_AT = Date.parse("2026-11-11T00:00:00.000Z");

export function formatUsdFromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${fraction}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  if (value && typeof value === "object") {
    const boxed = value as { toNumber?: () => number; toString?: () => string };
    if (typeof boxed.toNumber === "function") {
      const n = boxed.toNumber();
      if (Number.isFinite(n)) return n;
    }
    const text = typeof boxed.toString === "function" ? boxed.toString() : "";
    if (text && text !== "[object Object]") {
      const n = Number(text);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function positive(value: unknown): number | null {
  const n = asNumber(value);
  return n != null && n > 0 ? n : null;
}

function acceptCents(cents: number): number | null {
  const rounded = Math.round(cents);
  return Number.isSafeInteger(rounded) && rounded > 0 && rounded <= MAX_USD_CENTS ? rounded : null;
}

function isSuccessful(status: string): boolean {
  return status === "FULFILLED" || status.toLowerCase() === "success";
}

/** NGN per 1 USD when the rate is in that unit; smaller rates are USD per 1 NGN. */
function ngnKoboToUsdCents(kobo: number, rate: number): number | null {
  if (!(kobo > 0) || !(rate > 0)) return null;
  return acceptCents(rate >= 50 ? kobo / rate : kobo * rate);
}

/** Immutable USD cents for one successful order, or null when it cannot be converted. */
export function usdCentsForSuccessfulPayment(tx: Record<string, unknown>, ngnPerUsd?: number | null): number | null {
  const recorded = positive(tx["price_usd_cents"]);
  if (recorded != null) return acceptCents(recorded);

  const currency = String(tx["currency"] ?? "").toUpperCase();
  const minor = positive(tx["amount_minor"]) ?? positive(tx["amount_kobo"]);
  if (currency === "USD") return minor == null ? null : acceptCents(minor);
  // Direct checkout stores stablecoin minor units equal to the USD cents (1 token = 1 USD).
  if (currency === "USDT" || currency === "USDC") return minor == null ? null : acceptCents(minor);

  const kobo = positive(tx["amount_kobo"]) ?? (currency === "NGN" ? positive(tx["amount_minor"]) : null);
  if (kobo == null) return null;
  if (currency !== "NGN" && currency !== "") return null;

  const displayCurrency = String(tx["display_currency"] ?? "").toUpperCase();
  if (displayCurrency === "USD") {
    const shown = positive(tx["display_amount"]);
    if (shown != null) return acceptCents(shown * 100);
  }
  if (!displayCurrency || displayCurrency === "USD" || displayCurrency === "NGN") {
    const ownRate = positive(tx["fx_rate"]);
    if (ownRate != null) return ngnKoboToUsdCents(kobo, ownRate);
  }
  return ngnPerUsd != null ? ngnKoboToUsdCents(kobo, ngnPerUsd) : null;
}

function createdKey(tx: Record<string, unknown>): string {
  const value = tx["created_at"];
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function inRange(tx: Record<string, unknown>, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const created = createdKey(tx);
  if (!created) return false;
  if (from && created < from) return false;
  if (to && created > to) return false;
  return true;
}

export function summarizePaymentRevenue(
  rows: Record<string, unknown>[],
  range: { from?: string; to?: string } = {},
  options: { ngnPerUsd?: number | null } = {},
): PaymentRevenueReport {
  const byReference = new Map<string, Record<string, unknown>>();
  const anonymous: Record<string, unknown>[] = [];
  for (const row of rows) {
    const reference = typeof row["reference"] === "string" ? row["reference"] : "";
    if (!reference) {
      anonymous.push(row);
      continue;
    }
    const previous = byReference.get(reference);
    if (!previous || (!isSuccessful(String(previous["payment_status"] ?? "")) && isSuccessful(String(row["payment_status"] ?? "")))) {
      byReference.set(reference, row);
    }
  }

  let revenue = 0;
  let successful = 0;
  let pending = 0;
  let failed = 0;
  let total = 0;
  let excluded = 0;
  for (const tx of [...byReference.values(), ...anonymous]) {
    if (!inRange(tx, range.from, range.to)) continue;
    total += 1;
    const status = String(tx["payment_status"] ?? "");
    if (isSuccessful(status)) {
      successful += 1;
      const cents = usdCentsForSuccessfulPayment(tx, options.ngnPerUsd);
      if (cents == null) excluded += 1;
      else revenue += cents;
    } else if (PENDING.has(status) || status.toLowerCase() === "pending") pending += 1;
    else failed += 1;
  }

  return {
    currency: "USD",
    total_revenue_usd_cents: revenue,
    amount: revenue / 100,
    formatted_revenue: formatUsdFromCents(revenue),
    successful_payments: successful,
    total_orders: total,
    total_transactions: total,
    pending_payments: pending,
    failed_rejected_payments: failed,
    excluded_unconverted_payments: excluded,
    excluded_unconverted_note: excluded
      ? `${excluded} successful payment${excluded === 1 ? "" : "s"} had no amount and no USD/NGN rate, so ${excluded === 1 ? "it was" : "they were"} left out of the USD total.`
      : "",
  };
}

export async function paymentRevenueReport(
  db: { collection: (name: string) => { find: (query: Record<string, unknown>) => { toArray: () => Promise<Record<string, unknown>[]> } } },
  range: { from?: string; to?: string } = {},
): Promise<PaymentRevenueReport> {
  const query: Record<string, unknown> = {};
  if (range.from || range.to) {
    query["created_at"] = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) };
  }
  const rows = await db.collection("payment_transactions").find(query).toArray();
  const settings = await db.collection("admin_settings").find({ key: "main" }).toArray();
  const saved = settings[0];
  const reviewedAt = Date.parse(String(saved?.["direct_fx_as_of"] ?? ""));
  const rate = positive(saved?.["direct_usd_ngn_rate"]);
  const ngnPerUsd = rate != null && rate >= 50 && rate <= 1_000_000 && Number.isFinite(reviewedAt) && reviewedAt >= RATE_POLICY_AT
    ? rate
    : DEFAULT_NGN_PER_USD;
  return summarizePaymentRevenue(rows, range, { ngnPerUsd });
}
