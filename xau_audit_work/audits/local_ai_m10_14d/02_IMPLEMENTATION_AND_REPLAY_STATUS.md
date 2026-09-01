# Pure-M10 local AI implementation and replay status

Date: 2026-08-02
Branch: `research/ai-m10-14d-low-cost`

## Implemented authority

The EA remains pure M10. It builds one compact snapshot from the newly closed
M10 candle and the existing M10 scoring/setup engine. Local AI may validate an
existing setup or map strong unresolved M10 evidence into an existing setup
family. It cannot change direction unless aligned with the deterministic M10
preference, and it cannot bypass owner, normal, broker, margin, risk, SL,
exit, or final order-send protections.

The live path is nonblocking: submit/poll calls have a one-second MT5 limit
while inference runs on a single background worker. Missing, pending,
low-confidence, malformed, overloaded, or unavailable AI always returns to
the deterministic engine. Emergent fallback is disabled and is not
implemented on the MT5 event thread.

The local-first filter calls the model only when the closed M10 evidence is
complete/fresh, has a preferred direction, and is either:

- an existing allowed setup candidate; or
- an unresolved high-value case with leader score at least 70 and BUY/SELL
  separation at least 8.

All other M10 cycles log `LOCAL_AI_SKIPPED` and stay deterministic.

## Exact offline replay cache

Strategy Tester cannot use WebRequest. The EA therefore has a tester-only
exact-pair cache reader using `FILE_COMMON`. Pass 1 records exact compact JSON
snapshot rows. The resumable local builder validates each row, performs at
most one local inference for each unique signature, immediately fsyncs the
snapshot/decision pair, and reuses it across both variants and reruns. A miss
or failure is deterministic fallback. The builder makes zero paid calls.

The final prompt/cache contract is `xaucloud-local-ai-v4`. The gateway also
normalizes the sole observed logical contradiction fail-closed: a model result
that says a candidate is allowed while direction or setup is `NONE` becomes
`candidate_allowed=false` with reason code
`MODEL_CONTRADICTION_FAIL_CLOSED`.

## Fixed 14-day collection evidence

Window: 2026-07-14 through 2026-07-28, XAUUSD M10, MetaQuotes-Demo,
`Model=4`, USD 10,000 deposit, 1:100 leverage.

Both collection passes report 100% real ticks, 5,590,211 ticks and 1,320 bars.
The owner-blocked run reports scan health `started=1285 completed=1285
aborted=0`.

| Collection trajectory | Closed M10 cycles | AI-eligible snapshots | Trades | Net | PF | Max equity DD |
|---|---:|---:|---:|---:|---:|---:|
| With owner blockers, deterministic fallback | 1,285 | 396 | 15 | $1,223.02 | 1.28 | 21.93% |
| No owner blockers, deterministic fallback | 1,285 | 393 | 25 | $2,680.78 | 1.42 | 24.08% |

The two files contain 464 unique exact snapshots after deduplication. These
collection-run profits are **not AI results** and are not a deployment
recommendation; they only establish trajectories and cache inputs.

## Current incomplete gate

The 464-row v4 local-only cache build is resumable and runs under the named
Windows task `XauCloudLocalAI_Replay14DCache`. Final cached AI comparisons,
the deterministic baseline report, and the separate unseen holdout are not
yet claimed. Until all are complete, no AI variant is approved for live
attachment or merge to `main`.

## Verification

- 68 targeted tests pass.
- Both final v4 variants compile with 0 errors and 0 warnings.
- Final ten-case v4 acceptance: 100% strict decisions, zero timeouts,
  13.08 s average, 14.18 s p95, 8/10 deterministic confidence fallbacks.
- Runtime and gateway are loopback-only; paid models report disabled.
- Production MT5 terminal and production EA were not replaced or reattached.
