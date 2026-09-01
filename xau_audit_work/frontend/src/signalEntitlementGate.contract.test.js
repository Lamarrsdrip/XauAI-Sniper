import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");
const signalCards = read("components/cloud/SubscriberSignalCards.jsx");
const purchaseSection = read("components/PurchaseSection.jsx");

describe("ONE Command Center architecture contract (2026-08-25)", () => {
  test("there is no second, smaller dashboard file -- CloudSignalDashboard.jsx was retired, not left as dead code", () => {
    expect(fs.existsSync(path.join(__dirname, "components/cloud/CloudSignalDashboard.jsx"))).toBe(false);
    expect(dashboard).not.toContain("CloudSignalDashboard");
  });

  test("every signed-in user renders the exact same LicensedCloudDashboard shell -- exactly one render site, unconditional", () => {
    const renders = dashboard.match(/<LicensedCloudDashboard/g) || [];
    expect(renders).toHaveLength(1);
    // Regression guard: this render must NOT be behind a bot_license branch
    // any more -- see the old `entitlement?.bot_license ... <LicensedCloudDashboard`
    // gate this replaced.
    expect(dashboard).toMatch(/return <LicensedCloudDashboard entitlement=\{entitlement\} entFailed=\{entFailed\} \/>/);
  });

  test("the entitlement fetch failing (not 401) never locks a feature -- ownsBot defaults open", () => {
    expect(dashboard).toMatch(/ownsBot\s*=\s*entFailed\s*\|\|\s*Boolean\(entitlement\?\.bot_license\)/);
  });

  test("bottom nav and the More grid are fixed constants, never filtered by entitlement", () => {
    // NAV/MORE_NAV must not be computed from `entitlement` or `ownsBot` --
    // every user sees the same tabs; only what's behind a tab is locked.
    expect(dashboard).toMatch(/const NAV = \[/);
    expect(dashboard).not.toMatch(/NAV\.filter\(/);
    expect(dashboard).not.toMatch(/MORE_NAV\.filter\(/);
  });

  test("bot-personal pages stay reachable but locked for a non-bot user -- never removed from the router", () => {
    for (const tab of ["trading", "analytics", "intelligence", "control"]) {
      expect(dashboard).toMatch(new RegExp(`active==="${tab}"[\\s\\S]{0,20}&&[\\s\\S]{0,400}ownsBot`));
    }
    expect(dashboard).toContain("function BotRequiredPage(");
    expect(dashboard).toContain("function BotRequiredGate(");
  });

  test("Pattern Scanner stays fully open for everyone -- it's an educational chart-pattern reference, not bot-personal data", () => {
    expect(dashboard).toMatch(/active==="patterns"\s*&&\s*<PatternScannerPage/);
  });

  test("the bot-purchase CTA opens an in-app checkout, never a homepage redirect", () => {
    expect(dashboard).not.toMatch(/window\.location\.href\s*=\s*"\/#purchase"/);
    expect(dashboard).toContain("useBotCheckout");
    expect(dashboard).toContain("Get XauCloud Bot");
  });

  // 2026-08-25 dashboard-unification fix: a non-bot user used to see a
  // 4-line SignalCard summary for Market Outlook/10-Minute Engine while a
  // bot owner saw the full evidence panel (buy/sell evidence, plain-English
  // reason, freshness) -- exactly the "cheaper fork" this test's name warns
  // against. Both personas now render the SAME AIMarketOutlookCard/
  // M10EngineCard components; only the data source differs (subscriberSignal
  // prop vs the bot owner's own EA heartbeat).
  test("Home reuses the real Market Outlook/10-Minute Engine/Recent Signals cards for a non-bot user -- not a cheaper fork", () => {
    expect(dashboard).toMatch(/import \{ signalAxios, SignalCard, RecentSignalsCard, planSummary, relTime, formatDate as fmtDate \} from "\.\/SubscriberSignalCards"/);
    expect(dashboard).toContain("<AIMarketOutlookCard linked online subscriberSignal={outlook.data?.signal ?? null}");
    expect(dashboard).toContain("evidence={normalizeSubscriberM10Evidence(engine.data?.signal)}");
    expect(dashboard).toContain("<RecentSignalsCard");
    expect(dashboard).toContain("function ContinueLearningCard(");
  });

  test("the subscriber Market Outlook/10-Minute Engine cards are the SAME component the bot-owner Home page renders, not a second implementation", () => {
    const botOwnerM10Site = dashboard.match(/\{linked && <M10EngineCard[^}]*\}/);
    expect(botOwnerM10Site).toBeTruthy();
    expect(dashboard.match(/<M10EngineCard/g).length).toBeGreaterThanOrEqual(2);
    expect(dashboard.match(/<AIMarketOutlookCard/g).length).toBeGreaterThanOrEqual(2);
  });

  test("a licensed customer can actually reach a Billing view -- not just signal-only users", () => {
    expect(dashboard).toContain('active==="billing"');
    expect(dashboard).toMatch(/function BillingPage\(/);
    expect(dashboard).toMatch(/label="Billing"[\s\S]{0,80}setActive\("billing"\)/);
    expect(dashboard).toContain("/cloud/billing");
  });

  test("the trial's last active day says 'Last day', never a confusing '0 market days left'", () => {
    expect(signalCards).toContain('"Last day"');
  });

  test("no guaranteed-profit language anywhere in the shared subscriber signal cards", () => {
    expect(signalCards).not.toMatch(/guarantee(d)? (profit|return)/i);
    expect(signalCards).not.toMatch(/risk[- ]free/i);
    expect(signalCards).not.toMatch(/fake|mock|placeholder/i);
  });

  test("a 403 NOT_ENTITLED response is treated as a locked state, not a network error", () => {
    expect(dashboard).toContain("NOT_ENTITLED");
    expect(dashboard).toMatch(/locked:\s*true/);
  });

  // 2026-08-25 platform-unification audit: every bot-locked surface must
  // offer BOTH buying a new bot AND linking one already owned -- otherwise a
  // customer who already has a XauCloud license gets funneled into buying a
  // second one they don't need.
  test("every bot-locked surface offers 'Already own XauCloud? Link license', not just Buy", () => {
    expect(dashboard).toContain("Already own XauCloud? Link license");
    const gateFn = dashboard.slice(dashboard.indexOf("function BotRequiredGate("), dashboard.indexOf("const BOT_FEATURE_BULLETS"));
    expect(gateFn).toContain("onLinkLicense");
    for (const tab of ["Trading", "Analytics", "AI Brain", "Control"]) {
      expect(dashboard).toMatch(new RegExp(`<BotRequiredPage title="${tab}"[^>]*onLinkLicense=\\{\\(\\) => setActive\\("license"\\)\\}`));
    }
  });
});

describe("admin bank transfer visibility contract", () => {
  const portal = read("components/AdminPortal.jsx");

  test("the review queue shows which plan an order is for -- not just the amount", () => {
    expect(portal).toContain('"Reference","Buyer","Plan","Amount"');
    expect(portal).toContain("planLabel(t.plan_id)");
    expect(portal).toContain("planLabel(detail.plan_id)");
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
