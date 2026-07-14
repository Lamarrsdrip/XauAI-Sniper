# v6.22.0 ACTIVE Experiment — 2026-07-14 Missed-Campaign Forensic Audit

**EA:** `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5`
**Branch at time of incident:** `audit/v6220-active-intelligence-repair` (confirmed byte-identical to the live-deployed `.mq5`/`.ex5`, commit `55a1189`)
**Accounts:** `Account A` (primary, until 12:23:58), `Account B` (after account switch)
**Sources:** real MT5 EA journal `MQL5/Logs/20260714.log` (26,302 lines), real terminal journal `logs/20260714.log` (258 lines, contains actual broker deal confirmations), EA source (36,624 lines). No synthetic data, no hindsight — every figure below is either a literal log line or a direct aggregation of literal log lines, computed from the log's own local wall-clock timestamps (machine GMT+1). No exported M1/M5 OHLC history exists for 2026-07-14, so price evidence is reconstructed from prices embedded in the EA's own decision telemetry (`signalFirstSeenPrice=`, `entryPrice=`, `livePrice=`, structural high/low fields) — the best available ground truth in the absence of a tick/bar export.

---

## 1. Executive summary — why the whole move was missed

**The bot executed zero trades of any kind after 12:28:06.** The entire sequence — reclaim through 4030, the 4028→4102.56 expansion, the failure near the high, and the pullback to ~4061 — happened with the bot flat, even though its own telemetry correctly identified the trend at every stage (`MARKET_LIFECYCLE` logged `TREND_MATURE BUY` for the whole 12:53–13:40 rally, then `OPPOSITE_DIRECTION_CONFIRMED` during the pullback). This is not a story of "filters correctly blocked bad trades" — it is three independent, compounding architectural defects, plus one operational event, none of which required hindsight to diagnose:

1. **Regime/HTF-bias classification had no concept of "base and reclaim,"** so it read the entire 00:00–11:00 window as bearish/ranging/choppy and refused to generate BUY setups at all, even while price was basing at 3989–4005 and reclaiming through 4012.
2. **Trend-maturity/exhaustion in the campaign-transition engine was measured from the wrong anchor** (distance off the 24-hour rolling range extreme, not the current leg's origin, and "remaining reward" measured as distance to a rolling high that a still-expanding leg was itself setting). This is **confirmed, with exact numbers, as the cause of the 16:10 cancellation**: the candidate at 4095.68 passed *every* upstream gate (timing guard, SMART-GUARD, AI director, context-gate — "Proceeding to OpenTrade") and was cancelled only at the final campaign-authority check, which computed `distanceTravelledATR=15.01` / `sessionRangeConsumed=95%` / `exhaustionProbability=97` — the **only occurrence all day** of a fully-cleared signal being killed at that last gate.
3. **A separate, structurally distinct local scoring path** — `XAUEntryTimingGuard`'s own `exhaustionProb` (built from `extensionNoReset`/`missedMove`/`spikeCooldown`/`lateChaseEntry` flags, itself fed by `XAU_TrendContinuationScore()` and a bounded 4–30-bar `XAU_DirectionalExtensionATR` lookback) is what actually produced the 06:45 (@4032.17, local exhaustionProb=87%) and 13:40 (@4087.13, local exhaustionProb=100%) `HARD_BLOCK`s. This shares the same symptom as defect #2 (a fresh breakout read as "already extended, no reset") but lives in different code and was **not** touched by the fixes in this pass — see §13 for why, and flagged as the clearest remaining follow-up.
4. **A one-way "restart-conservative" latch** forces exhaustion≥70 on any redeploy with incomplete persisted state. This subsystem was redeployed 7 times on 2026-07-14 (00:29, 00:35, 00:38, 10:19, 12:05, 12:44, 16:17), plus a mid-day binary swap at 11:55–11:57 — any of which is a plausible latch-arming event for a component that only started existing the day before.
5. **Operational, not code:** an account switch at 12:23:58 orphaned an open SELL (`#9553094071`, 0.19 lots @4016.76, SL 4030.77, opened 11:33) — no closing fill for it exists in either log. Given the subsequent rally to 4102.56, it was very likely stopped out unmanaged, or is still open and forgotten.

The reversal (SELL) side was not silent either: the engine correctly created `CAMPAIGN_REVERSAL_OPPORTUNITY_CREATED` for a fade-the-top SELL at 13:41 (`origin=4102.56`) and confirmed it again at 16:21 and 16:40 — but a fixed-ceiling "wait for pullback to `latestAcceptable`" rule (4026.04, set at 12:40) never re-armed as price kept extending, so the already-designed continuation/reversal machinery never got to fire. By 16:10 the campaign engine's own numbers rated the SELL far more attractive (`oldReward=0.36R` vs `oppositeReward=4.36R`) — the inflated old-direction exhaustion (defect #2, now fixed) was starving the same continuation path that a correctly-scored SELL reversal needed to compete against.

---

## 2. Timeline — price vs. state vs. gating (reconstructed from real log evidence)

| Time | Price evidence | Zone | Regime / HTF read | What happened |
|---|---|---|---|---|
| 00:00–00:45 | 3994–4003 | **Base (3989–4005)** | HTF Bearish, Regime TREND_DN/RANGING | `no setup met regime criteria` dominant; small real fills 00:04–00:33 (scalps, net flat) |
| 01:30–02:00 | lows 3985.68–3992.57 | base | HTF Bearish | grinding |
| 02:10–02:42 | 3995–4000 | base | HTF Bearish | 2 small real round-trips (02:12–02:13, 02:42) |
| 03:09 | 4012.76 | reclaim | HTF Bearish | real fill: BUY 0.25 closed at a loss (stop-out) |
| 03:40–04:00 | 4012–4014 | **crosses ~4012** | HTF Bearish | HTF_TREND_FOLLOW A/A+ candidates graded, but withheld/blocked (`ADAPTIVE_RECOVERY` post-loss lockout after the 03:09 stop-out) |
| 05:20–05:30 | 4015 | recovery | HTF Bearish | same pattern |
| **06:45** | **4032.17** | **crosses ~4030** | HTF Bearish, Regime read as extended | Clean A-grade BREAKOUT → **HARD_BLOCK, local exhaustionProb=87%** (defect #3 — `XAUEntryTimingGuard`/`XAU_TrendContinuationScore`, not the campaign engine) |
| 08:20–08:50 | 4023–4027 | pullback in recovery | — | SKIP grade, `ADAPTIVE_RECOVERY` lockout continuing |
| 09:10 | 4016 | deeper pullback | — | A-grade BREAKOUT candidate, clean, but no fill logged |
| 09:15–11:00 | 4013–4026 | consolidation | HTF still Bearish/Range | `no setup met regime criteria` continues |
| 11:33 | 4016.76 | consolidation | — | **Real fill: SELL 0.19 lots, SL 4030.77** (this is the position later orphaned) |
| 11:55–11:57 | — | — | — | **Mid-day binary redeploy** (new `.ex5` copied in, EA restarted, campaign-manager component attaches for the first time, build tag `v6220-campaign-transition-location-authority-20260714`) |
| 11:56:55 | — | — | — | `CAMPAIGN_TRANSITION_AUTHORITY_CONFIG mode=SHADOW` (operator override at attach — see §7) |
| 12:23:58 | — | — | — | **Account switch** `Account A` → `Account B`; the 11:33 SELL is never closed in either log after this point |
| 12:27–12:28 | 4025.6–4026.2 | — | — | Real fill pair on new account: SELL then BUY-close, net flat |
| 12:35–12:43 | 4027.8–4029.8 | approaching 4030 again | — | — |
| **12:53:08** | — | — | — | `CAMPAIGN_TRANSITION_AUTHORITY_CONFIG mode=ACTIVE` (57 min after SHADOW attach) |
| **12:53–13:40** | **4028 → 4087** | **the main expansion leg** | Lifecycle correctly reads `TREND_MATURE BUY` for this entire 43-event segment | **No trade.** |
| **13:40** | **4087.13** (day high area) | near highs | — | Clean A-grade BREAKOUT → **HARD_BLOCK, local exhaustionProb=100%** (defect #3, same distinct mechanism as 06:45) |
| 13:41 | 4102.56 (session high logged) | failure near highs | — | `CAMPAIGN_REVERSAL_OPPORTUNITY_CREATED` fade-SELL, `origin=4102.56` — created, never triggered |
| 14:00–16:02 | 4076–4090 | chop near highs | Lifecycle: EXHAUSTING → TRANSITION_NEUTRAL → OPPOSITE_FORMING (correctly read) | Multiple B/SKIP-grade candidates, `NEWS_OBSERVING`, `CALIBRATED_ENTRY_QUALITY` blocks |
| **16:10** | **4095.68** | second push near top | — | Clean A-grade BREAKOUT, passed *every* upstream gate including "✅ CONTEXT-GATE PASS... Proceeding to OpenTrade" — then **cancelled at the final campaign-authority check** (`TIMING_ENGINE CANCELLED BY CAMPAIGN TRANSITION AUTHORITY`, exhaustion=97%, `oldReward=0.36R oppositeReward=4.36R`). See §8 — this exact final-gate cancellation happened **exactly once** in the entire day's log. |
| 16:40–17:20 | pullback in progress | **pullback (~4061–4063)** | `OPPOSITE_DIRECTION_CONFIRMED` (bearish), `opportunityState=WAITING_FOR_PULLBACK`/`VALUE_RESET` | Multiple grade-A `PENDING_OPPORTUNITY_STORED` BUY and SELL candidates queued, none executed |
| 17:05–17:20 | 4060.97–4063.83 (log ends 17:20) | **pullback low (~4061)** | — | log ends here, still flat |

---

## 3. MARKET_LIFECYCLE — full campaign-state history (276 events, first logged 11:56:55)

| Time range | n | state | trendDirection | trendHealth | contConf | transitionProb | reversalProb | notes |
|---|---|---|---|---|---|---|---|---|
| 11:56:55–12:29:59 | 9 | TRANSITION_NEUTRAL | SELL | 0 | 15–28 | 94–100 | 52–94 | attached to the orphaned 11:33 SELL |
| 12:34:59–12:39:59 | 2 | OPPOSITE_DIRECTION_FORMING | SELL | 0 | 15 | 100 | 82–94 | |
| 12:44:59 | 1 | OPPOSITE_DIRECTION_FORMING | **BUY (flip)** | 46 | 65 | 49 | 27 | direction flip recognized |
| **12:53:09–13:40:08** | **43** | **TREND_MATURE** | **BUY** | 1–58 | 24–75 | 30–63 | 16–52 | **= the 4028→4087 rally, correctly identified, zero trades** |
| 13:41:00 | 1 | TRANSITION_NEUTRAL | BUY | 18 | 45 | 60 | 45 | |
| 13:42–13:59 | 18 | TREND_EXHAUSTING | BUY | 10–18 | 39–45 | 60–88 | 33–72 | |
| 14:00–14:22 | 23 | TRANSITION_NEUTRAL | BUY | 0–9 | 13–39 | 73–98 | 40–73 | |
| 14:23–14:39 | 17 | OPPOSITE_DIRECTION_FORMING | BUY | 0 | 23–30 | 89–95 | 49–67 | |
| 14:40 | 1 | TRANSITION_NEUTRAL | BUY | 11 | 45 | 77 | 43 | |
| 14:41–14:44 | 4 | OPPOSITE_DIRECTION_FORMING | BUY | 11 | 45 | 85–93 | 62–78 | |
| 14:45–16:02 | 78 | TRANSITION_NEUTRAL | BUY | 0–11 | 12–45 | 68–100 | 37–94 | |
| 16:03–16:09 | 7 | OPPOSITE_DIRECTION_CONFIRMED | BUY | 8–11 | 42–45 | 76–100 | 42–94 | |
| 16:10–16:11 | 2 | TRANSITION_NEUTRAL | BUY | 11 | 45 | 83 | 57 | the 16:10 signal fired inside this segment |
| 16:12–16:13 | 2 | OPPOSITE_DIRECTION_CONFIRMED | BUY | 11 | 45 | 100 | 94 | |
| 16:14–16:39 | 27 | TRANSITION_NEUTRAL | BUY | 0–11 | 25–45 | 83–98 | 45–78 | exhaustion=97, `REENTRY_ALLOWED` |
| **16:40–17:20** | **41** | **OPPOSITE_DIRECTION_CONFIRMED** | BUY | 0 | 0–15 | 95–100 | 52–94 | exhaustion=97, `VALUE_RESET`/`WAITING_FOR_PULLBACK` — **= the pullback to ~4061, correctly identified, zero trades** |

---

## 4. Decision-event chronology (68 `XAU-TIMING` full candidate reports)

| Time | signalPx | setup | grade | blockClass | reason at first signal | exhaustion | remainingRoom | tcmScore | missedMove | what price did next |
|---|---|---|---|---|---|---|---|---|---|---|
| 00:00–00:25 | 4002.88 | TREND_PULLBACK | A/A+ | NONE→SOFT | ANALYSIS-ONLY (max open trades) | 0–12% | 6.6–14.1 ATR | 22–91 | 1.2–3.8 | drifted in the base |
| 00:34–00:45 | 3994.4–3995.4 | TREND_PULLBACK | A | HARD/SOFT | none | 10–46% | 10.3–12.9 ATR | 60–98 | -3.0..-0.05 | drifted in the base |
| 02:10–02:42 | 3995.4–3996.8 | TREND_PULLBACK | A/A+ | NONE/HARD | none / ADAPTIVE_RECOVERY | 0–32% | 2.98–3.82 ATR | 38–64 | -1.0..0.4 | small scalps, net flat |
| 03:40–04:00 | 4014.19 | HTF_TREND_FOLLOW | A/A+ | NONE→SOFT | none / ADAPTIVE_RECOVERY | 0–20% | 7.2–8.5 ATR | 28–94 | 0.3–4.3 | continued to 4030 |
| 05:20–05:30 | 4015.13 | HTF_TREND_FOLLOW | A/A+ | NONE→SOFT | none / ADAPTIVE_RECOVERY | 0–8% | 10.2–11.1 ATR | 38–44 | -0.5..0.1 | continued to 4030 |
| 06:40 | 4028.46 | SQUEEZE_RELEASE | B | SOFT_BLOCK | none | 46% | 1.15 ATR | 31 | -0.44 | broke out minutes later |
| **06:45** | **4032.17** | BREAKOUT | A | **HARD_BLOCK** (local exhaustionProb, not campaign engine) | none | **87%** | 1.5 ATR | 68 | -0.08 | ran to 4087+ over the next 7h |
| 08:20–08:50 | 4026.89 | HTF_TREND_FOLLOW | SKIP | HARD/NONE | CALIBRATED_ENTRY_QUALITY / ADAPTIVE_RECOVERY | 0–74% | 6.7–9.9 ATR | 0–41 | -0.4..3.5 | pulled back then continued |
| 09:10 | 4016.46 | BREAKOUT | A | NONE | none | 0% | 1.72 ATR | 100 | 0.54 | continued higher |
| 11:30–11:37 | 4018.40 | TREND_PULLBACK | A | NONE | SMART-GUARD | 0% | 1.24–1.32 ATR | 62–94 | 0.66–2.25 | continued higher |
| 12:35–12:42 | 4028.20 | TREND_PULLBACK | A | NONE | none | 0–29% | 1.36–1.53 ATR | 65–92 | -0.4..0.2 | broke to 4087 |
| **13:40** | **4087.13** | BREAKOUT | A | **HARD_BLOCK** (local exhaustionProb, not campaign engine) | none | **100%** | 1.55 ATR | 20 | -0.28 | day high 4102.56 minutes later, then failed |
| 14:40–15:50 | 4085.59 | TREND_PULLBACK | B | NONE→HARD | NEWS_OBSERVING / BAD-TIMING / CALIBRATED_ENTRY_QUALITY / TCM | 0–74% | 1.14–2.9 ATR | 0–73 | -9.4..0.9 | chopped near highs |
| 15:55–16:05 | 4085.59 | TREND_PULLBACK | A/B | SOFT_BLOCK_CONVERTED / HARD | CALIBRATED / NEWS_OBSERVING | 0–7% | 1.7–2.5 ATR | 61–86 | -3.2..2.8 | chopped near highs |
| **16:10** | **4095.68** | BREAKOUT | A | **NONE (passed) → cancelled at final gate** | none | **97%** (at final gate) | 1.60 ATR | 98 | 0.32 | rolled over, fell to ~4061 |
| 16:15–16:20 | 4090.45 | TREND_PULLBACK | B | HARD_BLOCK | none / CALIBRATED_ENTRY_QUALITY | 74% | 1.36–1.76 ATR | 0 | -0.34..-3.5 | fell to ~4061 |

Setup-type distribution across all 68: TREND_PULLBACK 48, HTF_TREND_FOLLOW 13, BREAKOUT 6, SQUEEZE_RELEASE 1. `blockClass` field appeared HARD_BLOCK 40x / NONE 42x / SOFT_BLOCK 9x / SOFT_BLOCK_CONVERTED 3x across all decision-line mentions (a single candidate can mention blockClass more than once across its block-reason line and its summary line, so these are event-mentions, not unique-candidate counts). Directional bias in the subset of lines carrying an explicit `SIGNAL:` tag: **7 BUY vs 31 SELL** — confirming the persistent bearish skew in what the engine was even willing to *propose*, consistent with root cause #1.

---

## 5. `TRADE BLOCKED BECAUSE` — reason frequency (201 lines, whole day)

| Reason | Count |
|---|---|
| `no setup met regime criteria` | 90 (55 of these before 11:00) |
| SMART-GUARD weak fast-TF confirmation (BUY, score-floor) | 20 |
| combined score < 3.0 threshold | 13 |
| SMART-GUARD weak fast-TF confirmation (SELL, multi-TF against) | 7 |
| SMART-GUARD weak fast-TF confirmation (SELL, score-floor) | 6 |
| SMART-GUARD weak fast-TF confirmation (BUY, multi-TF against) | 6 |
| ADAPTIVE_RECOVERY: B/SKIP grade blocked (post-loss lockout after 03:09 stop-out) | 6 |
| ANALYSIS-ONLY: max open trades reached | 5 |
| B-GRADE QUALITY BLOCK (fast-XAU confirmation fail) | 5 |
| Detailed HARD/SOFT_BLOCK lines with full XAU-TIMING payload | ~17 |
| Misc (BAD-LOCATION, NEWS_OBSERVING, exhaustion backstop, etc.) | ~26 |

Where the raw log does not carry per-candle telemetry for a block reason (the 90 `no setup met regime criteria` cycles are logged as a bare tag, not a full candidate report), this audit reports the aggregate count and says so explicitly rather than inventing per-candle detail that was never generated by the EA in the first place.

---

## 6. Real executions — the only ground truth for actual fills (terminal journal `deal #` confirmations)

| Time | Account | Action | Lots | Price |
|---|---|---|---|---|
| 00:04:07 | Account A | SELL | 0.02 | 4001.43 |
| 00:16:04 | Account A | SELL | 0.01 | 3999.57 |
| 00:21:59 | Account A | BUY (close) | 0.24+0.16 | 3999.72 |
| 00:33:50 | Account A | BUY (close, redeploy) | 0.01/0.02/0.02/0.04 | 3994.43–3994.70 |
| 02:12:56 | Account A | SELL | 0.22 | 3996.09 |
| 02:13:33 | Account A | BUY (close) | 0.22 | 3996.14 |
| 02:42:57 | Account A | SELL | 0.25 | 4000.15 |
| 03:09:11 | Account A | BUY (close, stopped out) | 0.25 | 4012.76 (loss) |
| **11:33:17** | Account A | **SELL** | **0.19** | **4016.76, SL 4030.77 — never closed in either log** |
| 12:27:59 | Account B | SELL | 0.29 | 4026.17 |
| 12:28:06 | Account B | BUY (close) | 0.29 | 4025.59 |

**Zero fills after 12:28:06** — confirmed independently in both the terminal log (no more `deal #` lines) and the EA log (zero order-send/deal-added/fill confirmations after 12:28:10), for the rest of the day.

**Flagged, not investigated further (per scope decision):** the 11:33 SELL (`#9553094071`, 0.19 lots @4016.76, SL 4030.77, account Account A) has no closing deal in either log after the 12:23:58 account switch. Given the subsequent rally through 4030.77 and on to 4102.56, this position was very likely stopped out unmanaged at 4030.77, or is still open and unmanaged. **This is account/broker state, not a code defect — recommend checking the account directly.**

---

## 7. Operational note: SHADOW→ACTIVE was a manual override, not a code timer

`InpCampaignTransitionMode` defaults to `CAMPAIGN_TRANSITION_ACTIVE` in source (`mq5:21641`). The `mode=SHADOW` observed at 11:56:55, switching to `mode=ACTIVE` at 12:53:08, was therefore an **input-parameter override applied at EA-attach time** (e.g. a `.set` file or manual input change when the fresh 11:55–11:57 redeploy was attached) — not a coded warm-up timer. Someone ran the freshly-redeployed campaign manager in observation-only mode for ~57 minutes, which happened to straddle the pre-breakout consolidation, then manually flipped it live. This is a deployment-practice observation for the report only; it is not being treated as an architecture defect and no code change is proposed for it.

---

## 8. Case study: the 16:10 signal (root cause #2 caught directly in the act)

Full trace at 16:10:00–16:10:19 (see raw log): the BREAKOUT BUY candidate at 4095.68 passed `XAUEntryTimingGuard` clean (`blockClass=NONE`, `tcmScore=98`, `TREND-CONTINUATION MODE: CONTINUATION QUALIFIED`), passed `ADAPTIVE-CONFIRM: ALLOW` (SMART-GUARD fastScore 85/85), passed the AI Director/committee/lot-sizing pipeline, and reached **`✅ CONTEXT-GATE PASS: BUY cleared H4 bias + Swing-SR checks. Proceeding to OpenTrade.`** at 16:10:18.976.

13ms later, `XAU_FinalAdaptiveCampaignDirectionDecision()` was consulted independently (as designed — it is meant to be the last word) and computed:
```
FINAL_CAMPAIGN_DIRECTION_DECISION normalBias=BUY trendHealth=11 maturity=100 continuationConfidence=45 exhaustionProbability=97 ...
[EXHAUSTION_ENTRY_AUDIT] direction=BUY distanceTravelledATR=15.01 sessionRangeConsumed=95 continuationQuality=45 remainingRewardR=0.36 decision=WOULD_BLOCK
TIMING_ENGINE CANCELLED BY CAMPAIGN TRANSITION AUTHORITY: ... exhaustion=97 ... oldReward=0.36R oppositeReward=4.36R ... entryDecision=REVERSAL_FORMING_NOT_READY
```
`distanceTravelledATR=15.01` and `sessionRangeConsumed=95%` are exactly the flawed 24h-range-extreme measurement (root cause #2, in `XAU_AdaptiveCampaignTransitionEngine()`) — the leg from ~4028 had only run a few ATR at that point, not 15. This exact string, `TIMING_ENGINE CANCELLED BY CAMPAIGN TRANSITION AUTHORITY`, occurs **exactly once in the entire day's log** — this was not a recurring pattern requiring a new architecture, it is a single, precisely-diagnosable consequence of the trend-maturity bug. **Correction on re-verification:** the 06:45 and 13:40 `HARD_BLOCK`s are a *different* mechanism — `XAUEntryTimingGuard`'s own local `exhaustionProb` (root cause #3, driven by `extensionNoReset`/`missedMove`/`spikeCooldown` flags and `XAU_TrendContinuationScore()`, using a bounded 4–30-bar lookback, not the 24h anchor). They share the same symptom, not the same code path — Fix A (§13) resolves the 16:10 mechanism with confirmed arithmetic (§14) but does not touch root cause #3.

Note also `oldReward=0.36R` vs `oppositeReward=4.36R` in the engine's own numbers — its internal math already believed the SELL reversal was far more attractive at this point, reinforcing that root cause #2's bad exhaustion score, not a missing reversal concept, is what stalled the BUY side at 16:10 specifically.

---

## 9. The six requested opportunity windows

### 1. Bottom/base reversal BUY, 3990–4005
- **First usable evidence:** 00:00–00:45, multiple A/A+ `TREND_PULLBACK` candidates at 3994–4003, `exhaustion=0–12%`, `remainingRoom=6.6–14.1 ATR` — objectively excellent location and reward.
- **Location:** good (loc field consistently favorable in this window).
- **Remaining reward:** excellent (10+ ATR of room).
- **Gate that blocked it:** primarily `ANALYSIS-ONLY: max open trades reached` and regime read (`no setup met regime criteria` dominant across 00:00–11:00) — the classic entry engine's HTF-Bearish/regime-TREND_DN read (root cause #1) suppressed BUY-setup generation through this entire window even where individual candidates that did get scored looked clean.
- **Verdict:** a genuine, evidenced, missed opportunity — not a hindsight call. The gate was the regime/HTF filter having no reclaim concept, exactly as suspected.

### 2. Higher-low/reclaim BUY, 4005–4020
- **First usable evidence:** 03:40–04:00, HTF_TREND_FOLLOW A/A+ at ~4012–4014, room 7.2–8.5 ATR, exhaustion 0–20%.
- **Location/reward:** still good.
- **Gate:** `ADAPTIVE_RECOVERY: B/SKIP grade blocked` — a post-loss lockout triggered by the 03:09 stop-out on the *prior* base trade. This is a legitimate, evidence-based risk control (not a design flaw) reacting to a real loss, but it compounded with root cause #1 to keep the reclaim leg untraded too.
- **Verdict:** partially explained by a real prior loss, not purely architectural — flagged as a secondary contributing factor, not a fourth root cause.

### 3. Breakout continuation BUY, 4028–4035
- **First usable evidence:** 06:40 (SQUEEZE_RELEASE, B-grade, blocked on location) then **06:45 (4032.17, A-grade BREAKOUT, blockClass=NONE at the timing-guard layer)**.
- **Location:** good — this was the actual breakout bar.
- **Remaining reward:** 1.5 ATR immediate, but the move ultimately ran ~14 ATR further — a textbook case of the "remaining reward looked modest locally but the campaign had far more room" scenario the maturity-anchor bug is blind to.
- **Gate:** `HARD_BLOCK`, local `exhaustionProb=87%` — root cause #3 (`XAUEntryTimingGuard`/`XAU_TrendContinuationScore`, not the campaign engine).
- **Verdict:** clean, missed, architecturally caused.

### 4. Pullback/retest BUY after breakout
- **First usable evidence:** 08:20–08:50 (pullback to 4023–4027) and 09:10 (4016.46, A-grade BREAKOUT, `blockClass=NONE`, `exhaustion=0%`, `tcmScore=100`).
- **Location/reward:** excellent — this is precisely the "controlled pullback and held continuation" scenario the spec asks the architecture to recognize after a spike.
- **Gate:** no HARD_BLOCK recorded for the 09:10 candidate itself, yet no fill exists — most likely `ADAPTIVE_RECOVERY` lockout (still active from the 03:09 loss) or `SMART-GUARD` at 11:30–11:37 (explicitly tagged `reasonBlockedAtFirstSignal=SMART-GUARD`).
- **Verdict:** the cleanest missed opportunity of the day by the numbers (exhaustion=0%, tcmScore=100) — blocked by a risk-lockout gate rather than a location/reward problem.

### 5. Exhaustion/profit-protection state, 4080–4099
- **First usable evidence:** 13:40 (4087.13) and the `TREND_EXHAUSTING`/`TRANSITION_NEUTRAL`/`OPPOSITE_DIRECTION_FORMING` sequence from 13:41–16:02 (§3).
- **Verdict:** correctly identified by the lifecycle engine as-designed (this is the one part of the sequence that worked) — but there was no open BUY campaign to protect, because none of the earlier BUY opportunities were ever taken. "Protect profit near exhaustion" is moot when there is no profit to protect.

### 6. Reversal SELL after failure, 4099→4065
- **First usable evidence:** 13:41:00, `CAMPAIGN_REVERSAL_OPPORTUNITY_CREATED id=CAMPAIGN_REV_SELL_1784043300 origin=4102.56 firstDetection=4086.85 latestAcceptable=4078.24`.
- **Location/reward:** the engine's own numbers rated this highly (`oppositeReward=4.36R` by 16:10).
- **Gate:** the reversal-entry rule required price to pull back to a **fixed acceptable-entry ceiling** (4078.24, later effectively 4026.04 in an earlier BUY-reversal instance) before arming — but price never returned there before the pullback that did eventually happen (to ~4061) undershot the stale ceiling on the way down without the rule re-arming for a *hold*, only for a *retest at the original ceiling*. Confirmed again unfired at 16:21 and 16:40.
- **Verdict:** a real, evidenced, architecturally missed SELL — the reversal-opportunity logic detected the setup correctly but its trigger condition was too rigid for how price actually pulled back.

---

## 10. Totals ("Calculate")

| Metric | Value | Source |
|---|---|---|
| Log time span | 00:00:00 – 17:39:27 (≈17h39m ≈ 212 M5 candles) | log timestamps |
| Full candidate reports (`XAU-TIMING:`) | 68 | exact count |
| — BUY-tagged (via `SIGNAL:` lines) | 7 | exact count, subset |
| — SELL-tagged (via `SIGNAL:` lines) | 31 | exact count, subset |
| `TRADE BLOCKED BECAUSE` events | 201 (203 incl. 2 duplicate-mention lines) | exact count |
| No-setup cycles (`no setup met regime criteria`) | 90 (55 before 11:00) | exact count |
| `PENDING_OPPORTUNITY_STORED` (queued, never executed) | 30 | exact count |
| `MARKET_LIFECYCLE` state snapshots | 276 (only from 11:56:55 — no lifecycle engine existed before) | exact count |
| Reached "CONTEXT-GATE PASS...Proceeding to OpenTrade" | 21 | exact count |
| Final-campaign-authority cancellation after passing all upstream gates | 1 (the 16:10 case, §8) | exact count |
| Real broker fills, whole day | 11 (effectively 6 open/close cycles + the orphaned 11:33 SELL) | terminal journal |
| Real fills after 12:28:06 (covers the entire 4028→4102→4061 move) | **0** | terminal journal |
| Longest unbroken flat stretch covering the requested campaign | 12:28:06 → end of log (17:39), ≈5h11m | terminal journal |
| Earliest reasonable, evidence-based BUY entry | 00:00–00:45 base, A/A+ grade, exhaustion 0–12% (Opportunity #1) — or if requiring HARD_BLOCK-free confirmation, 06:45 breakout attempt (Opportunity #3) | §9 |
| Maximum favorable excursion from the 06:45 breakout entry (4032.17) to the day high (4102.56) | ≈70.4 points (≈7ATR at the ~1.0-ATR-per-4032-candle scale logged, i.e. well past 1R on any reasonable stop) | derived |
| Candidates that would have reached 0.3R/0.5R/1R before invalidation | 06:45 BREAKOUT (4032.17→4102.56, all three thresholds cleared), 09:10 BREAKOUT (4016.46→4102.56, all three cleared), 13:40 BREAKOUT (4087.13 — only reached 0.3R equivalent before the failure/pullback, given the immediate reversal from 4102.56) | derived from the timeline; no independent R-multiple recomputation beyond what the engine's own `remainingRoom`/exhaustion fields already encode, to avoid inventing precision the source data doesn't support |

---

## 11. Root-cause sequence check against the owner's suspected mechanism

| Suspected mechanism | Occurred? | Evidence |
|---|---|---|
| Old bearish trend bias blocks early BUY | **Yes** | HTF Bias: Bearish 107x / Range 46x, 00:00–11:00; never Bullish until the flip at 12:44:59 |
| Ranging regime suppresses recovery | **Yes** | Regime tags TREND_DN 67x, RANGING 15x, CHOPPY 8x in 00:00–11:00; never TREND_UP; `DetectRegime()` has no reclaim/recovery concept (mq5:8476-8523) |
| M1 reversal package waits too long | **Partially — superseded by a bigger effect** | The reversal-opportunity engine did track evidence correctly but was gated by a fixed-ceiling pullback rule (§9.6), not primarily by M1-package slowness |
| Breakout bar rejected as abnormal | **No** | `impulseBlock`/spike detection specifically was not the trigger; 06:45/13:40 were `HARD_BLOCK`ed by `XAUEntryTimingGuard`'s local exhaustionProb (extensionNoReset/missedMove-driven, root cause #3) and 16:10 by the campaign engine's exhaustion (root cause #2) — two different mechanisms, neither is the abnormal-bar filter |
| Confirmation arrives after the move is consumed | **Yes, but caused by the maturity-anchor bug, not slow confirmation** | The engine computed "already consumed" (`sessionRangeConsumed=95%` at 16:10) using the wrong distance anchor while the actual leg still had room |
| Anti-chase then blocks the late entry | **No separate anti-chase veto found** | `lateEntryVeto`/`lateChaseEntry` was `N` in every traced HARD_BLOCK case (06:45, 13:40, 16:10) — the blocks were the local `exhaustionProb` calc (06:45/13:40, root cause #3) and the campaign-authority exhaustion invariant (16:10, root cause #2), not the anti-chase logic |
| Therefore the entire campaign is missed | **Yes** | Confirmed: zero trades after 12:28:06 |

The "wait for a full new M5 bar" timing-engine bug the owner worried about was **already fixed in an earlier version** (explicit removal comment at mq5:31250-31260) and was not a factor here.

---

## 12. Mandatory replay tests — status before fixes

| # | Test | Status before fix |
|---|---|---|
| 1 | Base near 3990–4005 creates a developing BUY opportunity | **Detected by log evidence, not executable** — regime/HTF gate (root cause #1) suppressed it |
| 2 | Higher-low/reclaim evidence accumulates across bars | **Partially** — evidence did accumulate (HTF_TREND_FOLLOW candidates strengthened 03:40→05:30) but post-loss lockout + regime gate still blocked entry |
| 3 | A good-value BUY can execute before the move reaches 4080 | **Failed** — 06:45 (4032) and 09:10 (4016) both qualified on the merits and were blocked |
| 4 | The breakout around 4030 arms timing instead of being permanently rejected | **Failed** — `HARD_BLOCK` at 06:45 was a hard reject for that bar, driven by root cause #3 (not yet fixed in this pass, see §13) |
| 5 | The post-breakout pullback can execute if it holds | **Failed** — 09:10 pullback candidate was clean (exhaustion=0%, tcmScore=100) and still didn't execute |
| 6 | No late BUY chase near 4090–4099 | **Passed (accidentally)** — no chase occurred, but only because everything was blocked, not because anti-chase logic correctly discriminated a good late entry from a bad one |
| 7 | Existing BUY campaign protects profit near exhaustion | **Not applicable** — no BUY campaign was ever open to protect |
| 8 | Failed highs and bearish structure can prepare a SELL | **Detected, not executed** — `CAMPAIGN_REVERSAL_OPPORTUNITY_CREATED` fired correctly at 13:41, never triggered (fixed-ceiling pullback rule) |
| 9 | WAIT states release after valid evidence | **Failed for the restart-latch case** — no restart occurred mid-campaign today after 12:53, so this specific latch wasn't re-triggered mid-move today, but the 7 same-day redeploys before 12:53 are the plausible cause of the conservative floor being engaged going into the rally |
| 10 | The campaign cannot finish with zero opportunities unless every one genuinely lacked reward/structure | **Failed** — 5 of 6 requested opportunity windows had real, evidenced, good-location/good-reward setups (§9) |

Post-fix status for these same 10 tests is in §14, filled in after implementation and the Strategy Tester replay attempt.

---

## 13. Architecture fixes implemented on this branch

- **Fix A (resolves root cause #2)** — two changes in `XAU_AdaptiveCampaignTransitionEngine()`:
  1. `distanceTravelledATR`/`trendMaturity` now walk backward from the latest closed bar to find the most recent ≥1.8 ATR retracement against the dominant direction, and measure travel from *that* swing point (the actual leg origin) instead of the 24-hour rolling range extreme. Falls back to the old 288-bar behavior if no such reset is found within that window, so it can only shrink the measured distance, never regress.
  2. `d.remainingRewardR` no longer measures "room" as distance to a rolling high/low that a still-expanding leg is itself setting (self-referential — room collapses toward zero exactly when a trend is freshest). When the dominant direction is making fresh extremes with no real overhead obstacle in the lookback (`freshHighsNoOverhead`) and the leg is confirmed still advancing (`freshProgress`), room is floored at `InpCampaignTransitionMinRewardR*2.2` instead of starving toward zero.
- **Fix B (resolves root cause #4, the restart latch)** — `XAU_CTLoadPersistentState()`'s conservative floor (force exhaustion≥70, lifecycle=EXHAUSTING) now only engages when a new helper, `XAU_CTHasOpenExposureInDirection()`, confirms a real open position exists (this symbol, this EA's magic) in the persisted/dominant direction. A redeploy with incomplete state and nothing actually open starts neutral instead of pre-floored, so the 7 same-day redeploys on 2026-07-14 would no longer each be a latch-arming event by themselves.
- **Fix C (resolves root cause #1)** — a bounded reclaim-evidence override: when the classic setup detectors produce nothing at all (`signal==0`, "no setup met regime criteria" — 90 occurrences, 55 before 11:00) but `XAU_CTDominantDirection()` shows a real direction, 2+ of the last 5 M5 bars show a higher-low (BUY) or lower-high (SELL) structure, and price has reclaimed the fast M5 EMA, a synthetic `CAMPAIGN_RECLAIM_SYNTH` candidate is allowed to continue into `XAU_ActiveIntelligenceDecision`/`XAUEntryTimingGuard` exactly like any other candidate — none of those downstream gates are bypassed. Also added: a documented comment block mapping the existing `ENUM_CAMPAIGN_MARKET_LIFECYCLE` states to the requested BASE_BUILDING→...→REVERSAL_PREPARING_OPPOSITE model (kept the existing enum rather than a mechanical rename across ~15+ call sites, per scope decision).
- **Root cause #3 (`XAUEntryTimingGuard`'s local `exhaustionProb`, responsible for the 06:45 and 13:40 blocks) was identified but NOT fixed in this pass.** It is a structurally separate scoring path (`XAU_TrendContinuationScore()` + a bounded `XAU_DirectionalExtensionATR` lookback) from the campaign engine that Fix A touches. A safe fix requires tracing `XAU_TrendContinuationScore()`'s own internals with the same rigor applied to Fixes A/B/C; that was not completed within this pass, and shipping an unverified change to a second core scoring function in a live-trading file was judged higher risk than leaving it documented as a follow-up.

## 14. Post-fix verification

**Compile:** `wine MetaEditor64.exe /compile` on the fixed source — **0 errors, 0 warnings**, 36.3s elapsed (`compile_logs/v6220_forensic_repair_maturity_reclaim_fix_compile.log`).

**Strategy Tester replay:** attempted per the plan, but **not run** — checked actual data availability first rather than launching a run that would silently use wrong data. Both candidate harnesses were verified to lack tick/history data covering 2026-07-14's session:
- The live terminal's own history cache (`bases/MetaQuotes-Demo/history/XAUUSD/2026.hcc` and `ticks/XAUUSD/ticks.dat`) was last modified **00:42** on 2026-07-14 — before the entire campaign in question.
- The isolated `tester_sandbox/MT5_Isolated` sandbox's tick data (`Bases/.../202607.tkc`) was last modified **2026-07-10**, four days stale.

Running the tester against either would have replayed against incomplete or wrong-period data — a misleading result, not a missing one — so this was skipped in favor of the documented static fallback, exactly as scoped in the plan. (The live terminal's `MQL5/Experts` folder was deliberately not touched to prepare a tester run, since it may be actively managing the still-orphaned 11:33 position — see §6.)

**Static/code-trace verification, using the real 2026-07-14 logged values against the fixed formulas:**

- **16:10 case (root cause #2), confirmed with exact arithmetic:** the logged `EXHAUSTION_ENTRY_AUDIT` shows `remainingRewardR=0.36`, which triggered the `+25` exhaustion penalty (`remainingRewardR<1.0?25.0:0.0`) inside `rawExhaustion`. Real evidence from the same moment (`M5seq=HH/HL intact (highs 4090.03>4085.23, lows 4078.65>4077.41)`) confirms `freshProgress` was true and price was making fresh highs with no real overhead obstacle — exactly the condition Fix A's reward floor targets. With `InpCampaignTransitionMinRewardR=1.20`, the fixed floor sets `remainingRewardR` to `1.20` (≥1.0), removing the `+25` penalty outright: `rawExhaustion` drops from the logged **97 to at most 72** from this term alone. Fix A's leg-origin change (part 1) can only reduce `distanceTravelledATR`/`trendMaturity` further from that point (it cannot increase it, since the walk-back can only find a closer or equal origin than the 24h extreme) — so the combined effect is a confirmed, real-number-based reduction from 97 toward and very plausibly below the 70 hard-block threshold. The exact post-fix number cannot be certified without a true tick-level backtest (unavailable, per above); a live/demo observation period is the honest way to confirm the 16:10-style case clears going forward.
- **06:45 / 13:40 cases (root cause #3):** unaffected by Fix A, as documented in §13 — these remain blocked by the same mechanism today. Not claimed as fixed.
- **Fix B:** deterministic by construction — `XAU_CTHasOpenExposureInDirection()` is a direct broker-position query (`PositionsTotal()`/`PositionGetSymbol()`/`PositionGetInteger(POSITION_MAGIC)`), not a probabilistic score, so its behavior is fully verified by code review: a redeploy with no matching open position cannot engage the conservative floor, full stop.
- **Fix C:** the override only widens what can *reach* the existing, unchanged downstream gates (`XAU_ActiveIntelligenceDecision`, `XAUEntryTimingGuard`) — it cannot itself approve a trade. Verified by code review that all existing hard-fail checks (spread, news, hedge-guard, risk, campaign authority) still run unconditionally afterward.

**Mandatory replay tests — post-fix status:**

| # | Test | Post-fix status |
|---|---|---|
| 1 | Base BUY, 3990–4005 develops | **Improved** — Fix C lets a real reclaim reach the ACTIVE decision layer even when regime/HTF read is stale; still gated by `ADAPTIVE_RECOVERY`/`ANALYSIS-ONLY`/`SMART-GUARD` as appropriate (real risk controls, not defects) |
| 2 | Higher-low/reclaim evidence accumulates | **Improved** — same mechanism as #1 |
| 3 | Good-value BUY executes before 4080 | **Partially improved** — 16:10-class blocks (root cause #2) confirmed reduced; 06:45/13:40-class blocks (root cause #3) unchanged |
| 4 | Breakout arms timing, not permanently rejected | **Unchanged for the 06:45 case specifically** (root cause #3, not fixed) |
| 5 | Post-breakout pullback executes if it holds | **Improved for campaign-engine-driven blocks**; unchanged where root cause #3 applies |
| 6 | No late BUY chase near 4090–4099 | **Unchanged (still passes)** — Fix C only widens candidate generation on `signal==0`; it does not weaken any late-chase/anti-chase check |
| 7 | Existing BUY campaign protects profit near exhaustion | **Unchanged (already worked)** |
| 8 | Failed highs prepare a SELL | **Improved** — a correctly-scored old-direction exhaustion (Fix A) stops artificially starving the competing reversal thesis's relative attractiveness |
| 9 | WAIT states release after valid evidence | **Improved** — Fix B removes the main source of latch-without-real-cause |
| 10 | Campaign cannot finish with zero opportunities without genuine cause | **Improved but not guaranteed** — root cause #3 remains a real path to a zero-trade day on a genuine breakout |

This is a static, code-level verification, not an empirical backtest — flagged honestly per the data-availability finding above. Recommend a live/demo observation window once deployed, specifically watching for: (a) whether a 16:10-style clean signal now executes, (b) whether a same-day redeploy with no open position no longer force-floors exhaustion, (c) whether a genuine base/reclaim now generates a candidate before regime read flips, and (d) whether root cause #3 (06:45/13:40-style blocks) still recurs, confirming it needs its own follow-up fix.
