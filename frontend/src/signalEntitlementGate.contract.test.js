import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");
const signalDashboard = read("components/cloud/CloudSignalDashboard.jsx");
const purchaseSection = read("components/PurchaseSection.jsx");

describe("signal trial/subscription entitlement contract", () => {
  test("CloudDashboard's licensed function body is untouched by the entitlement gate -- only its export wiring changed", () => {
    // The gate must render the EXISTING licensed dashboard, not a rewritten
    // copy of it. Guards against someone accidentally forking the licensed
    // path instead of reusing it.
    expect(dashboard).toContain("function LicensedCloudDashboard()");
    expect(dashboard).toContain("export default function CloudDashboard()");
    expect(dashboard).toMatch(/entitlement\?\.bot_license[\s\S]{0,40}<LicensedCloudDashboard/);
  });

  test("a signed-in visitor without a bot license never reaches the licensed dashboard", () => {
    // The gate must be the ONLY thing deciding this -- there must be exactly
    // one component that renders <LicensedCloudDashboard, and it must be
    // conditioned on bot_license, not on trial/subscription state.
    const renders = dashboard.match(/<LicensedCloudDashboard/g) || [];
    expect(renders).toHaveLength(1);
    expect(dashboard).toContain("<CloudSignalDashboard");
  });

  test("the entitlement fetch failing (not 401) falls back to the pre-existing dashboard, never a broken screen", () => {
    expect(dashboard).toMatch(/entFailed[\s\S]{0,60}<LicensedCloudDashboard/);
  });

  test("CloudSignalDashboard never exposes bot-only sections outside the locked teaser", () => {
    expect(signalDashboard).toContain("Bot license required");
    expect(signalDashboard).not.toMatch(/fake|mock|placeholder/i);
  });

  test("CloudSignalDashboard treats a 403 NOT_ENTITLED response as a locked state, not a network error", () => {
    expect(signalDashboard).toContain("NOT_ENTITLED");
    expect(signalDashboard).toMatch(/locked:\s*true/);
  });

  test("no guaranteed-profit language anywhere in the new signal dashboard", () => {
    expect(signalDashboard).not.toMatch(/guarantee(d)? (profit|return)/i);
    expect(signalDashboard).not.toMatch(/risk[- ]free/i);
  });
});

describe("public pricing section contract", () => {
  test("renders all four plans: trial, weekly, monthly, and the lifetime bot", () => {
    expect(purchaseSection).toMatch(/badge="Free Trial"/);
    expect(purchaseSection).toMatch(/badge="Weekly"/);
    expect(purchaseSection).toMatch(/badge="Monthly"/);
    expect(purchaseSection).toContain("XauCloud Bot");
  });

  test("every plan price is read from a live API response, never a hardcoded NGN literal", () => {
    // Strip comment lines first -- the file legitimately references
    // "₦300,000" once, inside a comment describing a PAST bug fix (a
    // stale-price-fallback regression), not a rendered value.
    const codeOnly = purchaseSection.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    expect(codeOnly).not.toMatch(/20[,]?000|50[,]?000|300[,]?000/);
    expect(purchaseSection).toContain("/purchase/plans");
  });

  test("signal subscriptions never claim to include automated execution", () => {
    expect(purchaseSection).toMatch(/never receives automated execution|No automated execution/);
  });

  test("no guaranteed-profit or risk-free language in the pricing section", () => {
    expect(purchaseSection).not.toMatch(/guarantee(d)? (profit|return)/i);
    expect(purchaseSection).not.toMatch(/risk[- ]free/i);
  });
});
