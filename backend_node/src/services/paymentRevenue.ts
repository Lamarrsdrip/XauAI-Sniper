/** USD revenue from stored payment records. Never mutates orders and never invents an exchange rate. */

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

export function formatUsdFromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${fraction}`;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function positiveFinite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function acceptCents(cents: number): number | null {
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_USD_CENTS ? cents : null;
}

function isSuccessful(status: string): boolean {
  return status === "FULFILLED" || status.toLowerCase() === "success";
}

/** Immutable USD cents for one successful order, or null when it cannot be converted reliably. */
export function usdCentsForSuccessfulPayment(tx: Record<string, unknown>): number | null {
  const recorded = positiveInt(tx["price_usd_cents"]);
  if (recorded != null) return acceptCents(recorded);

  const currency = String(tx["currency"] ?? "").toUpperCase();
  // Stablecoin minor units are not NGN kobo and are not a USD price unless price_usd_cents was stored.
  if (currency === "USDT" || currency === "USDC") return null;
  if (currency === "USD") {
    return acceptCents(positiveInt(tx["amount_minor"]) ?? positiveInt(tx["amount_kobo"]) ?? 0);
  }

  const displayCurrency = String(tx["display_currency"] ?? "").toUpperCase();
  if (currency !== "NGN" && currency !== "") return null;
  if (displayCurrency !== "USD") return null;

  const shown = positiveFinite(tx["display_amount"]);
  if (shown != null) return acceptCents(Math.round(shown * 100));

  const rate = positiveFinite(tx["fx_rate"]);
  const kobo = positiveInt(tx["amount_kobo"]);
  if (rate == null || kobo == null) return null;
  // Historical checkout stored USD per 1 NGN (exchange-rate API with NGN base).
  return acceptCents(Math.round((kobo / 100) * rate * 100));
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
      const cents = usdCentsForSuccessfulPayment(tx);
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
      ? `${excluded} successful historical payment${excluded === 1 ? "" : "s"} had no recorded USD price or exchange rate and ${excluded === 1 ? "was" : "were"} excluded from revenue.`
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
  return summarizePaymentRevenue(rows, range);
}
