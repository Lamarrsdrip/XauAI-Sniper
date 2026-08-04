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

  test("Home order is connection, outlook, M10/hourly comparison, then the collapsed advanced-details summary grid", () => {
    // Investigated 2026-08-04: this assertion previously expected
    // `summary` (home-summary-grid) before `comparison` (M10VsOutlookCard),
    // which stopped matching reality back at commit 6ac33d6 "mobile-first
    // Command Center home hierarchy redesign" (2026-07-24, see
    // audits/xaucloud/04_command_center_mobile_redesign.md) -- a real,
    // browser-verified, owner-approved redesign that intentionally
    // promoted M10VsOutlookCard up next to the outlook/M10 signal cards
    // and wrapped the old 8-metric technical grid in a collapsed-by-
    // default "Advanced details" <details> disclosure much further down
    // the page, after M30 consensus. The layout was correct; only this
    // test's assumption was stale. Updated to match the real, intended
    // hierarchy instead of reverting the redesign.
    const connection = home.indexOf('data-testid="bot-status-card"');
    const outlook = home.indexOf("<AIMarketOutlookCard");
    const comparison = home.indexOf("<M10VsOutlookCard");
    const summary = home.indexOf('data-testid="home-summary-grid"');
    expect(connection).toBeGreaterThan(-1);
    expect(connection).toBeLessThan(outlook);
    expect(outlook).toBeLessThan(comparison);
    expect(comparison).toBeLessThan(summary);
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
    // Dashboard also imports the shared M10 decision/freshness label maps
    // from the same module (see the raw-decision-code fix), so this checks
    // the default import specifically rather than the whole import line.
    expect(dashboard).toMatch(/import M10VsOutlookCard,?\s*(\{[^}]*\}\s*)?from "\.\/M10VsOutlookCard"/);
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

  test("offline, stale, loading, empty, and request-failure states are honest and customer-friendly", () => {
    // Owner-approved rule (2026-08-04): a customer never sees a red "DATA
    // STALE" warning with the old BUY/SELL signal still rendered
    // underneath it -- each state below is its own distinct, plain-
    // language block, never raw developer terms.
    expect(outlookCard).toMatch(/connected right now/);
    expect(outlookCard).toMatch(/Loading outlook/);
    expect(outlookCard).toMatch(/No signal right now/);
    expect(outlookCard).toMatch(/reach the market data service/);
    expect(outlookCard).not.toMatch(/DATA STALE/);
    expect(comparisonCard).toMatch(/no live agreement is claimed/);
    expect(comparisonCard).toMatch(/waiting for fresh data before showing agreement/);
    expect(comparisonCard).toMatch(/No comparison data yet/);
  });

  test("fixed navigation retains safe-area content clearance", () => {
    expect(dashboard).toContain("pb-[calc(5.5rem+env(safe-area-inset-bottom))]");
    expect(dashboard).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(dashboard).toContain("overflow-x-hidden");
  });

  test("raw EA bot_state never reaches a customer-visible label outside developer diagnostics", () => {
    // Full Command Center audit (2026-08-04): heartbeat.bot_state is a raw
    // EA-internal string (e.g. "MANAGING_TRADES", "STARTUP_SYNCING",
    // "EA_TRADING_DISABLED" -- see XAUUSD_AI_Sniper_EA.mq5 BotMonitorHeartbeat).
    // Every customer-visible surface must run it through humanBotState()
    // first. The one legitimate exception is the collapsed "Developer
    // diagnostics" panel on Settings, explicitly labeled "Raw bot state".
    const diagStart = dashboard.indexOf("Hidden diagnostics");
    const diagEnd = dashboard.indexOf("Setup checks", diagStart);
    const withoutDiagnostics = dashboard.slice(0, diagStart) + dashboard.slice(diagEnd);
    const rawUses = withoutDiagnostics.match(/heartbeat\.bot_state/g) || [];
    // Every remaining reference must be an argument to humanBotState(...),
    // never used bare as a display value (e.g. `heartbeat.bot_state||"X"`).
    const bareDisplay = withoutDiagnostics.match(/heartbeat\.bot_state\s*\|\|/g) || [];
    expect(rawUses.length).toBeGreaterThan(0);
    expect(bareDisplay).toHaveLength(0);
  });
});
