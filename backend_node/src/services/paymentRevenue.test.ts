import { describe, expect, it } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";
import { formatUsdFromCents, paymentRevenueReport, summarizePaymentRevenue } from "./paymentRevenue.js";

describe("USD payment revenue", () => {
  it("formats whole dollars and cents", () => {
    expect(formatUsdFromCents(125000)).toBe("$1,250.00");
    expect(formatUsdFromCents(0)).toBe("$0.00");
    expect(formatUsdFromCents(5)).toBe("$0.05");
  });

  it("counts fulfilled crypto and Nigerian bank orders in recorded USD once", () => {
    const report = summarizePaymentRevenue([
      { reference: "XC-CRYPTO", provider: "MANUAL_DIRECT", method: "CRYPTO", currency: "USDT", payment_status: "FULFILLED", price_usd_cents: 25000, amount_minor: 25000, created_at: "2026-11-01T00:00:00.000Z" },
      { reference: "XC-BANK", provider: "MANUAL_DIRECT", method: "BANK", currency: "NGN", payment_status: "FULFILLED", price_usd_cents: 25000, amount_minor: 37_512_500, amount_kobo: 37_512_500, created_at: "2026-11-02T00:00:00.000Z" },
      { reference: "XC-CRYPTO", provider: "MANUAL_DIRECT", method: "CRYPTO", currency: "USDT", payment_status: "FULFILLED", price_usd_cents: 25000, amount_minor: 25000, created_at: "2026-11-01T00:00:00.000Z" },
      { reference: "XC-PEND", provider: "MANUAL_DIRECT", method: "CRYPTO", currency: "USDC", payment_status: "MANUAL_PENDING", price_usd_cents: 25000, amount_minor: 25000 },
      { reference: "XC-REJ", provider: "MANUAL_DIRECT", method: "BANK", currency: "NGN", payment_status: "MANUAL_REJECTED", price_usd_cents: 25000, amount_minor: 100 },
      { reference: "XC-FAIL", provider: "PAYSTACK", currency: "NGN", payment_status: "FAILED", amount_kobo: 9_999_999 },
      { reference: "XC-PAID", provider: "PAYSTACK", currency: "NGN", payment_status: "PAID", price_usd_cents: 25000 },
    ]);
    expect(report).toMatchObject({
      currency: "USD",
      total_revenue_usd_cents: 50000,
      formatted_revenue: "$500.00",
      successful_payments: 2,
      pending_payments: 2,
      failed_rejected_payments: 2,
      total_orders: 6,
      excluded_unconverted_payments: 0,
    });
  });

  it("converts legacy NGN only from a recorded USD value and excludes the rest", () => {
    const report = summarizePaymentRevenue([
      { reference: "LEGACY-USD", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, display_currency: "USD", display_amount: 199.5, created_at: "2026-01-01T00:00:00.000Z" },
      { reference: "LEGACY-RATE", payment_status: "SUCCESS", currency: "NGN", amount_kobo: 100_000, display_currency: "USD", fx_rate: 0.0007, created_at: "2026-01-02T00:00:00.000Z" },
      { reference: "LEGACY-NGN", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, created_at: "2026-01-03T00:00:00.000Z" },
      { reference: "LEGACY-GBP", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, display_currency: "GBP", fx_rate: 0.0005 },
      { reference: "STABLE-NO-USD", payment_status: "FULFILLED", currency: "USDT", amount_minor: 25000 },
    ]);
    expect(report.total_revenue_usd_cents).toBe(19950 + 70);
    expect(report.successful_payments).toBe(5);
    expect(report.excluded_unconverted_payments).toBe(3);
    expect(report.formatted_revenue).toBe("$200.20");
  });

  it("applies the same date window as the analytics summary", async () => {
    const db = new FakeDb();
    await db.collection("payment_transactions").insertOne({ reference: "IN", payment_status: "FULFILLED", price_usd_cents: 10000, currency: "USDT", amount_minor: 10000, created_at: "2026-06-15T00:00:00.000Z" });
    await db.collection("payment_transactions").insertOne({ reference: "OUT", payment_status: "FULFILLED", price_usd_cents: 50000, currency: "USDT", amount_minor: 50000, created_at: "2026-08-01T00:00:00.000Z" });
    const report = await paymentRevenueReport(db, { from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T23:59:59.000Z" });
    expect(report).toMatchObject({ total_revenue_usd_cents: 10000, successful_payments: 1, total_orders: 1, formatted_revenue: "$100.00" });
  });
});
