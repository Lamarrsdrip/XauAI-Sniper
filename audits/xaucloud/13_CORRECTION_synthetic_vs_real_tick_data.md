# CORRECTION: Prior "60-Day Replay" Evidence Used Synthetic Ticks, Not Real Ticks

## What was wrong

Every MT5 Strategy Tester `.ini` config used in this session (and, it appears,
by prior sessions working in this sandbox — every historical `.ini` file
checked used the same setting) had `Model=1`. In MetaTrader 5's Tester
config format, `Model=1` means **"1-minute OHLC"** — ticks are synthetically
generated from 1-minute bar data (a small fixed number of interpolated
price points per bar), not genuine variable-resolution real tick data.
`Model=4` is **"Every tick based on real ticks"** — the actual historical
tick stream.

This was not caught earlier because MT5's report correctly showed "History
Quality: 100%" under `Model=1` too — that field describes the completeness
of the underlying bar history used to build the synthetic model, not
whether genuine real ticks were used. The tick *count* was the tell
(219,957 ticks over 60 days under `Model=1` vs. 23,648,730 ticks over the
same 60 days under `Model=4` — two orders of magnitude difference) but this
was not checked at the time.

## What this affects

- `08_60day_replay_results.md` and the published artifact
  (https://claude.ai/code/artifact/150e464f-9159-47b4-bd9a-c9c26e1d8bd4):
  the reported +$10,839.11 net profit, PF 1.43, 43.97%/44.98% drawdown for
  the 10-minute-extension configuration was run under `Model=1`.
- `10_extension_window_experiment.md`: the 0/5/10-minute comparison
  (no-extension +$2,234.86, 5-min +$6,134.02, 10-min +$10,839.11) was
  entirely `Model=1`-based.
- `FINAL_RELEASE_GATE.md`: was updated to treat the `Model=1` 60-day replay
  as closing the "real-tick MT5 replay" gap. **It did not.**

## What the real-tick rerun actually shows

Same exact compiled binary (SHA-256 `07e45b8afe6a43ffeadc3f5ab0e4db11c6f0ea3b8768bef3a151efe3fedcfcee`),
same 60-day window (2026-05-22 to 2026-07-21), same account/deposit/leverage,
`Model=4` (confirmed "100% real ticks" in the report, 23,648,730 ticks):

| | `Model=1` (synthetic, reported earlier) | `Model=4` (genuine real ticks) |
|---|---:|---:|
| Net profit | +$10,839.11 | **-$3,406.54** |
| Profit factor | 1.43 | **0.84** |
| Max balance/equity DD | 43.97% / 44.98% | **66.10% / 66.92%** |
| Ticks | 219,957 | 23,648,730 |

The strategy's qualitative outcome flips from profitable to lossmaking for
this exact 60-day window once genuine tick-level price ordering replaces
the synthetic 1-minute interpolation. This is a materially different
finding, not a rounding difference.

## Immediate corrections

- `FINAL_RELEASE_GATE.md` real-tick-replay gate is **reopened** — the
  `Model=1` run does not satisfy it. See the updated verdict below.
- The published 60-day artifact needs a correction banner (in progress).
- Any further extension-window or +0.15R-protection experimentation in this
  session uses `Model=4` exclusively going forward.

## Why this happened and how it's being prevented going forward

Every `.ini` used this session was adapted from a pre-existing template
(`v62524_m10fixedsl_30d.ini`, itself copied from earlier session work) that
already had `Model=1` set, and it was never verified against MT5's actual
Model enum before being reused repeatedly. The fix going forward: every
Tester config in this experiment explicitly sets `Model=4` and its
resulting report's tick count is sanity-checked against the window length
before any result is trusted.
