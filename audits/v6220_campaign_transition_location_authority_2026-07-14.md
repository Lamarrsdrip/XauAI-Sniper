# v6.22.0 EXP1 Campaign Transition and Entry-Location Authority Audit

Date: 2026-07-14

Baseline: `e4a6d876990327de58eda46e9ed96bb7aad790a7` (`experiment/v6.22.0`)

Target: `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1.mq5`

Mode default: `CAMPAIGN_TRANSITION_SHADOW`

Deployment: not performed

## Outcome

The v6.23.1 production repair was adapted to the v6.22.0 experiment's architecture instead of copied wholesale. The experiment still has one `ADAPTIVE_TREND_CAMPAIGN_MANAGER`, magic `62200001`, and no Counter-Excursion order path. A centralized campaign-transition decision now owns direction eligibility, while the campaign manager remains the sole close owner.

This is deliberately a shadow-first experiment build. ACTIVE authority is implemented and statically/scenario tested, but it has not been proven by a tick-level Strategy Tester run or real-market shadow observations.

## Architecture and ownership

| Concern | Final owner | Evidence |
|---|---|---|
| Lifecycle, exhaustion, transition, reversal package, entry location | `XAU_AdaptiveCampaignTransitionEngine()` | source around line 22059 |
| Final direction decision for every automated source | `XAU_FinalAdaptiveCampaignDirectionDecision()` | source around line 22346 |
| Normal/recovery/retry broker entry | `OpenTrade()` after final campaign choke | source around line 16784 |
| Legacy and campaign pyramid eligibility | final campaign choke before both send paths | source around lines 11294 and 23603 |
| Fast confirmed-reversal timing | `XAU_EffectiveAdaptiveCampaignEntryDelaySeconds()` | source around line 30507 |
| Profit protection and existing-position response | campaign protection plus transition recommendation | source around lines 23209 and 23870 |
| Actual close/finalize action | `ADAPTIVE_TREND_CAMPAIGN_MANAGER` only | transition authority calls campaign finalize; it does not introduce a direct competing closer |

The central decision classifies PRIMARY, RE_ENTRY, RECOVERY, RETRY, PYRAMID, and ADAPTIVE_REVERSAL. In ACTIVE mode all automated entry paths must pass it. Manual owner override semantics remain explicit and unchanged.

## Action thresholds

- Below 60% exhaustion: ordinary qualified campaign continuation remains possible.
- 60–69%: continuation becomes selective and pyramids are denied.
- At 70%: the exhausted direction's fresh entry, re-entry, recovery/retry, and pyramid permissions are all false.
- At 80%+: the opposite side becomes preferred only when a compact reversal package and acceptable location both pass.
- Exhaustion alone never creates a market reversal. One wick is insufficient.
- Exhaustion does not reset from elapsed bars or time. A real pullback/base plus renewed displacement/BOS/follow-through is required, and decay is bounded to ten points per evaluation.

The reversal opportunity persists an origin, latest acceptable price, value zone, peak excursion, pullback state, and consumed identity. This prevents the previous “right direction, wrong time/price” behavior: once a reversal has already traveled too far or consumed local reward, the decision becomes WAIT_FOR_PULLBACK instead of buying/selling late.

## Counter-Excursion boundary

Counter-Excursion remains absent, as required by the experiment contract. Historical Counter BUY results can appear in the deterministic incident fixture as evidence that the old SELL continuation failed, but no Counter code, magic number, execution path, or production ownership was imported. Runtime records explicitly report `counterEvidence=REMOVED`.

## Incident replay: old versus new

| Evidence/trade | Old observed result | New experiment ACTIVE decision |
|---|---|---|
| SELL exhaustion approximately 86%; Counter BUY 3990.325 closed +72.61 | old SELL context was later recycled | preserve high exhaustion; old SELL prohibited; reversal search active |
| SELL 3997.631 to 4017.559, -1036.26 | allowed by old trend-following path | blocked at the final direction choke |
| SELL 4015.021 to 4023.192, -890.64 | stale HTF SELL remained eligible | blocked for PRIMARY, re-entry, recovery, retry, and pyramid sources |
| Later BUY direction around 4028.551 after the reversal leg extended | direction was locally correct but entry location was bad; -755.83 | reversal remains valid, but entry waits for a pullback/value reset |

The incident fixture is `tests/fixtures/xau_vps_transition_incident_20260713_14.json`. This replay is deterministic decision validation using the proven trade sequence and recorded context. It is not represented as a full historical tick replay.

## Existing-position behavior

At persistent high exhaustion, new additions stop. Profitable old-direction campaigns can ratchet a protection floor; once the compact opposite package persists, the transition layer recommends `EXIT_PROFITABLE` or a bounded `EXIT_CONTROLLED` when the thesis is damaged. The recommendation is executed through the campaign manager's existing broker-confirmed finalize lifecycle, preserving one close owner.

## Timing and safety

Normal campaign entries retain the 120–180 second timing behavior. An ACTIVE, fully confirmed adaptive reversal may use a dedicated 15–60 second bounded confirmation (30-second default), with closed-bar/persistent microstructure proof and anti-chase/location checks. Spread, news, account, risk, cadence, SL geometry, broker, and full-risk-or-block protections remain downstream requirements.

## Tests

Focused command set covered the new transition/location file plus the existing experiment campaign, maturity, and forensic scenario suites:

- 158 passed.
- 70% source-wide blocking, 69% selectivity, 80% package requirement, one-wick rejection, real-reset-only exhaustion decay, persistent opportunity location, both pyramid paths, close ownership, timing, incident SELL blocks, late BUY wait, healthy-trend frequency, restart scoping, and BUY/SELL symmetry are represented.

Full repository suite:

- Baseline: 886 passed, 208 failed.
- Final: 914 passed, 208 failed.
- Failure-name comparison: zero added, zero removed; exact historical failure set unchanged.

The 208 failures are retained evidence, not hidden. They primarily assert old version pins or expect the production backend mirror to match the experiment. That mirror intentionally remains production code.

## Compile and artifact identity

MetaEditor result: `0 errors, 0 warnings, 56149 ms elapsed, cpu='X64 Regular'`.

- MQ5 SHA-256: `bde48d03c929b0d3cb9c75fdfbe0b44c6c43fae4f651e78f3bfe9e85bf917f45`
- EX5 SHA-256: `6f4df9ce5e0eb9ade806433ae8e8ae41ea3ab04c276e5b5d7db4925fecba55cb`
- Compile-log SHA-256: `70e7c18ece4224f760f39f8eb3a39d5760bc95dc6f39dc3ee4da8b92c53294ca`
- Compile evidence: `compile_logs/v6220_campaign_transition_location_authority.log`

Compilation used an isolated VPS temporary path. No live `MQL5/Experts` file, chart, terminal process, account attachment, or EA instance was changed.

## Rollback

Because deployment was not performed, live rollback is unnecessary. Repository rollback is the baseline experiment commit `e4a6d876990327de58eda46e9ed96bb7aad790a7`, or its corresponding EX5. Do not copy an experiment binary into the production EA filename.

## Remaining limitations and honest release status

- No live shadow evidence exists yet for this experiment build.
- No full tick-data Strategy Tester replay was available; deterministic decision replay is not a substitute.
- Static and compile success cannot prove the absence of every latent runtime or broker-specific bug.
- SHADOW remains the safe default until logs demonstrate sensible thresholds and opportunity location behavior on real markets.
- Main v6.23.1 and the VPS live attachment were outside this change and remain untouched.
