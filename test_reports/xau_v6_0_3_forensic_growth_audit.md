# XAUAI v6.0.3 Forensic Growth Audit

Generated: 2026-06-24

Evidence used:

- Local MT5 trade brain:
  `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_ExecutedTradeBrain_XAUUSD.csv`
- Local MT5 blocked-trade memory:
  `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_BlockedTradeMemory_XAUUSD.csv`
- Local MT5 unified intelligence:
  `/Users/libertyelectronics/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/XAUAI_TradingIntelligence_XAUUSD.csv`
- User screenshots from VPS-connected accounts showing the same EA behavior on other accounts.
- Code regression comparison from v5.9.1 to v6.0.2/v6.0.3.

## A. Bot Bad Or Market Bad?

Not simply "market bad." The bot still made strong money in the sample, but the current poor behavior is mostly a bot behavior/risk-selection problem after a large mid-period hit.

30-day local evidence:

- Closed trades: 133
- Net profit: +$228,874.96
- Win rate: 63.2%
- Profit factor: 1.78
- Average floating drawdown: -$5,707.38
- Largest floating loss: -$57,750.00

Old good phase, 2026-06-08 to 2026-06-15:

- Trades: 45
- Net: +$231,043.68
- Win rate: 66.7%
- Profit factor: 2.99
- Average lot: 21.40

Current weak phase, 2026-06-22 to 2026-06-24:

- Trades: 23
- Net: -$117.32
- Win rate: 34.8%
- Profit factor: 0.82
- Average lot: 0.05

Conclusion: the growth stopped because the bot shifted from full-sized trend baskets into tiny, defensive, low-expectancy churn. Market chop may have contributed, but the evidence points first to grade/risk/entry-selection and winner-giveback behavior.

## B. What Changed From The Profitable Version?

v6 added the STI layer, committee/human reasoning, news aftermath handling, and context-aware ratchet logic on top of v5.9.1.

The biggest behavioral difference in the data is not that all trading became bad. It is that A and B remained the profitable personality, while A+ became unreliable:

- A grade, 30 days: 65 trades, PF 63.28, net +$262,026.84
- B grade, 30 days: 23 trades, PF 1.92, net +$49,155.30
- A+ grade, 30 days: 45 trades, PF 0.65, net -$82,307.18

That means the bot's "highest confidence" grade is over-trusting some TREND_PULLBACK conditions. The old growth came mostly from A/B trend baskets, not from blindly sizing every A+ larger.

## C. Top 5 Causes

1. A+ overconfidence regression.
   A+ had negative expectancy despite a non-catastrophic win rate. Previous trade-brain logic reduced weak PF but did not block negative expectancy unless win rate was extremely low.

2. Tiny-lot churn after the mid-period hit.
   Average lot collapsed from 21.40 in the good phase to 0.05 in the current phase. That explains why wins no longer compound and why small losses/wins feel like win-loss-win-loss noise.

3. TREND_PULLBACK is the only dominant strategy and is currently mixed.
   It drove the old growth, so it should not be globally disabled. But the current phase TREND_PULLBACK was 22 trades, PF 0.41, net -$390.37.

4. Profit giveback remains visible.
   The 30-day report found 138 post-close reports where the exit left profit. Several basket hard-cap exits gave back $6k-$11k from peak. Current examples include shield-armed positions that still closed red or weak.

5. Some protective blocks are now expensive.
   DIR-LOCK, ANTI-BIAS, momentum slowdown, and EPF-T4 lockdown showed missed ATR greater than saved adverse ATR. They may be suppressing recovery/growth after losses.

## D. Patch Applied

Version: v6.0.3 FORENSIC GROWTH AUDIT.

Behavior patch:

- Trade Brain now blocks proven negative-expectancy patterns:
  `avgP < 0.0 && pf < InpTradeBrainMinPF`
- This directly targets the damaging A+ pattern without disabling profitable A/B trend behavior.

Forensic logging patch:

- `FORENSIC_ENTRY_SNAPSHOT`
  Logs setup, grade, regime, session, M5/M15/H1/context trend, spread ratio, STI TCP/exhaustion/late-risk, and committee state.
- `FORENSIC_SIZE_STACK`
  Logs grade base multiplier, timing multiplier, adaptive confirm, trade brain, PG/EPF, STI, committee, and final signal multiplier.
- `FORENSIC_CLOSE_DIAGNOSIS`
  Logs best floating profit, profit giveback, giveback percentage, whether protection should have triggered, shield armed state, and final diagnosis.

## E/F. Preserving The Original Personality

The patch does not disable TREND_PULLBACK, does not weaken all A-grade trading, and does not add random strategies.

The aggressive growth behavior is preserved where the evidence says it worked:

- A grade remains untouched unless its own trade-brain history proves negative expectancy.
- B grade remains untouched unless its own trade-brain history proves negative expectancy.
- TREND_PULLBACK remains active because it was strongly profitable during the old-good period.

The only new block applies after enough local memory proves a matching setup/grade/direction has negative expectancy.

## G. Before vs After

Before v6.0.3:

- Active v6.0.2 could identify many timing and exit reasons, but close records did not clearly compute profit giveback, protection-should-have-triggered, or a final diagnosis.
- Trade Brain reduced poor-PF patterns but could continue trading a negative-expectancy pattern if win rate was above the hard block threshold.
- A+ remained allowed despite 30-day PF 0.65 and net -$82,307.18 in local evidence.

After v6.0.3:

- Active/default EA is v6.0.3.
- Download metadata, README, frontend version labels, and server filenames point to v6.0.3.
- Negative-expectancy patterns are blocked by memory.
- Future trades will produce the missing forensic evidence needed to separate bad entry, bad exit, bad market, spread/news, wrong strategy choice, or lot-size suppression.

## H. Remaining Data Needed From VPS

The screenshots are valid behavioral evidence, but full per-trade reconstruction for the VPS accounts requires the VPS MT5 Common/Files exports:

- `XAUAI_ExecutedTradeBrain_XAUUSD.csv`
- `XAUAI_BlockedTradeMemory_XAUUSD.csv`
- `XAUAI_TradingIntelligence_XAUUSD.csv`
- `XAUAI_TradingIntelligence_XAUUSD.jsonl`

The local Mac-side files were found and analyzed. VPS files should be copied into the repo or sent separately to produce the same strategy/entry/exit breakdown for each VPS account.
