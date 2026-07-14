# Production ACTIVE Intelligence Forensic Audit — v6.23.2

## Executive finding

Production v6.23.1 was proven ACTIVE on the VPS, but its transition intelligence could still freeze a valid reversal sequence. The critical defect was architectural: reclaim, retest, and displacement were evaluated as same-bar Booleans. Live evidence arrived across separate closed M5 bars, so the engine repeatedly forgot useful evidence before the complete package could become executable. A second high-risk defect used a slow EMA as reversal value even when it was more than five ATR from the developing local base.

v6.23.2 repairs those defects without weakening broker geometry, spread, margin, aggregate risk, full-risk-or-block sizing, normal 120–180 second timing, anti-chase, opportunity consumption, or Counter isolation.

## Scope and identity

- Baseline: `origin/main` commit `e7aab48`, production v6.23.1.
- VPS symbol/timeframe: `XAUUSDm,M5`.
- Previous mode: ACTIVE, proven by the attached chart input and `ADAPTIVE_TRANSITION_ACTIVE_ASSERTION_PASSED` startup log.
- Previous build: `v6231-adaptive-transition-location-authority-active-20260714`.
- Previous EX5 SHA-256: `563b0c7222ab98591c04a77e9ad57b4d8884c4cb9b18fa6b1889e762ad40c794`.
- One terminal process and one production chart instance were observed.
- The v6.22.0 experiment worktree, source, binary, preset, memory, and deployment were not modified or staged.

Account and credential values are intentionally omitted. Raw logs remain outside the repository.

## Data quality and candidate grain

The correct analytical grain is one unique automated candidate/opportunity. v6.23.1 printed the generic final assertion on every tick: 112 raw lines collapsed to one unique `candidateId + source + direction + decision`. Candidate rates calculated from raw lines would therefore be invalid.

The redacted ACTIVE snapshot spans server time 14:57:48–15:30:12:

| Metric | Result |
|---|---:|
| Unique blocked candidates | 4 |
| Location blocks | 1 |
| Reset-not-confirmed blocks | 1 |
| Calibrated-quality blocks | 1 |
| Continuation-qualification blocks | 1 |
| Raw final-assertion lines | 112 |
| Unique final-assertion candidates | 1 |
| Healthy low-exhaustion candidates reaching final ACTIVE authority | 0 |

Because the live denominator for healthy low-exhaustion candidates is zero, a live healthy-trend allow rate is not reportable. The deterministic healthy-trend matrix remains the appropriate release gate until the market supplies those candidates naturally.

## Candidate outcomes

| Server time | Candidate | Decision | Follow-up |
|---|---|---|---|
| 15:00:05 | A BUY trend pullback at 4085.280 | Bad location | +1.24 ATR MFE, -0.07 ATR MAE over 30m; price later retraced below the signal |
| 15:10:20 | A BUY breakout at 4096.773 | Re-entry reset absent | 0.00 ATR MFE, 1.32 ATR MAE over 15m; block avoided a poor chase |
| 15:15:05 | B BUY trend pullback at 4089.651 | Calibrated quality | 0.00 ATR MFE, 0.54 ATR MAE over 15m |
| 15:25:10 | B BUY trend pullback at 4086.036 | Continuation qualification | 0.00 ATR MFE, 0.16 ATR MAE over 5m; follow-up incomplete |

The mixed outcomes prove that fewer trades are not automatically better. ACTIVE needs coherent release as well as coherent blocking.

## Root causes ranked

### Critical — reversal evidence was required simultaneously

At VPS local 17:15, the reversal audit logged displacement true and retest false. At 17:20, it logged retest true and displacement false. v6.23.1 required the current bar to contain reclaim, retest, and displacement together, so a valid sequence could remain observation-only.

### High — slow value anchor could permanently reject local structure

The live audit reported `distanceFromValueATR=5.59`, then `5.36`, while the market was forming a new local base. The slow EMA remained historically correct but locally irrelevant. Location quality stayed zero even as retest evidence developed.

### High — manual close did not invalidate same-opportunity automation

The close handler detected manual/mobile/web closes but did not clear same-direction pending opportunity, timing confirmation, recovery timing, or reversal consumption state. A stale setup could therefore reopen after the owner closed it.

### Medium — opportunity lifecycle lacked bounded invalidation

One reversal watch persisted from server 11:50 for over three hours. It had no explicit contradiction/staleness expiry and could keep carrying an obsolete origin/value zone.

### Medium — telemetry overcounted tick evaluations

`[ACTIVE_FINAL_ENTRY_ASSERTION]` was emitted by the generic decision function rather than only at the broker-send boundary. It produced 112 rows for one unique pyramid candidate.

## v6.23.2 architecture

1. Reclaim, retest, and displacement persist independently for a bounded 12 closed-M5-bar evidence window.
2. A compact reversal still requires failed continuation plus reclaim and at least one additional category; full confirmation requires all three categories and persistence. One wick cannot authorize reversal.
3. Duplicate structure/momentum evidence is capped to a 26-point reversal-confidence contribution.
4. Reversal value begins from the recent 12-bar closed-M5 base. The slow EMA is blended only when it remains within 1.5 ATR of that base.
5. WAIT/consumed opportunities release through an ATR pullback, a held reclaim/retest, or a compact base plus a fresh higher-low/lower-high reset. Elapsed time alone cannot release them.
6. Contradicted or stale opportunities expire, but directional exhaustion remains until a genuine continuation reset.
7. The same opportunity ID owns the timing window even if the legacy setup label changes, preventing timer recycling.
8. Manual close clears same-direction pending, timing, recovery, and first-seen state and marks the reversal opportunity consumed until a genuine market reset.
9. Generic decisions log once per candidate/bar/state. `[PRODUCTION_ACTIVE_FINAL_ENTRY_ASSERTION]` is emitted immediately before normal, pyramid, or Counter broker sends.

## Authority order

Market direction, health, maturity, exhaustion, transition, reversal sequence, location, reward, opportunity freshness, timing, and manual-close state feed the centralized adaptive decision. A non-allow decision makes broker send unreachable. Broker/account safety remains an independent absolute failure after market analysis; it does not become a competing direction engine.

## Timing and risk

- Normal continuation remains bounded to 120–180 seconds from first candidate and is revalidated mid-candle.
- High-exhaustion reversal retains its existing short bounded confirmation only after the compact package passes.
- Direction-correct but extended entries return WAIT_FOR_VALUE, not TRADE_NOW.
- `InpNormalRiskPct` remains 15%. Approved normal trades use full configured risk after broker-step floor normalization or are blocked.
- No minimum-lot inflation, 0.01 fallback, or silent risk reduction was introduced.

## Validation

- Final source and backend mirror SHA-256: `d1e72ae13d7f73816632e0ddc102bc08a29b0fdcfb06010022add0116a0a4a36`.
- Final EX5 SHA-256: `ef4dd0ef019c0c32240663587243fa63ede7c6bc63c6db570bbdab75ab121805`.
- MetaEditor: 0 errors, 0 warnings.
- Focused production transition/location tests: 84 passed.
- Mandatory v6.23.2 production ACTIVE release tests: 32 passed, including the requested 30 scenarios plus identity/isolation checks.
- Backend Python syntax: passed.
- Frontend build: not run because this isolated worktree has no `frontend/node_modules`.
- Broader backend test collection remains blocked by the pre-existing absolute `/app/frontend/.env` fixture dependency.

## Live limitations

No artificial trade was placed. Natural-market proof is still required for a v6.23.2 healthy continuation TRADE_NOW, a sequential reversal TRADE_NOW, and a WAIT_FOR_VALUE release. Compile and deterministic replay prove the implementation contract, not future profitability.

## Rollback

The pre-change VPS EX5, preset, chart, and Journal were preserved under:

`MQL5\Backups\v6231_active_intelligence_audit_20260714_170723`

The deployment installer also creates its own timestamped v6.23.2 rollback directory before modifying the persisted chart.
