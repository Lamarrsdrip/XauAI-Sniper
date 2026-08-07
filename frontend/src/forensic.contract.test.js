import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");

describe("forensic operating-company browser contracts", () => {
  test("browser sessions use HttpOnly cookies, not script-readable JWT storage", () => {
    const files = [
      "components/AdminPortal.jsx",
      "components/cloud/CloudAuth.jsx",
      "components/cloud/CloudDashboard.jsx",
      "components/cloud/AIThoughtFeed.jsx",
      "components/cloud/AIMarketOutlookCard.jsx",
      "pages/AIMarketOutlookPage.jsx",
    ].map(read).join("\n");
    expect(files).not.toMatch(/localStorage[\s\S]{0,80}(admin_token|cloud_token)/);
    expect(files).not.toMatch(/(admin_token|cloud_token)[\s\S]{0,80}localStorage/);
    expect(files).not.toMatch(/Authorization:\s*`Bearer/);
    expect(files).toMatch(/withCredentials:\s*true/);
  });

  test("homepage contains no invented drawdown or AI rating", () => {
    const hero = read("components/HeroSection.jsx");
    const performance = read("components/OutlookPerformanceSection.jsx");
    expect(hero).not.toContain('value: "5%"');
    expect(hero).not.toContain('value: "90 / 100"');
    expect(performance).toContain("not independently verified");
    expect(performance).toContain("separate from automated EA account performance");
  });

  test("public ticker renders only a provider-marked available quote", () => {
    const header = read("components/Header.jsx");
    expect(header).toContain("goldPrice?.available === true");
    expect(header).toContain("Number.isFinite(goldPrice?.bid)");
  });

  test("retrace wording is evidence, never another wait", () => {
    const surfaces = [
      read("components/cloud/CloudDashboard.jsx"),
      read("pages/AIMarketOutlookPage.jsx"),
    ].join("\n");
    expect(surfaces).not.toMatch(/waiting for retrace/i);
    expect(surfaces).not.toMatch(/waiting for a better entry/i);
    expect(surfaces).toMatch(/location (evidence: )?extended/i);
  });

  test("public previews are clearly illustrative and contain no fake account metrics", () => {
    const previews = [
      read("components/cloud/CloudLanding.jsx"),
      read("components/CloudPromoSection.jsx"),
    ].join("\n");
    expect(previews).toMatch(/illustrative/i);
    expect(previews).not.toContain("$12,847");
    expect(previews).not.toContain("confidence 87%");
    expect(previews).not.toContain("18 matching samples WR 67%");
  });

  test("broker and funded-account copy makes no unverified universal promise", () => {
    const copy = [
      read("components/ReassuranceSection.jsx"),
      read("components/FaqSection.jsx"),
    ].join("\n");
    expect(copy).not.toMatch(/75% deposit bonus/i);
    expect(copy).not.toMatch(/official partner/i);
    expect(copy).not.toMatch(/works on any MT5 broker/i);
    expect(copy).toMatch(/affiliate link/i);
    expect(copy).toMatch(/compatibility is broker-specific/i);
  });

  test("service worker is first-party (no OneSignal) and handles PWA caching", () => {
    const sw = fs.readFileSync(path.join(__dirname, "../public/service-worker.js"), "utf8");
    expect(sw).not.toMatch(/onesignal/i);
    expect(sw).toMatch(/addEventListener\("install"/);
    expect(sw).toMatch(/addEventListener\("fetch"/);
  });

  test("customer auth controls have associated labels and browser autocomplete", () => {
    const auth = read("components/cloud/CloudAuth.jsx");
    for (const id of ["cloud-signup-name", "cloud-signup-email", "cloud-signup-password", "cloud-signup-country", "cloud-login-email", "cloud-login-password"]) {
      expect(auth).toContain(`htmlFor="${id}"`);
      expect(auth).toContain(`id="${id}"`);
    }
    expect(auth).toContain('autoComplete="current-password"');
    expect(auth).toContain('autoComplete="new-password"');
  });

  test("admin EA configuration is read-only and contains no invented weekly target presets", () => {
    const admin = read("components/AdminPortal.jsx");
    expect(admin).toContain("Read-only release contract");
    expect(admin).not.toContain("20 %/wk");
    expect(admin).not.toContain("Weekly target");
    expect(admin).not.toContain("Save reference preset");
  });

  test("purchase price never falls back to a stale hardcoded amount, and checkout is blocked until a real price loads", () => {
    // Bug fix (purchase-flow audit, 2026-08-04): a failed /purchase/price
    // fetch used to be silently swallowed (empty .catch) and the widget
    // fell back to a hardcoded "₦300,000" with checkout still enabled --
    // if the admin had actually changed the price, this could show a
    // stale/wrong amount that looked like a bait-and-switch once the real
    // amount appeared later in the Bank Transfer step.
    const purchase = read("components/PurchaseSection.jsx");
    expect(purchase).not.toMatch(/\|\|\s*"₦300,000"/);
    expect(purchase).toMatch(/catch\(\(\)\s*=>\s*\{\s*setPriceLoadFailed\(true\)/);
    expect(purchase).toContain("checkoutBlocked");
    expect(purchase).toMatch(/disabled=\{loading \|\| checkoutBlocked\}/);
    expect(purchase).toContain("purchase-price-error");
  });
});
