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

  it("adds every successful naira payment by converting it with the saved USD rate", () => {
    const report = summarizePaymentRevenue([
      { reference: "NEW-USD", payment_status: "FULFILLED", currency: "USDT", price_usd_cents: 25000, amount_minor: 25000 },
      { reference: "LEGACY-USD", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, display_currency: "USD", display_amount: 199.5, created_at: "2026-01-01T00:00:00.000Z" },
      { reference: "LEGACY-RATE", payment_status: "SUCCESS", currency: "NGN", amount_kobo: 100_000, display_currency: "USD", fx_rate: 0.0007, created_at: "2026-01-02T00:00:00.000Z" },
      { reference: "LEGACY-1", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, created_at: "2026-01-03T00:00:00.000Z" },
      { reference: "LEGACY-2", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, created_at: "2026-01-04T00:00:00.000Z" },
      { reference: "LEGACY-3", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, created_at: "2026-01-05T00:00:00.000Z" },
      { reference: "LEGACY-4", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, created_at: "2026-01-06T00:00:00.000Z" },
      { reference: "LEGACY-5", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, created_at: "2026-01-07T00:00:00.000Z" },
      { reference: "LEGACY-6", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000, created_at: "2026-01-08T00:00:00.000Z" },
      { reference: "STABLE-NO-USD", payment_status: "FULFILLED", currency: "USDT", amount_minor: 25000 },
      { reference: "PENDING", payment_status: "PENDING", currency: "NGN", amount_kobo: 30_000_000 },
    ], {}, { ngnPerUsd: 1500 });
    // 250 + 199.50 + 0.70 + six times 300,000/1500 + 250. Pending stays out.
    expect(report.total_revenue_usd_cents).toBe(25000 + 19950 + 70 + 6 * 20000 + 25000);
    expect(report.formatted_revenue).toBe("$1,900.20");
    expect(report.successful_payments).toBe(10);
    expect(report.excluded_unconverted_payments).toBe(0);
    expect(report.pending_payments).toBe(1);
  });

  it("converts naira payments at 1400 per dollar when the admin has not saved a newer rate", () => {
    const report = summarizePaymentRevenue([
      { reference: "LEGACY-NGN", payment_status: "success", currency: "NGN", amount_kobo: 30_000_000 },
    ], {}, { ngnPerUsd: 1400 });
    expect(report.total_revenue_usd_cents).toBe(21429);
    expect(report.formatted_revenue).toBe("$214.29");
    expect(report.successful_payments).toBe(1);
    expect(report.excluded_unconverted_payments).toBe(0);
  });

  it("applies the same date window and the saved rate", async () => {
    const db = new FakeDb();
    await db.collection("admin_settings").insertOne({ key: "main", direct_usd_ngn_rate: "1600", direct_fx_as_of: "2026-11-11T12:00:00.000Z" });
    await db.collection("payment_transactions").insertOne({ reference: "IN", payment_status: "success", currency: "NGN", amount_kobo: 32_000_000, created_at: "2026-06-15T00:00:00.000Z" });
    await db.collection("payment_transactions").insertOne({ reference: "OUT", payment_status: "FULFILLED", price_usd_cents: 50000, currency: "USDT", amount_minor: 50000, created_at: "2026-08-01T00:00:00.000Z" });
    const report = await paymentRevenueReport(db, { from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T23:59:59.000Z" });
    expect(report).toMatchObject({ total_revenue_usd_cents: 20000, successful_payments: 1, total_orders: 1, formatted_revenue: "$200.00", excluded_unconverted_payments: 0 });
  });
});
