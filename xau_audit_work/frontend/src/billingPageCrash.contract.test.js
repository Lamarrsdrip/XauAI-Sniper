import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");

// Live regression caught by real browser testing (2026-08-25): BillingPage
// called fmtDate(...) in two places (subscription expiry, payment history
// row date) but fmtDate was never defined or imported anywhere in this
// file -- a guaranteed ReferenceError crash for any account with a real
// subscription or payment history (confirmed live: a real bot-owner
// account with payment history hit XAUCLOUD_UI_CRASH). No prior test
// caught this because the static import-regex tests only checked what WAS
// imported, never that every identifier USED was actually defined/in
// scope. This asserts both directly.
describe("BillingPage never references an undefined identifier", () => {
  test("fmtDate is imported (aliased from the real formatDate), not just called", () => {
    expect(dashboard).toMatch(/formatDate as fmtDate/);
    expect(dashboard).not.toMatch(/^function fmtDate\(/m);
    expect(dashboard).not.toMatch(/^const fmtDate = /m);
  });

  test("both real call sites (subscription expiry, payment history date) still use it", () => {
    const billingFn = dashboard.slice(dashboard.indexOf("function BillingPage("), dashboard.indexOf("function LicensePage("));
    expect(billingFn).toContain("fmtDate(ent.subscription?.expires_at)");
    expect(billingFn).toContain("fmtDate(p.created_at)");
  });
});
