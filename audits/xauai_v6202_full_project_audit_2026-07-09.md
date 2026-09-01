# XauAI Sniper v6.20.2 Full Project Audit

Date: 2026-07-09
Scope: EA, website, Command Center, backend command API, telemetry, force-open, force-close, release/download sync.

## Executive Summary

This audit found two confirmed command-control defects and several release-label drift issues. No entry logic, SmartGuard thresholds, Personality logic, AI advisory mode, exit/trade-management rules, or lot-sizing math were changed.

The v6.20.2 patch is a command safety and observability release:

- Force-open now carries original signal symbol, signal price, score, and event time from UI to backend to EA.
- Force-open logs original signal price vs current execution price, missed move, ATR-normalized missed move, and execution-price improvement/worsening.
- Force-close now has a per-ticket command path instead of relying only on broad close-all.
- Per-ticket force-close refuses wrong ticket, wrong symbol, wrong magic number, or missing position.
- Visible website/Admin/Download labels now show v6.20.2 consistently.
- Canonical download source and named v6.20.2 source are synced.

## Confirmed Bugs Fixed

| Area | Bug | Root Cause | Fix |
| --- | --- | --- | --- |
| Force-open audit trail | Command Center force-open could not prove whether price moved after a block. | Payload only carried direction/setup/grade/blocker/candle time. Original signal price/symbol/score were not sent end-to-end. | Added symbol, signal_price, score, event_time to UI payload, backend validator, and EA command poller. EA now logs missedMove and executionImprovement. |
| Force-close control | Command Center had close-all but no exact-ticket force-close. | UI/backend/EA command set did not include FORCE_CLOSE_TRADE. | Added FORCE_CLOSE_TRADE backend validator, UI button in Open Trade Thinking, and EA XAU_TryForceCloseTicket(). |
| Manual close loss firewall | Remote manual close reasons were not explicitly classified as manual/user close. | Loss-close firewall allowed SL/margin/emergency but did not name remote force-close as an allowed manual path. | Added MANUAL, REMOTE_FORCE_CLOSE, and REMOTE_COMMAND_CLOSE_ALL as explicit manual/emergency-allowed close contexts. |
| Release label drift | Site/admin/download fallback labels still referenced old releases. | Some text was static while download metadata is dynamic. | Updated DownloadSection, Footer, CloudLanding, FeaturesSection, and AdminPortal visible labels to v6.20.2. |
| Build identity drift | EA build hash still described an older v6.17.25 patch. | Version was bumped but build hash was not. | Updated XAUAI_BUILD_HASH to v6202-command-safety-force-controls-20260709. |

## Trade Lifecycle Audit Table

| Caller | Action | Gates Used | Risk Check Used | Manual Override | Hard Safety | Bug Found | Fixed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Main scan -> OpenTrade | Open entry | Direction, timing, SmartGuard/personality/context/AI advisory before call | XAU_ReconcileFinalRisk, margin/broker retcode, exposure caps | No | Yes | No confirmed defect in this patch | Not changed |
| Recovery -> OpenTrade | Re-entry/recovery open | Recovery evidence before call | Same OpenTrade authority | No | Yes | No confirmed defect in this patch | Not changed |
| Force-open -> OpenTrade | Manual open of blocked candidate | Skips soft strategy blockers intentionally | Same OpenTrade authority plus spread/stale/duplicate checks | Yes | Yes | Missing original signal audit data | Fixed |
| Pyramid add | Add position | Pyramid/retest validation | Projected margin/risk cap | No | Yes | No confirmed defect in this patch | Not changed |
| SafePositionClose | Close position | Loss-close firewall | N/A | Depends on reason | Yes | Remote manual close reason not explicit | Fixed |
| CloseAll | Close all EA positions | Magic + Symbol filter | Loss-close firewall | User command | Yes | Broad command only, no exact ticket option | Exact-ticket path added; close-all retained |
| Force-close ticket | Close one ticket | Ticket + Symbol + Magic filter | Loss-close firewall allows manual command | Yes | Yes | Missing path | Fixed |
| PositionModify | SL/TP modify | Existing freeze/stops wrapper where used | Broker stop/freeze rules | No | Yes | No confirmed defect in this patch | Not changed |
| Partial close | Reduce exposure | Existing partial logic | Loss-close firewall | No | Yes | No confirmed defect in this patch | Not changed |

## Risk / Lot Sizing Audit

Current v6.18+ sizing remains intact and was not changed. The canonical source still documents one sizing authority and the owner-selected aggressive COC-style sizing:

- `InpNormalRiskPct = 15.0`
- `InpMaxRiskPctEquity = 15.0`
- reduced-risk floor retained, not forced into micro lots
- broker min/max/step, margin projection, final risk reconciliation still run inside OpenTrade

No code change in v6.20.2 reduces lot size, changes grade multipliers, changes pyramid sizing, or changes AI/SmartGuard authority.

## Entry / Timing Audit

v6.20.0/v6.20.1 delayed-entry behavior remains unchanged:

- M5 remains the signal timeframe.
- Delayed entries still recalculate price/SL/TP/lot at OpenTrade time.
- Force-open still reuses OpenTrade, so stale SL/TP/lot cannot be carried from UI.
- New force-open telemetry simply records original blocked signal price vs current execution price.

No thresholds were loosened or tightened.

## Exit / Trade Management Audit

No exit strategy changes were made. Existing close paths still route through `SafePositionClose()` / `SafePositionClosePartial()` and the loss-close firewall. v6.20.2 only clarified manual remote close semantics so an intentional user force-close can close a losing trade, which matches the owner's rule that manual closes are allowed.

## Website / Command Center Audit

Confirmed fixed:

- Force-open payload now includes `symbol`, `signal_price`, `score`, `event_time`, and `signal_id`.
- Open Trade Thinking now has a per-ticket "Force close" button.
- The force-close confirmation modal states that the EA will reject wrong ticket/symbol/magic.
- Download fallback version and filename now point to v6.20.2.
- Public/admin visible labels no longer show stale v6.20.1/v6.17.20 strings in the checked files.

## Suspicious Issues Needing Live Data

- SmartGuard/Personality thresholds were not changed. The prompt requested no threshold changes unless current-version evidence proves a defect.
- Exit memory Phase A was not expanded here. Existing memory paths should be audited with fresh live trade outcomes before changing trade decisions.
- Delayed-entry outcome telemetry is present, but learned wait-zone memory is still a future improvement, not a confirmed bug.
- Command queue stale-expiration and duplicate-command prevention could be strengthened further server-side; current force-open has UI/backend/EA staleness checks and same-candle EA duplicate protection.

## Validation

Passed:

- `pytest -q tests/test_xau_v6202_command_safety_static.py` -> 8 passed.
- `pytest -q tests/test_xau_v6202_command_safety_static.py tests/test_download_release_metadata_static.py tests/test_release_labels_static.py tests/test_bot_activity_monitor_static.py` -> 20 passed.
- `python3 -m py_compile backend/server.py` -> passed.
- MetaEditor/Wine compile: `Result: 0 errors, 0 warnings`.
- Source sync: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` matches `XAUUSD_AI_Sniper_EA_v6.20.2.mq5`.

Blocked / not clean:

- Full pytest suite stops during collection because `backend/tests/test_cloud_billing_and_copy_trading.py` requires `/app/frontend/.env`, which does not exist in this local checkout.
- Frontend `npm run build` and `GENERATE_SOURCEMAP=false npm run build` both hung at `Creating an optimized production build...` and were manually stopped. No React syntax error was emitted before the hang.

## Files Changed

- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- `XAUUSD_AI_Sniper_EA_v6.20.2.mq5`
- `XAUUSD_AI_Sniper_EA_v6.20.2.ex5`
- `backend/server.py`
- `frontend/src/components/cloud/CloudDashboard.jsx`
- `frontend/src/components/cloud/AIThoughtFeed.jsx`
- `frontend/src/components/DownloadSection.jsx`
- `frontend/src/components/Footer.jsx`
- `frontend/src/components/cloud/CloudLanding.jsx`
- `frontend/src/components/AdminPortal.jsx`
- `frontend/src/components/FeaturesSection.jsx`
- `tests/test_xau_v6202_command_safety_static.py`

## Intentionally Not Touched

- Entry scoring and grade thresholds.
- SmartGuard/Personality thresholds.
- AI advisory-only architecture.
- Lot-sizing math and risk presets.
- Exit/trailing/partial/runner rules.
- Pyramid/recovery/re-entry logic.
- Multi-account strategy behavior.
