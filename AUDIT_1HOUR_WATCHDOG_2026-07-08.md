# 1-Hour Live Watchdog Audit — XAUUSD AI Sniper EA

**Account:** 108492408 (MetaQuotes-Demo, paper account, not funded/live)
**Audit window:** 2026-07-08, local/log time 12:31:35 → 13:35:18 (~64 min)
**Versions covered:** v6.17.13 (12:31:35–12:58:51) and v6.17.14 (12:58:51–13:35:18) — main was updated mid-audit, both segments reported and clearly split.

Note on time: the EA's own `Date:` fields (GateReport/Heartbeat) run on broker-server time, exactly **+2:00** ahead of the log's wall-clock column. All timestamps below are log wall-clock (local time).

Data-granularity note: price points below come from the bot's own real trade fills and signal-price prints (true broker quotes at those instants), not an independent continuous tick feed. MT5's binary history cache was not parsed (undocumented format, and it was stale — last written the day before), so it was not used as a source in this report.

---

## 1. Decision-cycle table (every real evaluation, both versions)

| Time | Ver | Candle(broker) | Setup | Dir | Regime | Grade | Score/Combined | Spread | Gate result | Blocker | Price |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12:47:02 | .13 | ~14:47 | TREND_PULLBACK | BUY (sym-recheck, orig SELL) | TREND_DN | SKIP | –/– | n/a | **BLOCKED** | SMART-GUARD: fastScore 0/85, M5/M15/M30/H1 all AGAINST (diff to –70.86) | 4071.66 |
| 12:50:13 | .13 | ~14:50 | TREND_PULLBACK | BUY (sym-recheck) | TREND_DN | SKIP | –/– | n/a | **BLOCKED** (disagreement worsened: M5 diff –2.69→–4.50) | SMART-GUARD | ~4066 (interp.) |
| 12:55:16 | .13 | 14:55 | TREND_PULLBACK | SELL | TREND_DN | A | 5.5/5.32 | 27 | **BLOCKED** | FAILED-IMPULSE HARD_BLOCK ("waiting for fresh pullback") | 4063.16→4062.81 |
| 12:59:16 | .14 | 14:55 (carried) | TREND_PULLBACK | SELL | TREND_DN | A | 5.5/5.32 | 27 | **BLOCKED**, stored as pending, "recheck next M5 bar" | FAILED-IMPULSE (same reason, re-evaluated after restart) | 4061.62 |
| **13:00:47** | .14 | 15:00 | TREND_PULLBACK | SELL | TREND_DN | A+→A (demoted) | 7.0/6.29 | 26 | **ALLOWED — EXECUTED** as "RECOVERY of missed signal" | grade demoted A+→A, still eligible | Filled **4059.98**, 0.09 lot, SL 4077.01, TP 3949.27, 1R=$153.27 |
| 13:18:55 | .14 | — | — | — | — | — | — | — | **Position closed** | BROKER_SL (stop hit) | 4077.01, **loss –$153.18** |
| 13:19:14 | .14 | 15:15 | BREAKOUT | BUY | BRKT_UP | A | 3.9/4.42 | 27 | **BLOCKED** | SMART-GUARD: fastScore 20/85, M15/M30/H1 AGAINST; symmetric SELL recheck → NO_OPPOSITE_SETUP | 4076.05 |
| 13:20:45 | .14 | 15:20 | BREAKOUT | BUY | BRKT_UP | A→B (demoted) | 2.7/3.52 | 53 (spike) | **BLOCKED**, worsening | SMC_HARD_CONFLICT + SMART-GUARD + spread spike | 4072.04 |
| 13:25:17 | .14 | 15:25 | SQUEEZE_RELEASE | BUY | TREND_DN (flipped back) | SKIP | 3.9/2.04 | 37 | No candidate (below 3.0 threshold) | Low score, not a gate block | — |
| 13:30:19 | .14 | 15:30 | SQUEEZE_RELEASE | BUY | TREND_DN | SKIP | 3.9/2.04 | 27 | No candidate | Low score | — |
| 13:35:18 | .14 | 15:35 | SQUEEZE_RELEASE | BUY | TREND_DN | SKIP | 2.9/1.39 | 25 | No candidate | Low score | — |

**Open-position state:** one SELL (0.04 lot, entry ~4051.58, opened before the window) was being managed 12:31:35–12:46:35, then closed at **–$76.44** (BROKER_SL, after having peaked at +$51.44 — a large giveback). No position was open 12:46:35–13:00:47. Then the executed SELL above ran 13:00:47–13:18:55. No position was open for the rest of the window.

---

## 2. Blocked-trade table with follow-up tracking

| # | Blocked candidate | Block price | +5min | +10–18min | Best favorable (MFE) | Worst adverse (MAE) | 1R reached? | SL hit first? | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| A | BUY TREND_PULLBACK @12:47/12:50 | 4071.66 | ~4066 (–5.7, adverse for BUY) | 4060.11 by +13min (–11.6, adverse) | ~0 | –11.6 pts (68% of a typical 1R) | No (never favorable) | N/A (never entered) | **CORRECT_BLOCK** — a BUY here would have been deep underwater the entire next 13+ min |
| B | SELL TREND_PULLBACK @12:55/12:59 (then recovered & executed 13:00) | 4062.81→4059.98 (executed) | +$8.01 peak (~+0.9pt favorable) | reversed hard; SL hit at +18min | +$8.01 (5% of 1R) | –$145.80 (95% of 1R) before final –$153.18 | **No** — only the adverse side reached 1R | **Yes**, exactly at SL (4077.01) | Block itself was reasonable (fresh-signal recheck design worked); the **recovery execution** that followed is where the money was lost — see §7 |
| C | BUY BREAKOUT @13:19/13:20 | 4076.05→4072.04 | –3.9 pts within ~90s | regime flipped back to TREND_DN by +6min, grade collapsed to SKIP | 0 | –3.9 pts and fading | No | N/A | **CORRECT_BLOCK** — prevented buying the exact local top of the breakout before it faded |

---

## 3. Correct vs wrong block count

- **CORRECT_BLOCK: 2** (A, C)
- **WRONG_BLOCK: 0**
- **Nuanced / directional issue: 1** (B — not a bad block, but the *recovery-and-execute* that followed the block was on the wrong side of an emerging trend reversal)

---

## 4. Top blockers by frequency

1. **SMART-GUARD** (multi-timeframe fast confirmation) — 2 of 3 episodes (A, C)
2. **FAILED-IMPULSE / A+ EVIDENCE DEMOTION** (timing/entry-quality gate) — 1 episode (B), didn't ultimately block, just delayed
3. Low combined-score SKIP (not a gate, just weak setups) — 3 cycles, all correctly filtered noise

---

## 5. Top blockers by missed profit

**None.** Neither SMART-GUARD block cost profit — both were on the correct side of subsequent price action. The one place money was actually lost (–$153.18) came from a trade that was **allowed**, not blocked.

---

## 6. "Should have traded" examples

None found this hour. No blocked candidate would have won if taken.

---

## 7. "Should have switched direction" — the flagship finding

At 12:47–12:59 the bot's own symmetric-recheck logic *tried* BUY, correctly rejected it, and stuck with SELL. It then recovered and executed that SELL at 13:00:47. Over the next 18 minutes price reversed hard enough that by 13:19:14 the bot itself detected a fresh **A-grade BREAKOUT BUY** at 4076.05 — a ~16-point round trip from where it had just sold. The SELL recovery was on the wrong side of a trend flip the bot detected only *after* taking the loss. This isn't really a "block was wrong" story — it's a **"recovered a stale/demoted signal right as the regime was turning"** story. See fix #1 below.

---

## 8. "Should have rechecked next M5" examples

None needed — the pending-opportunity/recheck-next-bar mechanism (episode B) worked exactly as designed here.

---

## 9. Scan / watchdog / indicator problems

- **Pre-audit (before 12:31, context only):** GateReport showed "Last scan: 13:50:16" while current time was 14:23:16 broker — a **~33-minute scan stall**, `INDICATOR_TRANSIENT_4807` retry loop. Resolved by an EA/terminal restart before the formal audit window began.
- **871 `INDICATOR_TRANSIENT_4807` retries** occurred inside the audit window — but almost all self-heal within the same tick (by design). `SCAN WATCHDOG` (the 512s force-scan) only fired at the two cold starts (12:33:43, 12:58:59), not mid-session. Not currently a live problem.
- **New finding — likely a real gap:** while the 13:00:47–13:18:55 position was open, there is **no `SCAN_STARTED` activity at all for ~18 minutes** (last scan attempt 13:00:49, next one 13:18:59 — the instant the position closed). The heartbeat log claims "analysis remains active while trades run," but the evidence says candidate scanning was fully paused while managing that position. That's exactly the window in which the opposite-direction BREAKOUT BUY was forming. This deserves a code-level look — not yet investigated in source.

---

## 10. Code-level fix recommendations (not implemented — pending decision)

1. **Confirm whether new-candidate scanning is gated off while any position is open.** Evidence: zero scan attempts for 18 straight minutes, resuming the instant the position closed. If confirmed, this is the highest-value fix — it means the bot can't notice a regime flip or a better opposite-direction setup while it's sitting in a losing trade.
2. **Tighten the "recovery of missed signal" path.** Right now a HARD_BLOCKed signal can be re-offered and executed one bar later on nothing more than a grade demotion (A+→A) passing a quality check — with no check on whether the *opposite* direction's evidence has been improving. Adding a lightweight "is the opposite side gaining ground" check before honoring a recovery would have caught episode B.
3. Minor/cosmetic: worth a sanity check that the log-wall-clock vs `TimeCurrent()` +2:00 offset isn't leaking into any news-time or session-window gating logic elsewhere, since those are time-sensitive gates.

None of these are logging/telemetry bugs — they're behavioral/architectural. No code changes have been made.
