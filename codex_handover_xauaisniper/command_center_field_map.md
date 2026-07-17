# Command Center Field Map

| UI field | Source | State |
|---|---|---|
| Online/offline | latest account/license heartbeat freshness | live/stale |
| EA version/account/broker/symbol | EA heartbeat | live, self-reported |
| M10 evidence | activity `details.m10_signal` | live when fresh |
| M30 consensus/mode | activity `details.m30_consensus` | live only when mode_active; mode-off hidden |
| Candidate ID/timer/move-R/result | not fully transported/rendered | missing |
| Decision/cancel reason | activity decision/reason/final_blocker | partial |
| Active trade thesis, SL, R/floor | per-ticket thesis status + activity | mixed live/derived; audit pending |
| Bias/confidence | latest AI/activity then heartbeat fallback | derived/advisory |
| Performance | rich journal records | live first-party; ratios after 20 samples |
| Outlook | market-outlook API using broker evidence | advisory-only |
| Notification health | OneSignal configuration/subscription state | configuration proof only |
| Remote command state | command collection + EA acknowledgement | live backend state; idempotency incomplete |

Never fill missing fields with sample numbers or infer runtime M30 mode from source/file name.
