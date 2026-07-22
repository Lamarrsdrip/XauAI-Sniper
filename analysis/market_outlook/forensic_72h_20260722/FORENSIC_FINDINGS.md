# AI Market Outlook — 72-hour forensic findings

Scope: local MT5 journal evidence dated 2026-07-20 through 2026-07-22. This is a truthful local trace, not a substitute for production MongoDB, notification-provider, or authenticated owner-session evidence.

## Evidence inventory

- 406 `M10_SIGNAL_ANALYSIS` events retained without cross-terminal deduplication.
- 54 explicit candidates: 3 BUY and 51 SELL.
- 219 `TRANSITION_WATCH`, 123 `NO_VALID_SIGNAL`, 6 `TREND_CONTINUATION_NO_ENTRY_YET`, and 4 retracement-wait decisions.
- 19 `FINAL_ENTRY_ARBITER` events recorded `decision=ALLOW`.
- 6 `EXECUTING:` calls appeared in the reviewed journals. An execution call is not broker confirmation.
- 11 v6.25.24 `EXACT_CANDIDATE_FINAL_OUTCOME` events all recorded `CANCEL_EXECUTION_NOT_CONFIRMED` with `executed=false`.
- 27 logged `/api/cloud/monitor/activity` POST failures: 26 connection failures (`http=1003`, error 5203) and one HTTP 520 origin failure.
- Multiple EA builds and chart periods were active during the interval. The raw trace intentionally preserves those duplicates because collapsing them would hide operational reality.

Source hashes and the complete event counts are in `SUMMARY.json`. `M10_ANALYSIS_TIMELINE.csv` contains every analysis event and all requested fields that are actually provable locally. Fields requiring production DB/provider access are explicitly marked unverified. `RELEVANT_LIFECYCLE_EVENTS.tsv` retains the wider candidate lifecycle, and `MONITOR_POST_RESULTS.tsv` isolates transport failures.

## Answers to the forensic questions

1. **Did the EA create BUY/SELL M10 candidates?** Yes: 54 logged candidate analyses (3 BUY, 51 SELL).
2. **Were any candidates execution-ready?** The journals contain 19 final-arbiter ALLOW decisions. They also contain only six execution calls and, for the 11 v6.25.24 exact outcomes, explicit non-confirmation. A final broker-confirmed count cannot be inferred from these lines alone.
3. **Were candidates suppressed because hourly advisory was neutral/unavailable?** The previous application contract made the newest hourly `cloud_market_outlooks` document the frontend's primary record, so an informational row could visually replace M10 truth. The EA logs do not prove that any specific production candidate was suppressed for this reason.
4. **Were valid M10 signals stored but rendered as `NO_VALID_OUTLOOK`?** This was possible in the old mapper because current UI state came from the newest outlook document rather than an M10-first contract. Production occurrence remains unverified without DB access.
5. **Did the backend reject missing Bid/Ask?** The old publisher required Bid/Ask under `market_thesis`; otherwise it produced a non-actionable invalid-outlook record. The reviewed `M10_SIGNAL_ANALYSIS` journal lines do not carry Bid/Ask, so they cannot prove whether the POST payload did.
6. **Could Bid/Ask be mapped under another block?** Yes. Before repair the backend ignored valid quote fields nested under `m10_signal` or `entry_readiness`. The repaired mapper accepts all three documented evidence blocks without changing EA logic.
7. **Could the page use a stale record?** Yes. The old current endpoint selected newest `generated_at` from all outlook rows. The repaired response computes current state from the newest scoped EA event and keeps hourly context nested.
8. **Timezone issue?** Local device time and M10 bar time are separate in the evidence. No production timestamp rejection can be proven without DB documents. The repaired parser accepts ISO and MT5 dotted UTC time formats.
9. **Could hourly informational heartbeats overwrite the current signal?** Visually, yes under the old latest-document selection. The repaired deterministic contract preserves an active stored M10 signal and never uses hourly context as canonical authority.
10. **Were notifications tied to hourly publication?** The old path could notify `TRACKING_STARTED` immediately for an M10 candidate and could send hourly advisory notifications. Both violated the requested confirmed-signal boundary.
11. **Was there an overly strict M10/hourly join?** No explicit join was required, but the UI effectively elevated the hourly document above separately fetched M10 data. The new contract removes that ambiguity.
12. **Could confidence become zero due to unavailable advisory data?** Yes in invalid-outlook documents. The authoritative contract now uses `null` when confidence is not genuinely available; missing data is `DATA_UNAVAILABLE`, not a 0% neutral signal.
13. **Could dedupe/freshness discard a legitimate signal?** Bar-level publication dedupe was deterministic, but candidate and readiness were conflated. The new candidate lifecycle event key includes account, candidate ID, event type, and event version; stale candidates are recorded as suppressed rather than silently notified.
14. **Was the EA heartbeat continuously publishing?** Not provable. Twenty-seven explicit activity POST failures refute any claim of uninterrupted delivery, even though successful sends may have been silent.
15. **Was there a genuine market reason for no execution-ready setup?** Many events genuinely reported transition, no-valid-signal, or pending confirmation. That is part of the answer, but transport failures and the prior contract defects mean the two-day UI symptom cannot honestly be attributed to market conditions alone.

## Repaired authority boundary

The backend now separates `ACTIONABLE_SIGNAL`, `WATCHING`, `NO_SIGNAL`, `DATA_UNAVAILABLE`, `BLOCKED`, and `EXPIRED`. M10 is canonical; hourly context is nested and advisory. A candidate is not actionable until explicit execution readiness is present. Signal notification is eligible only after readiness, freshness, publication validation, persistence, and deduplication. Routine informational events are grouped in history and excluded from signal analytics.

No trading threshold, entry rule, risk rule, SL, TP, TradeBrain authority, or EA execution logic was changed by this Outlook repair.
