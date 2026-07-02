# XauIndex v1.0.0 — Launch as a Separate Product

Date: 2026-07-02

## Why a separate product instead of a version bump

XauAI Sniper (gold-only) is now maintained on its own, independent lineage —
Codex is actively shipping that line (currently v6.6.1, "No-Limit Loss-Close
Firewall"). The Gold+Index Market Mode architecture built earlier (previously
labeled v6.6.0, then briefly renamed v6.7.0) is a genuinely different
product: it carries market auto-detection, a symbol-agnostic lot engine, and
Index Mode diagnostics that the gold-only lineage does not have. Per explicit
instruction, it now ships under its own name — **XauIndex** — with its own
independent version history starting at **1.0.0**, so the two products are
never confused with one another, by the owner or between the two build
processes working on this repo.

## What changed

- **New file**: `XauIndex_EA_v1.0.mq5` (forked from the former v6.7.0
  content). Rebranded: header title, `#property copyright`/`description`,
  `XAUAI_EA_VERSION`/`_NUM`/`BUILD_HASH` macros, and every user-visible
  `"XAUAI SNIPER"` print/log/report line now says `"XAUINDEX"` instead —
  visible in the MT5 journal, the 24h forward-test report, and the
  heartbeat mode string, so a customer running both bots side by side can
  always tell which is which.
- **Retired**: `XAUUSD_AI_Sniper_EA_v6.7.0.mq5`/`.ex5` removed from the repo
  root and from distribution — that content now lives on as XauIndex 1.0.0
  and would otherwise be a confusing, unserved third file sitting alongside
  the two real products.
- **Backend**: new, fully separate download surface —
  `/api/download/xauindex/info`, `/api/download/xauindex/ea`,
  `/api/download/xauindex/package`, and an admin master-download route —
  reading from its own `backend/ea_code_xauindex/XauIndex_EA.mq5`, entirely
  independent of the gold lineage's `backend/ea_code/` directory. Nothing
  about the gold download path was touched.
- **Frontend**: a second, visually distinct section on the Download page
  (`xauindex-download-section`) with its own heading, its own card, and its
  own `Download XauIndex v1.0.0 .MQ5` / ZIP buttons — clearly separated
  from the existing XauAI Sniper card by a divider and different color
  accent (emerald vs. amber), with copy that explicitly says "not the same
  bot as above."
- **Site-wide version badges** (Footer, Command Center header, Admin header,
  generic feature badges) now correctly reference the gold lineage's live
  version (v6.6.1) again — they had briefly drifted to v6.7.0 during the
  Market Mode work before the two products were split apart. The one
  feature card describing Gold+Index detection is now explicitly labeled
  "(XauIndex)" with its own `v1.0.0` badge instead of implying it ships in
  the mainline gold bot.

## Verification

- Compiled standalone: `test_reports/metaeditor_xauindex_v1_0_0.log` —
  **0 errors, 0 warnings**.
- New regression suite `tests/test_xauindex_v1_0_0_identity_static.py`
  (5 tests): source/backend sync, independent versioning/branding, file
  separation from the gold lineage, and that both the download page and
  backend actually wire up XauIndex's own endpoints rather than reusing the
  gold ones.
- Full suite: **149/149 passed** (also repaired several legacy tests whose
  hardcoded file paths/version literals pointed at the now-retired v6.7.0
  file instead of Codex's current gold build — pure test-housekeeping, no
  gold EA content was touched).
- Did not touch `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`,
  `XAUUSD_AI_Sniper_EA_v6.6.1.mq5`, or any of Codex's other gold-lineage
  work at any point in this change.

## How the two products differ today

Both currently trade gold identically (same exit engine, same protections).
The only functional difference is XauIndex's Market Mode layer: attach it to
a non-gold chart and it auto-detects and logs `INDEX_MODE_MONITORING_ONLY`
diagnostics without ever placing a trade — a capability the gold-only
lineage does not have and isn't intended to.
