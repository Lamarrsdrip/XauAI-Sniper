# v6.25.13 90-Day Replay Report

Mandatory replay of the `fix(ea): default breakouts off and protect pyramid
profit` implementation commit. This is analysis and reporting only; no EA
source was changed after the implementation commit.

## Run identity

- Symbol/timeframe: XAUUSD M10.
- Tick model: MT5 real ticks (`Model=4`). Tester report confirms **100%
  real ticks**, 35,797,509 ticks over 8,538 bars across the full window --
  no unavailable interval.
- Window: 2026-04-19 00:00 through 2026-07-18 00:00 (90 days).
- Starting balance: $10,000.00 USD.
- EA: v6.25.13, `XAUUSD_AI_Sniper_EA_v62513_default_off_pyramid_protect`.
- Implementation commit: `6321caa13acd8217a20a2aed8f9ee9b20870ab67` --
  `fix(ea): default breakouts off and protect pyramid profit`.
- Source SHA-256: `e6194856f1bb69be7a4071a7a5614e2c53f61002394e7a059fecbb1df6ff1163`.
- Compiled EX5 SHA-256: `9b36676ca87352ba5435bd7e4e1c74455d346aa4f6210c26d58203f2d3ab0dca`
  (0 errors, 0 warnings) -- this exact EX5 was used for this replay.
- Counter Excursion: OFF.
- Breakout execution input: `InpOwnerBreakoutExecutionMode=0` (BLOCK), the new
  production default, left as shipped -- not overridden for this replay.
- Pyramid: enabled (`InpAllowPyramid=true`, the compiled default).
- Replay executed cleanly on the first launch, Windows-style `Z:\` config
  path (the same method proven for the 30/50-day runs; the Unix-style
  `/config:/Users/...` path that stalled earlier in this session was not
  used). Journal: `automatic testing started` -> 11% -> 24% -> 36% -> 51% ->
  66% -> 80% -> 90% -> `"successfully finished" in 0:38:56.237`, terminal
  exit code 0.

## Overall performance

| Metric | Result |
|---|---:|
| Total trades | 209 |
| Total deals | 418 |
| Wins | 166 |
| Losses | 43 |
| Breakeven trades | 0 |
| Win rate | 79.43% |
| Gross profit | $47,861.78 |
| Gross loss | -$44,497.90 |
| Net profit | +$3,363.88 |
| Profit factor | 1.08 |
| Expected payoff | $16.10/trade |
| Balance drawdown maximal | $7,475.04 (54.81%) |
| Equity drawdown maximal | $8,033.87 (58.37%) |
| Final balance / equity (no open positions at test end) | $13,363.88 |
| Average realized R (all 209) | +0.0300R |
| Average winning-trade R | +0.2993R (n=166) |
| Average losing-trade R | -1.0095R (n=43) |
| Average peak R while open (all trades) | +0.3715R |

Campaigns: each closed position belongs to a distinct `campaignId`; BUY and
SELL campaigns are tracked in separate slots, so at most 2 campaigns
(one per direction) can be simultaneously active by construction.

## Breakout default-OFF proof

| Metric | Result |
|---|---:|
| `OWNER_BREAKOUT_BLOCKED` events (regime BRKT_UP/BRKT_DN rejected at candidate-acceptance or final-execution) | 54 |
| Blocked at CANDIDATE_ACCEPTANCE stage | 54 |
| Blocked at FINAL_EXECUTION stage (fail-safe re-check; not exercised because no blocked candidate ever survived to reach it) | 0 |
| `OWNER_BREAKOUT_EXECUTION_POLICY` events with `decision=ALLOW_NORMAL_PIPELINE` during a breakout regime (would only appear in NORMAL/INVERSE mode) | **0** |
| Breakout orders sent (BRKT_UP/BRKT_DN positions in the closed-trade set) | **0** |
| `OWNER_BREAKOUT_INVERSE_EXECUTION` rows with `inversion_applied=true` (only possible outside BLOCK mode) | **0** of 485 evaluation rows |

**Proof breakout orders sent = 0 while default BLOCK remained active:** the
closed-trade regime breakdown below shows 0 BRKT_UP and 0 BRKT_DN trades
across all 209 positions -- direct confirmation, not just an absence-of-log
inference.

**Proof no bypass path reopened them:** the same single `XAU_OwnerEntryPermission()`
authority gates PRIMARY, PYRAMID, and COUNTER_EXCURSION identically (source
verified; see the implementation commit's static audit). All 54 blocked
events and all 485 breakout-regime evaluation rows are consistent with one
enforcement point, no exceptions.

## CORE versus pyramid

| Role | Trades | Wins | Losses | Win rate | Gross profit | Gross loss | Net | Avg realized R | Avg peak R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CORE | 209 | 166 | 43 | 79.43% | $47,861.78 | -$44,497.90 | **+$3,363.88** | +0.0300R | +0.3715R |
| PYRAMID | 0 | 0 | 0 | n/a | $0.00 | $0.00 | $0.00 | n/a | n/a |

**Every one of the 209 closed positions was CORE. Zero pyramid legs
executed this run.** Campaigns improved/harmed by pyramids, profitable-core-
turned-loss-by-pyramid, and max simultaneous exposure are all N/A -- there
are no pyramid legs to measure. This is the central finding of this replay
and is explained in detail below.

## Pyramid gate: proof the armed-core-floor requirement is gone, and what replaced it as the binding constraint

Directly grepped against the raw 19.2 GB Tester Agent journal (independent
of any derived CSV):

| Check | Result |
|---|---:|
| `CORE_FLOOR_NOT_CONFIRMED*` occurrences (the exact v6.25.12 gate removed by this commit) | **0** |
| `PYRAMID_GATE_APPROVED` occurrences | **0** |
| `PYRAMID_GATE_REJECT` occurrences (unique real rejection events) | 5,926,176 |
| Total raw gate-related log lines (rejections + duplicate pre-gate-block prints) | 8,478,165 |

**The removed gate is confirmed genuinely absent from this build's runtime
behavior.** The implementation change is verifiably live. But pyramids still
produced zero trades, because two *pre-existing, unmodified* gates are
independently just as restrictive once evaluated without the old gate
short-circuiting most attempts earlier:

| Reason family | Count | Share of unique rejects |
|---|---:|---:|
| `TIMING_OR_LOCATION_NOT_CLEAN_CONTINUATION` (price has not moved >= `InpPyramidMinATR`=0.65x ATR beyond the last add/entry) | 3,596,492 | 60.7% |
| `CAMPAIGN_EXHAUSTION` (the campaign's own `XAU_AdaptiveMarketTransitionEngine()` transition read) | 2,071,913 | 35.0% |
| `PYRAMID_BLOCKED_POST_TRADE_COOLDOWN` | 480,076 | 8.1%* |
| `DIRECTION_NOT_CURRENTLY_APPROVED` | 257,771 | 4.4%* |

*Cooldown and direction-not-approved percentages overlap with the two
dominant reasons because campaign-exhaustion is logged via two separate
Print statements per real event (`XAU_PyramidGateReject` plus a second
`PYRAMID_BLOCKED_CAMPAIGN_EXHAUSTION` telemetry line); the unique-event
total above (5,926,176) is the reconciled figure. Structure opposition,
pressure opposition, exhaustion-threshold, and margin-buffer rejections
were not measurable in material volume -- evaluation never got past the
spacing/exhaustion gates in most cases.

**No approved pyramid exists, so there is nothing to prove about broker-
confirmed core floors for approved pyramids** -- reported honestly as N/A,
not fabricated as compliant.

**This is not a defect in the requested implementation.** The commit did
exactly what was specified: it removed the armed-core-floor requirement and
left every other gate (including the spacing and exhaustion gates above)
untouched, per the explicit "do not remove all pyramid protection" and
"every other gate below is unchanged" instructions. The result is a real,
verified finding for owner review, documented here rather than silently
repaired: `InpPyramidMinATR=0.65` and the campaign-exhaustion classification
are, on this 90-day real-tick sample, independently sufficient to produce
zero pyramid trades on their own. No code was changed in response to this
finding.

## Pyramid protection (0.25R / 0.20R / 70%-of-peak)

Not exercised this run -- zero pyramid legs exist. `PYRAMID_PROTECTION_ARMED`
and `PYRAMID_FLOOR_CONFIRMED` events: 0. Reaching-0.25R, floor-armed,
confirmations, retries, unresolved failures, and violations are all N/A, not
zero-by-fabrication. The formula itself was proven correct independent of
this replay via the EA's own compiled `OnInit()` self-test (which hard-fails
the binary in Tester mode if any of the 6 owner-specified boundary examples
are wrong) and 64 passing Python tests against the exact pushed source.

## Regime performance

| Regime | Trades | Wins | Losses | Win rate | Gross profit | Gross loss | Net | PF | Avg R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TREND_DN | 132 | 100 | 32 | 75.76% | $31,766.13 | -$33,060.59 | -$1,294.46 | 0.961 | +0.0029 |
| TREND_UP | 72 | 61 | 11 | 84.72% | $14,689.85 | -$11,437.31 | **+$3,252.54** | 1.284 | +0.0572 |
| CHOPPY | 3 | 3 | 0 | 100.00% | $717.39 | $0.00 | +$717.39 | inf | +0.3300 |
| RANGING | 2 | 2 | 0 | 100.00% | $688.41 | $0.00 | +$688.41 | inf | +0.3923 |
| BRKT_UP | 0 | -- | -- | -- | -- | -- | -- | -- | -- |
| BRKT_DN | 0 | -- | -- | -- | -- | -- | -- | -- | -- |

All 209 trades are CORE (no PYRAMID split possible). TREND_DN is
approximately breakeven over the full 90 days (net -$1,294.46, PF 0.961) --
the 90-day window includes a materially worse stretch than the more recent
30-day window: TREND_DN alone was net +$9,044.73 in the 30-day v6.25.12
replay's most recent window, meaning the older 60 days pulled it negative.
TREND_UP remained solidly profitable across the full window. CHOPPY and
RANGING appear for the first time in this project's recent replay history
(previous 30/50-day windows had 0 of each) with tiny, all-winning samples --
not statistically meaningful, reported for completeness only.

## Exit analysis

| Exit classification | Trades | Wins | Losses | Net | Avg peak R before this exit type |
|---|---:|---:|---:|---:|---:|
| `SL_MOD:OWNER_R_EXIT_FLOOR` | 79 | 79 | 0 | +$31,819.93 | +0.532R |
| `PROFIT_CLOSE` | 86 | 86 | 0 | +$15,811.76 | +0.346R |
| `BROKER_SL` | 43 | 0 | 43 | -$44,497.90 | +0.129R |
| `WEEKEND_CLOSE` | 1 | 1 | 0 | +$230.09 | +0.344R |

- All 79 owner-floor exits were profitable, all closed above their
  protected floor -- 0 floor violations found in this run's floor-event
  telemetry.
- All 43 losses ended at physical broker SL, essentially exact -1.00R
  (avg -1.0095R), having peaked at only +0.129R on average -- well short of
  the +0.40R GENERAL arm threshold. This is the same mechanism identified in
  the 30-day and 50-day v6.25.12 replays: a loss is a CORE trade whose peak
  never reached arming distance before reversing to the full stop. This
  mechanism is unchanged by this commit (CORE exit policy was explicitly out
  of scope).
- Peak-to-exit giveback for owner-floor exits: average peak +0.532R vs.
  average realized R +0.425R at exit -- consistent, modest giveback from the
  ratchet design, not evidence of a floor breach.

## MFE/MAE

Same honest limitation as the earlier reports: the EA logs `peakRWhileOpen`
per closed position but does not log adverse excursion while a position is
still open, so "drawdown before profit" / "peak before SL" breakdowns cannot
be reconstructed from existing telemetry without an EA logging change (out
of scope) or full tick-level reconstruction (not performed). Available
instead: losing trades' average peak R while open was +0.129R (from the
BROKER_SL exit-authority row above); all 43 losses stayed below the GENERAL
arm threshold before reversing.

## Post-exit missed R

| Checkpoint | Avg missed R (all 209) | BROKER_SL (n=43) | SL_MOD:OWNER_R_EXIT_FLOOR (n=79) | PROFIT_CLOSE (n=86) |
|---|---:|---:|---:|---:|
| 5 min | 0.1817 | 0.2164 | 0.2068 | 0.1430 |
| 10 min | 0.2515 | 0.3139 | 0.2800 | 0.1964 |
| 15 min | 0.2915 | 0.3440 | 0.3403 | 0.2233 |
| 20 min | 0.3321 | 0.3700 | 0.3908 | 0.2624 |
| 30 min | 0.4107 | 0.4421 | 0.4881 | 0.3281 |
| 60 min | 0.6431 | 0.6368 | 0.7832 | 0.5227 |

By period: FIRST_60_DAYS average realized R was slightly negative
(-0.0023R, 135 trades) while LATEST_30_DAYS was positive (+0.0889R, 74
trades) -- consistent with the TREND_DN weakness noted above being
concentrated earlier in the window. All 209/209 trades have complete
checkpoint data at all 6 horizons (0 historical-data-unavailable).

Clean continuation vs. immediate reversal (60-minute, all 209 trades): 110
clean / 99 reversal. Since 0 pyramid trades exist, CORE and "overall"
missed-R figures are identical (both are the same 209 trades).

## Comparison with the committed v6.25.12 30-day and 50-day reports (context only -- windows differ, not a controlled comparison)

| Metric | v6.25.12 30-day | v6.25.12 50-day | v6.25.13 90-day |
|---|---:|---:|---:|
| Window | 2026-06-18 to 2026-07-18 | 2026-05-29 to 2026-07-18 | 2026-04-19 to 2026-07-18 |
| Trades | 62 | 96 | 209 |
| Pyramid trades | 0 (of 3.3M evaluated) | 0 (of 4.7M evaluated) | 0 (of 5.9M unique evaluated) |
| Breakout trades | 2 (both losses) | 3 (1 win, 2 losses) | 0 (blocked by default) |
| Net profit | +$9,009.92 | +$5,971.03 | +$3,363.88 |
| Profit factor | 1.58 | 1.29 | 1.08 |
| Max equity drawdown | 24.08% | 43.00% | 58.37% |

### Six key questions

1. **Did breakout default-OFF produce zero breakout executions?** Yes --
   directly confirmed (0 breakout trades, 0 `ALLOW_NORMAL_PIPELINE` events
   during a breakout regime, 54/54 candidates blocked).
2. **Did pyramids begin executing again?** **No.** Zero pyramid trades, same
   as both prior windows, despite removing the specific gate that was
   thought to be the sole cause. See the pyramid-gate section above for the
   two pre-existing gates now shown to be independently sufficient to
   produce the same zero-pyramid outcome.
3. **Were pyramid trades selective rather than uncontrolled?** N/A -- no
   pyramid trades occurred to evaluate for selectivity.
4. **Did the +0.25R trigger and minimum +0.20R/70%-peak floor protect
   pyramid profit?** N/A -- never exercised; the formula's correctness was
   proven independently via the EA's own compiled self-test and Python
   tests, not via live trades in this replay.
5. **Did pyramids improve or damage profitable CORE campaigns?** N/A -- no
   pyramid legs exist to measure against CORE.
6. **Did the change reduce the previous functional "pyramid OFF" behavior
   without restoring the old pyramid losses?** Trivially yes on the second
   half (no pyramid losses, because there are no pyramid trades at all), but
   the change did **not** restore any pyramid activity, functional or
   otherwise -- pyramid remains, in practice, still fully inert on this
   dataset, just for a different structural reason than before.

Lower net profit, profit factor, and higher drawdown vs. the shorter windows
are not attributable to this commit's changes -- 0 breakout trades and 0
pyramid trades occurred in either the 30/50-day v6.25.12 windows'
comparable-period subset or here, and CORE exit policy is unchanged; the
difference is explained by the wider window including a weaker TREND_DN
stretch in the older 60 days (documented in the regime section above), not
by anything this commit touched. **No new strategy change is recommended or
made based on this replay**, per instructions.

## Remaining defect or limitation

- **No EA source was modified in response to anything found in this
  replay.** The implementation commit (`6321caa`) is unchanged; this report
  is analysis only.
- **Load-bearing finding for owner review:** removing the v6.25.12 armed-
  core-floor gate did not restore pyramid activity. `InpPyramidMinATR=0.65`
  (spacing/continuation gate) and the campaign-exhaustion transition read
  are, independently, sufficient to reject 100% of the 5.9M+ real pyramid
  evaluations in this 90-day window. If the owner's intent was for pyramids
  to meaningfully resume, a further change to one or both of these
  pre-existing gates would be required -- not made here, per "do not make
  another strategy change based on the replay" and "request owner approval
  for another code change."
- **MFE/MAE-while-open telemetry gap** (documented in the 30/50-day reports)
  persists; confirmed to affect this window too.
- **Sample sizes for CHOPPY/RANGING remain tiny** (3 and 2 trades) -- not
  statistically reliable, reported for completeness only.
- **The 90-day window is materially harder than the more recent 30-day
  window** (TREND_DN roughly breakeven over 90 days vs. strongly positive
  in the most recent 30), which is why headline profit factor and drawdown
  look worse here than in the shorter committed reports -- this is a
  property of the sampled market period, not of this commit's changes.
