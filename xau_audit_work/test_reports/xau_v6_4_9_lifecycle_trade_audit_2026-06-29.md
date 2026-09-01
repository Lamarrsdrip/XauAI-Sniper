# XAU AI Sniper v6.4.9 Lifecycle Trade Audit - 2026-06-29

## Scope

Urgent audit of the Mac live basket reported from screenshots:

- XAUUSD SELL 0.27, entry about 4021.89
- XAUUSD SELL 0.06, entry about 4026.93
- Basket reached about +$191 floating profit, then cycled through loss and recovery without closing.

## Files Inspected

- `XAUUSD_AI_Sniper_EA_v6.4.6.mq5`
- `XAUUSD_AI_Sniper_EA_v6.4.9.mq5`
- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- `frontend/src/components/DownloadSection.jsx`
- MT5 log: `MQL5/Logs/20260629.log`
- MT5 Experts folder:
  - `MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.6.mq5`
  - `MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.6.ex5`
  - `MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.9.mq5`
  - `MQL5/Experts/XAUUSD_AI_Sniper_EA_v6.4.9.ex5`

## Exact Version Found

Before this fix, the repo had protected-floor code internally marked v6.4.8, but the MT5 Experts folder still had older v6.4.6 filenames and the running log showed:

- `XAUUSD_AI_Sniper_EA_v6.4.6 (XAUUSD,M5)`

The fixed build is now:

- EA version: `v6.4.9`
- Build hash: `v649-trade-lifecycle-manager-20260629`
- Source SHA256: `b425db70cad7cf675743ff148e12e21c917a604a1019211eec1c867689bc928a`
- EX5 SHA256: `00d02ed9221dc3a12a06a5028baee27f5a76ebcdfebb9a73e988d3c931c255e5`

## Evidence From Live Log

The live Mac log proves the EA was aware of the peak but did not arm meaningful protection:

```text
18:44:34 BASKET PnL=$-1.44 Peak=$191.28 Floor=$1.00 Armed=N BE=Y
18:47:34 BASKET PnL=$48.39 Peak=$191.28 Floor=$1.00 Armed=N BE=Y
18:52:34 BASKET PnL=$75.12 Peak=$191.28 Floor=$1.00 Armed=N BE=Y
18:58:34 BASKET PnL=$104.16 Peak=$191.28 Floor=$1.00 Armed=N BE=Y
```

Supporting evidence:

```text
18:47:30 PROFIT LOCK: daily gain 3.1% reached 3.0% threshold - tightening SLs with ATR-adaptive distance (ATR=0.00)
```

This means daily profit lock also failed to create a meaningful stop because ATR was unavailable/zero at that moment.

## Root Cause

The basket profit lock depended on the classic basket arm threshold:

```mql5
double armUSD = MathMax(InpBasketArmFloor, bal * EffBasketArmPct() / 100.0);
if(!g_basketArmed && g_basketPeakUSD >= armUSD) g_basketArmed = true;
```

Default `InpBasketArmFloor` was `$200`. The live basket peak was `$191.28`, so:

- `g_basketArmed` stayed false.
- `g_basketFloorUSD` stayed at the break-even fallback of `$1.00`.
- The EA treated the basket as allowed to breathe even after a large proven peak.
- Trend continuation / pyramid logic kept seeing strong sell alignment, but profit protection had no lifecycle rule strong enough to override the hold.

The trade would not literally stay open forever because an SL existed around 4042.25, but under the old logic it could cycle profit -> loss -> profit -> loss until SL or a later structure exit. That is a design flaw for a trade that already proved +$191 floating profit.

## Fix Implemented

v6.4.9 adds `XAU_BasketLifecycleManager()` and makes protected basket floors independent of the old `$200` arm threshold.

New behavior:

- A meaningful basket peak arms protection directly.
- The basket floor ratchets from protected peak settings.
- A proven winner crossing into loss triggers `GIVEBACK_LIMIT_TRIGGERED`.
- If it already cycled profit -> loss and then recovers, it can take `SECOND_CHANCE_PROFIT_EXIT`.
- Repeated profit/loss cycling triggers `CYCLE_DECAY_EXIT`.
- Any hold after a protected peak must log `HOLD_REASON_REQUIRED`.

New logs:

- `PEAK_PROFIT_REACHED`
- `PROFIT_FLOOR_SET`
- `GIVEBACK_LIMIT_TRIGGERED`
- `SECOND_CHANCE_PROFIT_EXIT`
- `PROFIT_TO_LOSS_WARNING`
- `CYCLE_DECAY_EXIT`
- `HOLD_REASON_REQUIRED`
- `CONTINUATION_HOLD_PROTECTED`
- `CONTINUATION_HOLD_REJECTED`

## Risk Level

High live-trading impact. The bug allowed a proven +$191 floating basket to cycle into large floating loss because the old arm threshold was slightly too high and the basket lifecycle had no second-chance/cycle manager.

The fix is intentionally not a daily freeze, trading pause, or fear lockout. It applies only to already-open baskets that have proven meaningful profit.

## Verification

- `pytest tests/test_xau_v646_live_audit_static.py tests/test_xau_v647_trend_continuation_static.py tests/test_xau_v648_profit_floor_static.py tests/test_xau_v649_lifecycle_static.py`
  - Result: `23 passed`
- `npm --prefix frontend run build`
  - Result: compiled successfully
- MetaEditor compile:
  - Result: `0 errors, 1 warning`
  - Warning: MetaEditor Market version-format warning for `6.4.9`

Full `pytest` collection is blocked in this local workspace by `backend/tests/test_cloud_billing_and_copy_trading.py` expecting `/app/frontend/.env`.

## What To Test Next

- Reattach/restart the EA and confirm the startup log shows `v6.4.9` and build hash `v649-trade-lifecycle-manager-20260629`.
- In live/demo, confirm dashboard shows `Trade lifecycle: ON`.
- Watch for `PEAK_PROFIT_REACHED BASKET` and `PROFIT_FLOOR_SET BASKET` once a basket reaches meaningful profit.
- Confirm a basket that has gone profit -> loss and recovers logs either `SECOND_CHANCE_PROFIT_EXIT` or a clear protected hold reason.
