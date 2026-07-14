# v6.22.0 Adaptive Trend Campaign Experiment — Owner Manual-Trading Forensic Learning Audit

Date: 2026-07-14

Target: `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1`

Branch: `experiment/v6.22.0`

Baseline before this repair: `112ccc17bd5e0dce1e6218aa6ea66052ab0a447d`

Implementation commit: `85c28be`

Production status: **not merged to main, not deployed, not attached to any terminal**

Initial live-authority setting: `SHADOW`

## 1. Executive conclusion

The owner's manual sequence was not random counter-trend trading. It was a coherent market-lifecycle process:

1. Sell while the bearish move is healthy and still has reward.
2. Stop treating the same direction as attractive after the move is deeply consumed.
3. Read repeated failed lows, absorption, a liquidity sweep, reclaim and held retest as evidence that the old SELL campaign is ending.
4. Buy near the transition value area before H1/H4 fully flips.
5. Hold the new BUY campaign through ordinary pullbacks while its structure remains healthy.
6. Reassess only after the recovery becomes mature and local market character changes again.

The experiment already had the correct long-hold campaign owner and the 70% exhaustion authority. Its proven timing gap was narrower: the lifecycle was based primarily on closed M5 evidence, so the first safe local reversal package could mature before the normal M5 package recognized it. This repair adds a bounded, closed-M1 evidence bridge **inside the existing centralized campaign transition engine**. It does not create another entry engine, position manager, exit manager, risk model or Counter-Excursion subsystem.

The bridge is deliberately unavailable below 70% exhaustion. It cannot reverse on one wick. At 80–89% exhaustion it requires a sweep/reclaim, persistence, failed M5 continuation and a held micro retest. At 90%+ it may use persistent sweep/reclaim plus displacement. Reward, location, anti-chase, fresh opportunity identity, campaign closure, account safety and broker safety still have to pass.

## 2. Scope and security

- The supplied MetaQuotes demo account was accessed read-only with Investor authority.
- No order was placed, changed or closed.
- No credentials, account identifiers, tickets, order IDs or deal IDs are stored in this repository, fixture or report.
- The analysis window was 2026-07-13 13:00 through approximately 2026-07-14 11:15, Africa/Lagos (UTC+1).
- Environment observed: MetaQuotes demo, USD account, exact symbol `XAUUSD`, hedging mode.
- Manual classification is high confidence because the requested records had blank manual comments, unlike earlier EA-labeled activity. The magic number was not exposed by the available read-only view, so it is not claimed as independently proven.
- The starting balance is an arithmetic inference from the observed ending balance and closed net result, not a separately exported balance record.

## 3. Reconstructed manual trade history

All times below are Africa/Lagos. Identifiers are intentionally omitted.

| Open | Close | Side | Lot | Entry | Exit | Gross | Swap | Interpretation |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Jul 13 13:04:13 | 14:05:53 | SELL | 0.10 | 4069.34 | 4065.96 | +33.80 | 0.00 | Healthy bearish phase; protected exit |
| Jul 13 13:04:14 | 13:41:16 | SELL | 0.10 | 4069.51 | 4061.00 | +85.10 | Healthy continuation |
| Jul 13 13:04:15 | 13:41:53 | SELL | 0.10 | 4069.42 | 4057.00 | +124.20 | Healthy continuation |
| Jul 13 13:07:03 | 13:41:12 | SELL | 0.05 | 4069.35 | 4064.00 | +26.75 | Healthy continuation |
| Jul 13 16:37:43 | 19:31:31 | SELL | 0.10 | 4059.91 | 4002.51 | +574.00 | Main bearish runner held into exhaustion |
| Jul 13 16:37:44 | 17:06:32 | SELL | 0.10 | 4059.92 | 4035.00 | Earlier campaign realization |
| Jul 13 19:31:41 | Jul 14 11:10:35 | BUY | 0.10 | 4003.94 | 4017.23 | +132.90 | -1.26 | Early transition reclaim; held ~15.6 h |
| Jul 13 19:31:42 | Jul 14 11:10:35 | BUY | 0.10 | 4004.05 | 4017.23 | +131.80 | -1.26 | Early transition reclaim; held ~15.6 h |
| Jul 13 19:31:42 | Jul 14 11:10:35 | BUY | 0.10 | 4004.06 | 4017.25 | +131.90 | -1.26 | Early transition reclaim; held ~15.6 h |
| Jul 13 19:34:31 | Jul 14 11:10:35 | BUY | 0.10 | 3993.20 | 4017.25 | +240.50 | -1.26 | Better-value retest entry; held ~15.6 h |

Reconciliation:

- SELL gross: **1,093.05 USD**
- BUY gross: **637.10 USD**
- BUY swap: **-5.04 USD**
- Total closed net: **1,725.11 USD**
- Observed ending realized balance: **3,186.69 USD**
- Inferred balance before the sequence: **1,461.58 USD**
- Observed equity during the open BUY recovery: **3,687.49 USD**

The requested statement that the account grew from roughly 1,400 to roughly 3,400 is directionally consistent with the evidence. The precisely proven realized endpoint in the captured history is 3,186.69; the higher observed number was equity while BUYs were still open.

## 4. Chart reconstruction and what was learned

### Healthy SELL phase

The 4069 and 4059 SELL groups aligned with a bearish H4/H1/M30 context and forceful M15/M5 continuation. Lower prices still had substantial room, bearish displacement was clean and pullbacks were not yet demonstrating durable buyer control. Selling here was trend participation with good location and remaining reward.

### Exhaustion and bottom formation

Near 4000, the situation changed:

- the bearish campaign had already travelled a large distance;
- the waterfall had consumed much of the easy downside reward;
- continuation lows became less clean;
- repeated lower rejection and absorption appeared;
- a deep liquidity sweep toward approximately 3970 failed to produce durable downside acceptance;
- price reclaimed the 3990–4005 transition area;
- subsequent bullish pushes and held pullbacks showed that buyer control was developing.

The key lesson is not “buy whenever price falls a lot.” It is:

> High old-direction exhaustion makes continuation unsafe; failed continuation plus a closed reclaim/retest package creates a fresh opposite opportunity.

### Why the BUYs made sense before a slow trend flip

The owner did not wait for H1/H4 moving averages to declare a new bullish trend. The BUY thesis was local and structural: bearish continuation had failed at an extended low, price reclaimed the breakdown area, buying persisted and a value retest held. That gave a definable invalidation below the sweep/base and meaningful room back into the prior range.

The 3993.20 BUY is the strongest repeatable automation example because it combined the new direction with better value after the first bullish response. The approximately 4004 BUYs were directionally correct but represent a more aggressive first reclaim. The repaired experiment intentionally does **not** promise to reproduce every aggressive manual fill: if the first impulse is already more than 70% consumed or outside the acceptable value zone, it waits for a pullback instead of chasing.

### Why the BUYs were held

The BUYs were held for roughly 15.6 hours because the new bullish campaign continued to make progress and ordinary pullbacks did not invalidate the base/reclaim thesis. This is exactly why the repair is in the v6.22.0 Adaptive Trend Campaign experiment: entry learning feeds the experiment's existing campaign lifecycle, while the campaign manager—not the micro trigger—owns the longer hold, protection, pyramids and final exit.

### Later manual SELLs

Four manual SELLs were open at the final snapshot around 4017. Their entries occurred seconds after the BUY campaign closed, consistent with a fresh local rollover assessment. Their outcomes were unresolved at capture time. They are therefore useful as evidence of the owner's willingness to reassess direction, but they are **not** used as proof that the later SELL thesis was profitable or safe. Visible absence of stops in the mobile view is not copied into the EA.

## 5. Manual decision versus earlier VPS bot behavior

| Market event | Owner | Earlier VPS bot | Missing information | Experiment target |
|---|---|---|---|---|
| Healthy bearish expansion | SELL | SELL | None; direction was valid | Preserve healthy SELL frequency |
| Large move already delivered | Become selective | Continued treating SELL as mid-trend | Travel, maturity and remaining reward | Raise standards at 60–69% |
| Repeated failed lows / absorption | Stop fresh SELL | Reopened SELL | Old-direction failure persistence | Hard block at 70%+ |
| Sweep, reclaim and held retest | Prepare/enter BUY | Waited for slow confirmation | Local M1/M5 transition evidence | Closed-M1 bridge behind high exhaustion |
| First bullish impulse consumed | Prefer value/pullback | Could buy late around 4028 | Entry-location quality | Reject chase; preserve opportunity |
| New BUY campaign develops | Hold | Earlier system fought it with SELLs | Campaign identity and thesis health | Existing long-hold manager remains owner |

## 6. Exact experiment repair

### 6.1 Build identity and inputs

The build marker is `v6220-campaign-manual-micro-transition-20260714`.

Three bounded inputs were added:

- `InpCampaignTransitionMicroPersistence = 3`
- `InpCampaignTransitionMicroDisplaceATR = 0.18`
- `InpCampaignTransitionMicroSweepATR = 0.05`

They are validated during initialization, printed in startup authority configuration and included in the input hash. Invalid values fail initialization rather than silently changing behavior.

### 6.2 Closed-M1 evidence bridge

The centralized transition engine now evaluates a new closed M1 bar without waiting for the next M5 close. It measures:

- a sweep beyond the prior M1 range followed by a closed reclaim;
- a later held retest of that reclaimed range;
- compact opposing candle-body displacement normalized by M5 ATR;
- at least three opposing closed M1 candles among the recent five.

This evidence can influence direction only when persistent exhaustion is already at least 70%. It does not create an independent lifecycle or score below that threshold.

### 6.3 Authorization rules

- Below 70%: the M1 bridge has no reversal authority.
- 70–79%: old direction is blocked; opposite search is active, but no automatic reversal.
- 80–89%: failed M5 continuation + M1 sweep/reclaim + persistence + **held retest** are required.
- 90%+: failed M5 continuation + persistent M1 sweep/reclaim and either retest or displacement may qualify.
- Every qualified reversal still needs minimum reward, acceptable location, anti-chase, a fresh opportunity, closed old campaign, and downstream broker/account safety.
- One wick cannot pass because persistence and retest/displacement are separate requirements.

### 6.4 Persistence and reset safety

M1 recalculation cannot age the M5 lifecycle hysteresis counter. Persistent exhaustion can decay only when a real continuation reset is present **and** a new closed M5 bar confirms it. The previous unsafe pattern “four bars passed, allow both directions” is therefore not reintroduced.

### 6.5 Fast reversal timing

Once an 80%+ opposite package has fully passed in ACTIVE mode, the existing timing engine uses the bounded reversal confirmation setting (15–60 seconds, default 30) instead of the normal 120–180 second continuation delay. This does not skip revalidation or execute a market reversal from exhaustion alone. If the move has already run beyond the opportunity's acceptable price, the final choke point waits for a pullback.

## 7. One authority, not stacked systems

The repair was intentionally placed inside the existing authority graph:

```text
closed M5 lifecycle evidence
        +
closed M1 micro-transition evidence (usable only at >=70% exhaustion)
        |
        v
XAU_AdaptiveCampaignTransitionEngine
        |
        v
XAU_FinalAdaptiveCampaignDirectionDecision
        |
        +-- fresh PRIMARY / RE_ENTRY / RECOVERY / RETRY via OpenTrade
        +-- normal timing-engine revalidation
        +-- legacy and campaign PYRAMID checks
        +-- existing-position recommendation
        |
        v
existing Adaptive Trend Campaign manager
        +-- thesis confirmation
        +-- expansion and qualified pyramids
        +-- mature-trend holding/protection
        +-- broker-confirmed campaign finalization/retry
```

Conflict controls:

- In `ACTIVE`, the centralized transition decision is copied into the legacy maturity compatibility structure, so there are not two contradictory lifecycle models.
- In `SHADOW`, legacy experiment behavior remains authoritative and the new engine logs counterfactual decisions.
- `OpenTrade` is the convergence point for autonomous PRIMARY, RE_ENTRY, RECOVERY and RETRY paths.
- Both legacy pyramid sending and the experiment campaign pyramid path call the same final direction decision before sending.
- The micro bridge never calls `trade.Buy`, `trade.Sell`, `PositionClose` or the R-exit manager.
- Existing-position action flows through `XAU_Campaign_ApplyTransitionPositionAuthority`, which asks the existing campaign manager to finalize safely.
- Campaign close uses the existing broker-confirmed close/retry path.
- Counter-Excursion remains removed by the experiment contract and was not silently reintroduced.
- Full-risk binary sizing remains 15%; this repair does not reduce lots or introduce a 0.01 fallback.

## 8. Expected behavior in the incident-style replay

| Stage | Owner evidence | Old experiment timing | Repaired experiment decision |
|---|---|---|---|
| 4069 healthy SELL | Exhaustion ~42%, strong reward | SELL allowed | SELL allowed |
| 4059 healthy SELL | Exhaustion ~58%, continuation intact | SELL allowed | SELL allowed |
| Bottom search | Exhaustion ~86%, failed lows | Old SELL blocked, opposite may still wait for M5 | Old SELL blocked; M1 reversal candidate search active |
| One sweep wick | Sweep without persistence/retest | Wait | Wait; no BUY |
| First 4004 reclaim | Direction right but first impulse may be consumed | Could recognize late | If consumed/location poor: wait for pullback |
| 3993 value retest | Sweep, reclaim, retest, persistence, reward | May wait for next M5 package | BUY eligible before full H1/H4 flip |
| Developing BUY pullback | New campaign healthy | Campaign manager holds | Campaign manager holds; micro trigger no longer manages it |

The two previously proven losing VPS SELL locations at 3997.631 and 4015.021 remain blocked under the inherited 70% exhaustion invariant. The new work specifically improves the chance of preparing and authorizing the opposite BUY near value; it does not merely convert every late SELL into an instant BUY.

## 9. Source ownership and line references

Line numbers refer to the repaired experiment source in this branch:

- Build identity: line 1800
- Full-risk binary configuration: lines 2266–2267
- Transition mode default (`SHADOW`): line 21561
- New M1 inputs: lines 21575–21577
- Central lifecycle and micro evidence engine: line 22070
- Final direction choke point and invariants: line 22439
- Compatibility mapping that prevents a second lifecycle in ACTIVE: line 22504
- Existing campaign finalization/retry owner: line 23589
- Campaign pyramid final-authority call: line 23705
- Existing-position transition authority: line 23966
- Fast reversal delay selection: line 30603
- Shared timing revalidation: line 30618
- Autonomous OpenTrade convergence/final authority: lines 16822–16834

## 10. Validation evidence

### Compile

MetaEditor result:

```text
Result: 0 errors, 0 warnings
```

Source SHA-256 before commit: `9fc64b3350051d1502356d9d806ee5ac7edaf861408786480e722a52c1b5997b`

EX5 SHA-256 before commit: `95fa4f3d9d6ee4baa1290fab7b27f947b31a7f221d3eaf986a5b81f7bedf74cc`

### Focused transition and manual-replay tests

```text
79 passed
```

### Complete v6.22.0-specific test set

```text
170 passed
```

This covers campaign forensic scenarios, lifecycle/exhaustion authority, entry-location control, manual sequence replay, one-wick rejection, healthy-trend preservation, symmetry, persistent exhaustion, restart/config identity, pyramid ownership, long-hold ownership, risk preservation and safety convergence.

### Repository-wide comparison

The repository contains many historical release tests that intentionally assert incompatible old “current version” identities and backend copies. They were already failing on the untouched experiment baseline.

| Tree | Passed | Failed |
|---|---:|---:|
| Untouched experiment baseline `112ccc1` | 914 | 208 |
| Repaired experiment working tree | 926 | 208 |

Result: **12 additional passes, zero additional failures**. The 208 inherited failures are not caused by this repair and are not hidden as green.

## 11. Manual test instructions

1. Use only the v6.22.0 Adaptive Trend Campaign experiment EX5 from this branch.
2. Confirm the Journal prints build marker `v6220-campaign-manual-micro-transition-20260714`.
3. Start with `InpCampaignTransitionMode=SHADOW` to compare `WOULD_ALLOW` / `WOULD_BLOCK` decisions without changing experiment trades.
4. Confirm only one experiment instance and its intended experiment magic are active.
5. Review these logs around a complete move and transition:
   - `[MARKET_LIFECYCLE]`
   - `[EXHAUSTION_ENTRY_AUDIT]`
   - `FINAL_CAMPAIGN_DIRECTION_DECISION`
   - `CAMPAIGN_REVERSAL_DIRECTION_VALID_BUT_WAIT_FOR_PULLBACK`
   - `[TRANSITION_POSITION_AUDIT]`
   - campaign creation, pyramid, protection and finalization logs
6. Only after shadow behavior is sensible should the experiment input be changed manually to `ACTIVE`.
7. In ACTIVE testing, verify:
   - healthy early/mid trend entries still occur;
   - 70%+ blocks old-direction fresh/re-entry/recovery/retry/pyramid paths;
   - one wick does not reverse;
   - 80–89% needs a held retest;
   - late opposite entries wait for value instead of chasing;
   - a new campaign is held by the existing long-hold manager;
   - ordinary pullbacks do not cause BUY/SELL oscillation.

No automatic deployment, terminal attachment or account action was performed.

## 12. Rollback

Before merge, rollback is simply selecting the previous experiment commit/build (`112ccc1`) or reverting the new experiment commit. Main is already unchanged at `95bbb2e`, which is the revert of the earlier accidental production-target implementation.

## 13. Remaining limitations and unproven items

- A raw broker M1 OHLC export for the historical window was unavailable. Microstructure labels in the anonymized fixture are high-confidence chart reconstruction, not tick-perfect broker replay.
- Historical MFE/MAE for every manual position was not available from the captured read-only views.
- The later open manual SELL campaign outcome was unresolved.
- Manual trades visibly lacking stops are not treated as a model for automated risk behavior.
- Deterministic and static tests prove authority relationships and incident-style decisions, not future profitability.
- MetaEditor compilation proves source validity; it does not prove behavior under every broker fill, spread, restart or disconnect condition.
- SHADOW is the default precisely because live-market logging must confirm thresholds before ACTIVE authority is trusted.
- It is not technically honest to promise “no possible bug.” What is proven is: clean compile, complete v6.22.0 tests green, no new repository-wide failures, one centralized decision graph, preserved long-hold owner, preserved risk/broker safety and no deployment to a trading terminal.

## 14. Acceptance boundary

This experiment should be promoted to production only after the owner observes that it repeatedly does all of the following on unseen markets:

> Catch the healthy move → stop chasing at high exhaustion → wait through neutral transition → enter the opposite near a valid reclaim/retest and good value → hold the new campaign while its thesis remains healthy.

Matching one historical sequence is not enough. The experiment must prove that it also preserves valid continuations and avoids noisy flips before any later production merge.
