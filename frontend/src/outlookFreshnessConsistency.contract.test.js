import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const fullPage = read("pages/AIMarketOutlookPage.jsx");
const homeCard = read("components/cloud/AIMarketOutlookCard.jsx");

// Root-cause fix (2026-08-05): the full AI Market Outlook page could show a
// stale prior-hour BUY/SELL signal as "Execution-ready"/"Tracking" while the
// Home page correctly showed no active signal, from the same API response.
// The actual fix is backend-side (build_authoritative_outlook_contract now
// derives stored_active from the same _outlook_still_live +
// _signal_belongs_to_current_hourly_window logic compute_outlook_freshness
// uses -- see backend/tests/test_market_outlook.py). These tests lock in
// the two structural guarantees on the frontend side: no client-side
// caching/staleness math duplicating the backend's job, and no
// duplicate/out-of-order response can silently restore an old signal.
describe("AI Market Outlook current-signal freshness contract", () => {
  test("neither surface computes its own staleness from evaluation_deadline/expiry_at client-side", () => {
    // Both pages must trust the backend's contract.state/freshness.state
    // entirely -- re-deriving "is this still valid" from a raw timestamp
    // client-side is exactly the kind of second independent computation
    // that caused the two surfaces to disagree in the first place.
    for (const src of [fullPage, homeCard]) {
      expect(src).not.toMatch(/evaluation_deadline\s*[<>]/);
      expect(src).not.toMatch(/expiry_at\s*[<>]/);
      expect(src).not.toMatch(/new Date\(\s*evaluation_deadline/);
      expect(src).not.toMatch(/new Date\(\s*expiry_at/);
    }
  });

  test("neither surface persists the outlook/contract to localStorage or sessionStorage", () => {
    for (const src of [fullPage, homeCard]) {
      expect(src).not.toMatch(/localStorage\.(set|get)Item/);
      expect(src).not.toMatch(/sessionStorage\.(set|get)Item/);
    }
  });

  test("full Outlook page discards a superseded /outlook/current response instead of applying it", () => {
    expect(fullPage).toContain("currentRequestSeq");
    expect(fullPage).toContain("requestId !== currentRequestSeq.current");
  });

  test("Home page card discards a superseded /outlook/current response instead of applying it", () => {
    expect(homeCard).toContain("requestSeq");
    expect(homeCard).toContain("requestId !== requestSeq.current");
  });
});

// Owner-reported bug (2026-08-26): the Home Outlook card showed Entry and SL
// for an active signal but never TP1/TP2/TP3, for bot owners AND
// free/trial subscribers alike -- the take-profit fields existed in the
// underlying data (both /outlook/current's tp1_price/tp2_price/tp3_price
// and the subscriber mirror's tp1/tp2/tp3) but the compact card never read
// them.
describe("AI Market Outlook Home card shows take-profit levels for an active signal", () => {
  test("renders TP1 and TP2/TP3 alongside Entry and SL", () => {
    expect(homeCard).toContain("outlook.tp1_price");
    expect(homeCard).toMatch(/TP1:/);
    expect(homeCard).toMatch(/TP2 \/ TP3:/);
  });

  test("the subscriber data source maps tp1/tp2/tp3 from the mirrored signal doc into the same outlook.tp*_price fields", () => {
    expect(homeCard).toMatch(/tp1_price:\s*signal\.tp1/);
    expect(homeCard).toMatch(/tp2_price:\s*signal\.tp2/);
    expect(homeCard).toMatch(/tp3_price:\s*signal\.tp3/);
  });
});
