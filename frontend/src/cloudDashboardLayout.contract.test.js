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

describe("owner-required Command Center card order", () => {
  test("Home removes Setup Health and preserves one connection card", () => {
    expect(home).not.toContain("<SetupHealth");
    expect(home).not.toMatch(/Setup health/i);
    expect((home.match(/data-testid="bot-status-card"/g) || [])).toHaveLength(1);
  });

  test("Home order is connection, outlook, summary, then M10/hourly comparison", () => {
    const connection = home.indexOf('data-testid="bot-status-card"');
    const outlook = home.indexOf("<AIMarketOutlookCard");
    const summary = home.indexOf('data-testid="home-summary-grid"');
    const comparison = home.indexOf("<M10VsOutlookCard");
    expect(connection).toBeGreaterThan(-1);
    expect(connection).toBeLessThan(outlook);
    expect(outlook).toBeLessThan(summary);
    expect(summary).toBeLessThan(comparison);
    expect((home.match(/<AIMarketOutlookCard/g) || [])).toHaveLength(1);
    expect((home.match(/<M10VsOutlookCard/g) || [])).toHaveLength(1);
  });

  test("summary grid keeps all eight canonical tiles", () => {
    for (const label of ["Equity", "Today's P&L", "Open trades", "Open risk", "Market bias", "AI confidence", "Session", "Trading status"]) {
      expect(home).toContain(label);
    }
  });

  test("Settings owns the single dynamic Setup Health surface", () => {
    expect(settings).toContain('title="EA Setup & Connection"');
    expect(settings).toContain("<SetupHealth checks={status?.setup_checks||[]} />");
    expect(settings).toContain("MT5 account ${heartbeat.account_number}");
    expect(settings).toContain("heartbeat.ea_version");
    expect(setupHealth).toContain("checks.filter(c=>c.ok).length");
    expect(setupHealth).toContain("checks.map(c=>");
    expect(setupHealth).not.toContain("4/5");
  });

  test("one reusable comparison implementation is used by Home and Outlook page", () => {
    expect(dashboard).toContain('import M10VsOutlookCard from "./M10VsOutlookCard"');
    expect(outlookPage).toContain('import M10VsOutlookCard from "@/components/cloud/M10VsOutlookCard"');
    expect(outlookPage).not.toContain("function M10VsOutlookCard(");
    expect(comparisonCard).toContain("export default function M10VsOutlookCard");
  });

  test("Home shares the existing Outlook request and introduces no polling duplicate", () => {
    expect(dashboard).not.toContain('get("/outlook/current")');
    expect((outlookCard.match(/get\("\/outlook\/current"\)/g) || [])).toHaveLength(1);
    expect((outlookCard.match(/setInterval\(load, 60000\)/g) || [])).toHaveLength(1);
    expect(comparisonCard).not.toMatch(/axios|fetch\(|setInterval|setTimeout/);
  });

  test("offline, stale, loading, empty, and request-failure states are honest", () => {
    expect(outlookCard).toMatch(/EA offline/);
    expect(outlookCard).toMatch(/Loading outlook/);
    expect(outlookCard).toMatch(/No outlook published yet/);
    expect(outlookCard).toMatch(/Outlook request failed/);
    expect(comparisonCard).toMatch(/no live agreement is claimed/);
    expect(comparisonCard).toMatch(/waiting for fresh data before showing agreement/);
    expect(comparisonCard).toMatch(/No comparison data yet/);
  });

  test("fixed navigation retains safe-area content clearance", () => {
    expect(dashboard).toContain("pb-[calc(5.5rem+env(safe-area-inset-bottom))]");
    expect(dashboard).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(dashboard).toContain("overflow-x-hidden");
  });
});
