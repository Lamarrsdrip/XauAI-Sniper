# XauCloud Global Brain — Forensic Audit & Repair (2026-08-31)

## Scope

Audited the Global Brain learning path from observation schema and ingestion through outcome classification, counterfactual entry replay, estimator training, chronological validation/holdout, maturity/promotion, registry persistence, shadow serving, advisory serving, production influence, admin reporting, and the integration points used by the Bot / M10 / Outlook decision paths.

## Root findings

1. **Learning was alive, but promotion was over-constrained.** A challenger had to show a statistically significant improvement on the validation slice and then again on the holdout slice. The holdout is already the formal promotion test; requiring significance twice made useful promotion unnecessarily hard at realistic one-week sample sizes.
2. **Question evidence was split in the wrong order.** The code chronologically split the global resolved dataset and only then filtered each question's eligible rows. This could leave a question with a tiny validation/holdout even when many eligible observations existed elsewhere in the timeline.
3. **Cross-account concentration could hard-veto shared XAU learning.** One active account exceeding 50% of evidence caused `ACCOUNT_CONCENTRATION_RISK` to reject a challenger even when the market effect itself generalized chronologically. Account identity is not a market feature and should remain an audit signal, not a blanket veto.
4. **ENTRY_TIMING had a label bug.** `WAIT_IMPROVED_ENTRY` means the observed entry timing was materially worse than waiting, but the training target did not count it as a timing failure.
5. **Entry counterfactual replay was too short.** It only tested immediate/+1/+2/+3 minutes, which is not enough to learn many real gold pullback/wait behaviors.
6. **Serving buckets were too sparse.** Direction quality used direction + session + regime + setup, while bot observations frequently had no session. This fragmented evidence and made validated buckets unnecessarily hard to use.
7. **A promoted brain could only express REJECT in production.** It could not express a validated “WAIT for a cleaner entry” opinion from the ENTRY_TIMING champion, so entry-timing learning had no real path back into decisions.
8. **Per-bucket serving required 20 samples on top of model-level out-of-sample validation.** This made promoted knowledge stay dormant in many exact buckets. The serving floor is now smaller but more heavily shrunk toward the validated global prior.
9. **The code still has a genuine data gap for rejected opportunities.** Bot SKIPPED and M10 BLOCKED/EXPIRED observations are captured, but most do not have enough frozen price-path geometry to resolve a rigorous counterfactual winner/loss outcome. This is why false-rejection evidence can remain N/A. The repair does not fabricate those outcomes.
10. **The older EA-side `GLOBAL_TRADEBRAIN_*` seed mechanism is a separate subsystem and is explicitly fail-open when a validated seed is unavailable.** The web Global Brain production influence is applied through the Node decision integrations, not by magically activating that hard-coded EA seed path.

## Repairs applied

- Split each learning question **after** applying that question's eligibility filter, preserving chronological train/validation/holdout ordering.
- Use a per-question dataset fingerprint so evidence maturity tracks the data that actually belongs to that learning objective.
- Chronological validation now rejects **degradation/sign reversal**, while statistical significance is required on the untouched holdout promotion gate instead of being demanded twice.
- Cross-account concentration remains reported, but it no longer blocks promotion of shared XAU market-pattern knowledge by itself.
- Corrected ENTRY_TIMING target semantics so `WAIT_IMPROVED_ENTRY` is a timing failure.
- Extended retrospective timing replay to: immediate, +1, +2, +3, +5, +10, +15, +30 minutes (only where real quotes exist before the frozen evaluation deadline).
- Reduced sparse direction/timing keys:
  - DIRECTION_QUALITY: `direction | regime | setup_type`
  - ENTRY_TIMING: `regime`
  This deliberately removes session from the high-sparsity direction key while still retaining session in the stored observation.
- Reduced validated bucket serving floor from 20 to 8 while increasing Beta prior strength from 10 to 12. This does **not** lower the model promotion gate; it only lets a promoted model use a smaller bucket with stronger shrinkage toward its validated prior.
- Production influence can now return `WAIT` from a validated ENTRY_TIMING champion. WAIT never invents a BUY/SELL, never changes lot/SL/TP/risk, and only downgrades the current immediate entry so the normal engine can re-evaluate later.
- Bot, M10 and Outlook influence remain behind the existing owner switches. Defaults remain OFF for live influence.
- Advisory endpoint now exposes ENTRY_TIMING champion evidence too.
- Shadow-serving keys were aligned with the repaired training keys.
- Admin UI now presents account concentration as informational rather than visually implying it is a hard market-learning rejection.
- Updated affected tests for new bucket keys, timing offsets and account-concentration policy.

## Safety boundaries intentionally retained

- No challenger is promoted merely because a week elapsed.
- First models still must beat a trivial no-pattern baseline on untouched chronological evidence.
- Small samples still use the existing maturity/effect-size logic; no “5 examples = trusted” shortcut was introduced.
- Global Brain still cannot invent a trade or direction.
- Learned influence still cannot modify position sizing, SL, TP, exits or risk.
- Registry locking, first-resolution-wins behavior, drift monitoring, over-filtering protection, rollback history and kill switches remain intact.
- Missing rejected-opportunity price paths are reported as missing rather than fabricated.

## Validation performed in this workspace

- Parsed/transpiled all changed TypeScript production files and directly affected TypeScript tests with the installed TypeScript compiler API; no syntax diagnostics were produced.
- Full `npm test` / full TypeScript project typecheck could not be completed in this sandbox because dependency installation repeatedly timed out and the ZIP did not contain a complete `node_modules`. No claim of a full CI pass is made.

## Deployment note

After pushing this branch/ZIP, run the normal backend CI (`npm ci`, `npm test`, `npm run typecheck`, `npm run build`) before production deployment. Then run a Global Brain **dry-run cycle first** and compare the per-question maturity/holdout metrics. Only enable Bot/M10/Outlook learned influence after a champion exists and its holdout evidence is visible in the admin panel.
