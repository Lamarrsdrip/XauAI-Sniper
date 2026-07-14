# XAU AI Sniper v6.23.1 — Owner Manual-Trading Forensic Study

Date: 2026-07-14  
Analysis window: 2026-07-13 13:00 through 2026-07-14 11:15, Africa/Lagos (WAT, UTC+1)  
Production branch: main  
Implementation commit: cf37aeb  
Build marker: v6231-manual-micro-transition-authority-20260714

## Executive conclusion

The owner did not grow the account by blindly following or blindly fading the trend. The repeatable decision process was a campaign lifecycle:

healthy bearish continuation → take SELLs → recognize the waterfall is spent → stop SELL chasing → wait through bottom formation → use the sweep/reclaim and value retest to BUY before H1/H4 fully flip → hold while the new bullish thesis remains healthy → reassess after that recovery matures.

The requested window reconciles to $1,725.11 net closed profit: $1,093.05 from six SELL positions and $632.06 net from four BUY positions after swap. With the ending realized balance of $3,186.69, the arithmetic implies an opening balance near $1,461.58. A screenshot shows equity at $3,687.49 while the BUY campaign remained open. The starting balance is an arithmetic inference, not a separately captured terminal snapshot.

The proven v6.23.1 gap was timing resolution, not the absence of a transition model. The production engine evaluated its decisive structure package on closed M5 bars. The owner acted on a closed M1 liquidity sweep/reclaim and held retest inside the still-forming M5 bar. That could make the old bot wait until the useful reversal price was gone.

The repair adds a bounded closed-M1 bridge inside the existing centralized authority. M1 evidence has no authority below 70% exhaustion, cannot reverse from one wick, cannot bypass reward/location safety, cannot reset M5 hysteresis, and cannot decay stored exhaustion merely because another M1 bar closed.

## A. Read-only connection and evidence integrity

- Investor/read-only access was used; no order was placed, modified or closed.
- Server environment was verified as the supplied MetaQuotes demo environment without recording the login.
- Currency: USD.
- Symbol: XAUUSD.
- Position mode: hedging, proven by simultaneous positions in the same symbol.
- Terminal/history timestamps matched Africa/Lagos time.
- Requested-window trade comments were blank, while earlier EA activity carried EA-specific comments. The requested sequence is therefore classified as manual with high confidence.
- Magic numbers were not exposed by the web terminal and remain unproven; they were not guessed.
- No credentials, login identifier, tickets, order identifiers or deal identifiers are stored in the repository fixture or report.

## B. Closed manual trade reconstruction

| Open (WAT) | Close (WAT) | Side | Lot | Entry | Exit | Gross | Swap | Holding / exit evidence |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Jul 13 13:04:13 | 14:05:53 | SELL | 0.10 | 4069.34 | 4065.96 | +$33.80 | $0.00 | 1h01m40s; protected-profit stop |
| Jul 13 13:04:14 | 13:41:16 | SELL | 0.10 | 4069.51 | 4061.00 | +$85.10 | $0.00 | 37m02s; target |
| Jul 13 13:04:15 | 13:41:53 | SELL | 0.10 | 4069.42 | 4057.00 | +$124.20 | $0.00 | 37m38s; target |
| Jul 13 13:07:03 | 13:41:12 | SELL | 0.05 | 4069.35 | 4064.00 | +$26.75 | $0.00 | 34m09s; target |
| Jul 13 16:37:43 | 19:31:31 | SELL | 0.10 | 4059.91 | 4002.51 | +$574.00 | $0.00 | 2h53m48s; exact close mechanism unproven |
| Jul 13 16:37:44 | 17:06:32 | SELL | 0.10 | 4059.92 | 4035.00 | +$249.20 | $0.00 | 28m48s; target |
| Jul 13 19:31:41 | Jul 14 11:10:35 | BUY | 0.10 | 4003.94 | 4017.23 | +$132.90 | -$1.26 | 15h38m54s; manual exit |
| Jul 13 19:31:42 | Jul 14 11:10:35 | BUY | 0.10 | 4004.05 | 4017.23 | +$131.80 | -$1.26 | 15h38m53s; manual exit |
| Jul 13 19:31:42 | Jul 14 11:10:35 | BUY | 0.10 | 4004.06 | 4017.25 | +$131.90 | -$1.26 | 15h38m53s; manual exit |
| Jul 13 19:34:31 | Jul 14 11:10:35 | BUY | 0.10 | 3993.20 | 4017.25 | +$240.50 | -$1.26 | 15h36m04s; manual exit |

## C. Chart reconstruction and owner decision process

### Healthy bearish phase

H4/H1/M30 remained bearish. M15/M5 showed clean lower highs, forceful lower lows, strong displacement, weak recoveries and substantial remaining downside room. Entries around 4069 and 4059 therefore had both directional agreement and entry value. The owner used multiple targets and let one 4059 SELL capture most of the waterfall to 4002.51.

### Maturity and exhaustion near 3970–4005

The final waterfall consumed a large part of the available move. Price stopped extending cleanly, formed a base around 3990–4008, repeatedly rejected lower prices, and printed a deep liquidity sweep near 3970. This changed the question from “is H1 still bearish?” to “is another SELL here still worth its risk?” The answer became no before H1/H4 could announce a bull trend.

### Early bullish transition

The owner’s BUY timing followed a compact lower-timeframe package:

1. downside continuation repeatedly failed;
2. liquidity below the base was swept;
3. M1/M5 price closed back into the prior range;
4. opposing bullish bars persisted;
5. the reclaim survived a retest;
6. there was reward room back toward 4017–4033.

The three entries around 4004 occurred on the fast reclaim. The 3993.20 entry was the stronger repeatable automation template because it bought the pullback/value retest instead of chasing the first impulse.

### Holding logic

The BUYs were held about 15.6 hours. The owner did not use a tiny fixed target; the position was retained while the recovery continued to build higher lows and reclaim levels. The defensible automated analogue is thesis-based holding with structure invalidation and protected-risk management. The absence of visible stops in the manual screenshots is not copied into the EA.

## D. Current open-position snapshot

At approximately 11:15 WAT, four manual SELL positions were open:

| Side | Lot | Entry | Visible SL | Visible TP | Evidence status |
|---|---:|---:|---:|---:|---|
| SELL | 0.02 | 4017.34 | none | 3993.79 | live outcome unproven |
| SELL | 0.10 | 4017.08 | none | none | live outcome unproven |
| SELL | 0.10 | 4017.03 | none | 4000.78 | live outcome unproven |
| SELL | 0.10 | 4017.42 | none | none | live outcome unproven |

They were opened seconds after the four BUYs closed. The inferred thesis was that the recovery had matured near 4033 and local price was rolling over while higher timeframes remained broadly bearish. This is evidence of campaign reassessment, not proof that every rapid reversal is correct. At the snapshot, the new SELL outcome was unresolved. The missing visible stops must not be taught to production automation.

## E. Manual behavior versus the VPS bot

| Market event | Owner | VPS bot | What the bot missed | Required behavior |
|---|---|---|---|---|
| Healthy fall from 4069/4059 | SELL | SELL | Nothing material | Preserve continuation entries |
| Waterfall reaches 4005/3970 area | Stop aggressive SELL additions | Continued treating SELL as healthy | Move maturity, consumed reward, failed lows | Block old direction at 70%+ exhaustion |
| Liquidity sweep and reclaim | Prepare BUY | Waited for slow confirmation | Closed microstructure evidence | Create bounded early-reversal candidate |
| Value retest near 3993 | BUY | Could still wait for M5 | Retest occurred inside forming M5 | Closed-M1 bridge at high exhaustion |
| Recovery develops | Hold BUY | Previously fought recovery with SELLs | Transition persistence and fresh-opportunity identity | Keep stale SELL state blocked |
| Recovery becomes extended | Exit/reassess | Later BUY around 4028 risked chasing | Move already consumed and poor location | Shared location/anti-chase authority |

## F. v6.23.1 replay: match and mismatch

| Stage | Owner | Old v6.23.1 | Repaired v6.23.1 | Result |
|---|---|---|---|---|
| Healthy SELL near 4069 | SELL | SELL | SELL | Match preserved |
| Healthy SELL near 4059 | SELL | SELL | SELL | Match preserved |
| High exhaustion | Stop SELL/search BUY | Block SELL, wait | Block SELL/search BUY | Improved |
| One sweep wick | Wait | Wait | Wait | Noise protection preserved |
| First reclaim around 4004 | BUY | Wait for M5 | Wait for pullback if consumed | Deliberate safety mismatch |
| Value retest around 3993 | BUY | Wait for M5 | BUY eligible | Proven gap repaired |
| Normal bullish pullback | Hold BUY | Hold | Hold | Match preserved |
| Mature recovery | Exit BUY; fresh SELL thesis | Fresh evidence required | Fresh evidence required | Match in principle; live result unproven |

The 4004 mismatch is intentional. Historical profitability does not justify a general rule that chases every first reclaim. The automated rule prefers the 3993-style retest when location quality says the initial leg is consumed.

## G. Exact architecture repair

Production source: XAUUSD_AI_Sniper_EA_v6.23.1.mq5

- Line 1790: new build marker.
- Lines 1843–1845: bounded M1 persistence, displacement and sweep inputs.
- Line 3343: transition decision stores evaluated M1 bar and micro evidence.
- Line 10616: centralized XAU_AdaptiveMarketTransitionEngine.
- Lines 10820–10821: M1 bridge is disabled below the authoritative high-exhaustion threshold.
- Lines 10845–10847: one wick is insufficient; failed extremes, sweep/reclaim, retest/displacement and persistence are required.
- Lines 10935–10941: 80–89% requires retest or bounded Counter support; 90%+ can use the compact package, still subject to reward and location.
- Line 11014: every normal autonomous source still passes XAU_FinalAdaptiveDirectionDecision.
- Line 12080: pyramid path uses the same choke point.
- Line 14563: ACTIVE reversal lane retains spread, news, timing, account and broker safety.
- Line 17499: OpenTrade catches normal, re-entry, recovery and retry sources.
- Line 22128: existing-position transition authority remains inside the broker-confirmed R-exit owner.
- Line 28079: only a confirmed high-exhaustion reversal gets the bounded fast-confirmation delay.

The M1 recompute cannot increment M5 lifecycle hysteresis or reduce stored exhaustion. Counter evidence invalidates the cache without pretending a new M5 bar occurred.

## H. Preserved contracts

- Full binary normal sizing and configured 15% normal risk were not changed.
- Normal continuation delay remains hard-bounded to 120–180 seconds.
- Confirmed reversal fast path remains bounded at 30 seconds by default.
- Spread, news, account, margin, anti-chase and broker checks remain downstream gates.
- Counter-Excursion execution remains isolated; only bounded outcome evidence reaches the transition model.
- R-exit remains the sole normal broker-close owner with close confirmation/retry behavior.
- No experiment v6.22.0 source was modified.
- No VPS or Mac terminal deployment/attachment was performed.

## I. Validation

- Focused deterministic suite: 45 passed.
- MetaEditor: 0 errors, 0 warnings.
- Canonical and backend MQ5 SHA-256: cd151d41b8423ec0a4c168f4c535ab363a98e917b20630818da442e32dd09906.
- EX5 SHA-256: 5c6580299ac2d6fc9181d6ae27cf5dcd29f7ccc1889fbb9b4c238578ccba287c.
- Broad suite after excluding one collection-blocked cloud test: 851 passed, 209 failed.
- Untouched parent comparison: 838 passed, 208 failed.
- The one added broad-suite failure is a stale v6.23.0 identity test that requires its old named file to equal the current production backend. The other 208 failures already existed and mostly require historical release files to equal the current backend.
- Unmodified full collection remains blocked by backend/tests/test_cloud_billing_and_copy_trading.py requiring /app/frontend/.env.

## J. Deployment and authority status

The implementation commit is on main, but this report does not claim VPS deployment. InpAdaptiveTransitionMode remains SHADOW by default because exact historical M1 OHLC/tick export and live shadow evidence were unavailable. The code has real centralized authority in ACTIVE mode; the safe release default records decisions first.

Before ACTIVE:

1. attach the compiled build manually on the intended VPS terminal;
2. verify the build marker in Journal;
3. prove only one intended production instance is active;
4. collect MARKET_LIFECYCLE, EXHAUSTION_ENTRY_AUDIT, REVERSAL_ENTRY_AUDIT and FINAL_DIRECTION_DECISION logs;
5. confirm healthy-trend trade frequency is preserved and false reversal triggers remain bounded;
6. then explicitly change the input from SHADOW to ACTIVE.

## K. Remaining limitations

- Exact historical M1 OHLC/tick export was unavailable. The sweep/reclaim/retest sequence is a high-confidence chart reconstruction from terminal charts and owner screenshots, not a tick-perfect replay.
- The current open SELL campaign had no proven outcome at snapshot time.
- Manual magic numbers were not visible.
- The repaired EX5 has not been loaded or forward-tested on the VPS.
- No honest audit can guarantee “no bugs.” What is proven is compile cleanliness, deterministic behavior, source/binary identity, preserved risk contracts and no new functional regression in the focused scope.
