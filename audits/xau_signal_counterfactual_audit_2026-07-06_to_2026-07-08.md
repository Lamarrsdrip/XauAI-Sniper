# XAU AI Sniper Signal Counterfactual Audit

Generated: 2026-07-08
Period audited: 2026-07-06 00:00 through latest local MT5 evidence at 2026-07-08 06:25, using the timestamps written by MT5/EA files.
Scope: honest data audit only. No EA code was changed.

## Executive finding

The stored local evidence does not support a simple rule like "trade every blocked signal". If every tracked blocked signal from Monday was traded with a basic 1R stop / 2R target model, the modeled account likely loses money because many blocked signals later moved 1R against the entry.

But the evidence strongly supports your bigger concern: the bot is leaving real runs on the table. A subset of blocked momentum signals produced very large favorable movement after being blocked. The best examples include +10.47 ATR, +6.97 ATR, +6.87 ATR, +6.40 ATR, and +5.17 ATR forward movement after the block. Those were exactly the kind of runs that should have made the account grow if the EA had a cleaner selective-entry and runner-hold system.

The correct conclusion is not "remove all blocks". The correct conclusion is: keep hard danger blocks, but improve selective unblocking for clean momentum continuation, and stop cutting the winners too early once a valid run is captured.

## Evidence locations checked

- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_TradingIntelligence_XAUUSD.jsonl`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_TradingIntelligence_XAUUSD.csv`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_BlockedTradeMemory_XAUUSD.csv`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_ExecutedTradeBrain_XAUUSD.csv`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_ForwardTest_2026.07.06.txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_ForwardTest_2026.07.07.txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_ForwardTest_2026.07.08.txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_GateReport_2026.07.06.txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_GateReport_2026.07.07.txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_GateReport_2026.07.08.txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_Scorecard_2026_07_06_txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_Scorecard_2026_07_07_txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_Scorecard_2026_07_08_txt`
- `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_LiveHeartbeat_XAUUSD.txt`

Notes:
- The files are UTF-16 encoded.
- I found local MT5 Common Files evidence through 2026-07-08 06:25.
- I did not find the VPS HTML report file itself on this Mac. The VPS screenshot you sent is still useful visual evidence, but this audit file uses the locally stored EA/MT5 evidence listed above.
- The local reports changed version during the period: 2026-07-06 was v6.13.0, 2026-07-07 was v6.17.5, and 2026-07-08 was v6.17.7.

## Actual local bot behavior

| Day | Intel rows | Snapshots | Blocked | Opens | Closes | Executed close P/L |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-06 | 730 | 124 | 82 | 9 | 11 | $100.18 |
| 2026-07-07 | 593 | 197 | 59 | 6 | 6 | $142.60 |
| 2026-07-08 | 219 | 67 | 24 | 0 | 0 | $0.00 |

Local ExecutedTradeBrain close summary from this period:

- Closes: 17
- Opens: 15
- Net closed P/L: $242.78
- Gross profit: $842.02
- Gross loss: $-599.24
- Profit factor: 1.41
- Wins: 14
- Losses: 3

Important: this local ExecutedTradeBrain result is not the same as the VPS screenshot showing -$897.68. That means the VPS report file must be copied into this machine if you want exact VPS-side replay. The local evidence still shows the same structural issue: many small protected wins, a few larger broker-SL losses, and many blocked signals.

## Scorecard candidate behavior

| Day | Scorecard candidates | Trade opened | Personality blocked | B grade count | A/A+ count |
| --- | --- | --- | --- | --- | --- |
| 2026-07-06 | 139 | 14 | 125 | 127 | 12 |
| 2026-07-07 | 60 | 7 | 53 | 53 | 6 |
| 2026-07-08 | 9 | 0 | 9 | 9 | 0 |

This shows the live behavior you were complaining about: lots of candidates, but very few became trades. On 2026-07-08 in the local scorecard, every scorecard candidate was blocked and none opened.

## Blocked signal forward outcomes

I grouped blocked signals by decisionId, then used the EA's own BLOCK_CHECK follow-ups. The key fields are max favorable excursion in ATR (favATR) and max adverse excursion in ATR (advATR). I only included signals with at least 30 minutes of follow-up or a clear TP/SL-style outcome.

Tracked blocked signals in period: 165
Complete enough for counterfactual modeling: 157

Outcome counts:

- CLEAN_2R_WIN: 33
- PARTIAL_1R_PLUS: 11
- CLEAN_1R_LOSS: 87
- BOTH_TP_AND_SL_ORDER_UNKNOWN: 6
- DANGER_NO_2R: 8
- NO_CLEAR_EDGE: 12

## Grade outcome audit on blocked signals

| Grade | Signals | Clean 2R | 1R losses | Avg fav ATR | Avg adv ATR |
| --- | --- | --- | --- | --- | --- |
| A | 71 | 15 | 43 | 1.24 | 2.04 |
| PERSONALITY | 36 | 8 | 17 | 1.54 | 1.27 |
| B | 23 | 4 | 12 | 1.02 | 1.64 |
| A+ | 17 | 2 | 11 | 0.75 | 1.88 |
| SKIP | 10 | 4 | 4 | 2.50 | 1.71 |

Honest read: B grades were not clearly better in this local blocked-signal set. A+ was also not impressive: A+ blocked signals had lower average favorable movement and high adverse movement. The grade label is still not reliable enough by itself. The better predictor in this audit was not the grade. It was the combination of blocker type, momentum context, and whether the signal had room to continue.

## Blocker outcome audit

| Blocker | Signals | Clean 2R | 1R losses | Avg fav ATR | Avg adv ATR |
| --- | --- | --- | --- | --- | --- |
| Personality mismatch | 36 | 8 | 17 | 1.54 | 1.27 |
| NEWS_OBSERVING | 16 | 3 | 9 | 1.07 | 1.96 |
| NEWS_ENTRY_BLOCKED_POOR_RR | 15 | 4 | 11 | 1.23 | 2.13 |
| SMART-GUARD | 15 | 5 | 7 | 1.78 | 1.91 |
| BAD-LOCATION BLOCK | 10 | 2 | 7 | 1.17 | 1.94 |
| Trade blocked - momentum slowdown (close in oppo | 10 | 1 | 8 | 0.77 | 1.71 |
| Trade blocked - spread | 9 | 3 | 4 | 1.49 | 1.21 |
| A+ EVIDENCE DEMOTION | 8 | 0 | 5 | 1.40 | 1.83 |
| FAILED-IMPULSE BLOCK | 7 | 0 | 4 | 0.48 | 2.68 |
| B-GRADE QUALITY BLOCK | 7 | 1 | 4 | 0.39 | 1.89 |
| NEWS_ENTRY_BLOCKED_OVEREXTENDED | 4 | 0 | 2 | 1.65 | 3.83 |
| STI_REENTRY_WAIT  | 4 | 2 | 1 | 2.06 | 0.84 |

The worst idea would be to remove every blocker. For example, NEWS_ENTRY_BLOCKED_POOR_RR and momentum-slowdown blocks had many valid avoided losses.

The most interesting edge came from selective cases inside:

- Personality mismatch: produced several huge missed continuation moves, but also many valid losses.
- SMART-GUARD: mixed, but caught some of the biggest missed moves.
- Spread blocks: some were valid, but several had clean 2R follow-through after spread normalized.
- STI_REENTRY_WAIT: small sample, but strong missed moves.
- SMC_HARD_CONFLICT: very small sample; some worked, but this must not become a blind bypass.

## Top missed blocked runs

| Time | Dir | Setup | Grade | Blocker | Score | Fav ATR | Adv ATR | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-07 21:00 | SELL | TREND_PULLBACK | PERSONALITY | Personality mismatch | 3.00 | 10.47 | 0.00 | CLEAN_2R_WIN |
| 2026-07-07 20:55 | SELL | TREND_PULLBACK | SKIP | SMART-GUARD | 1.44 | 6.97 | 0.45 | CLEAN_2R_WIN |
| 2026-07-07 21:55 | SELL | BREAKOUT | PERSONALITY | Personality mismatch | 3.40 | 6.87 | 0.00 | CLEAN_2R_WIN |
| 2026-07-08 02:50 | BUY | TREND_PULLBACK | SKIP | SMART-GUARD | 2.59 | 6.40 | 0.12 | CLEAN_2R_WIN |
| 2026-07-07 03:00 | SELL | BREAKOUT | A | NEWS_ENTRY_BLOCKED_OVEREXTENDED | 6.05 | 5.52 | 2.19 | BOTH_TP_AND_SL_ORDER_UNKNOWN |
| 2026-07-08 03:20 | BUY | TREND_PULLBACK | B | SMC_HARD_CONFLICT | 3.10 | 5.17 | 0.00 | CLEAN_2R_WIN |
| 2026-07-08 03:25 | BUY | HTF_TREND_FOLLOW | SKIP | NEWS_ENTRY_BLOCKED_POOR_RR | 5.31 | 4.52 | 0.66 | CLEAN_2R_WIN |
| 2026-07-08 03:25 | BUY | HTF_TREND_FOLLOW | A | SMC_HARD_CONFLICT | 5.31 | 4.49 | 0.69 | CLEAN_2R_WIN |
| 2026-07-07 14:40 | BUY | BREAKOUT | A | STI_REENTRY_WAIT  | 7.00 | 3.99 | 0.00 | CLEAN_2R_WIN |
| 2026-07-06 15:25 | SELL | ASIA_BREAKOUT | A | Trade blocked - spread | 4.95 | 3.73 | 0.00 | CLEAN_2R_WIN |
| 2026-07-06 00:34 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 2.90 | 3.70 | 1.22 | BOTH_TP_AND_SL_ORDER_UNKNOWN |
| 2026-07-06 12:55 | BUY | HTF_TREND_FOLLOW | A | NEWS_OBSERVING | 4.21 | 3.52 | 0.00 | CLEAN_2R_WIN |
| 2026-07-06 12:40 | BUY | HTF_TREND_FOLLOW | A | NEWS_ENTRY_BLOCKED_POOR_RR | 4.21 | 3.31 | 0.27 | CLEAN_2R_WIN |
| 2026-07-06 19:30 | BUY | HTF_TREND_FOLLOW | B | NEWS_OBSERVING | 3.89 | 3.29 | 0.00 | CLEAN_2R_WIN |
| 2026-07-06 13:00 | BUY | TREND_PULLBACK | PERSONALITY | Personality mismatch | 1.20 | 3.27 | 0.06 | CLEAN_2R_WIN |
| 2026-07-06 10:30 | BUY | HTF_TREND_FOLLOW | A | NEWS_OBSERVING | 4.54 | 3.19 | 0.00 | CLEAN_2R_WIN |
| 2026-07-06 11:45 | SELL | ASIA_BREAKOUT | B | Trade blocked - spread | 3.13 | 3.13 | 0.51 | CLEAN_2R_WIN |
| 2026-07-07 14:45 | BUY | TREND_PULLBACK | A | STI_REENTRY_WAIT  | 4.28 | 3.10 | 0.00 | CLEAN_2R_WIN |

These are the trades the bot should study. Several are low grade or personality/SKIP blocked, yet they later moved far in favor. That means the grading/blocking system is still sometimes late to recognize real momentum.

## What if the bot traded all blocked signals?

Simulation assumptions:

- Starting capital examples: $1,000 and $2,000.
- Risk per signal: 1% of current equity.
- CLEAN_2R_WIN = +2R.
- CLEAN_1R_LOSS = -1R.
- PARTIAL_1R_PLUS = +1R.
- If both TP and SL were seen in the summary, the exact sequence is unknown, so I show conservative, balanced, and optimistic models.
- This is not tick-by-tick backtest proof. It is a forward-outcome audit using the EA's stored blocked-signal follow-up data.

| Scenario | Model | Signals | $1k end | $1k return | $1k max DD | $2k end | R sum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Literal all tracked blocked signals | conservative | 157 | $777.13 | -22.29% | -30.07% | $1,554.27 | -24.0 |
| Literal all tracked blocked signals | balanced | 157 | $859.38 | -14.06% | -26.44% | $1,718.77 | -14.0 |
| Literal all tracked blocked signals | optimistic | 157 | $949.58 | -5.04% | -23.44% | $1,899.16 | -4.0 |
| Clustered: max 1 per 30m per direction/setup | conservative | 112 | $861.52 | -13.85% | -21.08% | $1,723.05 | -14.0 |
| Clustered: max 1 per 30m per direction/setup | balanced | 112 | $924.39 | -7.56% | -16.59% | $1,848.77 | -7.0 |
| Clustered: max 1 per 30m per direction/setup | optimistic | 112 | $991.29 | -0.87% | -14.12% | $1,982.58 | 0.0 |
| Clustered: max 1 per 60m per direction/setup | conservative | 93 | $943.93 | -5.61% | -13.58% | $1,887.85 | -5.0 |
| Clustered: max 1 per 60m per direction/setup | balanced | 93 | $1,007.71 | 0.77% | -11.84% | $2,015.43 | 1.5 |
| Clustered: max 1 per 60m per direction/setup | optimistic | 93 | $1,075.24 | 7.52% | -10.51% | $2,150.49 | 8.0 |
| Selective historical edge subset, clustered 30m | conservative | 64 | $1,087.94 | 8.79% | -9.59% | $2,175.89 | 9.0 |
| Selective historical edge subset, clustered 30m | balanced | 64 | $1,138.32 | 13.83% | -7.75% | $2,276.64 | 13.5 |
| Selective historical edge subset, clustered 30m | optimistic | 64 | $1,190.58 | 19.06% | -7.75% | $2,381.17 | 18.0 |

Read this carefully:

1. Literal "trade everything blocked" is bad. On the balanced model, $1,000 becomes about $859, and $2,000 becomes about $1,719.
2. Even clustered every 30 minutes, the balanced model still loses: $1,000 becomes about $924.
3. A 60-minute de-duplication is near flat to slightly positive in the balanced model, but still not good enough for your growth goal.
4. The selective historical edge subset is the only modeled case that looks attractive: $1,000 becomes about $1,138 in the balanced model, and $2,000 becomes about $2,277. This is not a live rule yet. It is evidence that the EA needs selective unblocking, not blind unblocking.

## Honest conclusion

If the bot had traded all signals without blocking, the account probably would not be much bigger today. It likely would have taken too many low-quality entries and suffered drawdown.

But if the bot had selectively traded the blocked signals that showed strong continuation characteristics, and then held good runners longer, the account had a realistic path to be meaningfully higher. The largest missed runs were not tiny. They were multi-ATR continuations.

The current architecture's main weakness is not only "too many blocks". It is this combination:

1. The bot blocks too many early/uncertain momentum signals.
2. Some of those blocked signals become the real move.
3. When it does enter, it often protects small profit quickly.
4. After cutting a winner, it may need to re-enter later at worse location.
5. That makes the account rely on many small wins instead of fewer large runners.

## Recommended next audit/action, without guessing

1. Build a selective unblock rule from evidence, not emotion:
   - Require strong M5/M15 continuation.
   - Require room to target.
   - Require spread normalized or quickly normalizing.
   - Allow personality/SmartGuard warnings to become soft warnings only when the signal is in a strong momentum window.
   - Do not bypass true hard danger: invalid RR, extreme spread, hostile HTF, hard news release chaos, or no margin.

2. Add a runner-retention review:
   - For every winning close, compare the next 30/60 minutes after exit.
   - If price continued another 1R/2R after exit, label EXIT_EARLY_LEFT_RUNNER.
   - Use this to prove where winners are being cut too early.

3. Improve grade meaning:
   - Grade should not be just confirmation count.
   - Add separate score for entry timing, extension risk, remaining room, and expected MAE.
   - This audit again shows grade alone is not reliable enough.

4. Request/import the VPS HTML report:
   - The screenshot result (-$897.68) does not exist locally as an HTML report file.
   - If you put that report file on this Mac, we can run the same parser on the VPS history and compare local vs VPS exactly.

## Bottom line

Your instinct is partly right: the bot is missing runs and not converting enough valid movement into large winners.

But the data says the fix should not be "trade every signal". The profitable path is:

- block real danger,
- selectively allow early momentum continuation that currently gets blocked,
- stop treating B/low-grade as automatically bad,
- do not let late confirmation inflate grade,
- and hold validated runners longer so one good run pays for multiple losses.
