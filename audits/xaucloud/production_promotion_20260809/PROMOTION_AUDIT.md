# XauCloud.io production promotion audit — 2026-08-09

## Promoted source

- Candidate lineage: `XauCloud_PATTERN_ENGINE_BREAKOUT_B_V4_AUDITED`, derived
  from the v6.26.3 line.
- Production source: `backend/ea_code/XauCloud.io.mq5`
- Source SHA-256: `d9f88e626d908b97885c869049a72cffa09adfb89d5749b7c9ce91ac27366d2d`
- Production EX5 SHA-256: `c4d7cf6f5160388cbbb2be7fa9644ffc6a94677f740a27327def90aec4e1da54`
- MetaEditor result: 0 errors, 0 warnings. See
  `metaeditor_compile_outlook_fix.log`.

## Lifecycle audit

The audited path is: closed-bar signal evidence → candle/structure/
continuation/liquidity Pattern Intelligence → canonical M10 direction case →
native `ScoreSetups` preselection adjustment → setup candidate →
`BREAKOUT_UP`/`BREAKOUT_DOWN` ownership → M10 endorsement and M30/H1/H4 context
→ timing/freshness/direction-exclusivity gates → final risk geometry and lot
sizing → broker stop reconciliation → `OrderSend` → post-fill SL confirmation →
ratchet/break-even/trailing/close management.

Pattern Intelligence is execution-relevant in two intentionally distinct
layers: bounded canonical M10 buy/sell case evidence (maximum absolute case
contribution 22) and bounded native setup-preselection scoring (maximum
absolute adjustment 2.2). The V4 code does not reapply a post-competition
pattern adjustment, and pattern code has no private order-send path.

Breakout candidates use `OWNER_BREAKOUT_NORMAL`; both directions enter the
existing candidate pipeline and continue through the same confirmation,
timing, safety, risk, broker-stop and order-result gates. There is no breakout
private lane.

Order/modify paths were checked for symbol tick normalization, broker stop and
freeze levels, result retcodes, magic-number consistency, duplicate sends,
re-entry state, SL ratchets and widening. Compatibility magic numbers, order
comment prefixes, license identifiers and telemetry schema identifiers were
retained intentionally.

## Proven bug fixed

The v6.26.3 Outlook branch validated and sized an Outlook trade against its
explicit signal SL, but the normal fixed-stop assignment then overwrote that
SL immediately before `OrderSend`; post-fill reconciliation also expected the
normal stop. The smallest scoped fix preserves and tick-normalizes the explicit
Outlook SL in both places. An invalid Outlook SL still rejects the trade and is
never replaced with the normal stop. Normal candidate/risk behavior is
unchanged.

Normal trades retain the existing fixed `InpStopLossGoldMove=10.00` policy and
protected-floor/ratchet rules prevent later widening; tightening, break-even,
profit trailing and closing remain allowed. Outlook-originated trades are the
explicitly separate exception and retain their validated signal SL. The EA can
guarantee the stop it requests and that it does not intentionally widen it; a
broker stop cannot guarantee the final fill price through a real gap or extreme
spread event.

## Replay evidence

The supplied 100% real-tick MT5 report is preserved as
`XauCloud.io-30day-real-ticks-report.html`. Its summary and 88 deals were parsed
into 44 round trips; per-trade commission/swap-adjusted P/L reconciles exactly
to $9,968.01. The report records PF 2.12, 31W/13L, 70.45% win rate, balance
maximal drawdown $1,824.86 / 13.35%, and equity relative drawdown 16.21%.
The exact replay was not rerun after the Outlook-only execution fix; Strategy
Tester mode does not consume remote Outlook commands, so the supplied replay is
reference evidence rather than a claimed post-fix rerun.
