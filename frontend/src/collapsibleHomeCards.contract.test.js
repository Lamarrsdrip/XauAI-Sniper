import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");

describe("collapsible Home summary cards (Recent Signals / Closed Trades, 2026-08-25)", () => {
  test("Collapsible defaults to closed on initial render", () => {
    expect(dashboard).toMatch(/function Collapsible\([\s\S]{0,80}const \[open, setOpen\] = useState\(false\)/);
  });

  test("the summary header is accessible -- aria-expanded, a real <button>, keyboard-operable by default", () => {
    const collapsible = dashboard.slice(dashboard.indexOf("function Collapsible("), dashboard.indexOf("function HomeRecentActivity("));
    expect(collapsible).toMatch(/<button[\s\S]{0,40}aria-expanded=\{open\}/);
  });

  test("no expand affordance renders when there is nothing to expand", () => {
    const collapsible = dashboard.slice(dashboard.indexOf("function Collapsible("), dashboard.indexOf("function HomeRecentActivity("));
    expect(collapsible).toMatch(/if \(!count\)/);
  });

  test("Recent Signals and Closed Trades both have a real empty state with no expand button", () => {
    expect(dashboard).toContain('emptyText="No recent signals"');
    expect(dashboard).toContain("No closed trades today");
  });

  test("Recent Signals summary reuses the existing GET /cloud/signals/recent state -- no new fetch just for the collapsed view", () => {
    const summaryFn = dashboard.slice(dashboard.indexOf("function RecentSignalsSummary("), dashboard.indexOf("function HomeRecentActivity("));
    expect(summaryFn).not.toMatch(/signalAxios\.(get|post)/);
    expect(summaryFn).toContain("const { loading, signals, locked, error } = state;");
  });

  test("Closed Trades summary is computed from the already-loaded events/heartbeat -- not a new per-user aggregate call, and never the network-wide daily-results endpoint (that would leak other customers' trades as 'yours')", () => {
    const activityFn = dashboard.slice(dashboard.indexOf("function HomeRecentActivity("), dashboard.indexOf("// Simple push on/off toggle"));
    expect(activityFn).not.toContain("/performance/daily-results");
    expect(activityFn).not.toMatch(/axios\.(get|post)/);
    expect(activityFn).toContain('eventCategory(e) === "exits"');
  });

  test("Home renders both as Collapsible -- Recent Signals on the subscriber Home, Closed Trades on the bot-owner Home", () => {
    expect(dashboard).toContain("<RecentSignalsSummary state={recent} />");
    expect(dashboard).toMatch(/<Collapsible title="Closed Trades"/);
    expect(dashboard).toMatch(/<Collapsible title="Recent Signals"/);
  });
});
