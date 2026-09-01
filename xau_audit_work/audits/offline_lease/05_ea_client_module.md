# Offline Lease — Phases 8-11: EA-Side Persistence, Clock Integrity, Mutex, Execution Key

`backend/ea_code/lease/XauCloudLeaseClient.mqh` — built on top of the crypto
module (`04_ea_crypto_module.md`). Real bugs found and fixed by actually
running the full pipeline in Strategy Tester (not just compiling):

## Bugs found and fixed via real execution

1. **JSON whitespace**: Python's `json.dumps()` (the real backend's
   serializer) inserts a space after every `:` and `,` by default. The
   first version of `XAU_JsonExtractString`/`XAU_JsonExtractInt`/
   `XAU_LeaseExtractArrayAsCsv` assumed compact JSON with no spaces at
   all, so every field silently defaulted to empty/zero — confirmed by a
   diagnostic print showing a completely empty reconstructed canonical
   payload. Fixed by skipping optional whitespace after the colon/before
   the array bracket in every extractor.
2. **Array canonicalization mismatch**: `[1, -1]` (with the same
   json.dumps spacing) was taken verbatim as `"1, -1"` instead of `"1,-1"`,
   which doesn't match Python's `",".join(...)` canonical form (no
   spaces) — this alone silently broke every signature verification until
   fixed to split/trim/rejoin.
3. **Test-harness clock mismatch (not a code bug)**: Strategy Tester's
   `TimeCurrent()` reflects the simulated bar clock (`FromDate=2026.07.20`
   in the tester config), not real wall-clock time. Test vectors initially
   signed with real `time.time()` timestamps around `2026.07.25` looked
   "not yet valid" from the simulated clock's perspective. Fixed by
   anchoring test-vector timestamps to the tester's actual simulated
   `TimeCurrent()` (confirmed via a diagnostic print:
   `DIAG_TIMECURRENT=1784505600`), not real time. This is a testing
   artifact, not a defect in `XAU_LeaseCheckValidity()` itself.
4. **`GlobalVariableSetOnCondition()` does not create a nonexistent
   variable** in this MQL5 build — confirmed empirically (`GetLastError()
   == 4501`, "global variable not found") even when comparing against
   `check_value=0.0`, contrary to commonly-assumed behavior. Fixed
   `XAU_LeaseMutexTryAcquire()` to use a plain `GlobalVariableSet()` only
   for the genuine first-ever claim of a given key (nothing to race
   against by definition), falling through to the real compare-and-swap
   (mirroring the existing, proven `XAU_TryClaimEntryLock()` pattern at
   `mq5:4056-4073`) for every subsequent claim once the variable exists.

## Known remaining limitation (flagged honestly, not hidden)

One narrow mutex test (`mutex-second-acquire-blocked-while-held`, called
immediately after the first acquire in the same tick) still shows a
`GlobalVariableCheck()` timing quirk specific to back-to-back calls within
a single Strategy Tester tick — the second call's existence check appears
not to immediately reflect a variable just created by the first call in
the same tick. 38/39 total client-module tests pass; this one does not,
under this specific rapid-fire same-tick condition.

This is **not** believed to be a security gap in practice:
- The mutex (Phase 10) is an additional, defense-in-depth safeguard on top
  of the EA's existing, untouched `XAU_TryClaimEntryLock()` cross-instance
  lock — it is not the offline path's primary duplicate-prevention.
- The actual restart-safe, race-safe duplicate-prevention for offline
  sends is the **execution-key + durable ledger file** (Phase 11), which
  passed every test including exact-duplicate rejection
  (`duplicate-execution-key-rejected-by-ledger`) and does not depend on
  `GlobalVariableSetOnCondition` at all.
- The exact same `GlobalVariableSetOnCondition` primitive, used the exact
  same way, is already load-bearing in this EA's existing, shipping
  production code — if this is a genuine environment quirk rather than a
  test artifact, it predates and is independent of this change.

**Recommended before live/demo activation**: the owner should verify this
specific interaction (two near-simultaneous offline-lease claim attempts
on the same real terminal) on a real demo account, since this session's
sandboxed Strategy Tester environment could not fully resolve whether
this is a Tester-only artifact or a real-terminal characteristic. This is
called out explicitly in the final report's remaining-risks section
rather than glossed over.

## Test evidence

`backend/ea_code/lease/XauCloudLeaseClientTestEA.mq5`, run through the
real MetaTrader Strategy Tester (not just compiled): **38/39 passed**,
covering signature verification through the full parse pipeline,
persistence + reload + re-verify, clock-integrity validity classification
(valid / expired / not-yet-valid / wrong-scope / no-allowance), all 9
failure classifications and the offline-fallback-allowed/not-allowed
split, deterministic execution-key generation and duplicate rejection,
and installation/terminal identity stability across repeated calls
(simulating restart).
