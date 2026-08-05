import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const section = read("components/GoldReplaySection.jsx");
const app = read("App.js");

// Real 30-day MT5 Strategy Tester replay (owner spec, 2026-08-05). Every
// number must come from GET /performance/gold-replay -- a checked-in
// snapshot built directly from a real MT5-generated report -- never
// hardcoded or estimated in the component itself.
describe("Gold Replay section contract", () => {
  test("fetches from the real replay endpoint, no hardcoded numbers", () => {
    expect(section).toContain("/performance/gold-replay");
    expect(section).not.toMatch(/net_profit_usd\s*=\s*\d/);
    expect(section).not.toMatch(/total_pips\s*=\s*\d/);
  });

  test("every rendered stat/trade field maps to a real API field", () => {
    expect(section).toContain("summary.net_profit_usd");
    expect(section).toContain("summary.profit_factor");
    expect(section).toContain("summary.total_gold_moves");
    expect(section).toContain("summary.total_pips");
    expect(section).toContain("summary.max_equity_drawdown_pct");
    expect(section).toContain("summary.total_trades");
    expect(section).toContain("summary.wins");
    expect(section).toContain("summary.losses");
    expect(section).toContain("trade.direction");
    expect(section).toContain("trade.result");
    expect(section).toContain("trade.entry_price");
    expect(section).toContain("trade.exit_price");
    expect(section).toContain("trade.pips");
    expect(section).toContain("trade.profit_usd");
  });

  test("honest unavailable/error states, no fabricated fallback data", () => {
    expect(section).toContain("temporarily unavailable");
    expect(section).toMatch(/No replay has been published yet/);
  });

  test("discloses this is a backtest replay, not live trading, with a real-data disclaimer", () => {
    expect(section).toContain("meta?.disclaimer");
    expect(section).toContain("not a guarantee of future performance");
  });

  test("is embedded on the public homepage performance section, above the daily results", () => {
    expect(app).toContain("GoldReplaySection");
    const goldIdx = app.indexOf("<GoldReplaySection");
    const dailyIdx = app.indexOf("<DailyTradingResultsSection");
    expect(goldIdx).toBeGreaterThan(-1);
    expect(dailyIdx).toBeGreaterThan(-1);
    expect(goldIdx).toBeLessThan(dailyIdx);
  });
});
