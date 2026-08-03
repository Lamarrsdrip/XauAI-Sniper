# MetaQuotes Market Listing — XauCloud

Draft submission-form content. Sourced from `docs/*` and
`audits/xaucloud/17_market_edition_claude_xaucloud.md` — no claim here
that isn't already backed by those documents.

## Product name

**XauCloud**

## Suggested category

Expert Advisors → Forex / Metals (Gold). MQL5 Market's category tree is
confirmed at submission time in the seller portal; this is the closest
fit given the EA is XAUUSD-only by design (see `SYMBOL_COMPATIBILITY.md`).

## Pricing (owner-directed)

- **Lifetime purchase: USD $250.00** (fixed, not free).
- **Suggested rental tiers** (proportioned off the $250 lifetime price,
  not independently verified against any market-rate benchmark — the
  owner should sanity-check these before submission):
  - 1 month: **$45**
  - 3 months: **$110**
  - 6 months: **$190**
  - 1 year: **$260** (intentionally close to lifetime price, so lifetime
    remains the obviously better long-term deal)
- Activations per sale: **10** (mid-range of MQL5's allowed 5–20; not
  specified by the owner, chosen as a reasonable default — raise if you
  expect buyers to commonly run this on more than a couple of machines).
- MetaQuotes charges 20% of every sale; net proceeds at $250 = $200.

## Recommended symbol and timeframe

- **Symbol: XAUUSD only.** Designed, compiled, and tested against gold.
  `IsXAUFastSymbol()` gates some memory/telemetry features on the symbol
  name containing "XAU" or "GOLD" (case-insensitive) — other symbols are
  not guaranteed to behave correctly and have not been tested.
- **Timeframe: attach on any chart timeframe — the EA's own decision
  cycle is fixed to M10 internally** (it reads M10 data regardless of
  the visible chart period). State this clearly to avoid buyer confusion
  about which chart timeframe to open.

## SEO-friendly keywords

gold EA, XAUUSD expert advisor, deterministic trading robot, no AI
trading bot, offline expert advisor, M10 gold strategy, risk-managed
gold EA, no network EA, MetaTrader 5 gold robot, rule-based trading
system, structural stop loss EA, XAU trading robot

## Product metadata

- Product name: **XauCloud**
- Product type: Expert Advisor (MetaTrader 5)
- Version: **1.00**
- Magic number: **26080301**
- Platform: MetaTrader 5 only (no MT4 build produced)
- Account type: Any (no netting/hedging-specific dependency identified —
  owner should confirm against `SYMBOL_COMPATIBILITY.md`/testing before
  restricting this field)
- Expert Advisor type tag: **Trend** (structured regime/direction/entry-
  quality scoring with a fixed structural stop and profit-lock exits —
  not martingale, grid, arbitrage, hedging, scalping, news, neural-network,
  or multicurrency by design)

## Short description (~200 chars, for listing cards/search results)

> Deterministic gold (XAUUSD) M10 Expert Advisor. No AI, no cloud, no
> network calls — every decision runs locally from your own chart data.
> Forked from a live production trading engine.

## Full description

XauCloud is a self-contained MetaTrader 5 Expert Advisor for
XAUUSD (gold), built around a 10-minute (M10) decision cycle. It is a
direct fork of a live, cloud-connected trading product — but every AI/LLM
call, cloud backend dependency, remote-command channel, and copy-trading
link has been removed. What ships here is the deterministic local engine:
market regime detection, direction and entry-quality scoring, risk-based
position sizing, trade management, and exits — computed entirely on your
own machine, from your own broker's chart data. There is nothing to
whitelist, no server to reach, and no external dependency of any kind.

**What it does:**
- Scans XAUUSD on the M10 timeframe for qualifying entry setups using a
  structured regime/direction/entry-quality scoring model.
- Sizes every trade against a single, explicit risk-percentage input
  applied to the real stop-loss distance — one risk authority, no hidden
  overrides.
- Manages open trades with a rules-based exit system (structural stop,
  profit-lock/ratchet behavior, and time/structure-based management).
- Applies a set of hard, non-negotiable structural entry blocks that
  cannot be overridden by any other part of the system.

**What it deliberately does not do:**
- No AI or machine-learning model runs at any point during live trading —
  not disabled by default, genuinely absent from the code path.
- No outbound network call of any kind (`WebRequest`, DLL, or otherwise) —
  verified by a static sweep of the compiled source.
- No remote control surface — nothing outside your own terminal can pause,
  stop, or force a trade.

**Where the trading logic comes from:** the regime, direction,
entry-quality, risk, and exit engines in this build are the same code
already running in the source product's live/cloud edition — this is a
network-removal fork, not a rewrite. See `STRATEGY_OVERVIEW.md` in the
docs package for exactly what that does and does not establish about
*this specific compiled build's* own track record (short version: the
logic is proven elsewhere; this exact `.ex5` has not yet accumulated its
own independent trading history).

**Honesty note on AI-sounding names:** some input labels and internal
code comments still say "AI" (e.g. `InpUseAI`, `AI DIRECTOR` input group)
because this is a fork, not a rewrite from a blank file — those inputs
are wired to nothing now (see `KNOWN_LIMITATIONS.md`). Nothing in this
product calls an AI model.

## Feature list (bullet form for the listing page)

- Deterministic M10 gold (XAUUSD) trading engine — zero AI dependency
- Zero network calls — verified, not just claimed (WebRequest/DLL/import
  all confirmed absent by static analysis of the compiled source)
- Single, explicit risk-percentage position sizing
- Rules-based stop-loss and profit-management/exit system
- Hard structural entry blocks that cannot be bypassed
- Restart/reconnect state recovery (loss-streak and position
  reconciliation on reattach)
- Runs entirely on your own VPS/terminal — nothing to whitelist, nothing
  phoning home
- Forked from a live production trading engine's proven decision logic

## Installation guide (for the listing's install section)

See `docs/INSTALLATION.md` — summary: copy `XauCloud.ex5` to
`MQL5/Experts`, attach to an XAUUSD chart, review `InpNormalRiskPct` and
`InpMaxSpread` before first run. No WebRequest URL whitelist entry is
required.

## Parameter descriptions

See `docs/INPUTS_REFERENCE.md` for the full 883-input reference (grouped
by subsystem) and the "inputs most people actually need to touch" summary
table.

## FAQ / Support

See `docs/FAQ.md` and `docs/SUPPORT.md`.

## Changelog

See `docs/CHANGELOG.md` — v1.00, initial Market release.

## Recommended VPS specification

1 vCPU / 1–2 GB RAM is a reasonable minimum for a single-symbol MT5 EA
with no network dependency. **Not load-tested for this specific build** —
stated as an estimate, not a verified benchmark. See `FAQ.md`.

## Assets

- Icon: `assets/icon_512.png` (also 256/128/64 variants)
- Banner: `assets/banner_1200x300.png`
- Store thumbnail: `assets/store_thumbnail_590x330.png`
- **Screenshot: not included.** A genuine Market screenshot requires the
  compiled EA actually attached to a live/demo chart with the terminal
  window captured — this needs to be done by the account owner (or with
  GUI screen-capture tooling this session doesn't have). Do not submit
  without at least one real screenshot; MetaQuotes Market listings
  without a product screenshot are unusual and likely to look incomplete
  to reviewers and buyers alike.

## Pre-submission checklist

- [x] MetaQuotes Market compliance audit complete — 4 real hardening
      fixes applied (2 indicator-handle leaks, 1 unbounded array, 6
      unbounded log files), zero network/DLL surface reconfirmed after
      fixes. See `audits/xaucloud/20_market_compliance_audit.md`.
- [x] Real Strategy Tester validation run against the exact final
      compiled build (post-compliance-fixes, post-rename) — 7-day,
      100%-real-tick XAUUSD M10 run, 4 trades, no crash across 2.95M
      ticks. See `audits/xaucloud/20_market_compliance_audit.md` and
      `audits/xaucloud/claude_xaucloud_qc_evidence/`.
- [x] Final compile: 0 errors, 0 warnings.
- [x] Product renamed to **XauCloud** (was drafted as "Claude XauCloud"
      earlier in this session — owner corrected this; all customer-facing
      strings, docs, and assets updated).
- [ ] Confirm `InpMagicNumber` (`26080301`) doesn't collide with anything
      else you run on the same account.
- [ ] Replace `docs/SUPPORT.md` placeholder contact fields with your real
      support channel.
- [ ] Capture at least one real terminal/chart screenshot — still not
      done; needs the owner's hands or GUI capture tooling this session
      doesn't have.
- [ ] Sanity-check the suggested rental price tiers above before
      submission — proportioned off the $250 lifetime price, not
      independently benchmarked.
