# Bot-Managed Counterfactual Audit — XAUUSD AI Sniper EA

Follow-up to `AUDIT_1HOUR_WATCHDOG_2026-07-08.md`. That report scored blocked/executed trades against passive SL/TP outcomes (1R/2R/SL-hit). This follow-up re-scores every case using the bot's **real exit-management logic**, pulled directly from the v6.17.14 source, instead of assuming the trade would have been held passively to SL/TP.

---

## What the bot's real management logic requires before it does anything

Read directly from `XAUUSD_AI_Sniper_EA_v6.17.14.mq5`:

| Mechanism | Function | Arms at |
|---|---|---|
| Protected Peak Floor | `XAU_ProtectPeakProfitFloor` (line 4691) | `peak ≥ min($75×acctMult, 0.45R)` → **$68.97** for this trade's sizing |
| Smart-Exit 3-Layer (protect/partial/EV-exit) | `XAU_SmartExit3Layer` (line 4333) | `peak ≥ max($75, 2% equity)` → **$75.00**, hard `return false` below it (line 4350) |
| Simple BE lock | `InpBELockActivateR` | **+1.0R** (~$153) |
| "AR" breakeven | `InpARBreakEvenR` | **+1.2R** (~$184) |
| Partial close | `XAU_ContextShouldTakePartial` (line 4122) | `profitUSD ≥ strongProfitUSD` (**$75**) *and* peakR ≥ 1.0–1.2 depending on context |

Every protection layer requires floating profit somewhere between **$69 and $184** before it arms. There is no graduated protection below that line — it is all-or-nothing gating on "did this trade prove itself first."

---

## Counterfactual per candidate

### Trade B — SELL executed 13:00:47 (the one real trade in the window)

This one didn't need simulation — the bot's actual tick-by-tick `TRADE_THESIS_STATUS` log for ticket `9477557258` (1,101 lines) was mined directly. Every protection-related print type was searched for this ticket: **zero** `PEAK_PROFIT_REACHED`, zero `PROFIT_FLOOR_SET`, zero `GIVEBACK_LIMIT`, zero `RUNNER_CONVICTION`, zero `EV_PROTECT`/`EV_EXIT`, zero BE-lock.

- **Max floating profit reached:** $8.01 (0.052R) — ~12% of the way to the cheapest arm threshold ($69)
- **First profit-lock opportunity:** never occurred
- **Partial close would trigger:** No
- **BE would trigger:** No
- **Trailing would trigger:** No
- **Smart exit would close before SL:** No
- `protectReason` and `exitReason` stayed empty for the entire 18-minute life; `holdReason` tracked "Recovery Mode, watching for reclaim" until the broker SL closed it
- **Simulated bot-managed P/L:** –$153.18 (identical to actual — there is no simulation delta because no mechanism ever armed)

**Classification: TRUE_LOSS.** Not a mis-scored managed-win — the trade never got close enough to profit for management to matter at all.

### Candidate A — BUY blocked @4071.66 (12:47/12:50)

Price only ever moved adverse to this direction (–5.7 to –11.6 pts over 13 min, never positive). Peak would have been ≤$0 — below every arm threshold by definition.

**Classification: TRUE_LOSS-if-taken.** Bot-managed counterfactual changes nothing — block stands as CORRECT_BLOCK.

### Candidate C — BUY breakout blocked @4076.05→4072.04 (13:19/13:20)

Price moved adverse immediately (–3.9 pts within 90s, continued fading into SKIP-grade). Same story: never favorable, never near an arm threshold.

**Classification: TRUE_LOSS-if-taken.** Block stands as CORRECT_BLOCK.

### Earlier executed loser — SELL closed 12:46:35 (posId 9476320268, pre-window entry)

`bestFloating=$0.00` for its entire recorded life — literally never profitable for one tick. No management mechanism could have engaged; there was nothing to protect.

**Classification: TRUE_LOSS**, trivially.

---

## Direct answer to the core question

Are we wrongly calling blocked trades "bad" just because passive SL/TP scoring says they hit SL, even though real management would have banked profit first?

**No** — in this dataset, passive SL/TP scoring and the bot-managed counterfactual agree on every case, for the same reason each time: **none of these trades (real or hypothetical) ever built enough floating profit to cross the bot's own $69–$184 protection-arming floor.** There is no `PASSIVE_LOSS_BUT_BOT_MANAGED_WIN` case to find here, because the mechanism that would create that gap — a trade goes nicely profitable, then gives it back before SL — never got triggered. These losers moved against the position almost immediately instead.

**Caveat, stated plainly rather than glossed over:** this means the original audit's "SL hit first" framing happened to be safe this time, but only because none of the sampled trades reached the profit-management zone. The concern behind this challenge is legitimate in general for this bot — there is simply no case in this 64-minute window where a trade cleared +0.45R and then reversed, so this data cannot yet show what happens in *that* scenario. A future audit window should specifically flag and deep-trace any trade that crosses $69+ floating profit, to test the actual failure mode being worried about here.

---

## Executed-losers comparison (summary)

| Trade | Peak floating profit | Nearest arm threshold | Would management have protected it earlier? | Why / why not |
|---|---|---|---|---|
| posId 9476320268 (closed 12:46:35) | $0.00 | $68.97 (cheapest) | No | Never profitable even once — nothing to protect |
| posId 9477557258 (closed 13:18:55) | $8.01 | $68.97 (cheapest) | No | Reached only 12% of the cheapest arm threshold before reversing |

Both losses trace back to entry timing/direction, not exit-management quality — the management layer never got a chance to act in either case.
