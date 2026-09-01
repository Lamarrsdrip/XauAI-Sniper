# XauCloud Real 60-Day MT5 Replay Results

Real MetaEditor compile + real MT5 Strategy Tester replay, run in this session against
the current audited source (`XAUUSD_AI_Sniper_EA.mq5` @ commit `61ec381`, SHA-256
`656805f7...`). Isolated sandbox only (`/Users/libertyelectronics/XauAI-Sniper/tester_sandbox/MT5_Isolated`)
— confirmed via `ps aux` before and after that the live/attached Mac terminal (a separate,
long-running `C:\Program Files\MetaTrader 5\terminal64.exe` process) was never touched.

## Two distinct binaries — do not conflate them

| | SHA-256 | Source | Use |
|---|---|---|---|
| **Deployable candidate** | `948aeee5d792df440c13bf455e2f876725a832eda154fc1de9e9eb86c711a06b` | Exact, unmodified audited git source (`InpLicensePIN` compiled default `""`, as committed) | This is what's now checked into `XAUUSD_AI_Sniper_EA.ex5` and `backend/ea_code/XAUUSD_AI_Sniper_EA.ex5`, and what the new `v6.25.24` manifest entry in `backend/ea_releases/manifest.json` references. |
| **Tester-only replay variant** | `5e49c067bf3ddbc60339c7ffb5d18a2a87f0a6d4f3b8e052f3f3990d98d498b0` | Identical source except one line: `InpLicensePIN` compiled default changed from `""` to `"ASE-TEST-0001"` (format-check-only value, no live server contact in Tester mode — confirmed by reading the code) | Used **only** for this local isolated replay, so the run wouldn't require external `.set`/profile plumbing. **Never committed to the repo, never to be deployed anywhere.** Trading logic is byte-for-byte identical to the deployable candidate — the one-line diff was verified with `diff` before compiling (see session transcript) and touches nothing except the license-string default. |

## Why three attempts failed before this succeeded (recorded honestly, not hidden)

1. Attempt 1 used a plain-ASCII `.set` file for `InpLicensePIN` — MT5 requires UTF-16LE for
   `.set` files; the override silently didn't apply (`Bars: 0, Ticks: 0` — nothing was
   tested at all).
2. Attempt 2 fixed the encoding — same result. Root cause was different: MT5's Tester
   automatically caches the *last-used* input set per expert name in
   `MQL5/Profiles/Tester/<ExpertName>.set`, and had cached the (empty, from attempt 1)
   value — it was silently reapplied regardless of the `.ini`'s `ExpertParameters`.
3. Attempt 3 (the Tester-only-variant compile, still with the stale cache present) — same
   result for the same reason.
4. Deleted the stale cached profile. Attempt 4 succeeded.

None of these were EA logic defects — all three were local Tester tooling/caching
behavior, confirmed by reading the actual MT5 terminal log (`Alert: Enter PIN in Inputs
tab.` — the exact literal string from `XAUUSD_AI_Sniper_EA.mq5:10759`) rather than
guessed at.

## Real results (config: `tester_sandbox/MT5_Isolated/config/xaucloud_audit_60d.ini`)

- Symbol XAUUSD, M10, every-tick real-tick model, 2026-05-22 → 2026-07-21 (60 days),
  MetaQuotes-Demo account, $10,000 deposit, 1:100 leverage — same account/deposit/leverage
  convention as the prior 30-day fixed-SL isolation replay.
- **History Quality: 100%**, Bars: 5,502, Ticks: 219,957, Symbols: 1 — confirms genuine
  tick data was loaded and processed, not a partial/degraded run.
- **Total Net Profit: +$10,839.11**
- Gross Profit $36,332.41 / Gross Loss -$25,493.30, **Profit Factor 1.43**
- **Total Trades: 116** (44 short, 63.64% won; 72 long, 70.83% won), 232 total deals
- Profit trades 79 (68.10%), Loss trades 37 (31.90%)
- Expected Payoff $93.44, Recovery Factor 1.62, Sharpe Ratio 8.97
- **Balance Drawdown Maximal: $6,437.46 (43.97%)**, **Equity Drawdown Maximal: $6,674.64
  (44.98%)**
- Largest profit trade $4,144.16, largest loss trade -$1,820.00
- Order comments in the raw report confirm `XAU-SNIPER|ORIG=SELL|EXEC=SELL` format —
  matches the rebrand ledger's claim that this identifier was left untouched.

Full evidence copied into the repo at `audits/xaucloud/60d_replay_evidence/`:
`xaucloud_audit_60d.htm` (the real MT5-generated report), the three chart PNGs it
produced, `compile.log` (the deployable-candidate compile), and `ex5_sha256.txt`.

## Honest reading — not spun either direction

- This is a genuinely positive result: profitable over 60 real-tick days, consistent
  win-rate skew long-favored (70.83% vs 63.64%), profit factor comfortably above 1.
- **The drawdown (43.97%/44.98%) is materially higher than the previously recorded 30-day
  fixed-SL isolation run's drawdown (35.24%/36.93%, from
  `analysis/m10_fixed_sl_experiment/M10_FIXEDSL_ISOLATION_REPLAY.md`).** This is not
  explained away here — it could be a different, harder 30-day sub-window inside this
  60-day span, a longer-window compounding effect, or something else. Determining which
  requires actually looking at the trade-by-trade drawdown timeline, which was not done
  in this pass (scope discipline — this session's job was to get real replay evidence, not
  re-open a new strategy investigation). Flagged as a follow-up question, not resolved.
- **This is one 60-day window, in-sample relative to nothing (no holdout split was run
  here).** It does not prove future performance and should not be read as a guarantee.
- **This replay used the Tester-only variant**, not the exact deployable binary. The
  difference is a single non-trading-logic string default, verified with `diff` before
  compiling — but stated plainly here rather than glossed over.
- **Still not done**: Mac/VPS runtime verification (confirming the deployable-candidate
  hash `948aeee5...` is what's actually attached and running on both terminals), an
  out-of-sample holdout replay, and everything else in
  `audits/xaucloud/05_live_step_packages.md` §3-6.

## Manifest updated, but not promoted

`backend/ea_releases/manifest.json` now has a real `v6.25.24` entry with the genuine
compile hash and this replay's real numbers in its release notes. `current_version` was
**deliberately left at `v6.25.8`** — this replay plus a clean compile are necessary but
not sufficient for promotion; Mac/VPS runtime verification is still required first (see
`05_live_step_packages.md` §3).
