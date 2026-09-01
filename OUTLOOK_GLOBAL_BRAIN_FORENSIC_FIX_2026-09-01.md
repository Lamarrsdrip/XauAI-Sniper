# Outlook + Global Brain Forensic Fix — 2026-09-01

## Scope

This patch starts from the current XauCloud snapshot that already contains Global Brain label schema v3, the less-sparse Direction/Timing bucket keys, expanded entry-timing counterfactual offsets, and WAIT support in `globalBrainInfluence.ts`.

The patch intentionally does **not** change the EA, trading risk, lot sizing, SL/TP, or the Global Brain promotion thresholds. It is focused on the Outlook/manual-intelligence data path and its integration contract with Global Brain.

## Confirmed defects fixed

1. **Outlook could fabricate BUY from no direction.**
   `resolveHourlyBias()` previously defaulted to BUY when there was no canonical M10 BUY/SELL and pressures were equal. Small pressure differences could also create a directional signal. It now returns `NEUTRAL` unless non-canonical pressure has a meaningful gap.

2. **Contradictory evidence could flip a canonical direction.**
   A canonical BUY could be transformed into SELL (or vice versa) solely because pressure contradicted it. Strong contradictions now become `NEUTRAL`/wait-for-fresh-evidence instead of manufacturing the opposite trade.

3. **Account evidence scope could mix accounts.**
   `latestEaEvidence()` used `$or: [{account}, {license_key}]` when both identifiers were known. That could select another account sharing the same license and leak the wrong direction/price into an Outlook. It now requires the same activity row to match both `account` and `license_key` when both are supplied.

4. **Bid/Ask could be assembled from different evidence payloads.**
   `extractEvidenceQuote()` previously selected Bid, Ask, Mid and timestamp independently across thesis/M10/readiness data. That could produce a synthetic quote that never existed at the broker. It now chooses one internally consistent quote bundle, preferring the freshest valid timestamp.

5. **External fallback pricing could detach Outlook from the connected broker.**
   Outlook generation no longer substitutes the external gold feed when the account EA broker quote is missing. It publishes `NO_VALID_OUTLOOK / BROKER_QUOTE_UNAVAILABLE` instead of presenting potentially mismatched levels.

6. **Zero-valued evidence was silently replaced by defaults.**
   `|| fallback` converted legitimate numeric zero values (pressure=0, exhaustion=0, remaining_room=0, movement_consumed=0) into arbitrary defaults. Confidence/zone math now preserves finite zero values.

7. **Global Brain integration tests were stale after the v3 bucket-key migration.**
   Several tests still seeded old `direction|session|regime|setup` Direction Quality keys even though production/training now use `direction|regime|setup`. Those test fixtures were aligned. The no-op influence expectations were also updated to include Entry Timing fields, and a WAIT integration case was added.

## Global Brain status checked

- Direction Quality training key: `direction|regime|setup_type`.
- Entry Timing training key: `regime`.
- Influence evaluator uses those same keys.
- `REJECT` and validated `WAIT` only downgrade existing candidate decisions; they do not invent BUY/SELL or alter risk.
- Production influence switches remain gated by the existing per-scope settings and default OFF.
- Shadow serving remains post-decision/advisory logging.

## New regression coverage

`backend_node/src/services/marketOutlookForensicFix.test.ts` adds checks for:

- no fabricated BUY on balanced evidence;
- no direction on tiny pressure differences;
- canonical-direction conflict becomes neutral rather than reverse;
- legitimate zero evidence is preserved;
- quote components are not mixed across payloads;
- account + license are scoped to the same row;
- no external-price substitution when broker quote is absent.

`marketOutlookSignal.globalBrain.test.ts` also now covers the v3 Global Brain bucket keys and an Outlook `WAIT` result.

## Validation performed in this environment

- TypeScript syntax/transpile diagnostics were run on every modified TypeScript file using TypeScript 5.8.3: **no syntax diagnostics**.
- A full `tsc --noEmit` / Vitest run could not complete because the snapshot does not contain installed dependencies and `npm ci` did not finish within the tool network/runtime window. The typecheck failure observed was dependency/type-package absence, not a source diagnostic from these modified files.

## Deployment note

Push/deploy the whole snapshot together so the Outlook fixes and the already-repaired Global Brain v3 code remain in sync. After production deploy, verify an account-specific fresh EA quote, generate/dry-run an Outlook, and confirm `price_source=EA_LIVE_BROKER_PRICE`. A missing broker quote should now create `BROKER_QUOTE_UNAVAILABLE`, not an external-feed-derived actionable signal.
