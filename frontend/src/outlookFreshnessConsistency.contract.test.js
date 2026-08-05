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
