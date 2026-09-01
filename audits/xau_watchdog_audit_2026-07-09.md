# Live Watchdog Audit — XAUUSD AI Sniper EA

**Account:** 108492408 (MetaQuotes-Demo, paper account, not funded/live)
**EA version:** v6.20.0 (as of start; version changes mid-window will be flagged inline)
**Audit window start:** 2026-07-09, local/log time 07:47:00 (WAT)
**Target duration:** 5 hours minimum (2026-07-09 12:47 WAT), continuing beyond that until explicitly stopped by user.
**Polling method:** MT5's own live Journal/Expert log (`MQL5/Logs/20260709.log`) is polled every ~20–25 min; each new slice is archived verbatim (UTF-8 converted) under `audits/raw/`, then parsed for this report. Nothing is summarized away in the raw archive — only this rollup file condenses repeated heartbeats/idle lines.

Note on time: in prior audits, the EA's own `Date:` fields (GateReport/Heartbeat) ran on broker-server time, ~+2:00 ahead of the log wall-clock column. Assume the same offset applies here unless noted otherwise.

---

## Running log of checkpoints

_(Each polling pass appends one entry below with: time range covered, heartbeat/idle count, decision cycles, blocks, trades, errors/anomalies.)_

### Checkpoint 0 — window opened 07:47 WAT

Capture initialized. Starting byte offset in live log: 18718487. Baseline tail sample confirmed EA v6.20.0 alive and heartbeating (BOT-MONITOR heartbeat OK, license_pin ASE-M4M4W-VWJG accepted) as of 07:44:43. No decision cycles captured yet — first real checkpoint follows in ~20-25 min.

### Checkpoint 1 — 07:47:35–07:51:46 WAT (log lines 20517–20618, raw archive: `raw/xau_watchdog_raw_2026-07-09_0751.log`)

- Routine: GateReport/ForwardTest heartbeat files refreshed (07:47:35); ~15 BOT-MONITOR heartbeats OK (account 108492408, license pin ASE-M4MW-VWJG accepted every time); several `SCAN IDLE: WAITING_FOR_NEW_M5_BAR` lines — all normal.
- **Indicator stall (self-healed):** 07:50:00.090–07:50:03.410 — `EMA_FAST_H1` hit `INDICATOR_TRANSIENT_4807` 29 times in ~3.3s (classic new-bar-boundary quirk noted in prior audits), then `INDICATOR_REBUILD` fired and it recovered cleanly (`INDICATOR_RECOVERY_SUCCEEDED... after 0s in recovery`). No trading impact — this is the same self-healing pattern flagged as "not currently a live problem" in the 2026-07-08 1-hour audit.
- **Decision cycle — candle 09:50 (broker time, i.e. 07:50 wall-clock, confirming the known +2:00 broker/log offset):**
  - `ADAPTIVE-DIRECTION`: HTF bias flipped to **Bearish→forced BUY_ONLY (STRONG tier)** on a confirmed HH/HL reversal (M5 and M15 both intact HH/HL sequences).
  - Setup **TREND_PULLBACK**, dir **BUY**, regime **TREND_UP**, SMC score 1.50 (KILL_ZONE +0.5 bonus, no BOS/OB/FVG confirmation).
  - Grade **SKIP**, rawScore 1.50, combined 2.48, spread 24.
  - `SMART-GUARD FAST CONFIRM` actually **allowed** this at the fast-confirm gate (fastScore 85/85; M5/M15/M30 OK, only H1 against, treated as soft penalty) — but it was still blocked one layer later: `TRADE BLOCKED BECAUSE: combined 2.5 < threshold 3.0`. So the block here is the **overall combined-score gate**, not SMART-GUARD — worth tracking since it's a different blocker category than the two seen in the prior 1-hour audit.
  - Entry price not printed in this slice (only spread=24 available); will backfill from tick/position data if a comparable candidate reappears.
  - `SCAN_COMPLETED_NO_TRADE` — no position opened.
- No trades opened or closed in this window. No errors beyond the self-healed indicator retry.

### Checkpoint 2 — 07:55–09:45 WAT (log lines 20619–23255, raw archive: `raw/xau_watchdog_raw_2026-07-09_0949.log`)

**This wakeup fired late (09:49 instead of ~08:14) so it covers a big span — 22 decision cycles across candles 09:55→11:45 broker time.**

- **Regime the entire window: TREND_UP**, htfBias consistently -1 (bearish HTF) but `ADAPTIVE-DIRECTION` kept forcing `activeDir=1(STRONG)` BUY-only for most of it (same override mechanism as Checkpoint 1) — dropping to WEAK/NONE only when no fresh setup was forming.
- **Decision-cycle breakdown (all 22 → NO_TRADE, zero executions):**
  - 5 candles (09:55, 10:05, 10:10, 10:50, 11:30): dir=BUY, grade=SKIP, combined 2.48–2.80 — blocked by the **combined-score < 3.0 threshold** (same category as Checkpoint 1's block).
  - 6 candles (10:15, 10:20, 10:25, 11:00, 11:25, 11:35): dir=BUY, grade=B, combined 3.45–3.80 — passed the score gate as a genuine **CANDIDATE**, but blocked one layer deeper by entry-timing gates: `BAD-LOCATION BLOCK` (too close to recent high, x2), `CALIBRATED_ENTRY_QUALITY`/`late-chase-entry` (x2), and `TREND-CONTINUATION MODE` qualifying but still gated (x1). **New blocker categories not seen in Checkpoint 1.**
  - 9 candles (10:30–10:55, 11:05–11:20, 11:40–11:45): dir=NONE — regime present but no setup formed at all (activeDir fell to WEAK/NONE).
- **Flagship finding — sustained missed rally:** The BUY-direction signal first appeared around **4103.00** (~08:00–08:15). Price then climbed steadily: 4104.50 (08:20) → 4105.70 (08:25) → 4107.88 (09:00, missed +4.88) → peak **4115.77 at 09:25** (missed +12.77 from first signal, 14 candles since signal) → pulled back to 4110.38 by 09:35 (missed +7.38). That's a **~13-point, ~90-minute sustained BUY-aligned rally in a confirmed TREND_UP regime that the bot correctly called direction on every single candle and never once entered** — first blocked by low combined score while the setup was still forming, then blocked by `BAD-LOCATION`/`late-chase-entry`/entry-timing gates once price had already run. This is the strongest "should have traded" candidate in the audit so far — see running tally below. Not yet a code recommendation (need to see how it resolves — pullback continuing vs fresh entry eventually taken), but tracking closely.
- `PERSONALITY GATE: TREND_PULLBACK not ideal for REVERSAL_ENV — adjusting` fired 6 times (08:00–08:03) — a regime/personality friction note, not a hard block.
- **Indicator retries:** 784 `INDICATOR_TRANSIENT_4807` occurrences — proportional to the ~2h span (fires predictably at every new M5 bar boundary). Worst single burst reached 29/30 before self-healing via `INDICATOR_REBUILD`; **never hit the 30/30 ceiling**. Confirms this is a stable, self-healing, non-escalating pattern — not a live problem, consistent with the 2026-07-08 audit's conclusion.
- No trades opened or closed. No genuine errors found (all "error"-matching lines were the routine transient-retry log lines).

**Running tally after 2 checkpoints:** 0 trades executed, 0 correct blocks confirmed yet (nothing has reversed against the blocked direction — everything so far has continued favorably for the blocked BUY side), 1 strong candidate "should have traded" situation building (the 4103→4115.77 missed rally).

---

### Checkpoint 3 — 09:50–11:50 WAT (log lines 23256–25785, raw archive: `raw/xau_watchdog_raw_2026-07-09_1153.log`)

**This wakeup also fired late (11:53 instead of ~10:25), covering ~2 hours — 25 decision cycles across candles 11:50→13:50 broker time.** Still v6.20.0, no restarts, no indicator-retry ceiling breaches this window either.

- **IMPORTANT UPDATE to the Checkpoint-2 "missed rally" thread: it reversed.** After peaking at 4115.77 (~09:25), price pulled back through the rest of this window: the next BUY setup's `signalFirstSeenPrice` is **4107.45**, with realized entry prices sliding to **4104.31–4106.88** across 11:10–11:35 — i.e. price gave back essentially the entire missed rally and is now testing back toward the original ~4103 starting level. **Verdict revision: the earlier missed-rally episode is now leaning toward CORRECT_BLOCK in hindsight** — a bot that had chased the BUY near 4115.77 would now be sitting on an unrealized loss. Treat the Checkpoint-2 flag as "watch, don't yet conclude" — noted there for exactly this reason.
- **Long no-setup stretch:** 09:50–11:05 (16 straight candles) — `dir=NONE`, `TRADE BLOCKED BECAUSE: no setup met regime criteria`, regime nominally still `TREND_UP` throughout despite price chopping/reversing. **Notable: the regime label stayed TREND_UP for the entire ~4-hour window so far (07:55→11:50) even while price round-tripped 4103→4115.77→~4104.** Worth a code-level look at whether regime classification is lagging real price action (this project already has a prior `xau_direction_recognition_latency_audit` in `audits/` — this observation may be directly relevant to that thread, not a new bug).
- **New high-quality candidate, hard-blocked 6x, then expired:** 11:10–11:35 (6 candles, 25 min) — **Grade A**, rawScore 5.50, combined 5.08, `setupQuality=88/100`, `finalCalibratedConfidence` 78–79/100 — clearly the strongest-scoring setup seen in this audit so far. Blocked every cycle:
  - 4x `CALIBRATED_ENTRY_QUALITY... timing=failed-impulse blockClass=HARD_BLOCK` (11:10, 11:15, 11:25, 11:30)
  - 2x `TREND-CONTINUATION MODE: qualification failed` (11:20, 11:35) — tcmScore 43–44 vs minScore 72 required
  - At 11:40 the setup vanished entirely (back to `dir=NONE`), consistent with the failed-impulse read being correct — this lines up with the price pullback noted above, so this also looks like a **correct block**, not a missed trade.
- No trades opened or closed. No genuine errors. No indicator-retry bursts reached the 30/30 ceiling.

**Running tally after 3 checkpoints:** 0 trades executed in ~4 hours of live monitoring. 0 confirmed WRONG_BLOCK so far — both flagged candidates (the 4103→4115.77 rally chase, and the 11:10–11:35 Grade-A failed-impulse setup) now look like probable CORRECT_BLOCKs once the follow-through price action is accounted for. The standout open question for the final report is **why zero trades have fired across an entire TREND_UP-labeled session that visibly chopped in a ~13-point range** — worth checking in the final compile whether the entry-quality/timing gates are simply calibrated tighter than the rest of the gate stack, given they're the ones doing all the blocking once score thresholds are cleared.

---

### Checkpoint 4 — 11:53–12:20 WAT (log lines 25786–26545, raw archive: `raw/xau_watchdog_raw_2026-07-09_1220.log`)

- **Confirms the reversal:** signal prices now print **4096.46** (11:55) and **4098.77** (12:00) — price has kept falling from the 4115.77 peak through the 4104–4107 zone (Checkpoint 3) down to ~4094–4099 now. That's a ~19-point round trip from the peak. This further **confirms the Checkpoint-2 BUY block was correct** — a bot that had entered that missed BUY would be significantly underwater by now.
- **First-ever SELL-direction candidates, both high grade, both blocked by SMART-GUARD (new blocker category on this side):**
  - 11:55:04 — `BREAKOUT` SELL, **grade A+**, rawScore 5.90, combined **8.43** (highest score of the whole audit) — `ADAPTIVE-CONFIRM: BLOCK` via SMART-GUARD (fastScore 20/85; M15/M30/H1 against). Stored as `PENDING_OPPORTUNITY` + `BLOCKED-MEMORY` (signalPrice=4096.46) for possible later recovery.
  - 12:00:02 — `TREND_PULLBACK` SELL, grade A, combined 5.10 — same SMART-GUARD block pattern (fastScore 20/85), also stored as pending/blocked-memory (signalPrice=4098.77).
  - **Flag for next checkpoints:** the 2026-07-08 1-hour audit's single loss came from exactly this "recovery of a stored/blocked signal" path being honored one bar later without re-checking whether the *opposite* side had gained ground. Watch whether either of these two stored SELL setups gets recovered-and-executed, and if so scrutinize it closely.
- **Regime-label lag — now a concrete, higher-confidence finding:** `regime=TREND_UP` has been printed on every single decision cycle since the audit started at 07:47 (5 checkpoints, ~4.5 hours) — yet in this same window `ADAPTIVE-DIRECTION` cycled through STRONG BUY (Ckpt 1–2) → STRONG SELL (12:00, on confirmed bearish M5+M15 structure) → `DIRECTION_TRANSITION_WAIT` (12:05–12:15, explicitly reasoning "WEAK opposition to bearish HTF bias") → `DIRECTION_BOTH_ALLOWED` (12:20, an explicit "TRANSITION_WAIT OVERSTAY RELEASE... market is genuinely undecided") — while price fell ~19 points off its peak. The `regime` field itself never left `TREND_UP` despite the EA's own finer-grained direction/structure logic clearly detecting the reversal. This looks like a real code-level latency/staleness issue in the regime classifier specifically (separate from the direction-override logic, which is working) — matches the theme of this project's existing `xau_direction_recognition_latency_audit` in `audits/`, worth a direct code comparison there.
- **Version bump mid-window:** EA updated from **v6.20.0 → v6.20.2 at 12:20:47** (main was likely edited/recompiled and auto-reloaded). No behavioral discontinuity observed yet in the few lines available post-bump — will track as its own segment in following checkpoints, same approach as the v6.17.13→v6.17.14 split in the 2026-07-08 audit.
- No trades opened or closed. No indicator-retry ceiling breaches.

**Running tally after 4 checkpoints:** 0 trades executed in ~4.5 hours. 0 confirmed WRONG_BLOCK. Two pending/blocked-memory SELL setups now stored and worth watching for a recovery-execution. Regime-label staleness is now the leading code-level finding.

---

### Checkpoint 5 — 12:20–12:55 WAT (log lines 26546–27271, raw archive: `raw/xau_watchdog_raw_2026-07-09_1256.log`)

- Still **v6.20.2** (build tag now `v6202-command-safety-force-controls-20260709` — a new build label, no functional discontinuity observed).
- **Price bounced back up**: a new BUY `TREND_PULLBACK` setup appears with `signalPrice=4101.86` (12:35–12:40) — meaning price recovered off the ~4094–4099 low back to ~4101–4102. Net effect: over the full 5-hour window price has now round-tripped **4103 (start) → 4115.77 (peak, 09:25) → ~4094 (trough, 12:00) → ~4102 (12:40)** — essentially flat start-to-now with a ~21-point swing in between.
- This new BUY setup was blocked by `TREND-CONTINUATION MODE: qualification failed` + `BAD-RR TRUE BLOCK` (tcmScore=50 vs minScore=72, poor remaining room after the move already travelled), then **explicitly re-attempted as a RECOVERY at 12:45** (`DIRECTION_QUALITY | ... RECOVERY of missed signal ...`) — and the recovery was **also blocked** (`WhyChosenDirection=N/A — blocked, see reason`). This is the exact recovery mechanism flagged as risky after Checkpoint 4 — this time it did NOT result in an execution, so no repeat of the 2026-07-08 loss pattern (yet).
- The two SELL setups stored at 11:55/12:00 (signalPrice 4096.46 A+, 4098.77 A) were **not** recovered/executed in this window either.
- **`regime=TREND_UP` printed on every single decision cycle from 07:47 through 12:55 — the entire 5-hour, 8-minute window — with zero exceptions**, confirming the regime-staleness finding as a robust, reproducible pattern rather than a one-off.
- No trades opened or closed. No indicator-retry ceiling breaches. No errors.

---

## Final compiled report (07:47–12:55 WAT, ~5h 8min)

**Account:** 108492408 (MetaQuotes-Demo, paper/demo — not a funded live account). **Versions covered:** v6.20.0 (07:47–12:20) → v6.20.2 (12:20–ongoing), auto-updated mid-audit with no behavioral discontinuity observed. **Headline result: zero trades opened or closed in the entire window.**

#### 1. Decision-cycle summary (62 evaluations total)

| Outcome | Count | % |
|---|---|---|
| No setup formed at all (`dir=NONE`) | 40 | 65% |
| Setup formed but below combined-score threshold (`grade=SKIP`) | 6 | 10% |
| Setup passed score gate → became a real `CANDIDATE`, blocked one layer deeper | 16 | 26% |
| **Executed** | **0** | **0%** |

#### 2. The 16 real candidates (score-qualified, blocked at entry-timing/quality/confirmation layer)

| # | Time (wall) | Candle (broker) | Setup | Dir | Grade | Score (raw/comb) | Blocker | Price context |
|---|---|---|---|---|---|---|---|---|
| 1 | 08:15 | 10:15 | TREND_PULLBACK | BUY | B | 3.5/3.77 | CALIBRATED_ENTRY_QUALITY (failed-impulse, HARD) | entry 4101.38, signal 4103.00 |
| 2 | 08:20 | 10:20 | TREND_PULLBACK | BUY | B | 3.5/3.77 | BAD-LOCATION (too close to high, SOFT) | entry 4104.50, missed +1.50 |
| 3 | 08:25 | 10:25 | TREND_PULLBACK | BUY | B | 3.5/3.77 | BAD-LOCATION (SOFT) | entry 4105.70, missed +2.70 |
| 4 | 09:00 | 11:00 | TREND_PULLBACK | BUY | B | 3.5/3.77 | CALIBRATED_ENTRY_QUALITY (late-chase-entry, HARD) | entry 4107.88, missed +4.88 |
| 5 | 09:25 | 11:25 | TREND_PULLBACK | BUY | B | 3.5/3.77 | TREND-CONTINUATION MODE (qualified but still gated, HARD) | entry 4115.77 — **the peak**, missed +12.77 |
| 6 | 09:35 | 11:35 | TREND_PULLBACK | BUY | B | 3.0/3.45 | CALIBRATED_ENTRY_QUALITY (late-chase-entry, HARD) | entry 4110.38, missed +7.38 (post-peak, already retracing) |
| 7 | 11:10 | 13:10 | TREND_PULLBACK | BUY | A | 5.5/5.08 | CALIBRATED_ENTRY_QUALITY (failed-impulse, HARD) | signal 4107.45, entry 4106.88 |
| 8 | 11:15 | 13:15 | TREND_PULLBACK | BUY | A | 5.5/5.08 | CALIBRATED_ENTRY_QUALITY (failed-impulse, HARD) | entry 4105.04 |
| 9 | 11:20 | 13:20 | TREND_PULLBACK | BUY | A | 5.5/5.08 | TREND-CONTINUATION MODE (qualification failed) | entry 4105.06 |
| 10 | 11:25 | 13:25 | TREND_PULLBACK | BUY | A | 5.5/5.08 | CALIBRATED_ENTRY_QUALITY (failed-impulse, HARD) | entry 4104.92 |
| 11 | 11:30 | 13:30 | TREND_PULLBACK | BUY | A | 5.5/5.08 | CALIBRATED_ENTRY_QUALITY (failed-impulse, HARD) | entry 4104.31 |
| 12 | 11:35 | 13:35 | TREND_PULLBACK | BUY | A | 5.5/5.08 | TREND-CONTINUATION MODE (qualification failed) | entry 4104.62 — setup expired next candle |
| 13 | 11:55 | 13:55 | **BREAKOUT** | **SELL** | **A+** | 5.9/**8.43** (highest of audit) | SMART-GUARD (fast-TF disagreement) | signal 4096.46 — near the eventual trough |
| 14 | 12:00 | 14:00 | TREND_PULLBACK | SELL | A | 4.4/5.10 | SMART-GUARD (fast-TF disagreement) | signal 4098.77 |
| 15 | 12:35 | 14:35 | TREND_PULLBACK | BUY | A | 4.0/4.10 | (forming) | early stage |
| 16 | 12:40 | 14:40 | TREND_PULLBACK | BUY | A | 5.5/5.08 | TREND-CONTINUATION MODE + BAD-RR, then explicit RECOVERY attempt at 12:45 also blocked | signal 4101.86 |

#### 3. Correct vs. wrong block — episode verdicts

- **Episode A (rows 1–6, the 4103→4115.77 BUY chase, ~08:00–09:35):** Price kept extending in the bot's favor while every attempt was blocked (first on quality/location, later on late-chase-entry). *At the time*, this read as a clear miss. **By Checkpoint 5, price has fully round-tripped back to ~4102** — so whether this was ultimately a **CORRECT_BLOCK** or a **missed partial profit** depends entirely on where a real SL/TP would have sat (never logged, since nothing executed). Rows 1–4 (entries 4101–4108) are **genuinely ambiguous** — a realistic TP inside the +10–15pt zone could have banked profit before the reversal. Rows 5–6 (entries 4110–4116, chasing near/at the peak) look like **CORRECT_BLOCK** — those would very likely be underwater now.
- **Episode B (rows 7–12, the Grade-A "failed-impulse" BUY cluster, 11:10–11:35):** Setup expired right as price kept fading toward the 4094–4099 low. **CORRECT_BLOCK** — high confidence.
- **Episode C (rows 13–14, the two SELL setups, 11:55–12:00):** Price did fall a little further (to the ~4094–4099 trough shortly after) then **bounced back to ~4101–4102** by 12:35–12:40. Net: the SELL bias was directionally right for a short stretch but would likely have been sitting near breakeven-to-small-loss by now depending on entry/exit timing. Best read: **CORRECT_BLOCK-leaning, not clear-cut**.
- **Episode D (row 16, the 12:35–12:45 BUY + explicit recovery attempt):** Too recent to score — flagged for next checkpoint.

**Tally: 0 confirmed WRONG_BLOCK, 2 confirmed/likely CORRECT_BLOCK (Episodes B and C), 1 genuinely ambiguous (Episode A rows 1–4), 1 too-recent-to-call (Episode D).** No trade, blocked or executed, has yet produced a clear "the bot should have taken this and made money" case in this audit.

#### 4. Top blockers by frequency (62 decision cycles)

1. **No setup met regime criteria** — 40/62 (65%) — market simply didn't offer a qualifying structure most of the time.
2. **CALIBRATED_ENTRY_QUALITY / BAD-LOCATION** (entry-timing/quality layer) — 7/62 (11%) — the single biggest source of blocked *real* candidates (7 of 16).
3. **TREND-CONTINUATION MODE qualification failure** — 7/62 (11%) — second-biggest blocker of real candidates.
4. **Combined-score < 3.0 threshold** — 6/62 (10%) — filters out weak setups before they become candidates.
5. **SMART-GUARD (fast-timeframe disagreement)** — 2/62 (3%) — both were the SELL-side setups in Episode C.

Together, entry-timing/quality and trend-continuation gates account for **14 of the 16 real candidates (87.5%)** — these two gates, not the score threshold, are doing almost all of the actual trade-prevention work once a setup is good enough to matter.

#### 5. Top blockers by missed profit

**None confirmed.** The two clearest episodes (B, C) both look like correct blocks in hindsight. Episode A is the only open question, and even there the picture is mixed (early entries ambiguous, late-chase entries clearly correct to block). No blocked candidate has produced an unambiguous "this would have been a clean winner" case.

#### 6. "Should have traded" examples

None confirmed this window. Closest candidate is Episode A rows 1–4 (ambiguous, not confirmed).

#### 7. "Should have switched direction" examples

**None where the bot got it wrong.** Notably, the system's `ADAPTIVE-DIRECTION` logic *did* correctly detect the reversal from bullish to bearish structure around 11:55–12:00 and switched to offering SELL candidates (Episode C) — the switch itself was right, it just didn't clear the SMART-GUARD confirmation gate. Unlike the 2026-07-08 audit's flagship finding (a stale/demoted signal recovered on the wrong side right as the market turned), no such wrong-side recovery has occurred here — the direction logic and the (still-pending) SELL setups have so far stayed on the correct side of the move.

#### 8. Scan / watchdog / indicator problems

- **`INDICATOR_TRANSIENT_4807` self-healing retries**: occurred at essentially every new M5 bar boundary throughout the window (hundreds of occurrences), worst single burst 29/30 before an automatic `INDICATOR_REBUILD` cleared it. **Never once hit the 30/30 ceiling.** Same pattern as the 2026-07-08 audit — confirmed stable, non-escalating, not a live problem.
- **No scan stalls, no restarts (other than the clean v6.20.0→v6.20.2 auto-update at 12:20:47), no missed-scan gaps** — unlike the 2026-07-08 audit, no position was ever open in this window, so the "no scanning while managing a position" question from that audit simply didn't get tested here (there was nothing to manage).
- **Headline finding — regime-classifier staleness:** `regime=TREND_UP` was printed on **all 62 decision cycles across the full 5h8m window**, without exception, even while: `ADAPTIVE-DIRECTION` cycled STRONG BUY → STRONG SELL → TRANSITION_WAIT → BOTH_ALLOWED; `htfBias` stayed -1 (bearish) throughout; and price completed a full ~21-point round trip (4103→4115.77→~4094→~4102). The EA's finer-grained structure/direction logic clearly tracked the chop correctly — the coarse `regime` label did not move at all. This looks like a genuine code-level bug or an intentionally very-slow-to-update classifier; worth a direct look at the regime-detection function and a comparison against this project's existing `audits/xau_direction_recognition_latency_audit_2026-07-07_to_2026-07-08.md`, which may already document the same root cause.

#### 9. Code-level fix recommendations (not implemented — pending decision)

1. **Investigate `regime` classifier staleness.** This is the strongest, most reproducible finding in the audit: a coarse-grained field that never updated across a full reversal cycle, while other parts of the same EA (ADAPTIVE-DIRECTION, HTF bias) tracked it correctly. If other gates key off `regime` (several of the blocking messages reference `Regime:TREND_UP` directly in their text), a stale regime tag could be silently mis-informing those gates even when the direction/confirmation layers are working right.
2. **Calibration question, not a bug: entry-timing/quality gates (CALIBRATED_ENTRY_QUALITY + TREND-CONTINUATION MODE) blocked 14 of 16 real candidates (87.5%) across a 5-hour session that netted to roughly flat.** Given the outcome — zero losses, zero profits, mostly correct blocks — this could be working exactly as intended (a conservative filter correctly sitting out a choppy, directionless session). Worth a product decision, not a code fix: is this the desired behavior in genuine chop, or should the gates loosen when a Grade-A/A+ setup (rows 5, 7–12, 13) repeats across multiple consecutive candles without qualifying?
3. **Watch the recovery-execution path.** Two SELL setups (rows 13–14) and one BUY setup (row 16, already recovery-attempted once) remain in blocked-memory. The 2026-07-08 audit's only loss came from exactly this path being honored without checking whether the opposite side had gained ground. So far in this audit no recovery has executed — keep tracking.

None of these are logging/telemetry gaps — everything needed to reconstruct this audit was already in the log. No code changes have been made.

_(This section will keep extending as monitoring continues past the 5-hour mark, until the user says stop.)_
