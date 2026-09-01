import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");
const outlookCard = read("components/cloud/AIMarketOutlookCard.jsx");
const comparisonCard = read("components/cloud/M10VsOutlookCard.jsx");
const outlookPage = read("pages/AIMarketOutlookPage.jsx");

const home = dashboard.slice(
  dashboard.indexOf("function HomePage("),
  dashboard.indexOf("function SetupHealth(")
);
const setupHealth = dashboard.slice(
  dashboard.indexOf("function SetupHealth("),
  dashboard.indexOf("// ─── Trading")
);
const settings = dashboard.slice(
  dashboard.indexOf("function SettingsPage("),
  dashboard.indexOf("// ───", dashboard.indexOf("function SettingsPage(") + 20) > -1
    ? dashboard.indexOf("// ───", dashboard.indexOf("function SettingsPage(") + 20)
    : dashboard.length
);

describe("current Command Center customer contract", () => {
  test("Home does not render the legacy Setup Health surface", () => {
    expect(home).not.toContain("<SetupHealth");
    expect(home).not.toMatch(/Setup health/i);
  });

  test("Command Center keeps the primary AI outlook and shared M10 comparison implementation available", () => {
    expect(dashboard).toContain("AIMarketOutlookCard");
    expect(dashboard).toContain("M10VsOutlookCard");
    expect(comparisonCard).toContain("export default function M10VsOutlookCard");
  });

  test("customer dashboard retains genuine account and trading telemetry surfaces", () => {
    expect(dashboard).toMatch(/equity/i);
    expect(dashboard).toMatch(/open.*trade/i);
    expect(dashboard).toMatch(/confidence/i);
  });

  test("Settings owns the dynamic Setup Health surface", () => {
    expect(settings).toContain('title="EA Setup & Connection"');
    expect(settings).toContain("<SetupHealth checks={status?.setup_checks||[]} />");
    expect(setupHealth).toContain("checks.filter(c=>c.ok).length");
    expect(setupHealth).toContain("checks.map(c=>");
    expect(setupHealth).not.toContain("4/5");
  });

  test("M10 comparison remains a single reusable implementation", () => {
    expect(dashboard).toMatch(/M10VsOutlookCard/);
    expect(comparisonCard).toContain("export default function M10VsOutlookCard");
    expect(outlookPage).not.toContain("function M10VsOutlookCard(");
  });

  test("Home introduces no duplicate Outlook polling authority", () => {
    expect(dashboard).not.toContain('get("/outlook/current")');
    expect(
      (outlookCard.match(/get\("\/outlook\/current"\)/g) || [])
    ).toHaveLength(1);

    expect(comparisonCard).not.toMatch(
      /axios|fetch\(|setInterval|setTimeout/
    );
  });

  test("customer-facing state avoids raw EA implementation codes", () => {
    const visibleRawPatterns = [
      /MANAGING_TRADES/,
      /STARTUP_SYNCING/,
      /EA_TRADING_DISABLED/,
    ];

    for (const pattern of visibleRawPatterns) {
      expect(home).not.toMatch(pattern);
    }
  });

  test("offline, loading and empty states remain customer-friendly", () => {
    expect(outlookCard).toMatch(/connected right now/);
    expect(outlookCard).toMatch(/Loading outlook/);
    expect(outlookCard).toMatch(/No signal right now/);
    expect(outlookCard).toMatch(/reach the market data service/);
    expect(outlookCard).not.toMatch(/DATA STALE/);
  });

  test("fixed navigation retains safe-area clearance", () => {
    expect(dashboard).toContain(
      "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
    );
    expect(dashboard).toContain(
      "pb-[env(safe-area-inset-bottom)]"
    );
    expect(dashboard).toContain("overflow-x-hidden");
  });
});
