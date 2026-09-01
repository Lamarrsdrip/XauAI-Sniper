import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const page = read("pages/AIMarketOutlookPage.jsx");

describe("persisted Signal Outlook lifecycle UI contract", () => {
  test("authoritative persisted states map to amber, green, red, blue, teal, and unavailable labels", () => {
    for (const state of [
      "TRACKING_AMBER", "WIN_GREEN_0_5R", "WIN_GREEN_TP1",
      "LOSS_RED_SL", "LOSS_RED_TIMEOUT", "PARTIAL_PROFIT", "BREAK_EVEN",
      "HISTORICAL_DATA_UNAVAILABLE",
    ]) {
      expect(page).toContain(state);
    }
    expect(page).toContain("TRACKING · AWAITING TP1");
    // Root-cause fix (2026-08-05): a signal below TP1 at the 60-minute
    // deadline is no longer automatically a LOSS -- LOSS_RED_TIMEOUT now
    // only fires on a genuinely negative close, so its label dropped the
    // "BELOW +0.50R" framing that used to fire regardless of sign.
    expect(page).toContain("LOSS · NO TP REACHED");
    expect(page).toContain("PARTIAL PROFIT");
    expect(page).toContain("BREAK-EVEN");
  });

  test("cards display exact anchor and persisted journey fields", () => {
    for (const field of [
      "tracking_entry_price", "current_r", "mfe_r", "mae_r",
      "evaluation_deadline", "first_half_r_at", "tp1_hit_at", "sl_hit_at",
    ]) {
      expect(page).toContain(field);
    }
    expect(page).toContain("Signal entry");
    expect(page).toContain("Suggested zone");
  });

  test("history cards use lifecycle accent on the entire card", () => {
    expect(page).toContain("border-l-4");
    expect(page).toContain("color.border");
    expect(page).toContain("color.bg");
  });

  test("analytics show resolved outcomes, excursions, active and unavailable counts", () => {
    for (const field of [
      "win_rate", "wins", "losses", "total_r", "average_r",
      "average_mfe", "average_mae", "active_unresolved_count",
      "unavailable_historical_count",
    ]) {
      expect(page).toContain(field);
    }
  });

  test("informational updates explicitly remain outside signal analytics", () => {
    expect(page).toContain("INFORMATIONAL UPDATE");
    expect(page).toContain("Informational updates are excluded from signal analytics.");
  });

  test("frontend only polls persisted state and performs no price/R calculation", () => {
    expect(page).toContain('get("/outlook/current")');
    expect(page).toContain('get("/outlook/history"');
    expect(page).not.toMatch(/currentBid\s*-\s*trackingEntryPrice/);
    expect(page).not.toMatch(/trackingEntryPrice\s*-\s*currentAsk/);
  });
});
