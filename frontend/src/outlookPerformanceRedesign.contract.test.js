import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const section = read("components/OutlookPerformanceSection.jsx");
const app = read("App.js");

// Premium redesign (owner spec, 2026-08-04): compact stat cards, redesigned
// signal cards, filter chips, cumulative performance chart, confidence
// badges, lazy-loaded pagination -- while never fabricating data. These
// tests are static-source checks (matching this repo's existing
// forensic.contract.test.js pattern) rather than a rendered-DOM test, since
// this codebase has no render-test harness set up for marketing components.
describe("Market Outlook Performance redesign contract", () => {
  test("every stat card renders a real API field, never a literal fabricated number", () => {
    // Guard against a regression back to hardcoded example numbers like the
    // ones this exact page used to ship as invented drawdown/AI-rating
    // placeholders elsewhere on the site (see forensic.contract.test.js).
    expect(section).toMatch(/value=\{stats\.win_rate/);
    expect(section).toMatch(/value=\{stats\.total_pips\}/);
    expect(section).toMatch(/value=\{stats\.total_gold_moves\}/);
    expect(section).toMatch(/value=\{stats\.average_pips\}/);
    expect(section).toMatch(/value=\{stats\.average_win_pips\}/);
    expect(section).toMatch(/value=\{stats\.average_loss_pips\}/);
    expect(section).toMatch(/value=\{stats\.best_trade_pips\}/);
    expect(section).toMatch(/value=\{stats\.worst_trade_pips\}/);
    // v6.26.0 R-to-pips migration: this redesign's stat cards must never
    // show a bare "R" label again (was "Net R" + suffix="R" on 5 cards).
    expect(section).not.toMatch(/label="Net R"/);
    expect(section).not.toMatch(/suffix="R"/);
    expect(section).toMatch(/\{stats\.wins\} wins/);
    expect(section).toMatch(/\{stats\.losses\} losses/);
    // No suspicious standalone numeric-literal stat values (the kind of
    // thing a fabricated placeholder would look like).
    expect(section).not.toMatch(/label="Win Rate"[^/]*value=\{?\d/);
  });

  test("signal cards render only real fields from the API signal object, direction/result never hardcoded", () => {
    expect(section).toContain("signal.direction");
    expect(section).toContain("signal.result");
    expect(section).toContain("signal.entry_price");
    expect(section).toContain("signal.stop_loss");
    expect(section).toContain("signal.take_profit_1");
    expect(section).toContain("signal.result_pips");
    expect(section).toContain("signal.result_gold_moves");
    expect(section).toContain("signal.result_r");
    expect(section).toContain("signal.confidence_pct");
    expect(section).toContain("signal.highest_tp_reached");
  });

  test("result badge coloring covers only the result values the completed-signal feed can actually produce", () => {
    // The backend query for this feed only ever returns analytics_outcome
    // WIN or LOSS (see market_outlook_routes.build_public_outlook_performance's
    // query filter) -- must not invent BREAKEVEN/CANCELLED/PARTIAL_TP/etc
    // styling for states that structurally cannot occur in this dataset.
    expect(section).toContain("RESULT_STYLE");
    expect(section).toMatch(/WIN:\s*\{/);
    expect(section).toMatch(/LOSS:\s*\{/);
  });

  test("filter chips are real client-side filters over fetched data, not decorative", () => {
    expect(section).toContain('"All", "BUY", "SELL"');
    expect(section).toContain('"All", "WIN", "LOSS"');
    expect(section).toMatch(/"Today"|"Last 7 days"|"Last 30 days"/);
    expect(section).toContain("filteredSignals");
    expect(section).toContain("directionFilter");
    expect(section).toContain("resultFilter");
    expect(section).toContain("dateFilter");
  });

  test("filter chip bar is sticky", () => {
    expect(section).toMatch(/sticky top-\[/);
  });

  test("Cumulative Net R chart is completely removed", () => {
    // Owner spec (2026-08-04): removed entirely -- component, heading,
    // graph, and the recharts import used only by it. Filters and signal
    // cards moved up to fill the space; no blank gap left behind.
    expect(section).not.toContain("Cumulative Net R");
    expect(section).not.toContain("AreaChart");
    expect(section).not.toContain("cumulative_r_curve");
    expect(section).not.toContain("recharts");
    expect(section).not.toContain("PerformanceChart");
  });

  test("load more requests additional real data via the limit param, never fabricates extra rows", () => {
    expect(section).toContain("setLimit((l) => l + LOAD_MORE_STEP)");
    expect(section).toMatch(/params:\s*\{\s*limit\s*\}/);
  });

  test("confidence badge is derived from the real confidence_pct, not invented", () => {
    expect(section).toContain("function ConfidenceBadge({ pct })");
    expect(section).toContain("if (pct == null) return null");
  });

  test("advisory disclaimers are preserved from the pre-redesign version", () => {
    expect(section).toContain("not independently verified");
    expect(section).toContain("separate from automated EA account performance");
  });

  test("respects prefers-reduced-motion for both the count-up numbers and card entrance animation", () => {
    expect(section).toContain("prefers-reduced-motion: reduce");
    expect(section).toMatch(/matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  });

  test("signal cards are compact -- no separate 3-column Entry/SL/TP grid or boxed result panel", () => {
    // Owner spec (2026-08-04): ~30-40% shorter cards. Entry/SL/TP1 collapsed
    // onto one inline row instead of a `grid grid-cols-3` with stacked
    // per-field labels, and the result line is plain text instead of a
    // bordered/padded box -- both of those were the main height cost.
    expect(section).not.toContain("grid grid-cols-3");
    expect(section).not.toContain("bg-black/20 px-2.5 py-2");
    expect(section).toMatch(/Entry <span/);
  });

  test("Outlook Performance section is no longer embedded on the public homepage", () => {
    // Owner decision (2026-08-04): pulled off the marketing homepage --
    // the component itself still exists (still tested above) but is not
    // rendered there. Replaced at the same "performance" anchor by real
    // closed-trade results (DailyTradingResultsSection).
    expect(app).not.toContain("OutlookPerformanceSection");
    expect(app).toContain("DailyTradingResultsSection");
    expect(app).toMatch(/<section id="performance">[\s\S]*<DailyTradingResultsSection/);
  });
});
