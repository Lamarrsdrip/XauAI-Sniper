import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const section = read("components/DailyTradingResultsSection.jsx");

// Real closed-trade daily results (owner spec, 2026-08-04) -- replaces the
// Outlook advisory section on the homepage. Every number must come from
// GET /performance/daily-results (real trade_journal data), never
// fabricated or client-computed from a different source.
describe("Daily Trading Results section contract", () => {
  test("fetches from the real performance endpoint, no hardcoded numbers", () => {
    expect(section).toContain("/performance/daily-results");
    expect(section).toContain("data?.days");
    expect(section).toContain("data?.totals");
    expect(section).not.toMatch(/net_pips\s*=\s*\d/);
    expect(section).not.toMatch(/net_gold_moves\s*=\s*\d/);
  });

  test("every rendered stat/day field maps to a real API field", () => {
    expect(section).toContain("totals.net_usd");
    expect(section).toContain("totals.net_usd_available");
    expect(section).toContain("totals.net_gold_moves");
    expect(section).toContain("totals.net_pips");
    expect(section).toContain("totals.trades");
    expect(section).toContain("totals.wins");
    expect(section).toContain("totals.losses");
    expect(section).toContain("day.net_pips");
    expect(section).toContain("day.net_gold_moves");
    expect(section).toContain("day.trades");
    expect(section).toContain("day.wins");
    expect(section).toContain("day.losses");
  });

  test("honest empty/unavailable/error states, no fabricated fallback data", () => {
    expect(section).toContain("temporarily unavailable");
    expect(section).toMatch(/No closed trades in the last 30 days yet/);
  });

  test("describes the network-wide source without exposing account identifiers", () => {
    expect(section).toContain("reported by XauCloud EAs across connected accounts");
    expect(section).toContain("data.account_count");
    expect(section).toContain("day.account_count");
    expect(section).not.toContain("account_login");
    expect(section).not.toContain("license_id");
  });

  test("first-party disclaimer is present, matching the rest of the site's real-performance pages", () => {
    expect(section).toContain("First-party trading records, not independently verified");
  });

  // v6.26.0 R-to-pips/Gold-moves migration -- this section must never show a
  // bare "R" unit label again (was "Net R (30d)" ... + "R", replaced with a
  // Net P/L $ card since Gold Moves and Pips already cover the same number
  // in the correct units).
  test("no bare R-multiple label anywhere in this section", () => {
    expect(section).not.toContain("Net R");
    expect(section).not.toMatch(/\+"R"/);
    expect(section).not.toMatch(/totals\.net_r\b/);
  });

  test("does not label mixed or unknown account currencies as USD", () => {
    expect(section).toContain("Currency unavailable");
  });
});
