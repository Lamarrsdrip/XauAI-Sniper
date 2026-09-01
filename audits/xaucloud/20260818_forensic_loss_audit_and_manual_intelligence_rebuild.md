# Forensic loss audit and Manual Trading Intelligence rebuild — 18 August 2026

## Evidence scope and limits

This report uses the production `trade_journal`, `cloud_bot_activity`,
`cloud_bot_heartbeats`, and `four_hour_outlook_history` collections, read on
18 August. No production records were changed during the audit.

The local Mac MT5 journal available in this workspace ends on 26 July 2026.
It therefore cannot prove the exact start/end of the claimed 16–18 August Mac
offline interval. The VPS account continued to report production activity from
17 August 09:34 UTC and heartbeats from 18 August 13:35 UTC onward. Its
continuity is direct evidence that a Mac terminal outage did not stop this VPS
EA; a shared cloud/backend decision dependency remains possible and was traced
below.

`cloud_bot_activity` has a 2,000-row rolling retention policy. It retained
enough recent evidence for the loss cluster but not full decision snapshots for
the earliest entries. That is an observability failure, not a reason to invent
entry explanations. The rebuild adds a durable broker-candle store and a
180-day entry/exit evidence log.

After the initial application-log review, the active production MT5 terminal
was read through its official local Python bridge. The closed-only export is
provenanced as `Exness-MT5Trial9` / `XAUUSDm` (3 digits) and contains 900 H1,
250 H4 and 90 D1 bars. Its 2026-08-18 UTC export timestamp and SHA-256 input
fingerprint are recorded in
`20260818_manual_intelligence_broker_replay.json`. No external, futures,
spot, synthetic, or proxy price data is used in that replay.

## VPS loss reconstruction

The affected VPS identity reports `XauCloud-60pips_v6.27.2`, M5, on
`XAUUSDm`, with build label `xaucloud-60pips-production-20260813`. The checked
in production source is `backend/ea_code/XauCloud-60pips.mq5`; its SHA-256 is
`e5146af7691d2023ef317331d3c4a0925bfb9f132139e105ebc634acc1a04d4a`, matching
the v6.27.2 release manifest. The active VPS EX5 is also byte-verified against
that manifest (SHA-256
`d5ae1a46984432314f09057e399b470d802687a3a77572aeacd2025438adc96c`), so no EA
binary update is warranted.

| Open UTC | Ticket | Side | Entry → exit | P/L | Journal regime | Entry family / outcome |
|---|---:|---|---|---:|---|---|
| 17 Aug 09:02 | 3093925625 | SELL | 4394.85 → 4404.85 | -$1,110.00 | TREND_UP | TREND_PULLBACK B, broker SL |
| 17 Aug 11:12 | 3094467393 | BUY | 4402.66 → 4392.66 | -$2,250.00 | TREND_UP | TREND_PULLBACK A+, broker SL |
| 17 Aug 13:02 | 3095088190 | SELL | 4383.47 → 4393.23 | -$1,951.20 | TREND_UP | NORMAL, broker SL |
| 17 Aug 23:02 | 3097829138 | SELL | 4412.01 → 4420.80 | -$2,135.00 | TREND_UP | NORMAL, broker SL |
| 18 Aug 05:52 | 3098747657 | BUY | 4395.75 → 4401.83 | +$942.56 | TREND_UP | M10 originated A+, EA profit close |
| 18 Aug 07:42 | 3099103734 | BUY | 4402.53 → 4392.53 | -$2,570.00 | TREND_UP | NORMAL, broker SL |
| 18 Aug 09:02 | 3099454270 | BUY | 4394.00 → 4400.58 | +$1,152.55 | TREND_DN | Outlook signal, EA profit close |
| 18 Aug 13:02 | 3100467100 | BUY | 4392.76 → 4380.94 | -$3,145.18 | TREND_DN | NORMAL, broker SL |
| 18 Aug 15:02 | 3101554622 | SELL | 4369.45 → 4375.93 | -$1,147.67 | BRKT_DN | NORMAL, broker SL |

Total: **9 trades, 2 wins, 7 losses, -$12,213.94**. Both directions lost
heavily (BUY -$5,870.07; SELL -$6,343.87). Six `TREND_UP` trades netted
-$9,073.64. Seven of nine closes were broker stops, so the primary damage was
not a premature EA exit: it was repeated, poorly aligned entry direction and
timing under rapidly changing short-horizon evidence.

The retained activity also proves a concrete contradiction: while a live SELL
was being managed on 17 August, the journal regime was `TREND_UP`; the M10
candidate repeatedly remained SELL/`STRUCTURE_OPPOSES` despite balanced
pressure and very low reported trend health. Later on 18 August the telemetry
reported `atr_m5` values around 4,395 while XAUUSD traded near 4,389. That
field is malformed for an ATR and must not be used in high-timeframe sizing.

## Why the old Manual Trading Intelligence was poor

The prior implementation was not a genuine 4H model:

1. Its directional score awarded points directly to `market_thesis.direction`,
   M10 preferred direction, M10 case scores and M10 pressure. Its H1/H4
   confirmation was built from at most 24 hours of surviving activity ticks.
2. It mixed all accounts into one synthetic candle stream. A Mac and VPS
   broker feed could therefore alter the same displayed series.
3. It had no durable Daily/H4 source, no unique persisted thesis, and replaced
   the card on confidence collapse as readily as on structural invalidation.
4. History shows 110 forecasts in five days, including **21 direction flips**.
   74 were sourced from `yahoo:GC=F` and one from `kraken:PAXGUSD(spot)` before
   the EA-stream change, so displayed XAUUSD levels were not reliably the
   customer broker price. The subsequent 35 EA-stream forecasts still made 16
   flips, confirming that the core M10-led bias was the larger fault.

For example, the active old SELL forecast generated at 19:15 UTC claimed
240–400 pips while showing `room_to_run: 0.0R`, buyers in control, trend health
3/100, and a 66.6-point preferred-entry range. This is internally inconsistent
target generation, not high-conviction swing analysis.

## Rebuild delivered

The new backend:

- persists verified EA broker bid/ask observations into account-scoped H1, H4,
  and D1 OHLC buckets; it never mixes Mac/VPS streams;
- rejects missing, crossed, stale (>10 minutes), malformed, or out-of-range
  prices; cached or external prices cannot be served as current;
- fails closed with **NO HIGH-CONVICTION SETUP** until 20 D1, 30 H4, and 80 H1
  broker candles exist;
- establishes direction from weighted Daily/H4/H1 structure only. M10 is
  displayed solely as entry-timing context;
- classifies an explicit regime before a trade thesis; calculates runway to an
  actual recorded opposing structure; derives T1/T2/T3 as fractions of that
  runway; and refuses a target without at least 100 pips of real room;
- persists a thesis ID, status, targets, invalidation, evidence, data time,
  and current state. A SELL reversal now requires opposite Daily + H4 + H1
  structure and at least 75% confidence, or the existing structural
  invalidation to be breached. Ordinary pullbacks become `PULLBACK_WITHIN_THESIS`
  or `WEAKENING`, never an automatic opposite call;
- writes an `MTI_DECISION` diagnostic record for each review and retains
  structured entry/exit decision evidence for 180 days.

## Evaluation and remaining risk

Focused tests pass: 60 backend tests, backend typecheck, 75 frontend tests,
and a production frontend build. New tests cover no setup, confirmed BUY/SELL,
pullback non-flip, confirmed reversal, runway rejection, stale-price rejection,
malformed-price rejection, and initial history accumulation.

The chronological 30-day replay now uses the terminal's own closed D1/H4/H1
export (19 July 16:00 UTC through 18 August 16:00 UTC). Each decision sees only
bars already closed at that timestamp; later H1 bars are used only to classify
the next-day outcome. It produced 135 evaluations, 4 qualifying BUY theses, no
direction flips, 2 T1 reaches, no invalidations, and 2 one-day expiries. This
is an outcome classification—not a profitability or live-trading claim—and
the JSON record preserves every decision and input fingerprint. By contrast,
the old card generated 110 forecasts and 21 flips in five days, including
external/futures/spot sources before it was rebuilt. The new replay is broker
specific and HTF-only for direction.

The automated EA is intentionally not changed in this patch. The evidence
identifies its main cluster as M10 direction/regime disagreement and repeated
broker-stop entries, but the short-retention data cannot reconstruct every
pre-entry gate for the earliest trades. The new durable EA decision log is the
prerequisite for a safe, entry-family-specific EA correction rather than an
untested global restriction.
