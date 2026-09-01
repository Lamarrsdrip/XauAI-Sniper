# July 15, 2026 incident reconstruction

## Evidence reviewed

- ChatGPT conversation **Inverse experiment setup**, beginning at 11:03 AM Africa/Lagos time.
- Owner-provided screenshot and production-repair prompt.
- Frozen v6.23.3 source and its normal-entry blocker call sites.

## Observed sequence

1. A valid normal SELL opportunity was available near XAUUSD 4033.
2. The normal strategy did not enter there because multiple independent strategic blockers and confirmation/recovery states could reject or defer the same candidate.
3. The same directional idea was later sold at approximately 4026.671 with stop near 4034.925 and size 0.91 lots.
4. By then the favorable move was substantially consumed and remaining reward was poor.
5. Price retraced and the trade lost approximately USD 751.12. The discussed opposite-direction counterfactual was approximately USD 500, but no inverse rule was added to the normal strategy.

## Repaired decision

- Near 4033: a structurally valid candidate creates its identity and arms the required 2–3 minute delay. It is not rejected by personality, SMC disagreement alone, AI absence, memory, loss fear or recovery state.
- At timing release: live price, ATR travel, remaining reward, reset and exhaustion are recomputed.
- If still fresh: the same candidate may proceed after the delay.
- Near 4026.671: a candidate that has traveled at least the consumed-extension threshold, has poor remaining reward, no reset and independent exhaustion evidence is rejected by the sole Freshness/Extension Authority.
- A blocked early candidate is never stored in a recovery mailbox and cannot reopen later using stale confidence.

This reconstruction is a deterministic policy test, not a profit guarantee or a claim that every historical tick can be recreated without the broker's full tick archive.
