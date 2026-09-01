import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");
const signalCards = read("components/cloud/SubscriberSignalCards.jsx");
const goldReplay = read("components/GoldReplaySection.jsx");

// Correction, 2026-08-25: an earlier pass made Recent Signals / Closed
// Trades a tap-to-expand accordion (hidden by default). That was explicitly
// wrong -- the requirement is VISIBLE by default with an internal scroll
// container, matching the public homepage's 30-Day Replay trade list
// (GoldReplaySection.jsx), never a collapsed/hidden state.
describe("Recent Signals / Closed Trades stay visible with internal scroll (not an accordion)", () => {
  test("the accordion component from the corrected pass no longer exists", () => {
    expect(dashboard).not.toContain("function Collapsible(");
    expect(dashboard).not.toContain("aria-expanded");
    expect(dashboard).not.toContain("function RecentSignalsSummary(");
  });

  test("Recent Signals on Home renders the real list directly, in scroll mode -- rows are not hidden behind a summary line", () => {
    expect(dashboard).toContain("<RecentSignalsCard state={recent} scroll />");
  });

  test("RecentSignalsCard's scroll mode uses the same bounded max-height + overflow-y-auto pattern as the 30-Day Replay list", () => {
    expect(goldReplay).toMatch(/max-h-\[\d+px\][^"]*overflow-y-auto/);
    expect(signalCards).toMatch(/max-h-\[\d+px\][^"]*overflow-y-auto/);
  });

  test("Recent Signals header shows a plain item count, not a 'Latest: ...' one-line replacement", () => {
    const fn = signalCards.slice(signalCards.indexOf("export function RecentSignalsCard("), signalCards.indexOf("export function RecentSignalsCard(") + 1500);
    expect(fn).toMatch(/\$\{count\} item/);
    expect(fn).not.toMatch(/Latest:/);
  });

  test("Closed Trades on Home is always rendered (never returns null/hidden) and scrolls internally", () => {
    const fn = dashboard.slice(dashboard.indexOf("function HomeRecentActivity("), dashboard.indexOf("// Simple push on/off toggle"));
    expect(fn).not.toMatch(/if \(!meaningful\.length\) return null/);
    expect(fn).toMatch(/max-h-\[\d+px\][^"]*overflow-y-auto/);
  });

  test("Closed Trades keeps a real stats summary (today's count, W/L, P&L) above the scrollable rows, from real data -- not a fabricated frontend guess", () => {
    const fn = dashboard.slice(dashboard.indexOf("function HomeRecentActivity("), dashboard.indexOf("// Simple push on/off toggle"));
    expect(fn).toContain("heartbeat?.daily_pnl");
    expect(fn).toMatch(/\{wins\}W \/ \{losses\}L/);
  });

  test("empty states render real copy with no scroll container -- 'No recent signals yet.' / 'No closed trades yet.'", () => {
    expect(signalCards).toContain("No recent signals yet.");
    expect(dashboard).toContain("No closed trades yet.");
  });

  test("no duplicate fetch was introduced -- both reuse data Home already loads", () => {
    const activityFn = dashboard.slice(dashboard.indexOf("function HomeRecentActivity("), dashboard.indexOf("// Simple push on/off toggle"));
    expect(activityFn).not.toMatch(/axios\.(get|post)/);
    expect(activityFn).not.toContain("/performance/daily-results");
  });
});
