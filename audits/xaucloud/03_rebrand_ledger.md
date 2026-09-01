# XauCloud Rebrand Ledger (Phase 5)

Every visible "XAU AI Sniper" / "XauAI Sniper" / "XAUAI" / "XauAISniper" / "XAUUSD AI Sniper"
surface was classified safe/unsafe before touching anything (see initial scoping in this
session). This ledger records exactly what was changed and, for every legacy identifier
intentionally retained, why.

**Domain**: `xauaisniper.com` is unchanged everywhere (env defaults, `#property link`,
docs) per explicit owner instruction — never touched.

## Changed (safe, user-facing)

- **Frontend** (`frontend/src/`): `Header.jsx`, `Footer.jsx`, `HeroSection.jsx`,
  `DownloadSection.jsx` (2 strings), `CloudPromoSection.jsx`, `AdminPortal.jsx`,
  `cloud/CloudLanding.jsx` (2 strings), `cloud/InstallAppPrompt.jsx`,
  `cloud/CloudAuth.jsx` (2 strings), `cloud/CloudDashboard.jsx`, `lib/onesignal.js`,
  `pages/AIMarketOutlookPage.jsx`, `cloud/XauAiLogo.jsx` (`alt` text + doc comment) — all
  visible/display text renamed to XauCloud.
- **PWA metadata**: `frontend/public/manifest.json` (`name`, `short_name`, `description`),
  `frontend/public/index.html` (`<title>`, meta description, `apple-mobile-web-app-title`).
- **Backend user-facing strings** (`backend/server.py`): PIN-delivery email heading +
  subject, password-reset email heading + subject, root API welcome message, TOTP issuer
  label, `/architecture` + all four `/docs/*` endpoints (also where the XC-001 M30-mode
  fix landed), conscious-memory report heading, license-key validation error message,
  two XauIndex-comparison code comments.
- **EA cosmetic strings** (`XAUUSD_AI_Sniper_EA.mq5` + `backend/ea_code/` mirror, kept
  byte-identical throughout): `#property copyright`, `#property description`, the startup
  `Print()` banner, the 24h forward-test report `FileWrite()` header, and the on-chart
  dashboard string. Verified: no test or parser anywhere matches these exact banner
  strings (grepped `tests/`, `backend/`, `scripts/` before changing); the one existing
  test that references a similar literal (`test_xauindex_v3_1_0_identity_static.py`)
  asserts XauIndex's *own* source does not contain "XAUAI SNIPER" — unaffected, since
  that file wasn't touched and the assertion was never about this file's content.

## Retained — internal/compatibility identifiers (do not rename, with reason)

| Identifier | Where | Why retained |
|---|---|---|
| `_get_ea_meta(filename_prefix="XAUUSD_AI_Sniper_EA"\|"..._MASTER")` | `backend/server.py:1049,1191` | Filename prefix is used as a literal lookup/match key against files under `ea_code/` and repo root. Renaming without also renaming those files and every call site would 404 the download/version-detection endpoints. |
| `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, `backend/ea_code_xauindex/XauIndex_EA.mq5`, root-level versioned `.mq5`/`.ex5` snapshots | filesystem | Same reason — these are load-bearing paths, not display text. The ~180 historical version snapshots at repo root are archival only (not referenced by backend code) and were left alone rather than mass-renamed for cosmetic reasons. |
| `XAUAI_TradeBrain_v1.csv`, `XAUAI_ForwardTest_*.txt`, `XAUAI_StratWeights_v1.csv`, `XAUAI_ExecutedTradeBrain_*`, `XAUAI_BlockedTradeMemory_*`, `XAUAI_TradingIntelligence_*` | EA-generated file prefixes, MQL5 source | Cross-referenced as expected filename prefixes in `backend/analytics/xau_attribution_report.py` (argparse help-text and glob patterns). Renaming without updating that tool breaks existing customer-generated telemetry files it already expects. |
| Order-comment strings (`"XAU-SNIPER\|ORIG=..."`, `"XAU-SNIPER\|PYRAMID_TWO_GATE..."`) | `XAUUSD_AI_Sniper_EA.mq5` (OpenTrade / pyramid send sites) | Parsed for CORE-vs-PYRAMID reconciliation/logging (confirmed in the Phase 2 EA audit). Not customer-visible branding in the ordinary sense (brokers show order comments in the terminal, not the product's marketing identity) and changing the prefix risks breaking any existing reconciliation tooling keyed on it. |
| `#define XAUAI_EA_VERSION`, `XAUAI_BUILD_HASH`, `XAU_TRADEBRAIN_SEED_SCHEMA "XAUAI_TRADEBRAIN_SEED_V1"` | `XAUUSD_AI_Sniper_EA.mq5` macros | Internal macro/schema identifiers, not rendered to customers directly (their *values* are interpolated into the banners that WERE renamed above). Renaming the macro name itself is a pure internal-identifier change with no user-facing benefit and nonzero risk of a missed reference. |
| `sessionStorage` keys `xauai_cloud_banner_dismissed`, `xauai_install_dismissed_at` | `frontend/src/components/cloud/CloudFunnelBanner.jsx`, `InstallAppPrompt.jsx` | Internal client-side persistence keys. Renaming resets every existing visitor's dismissed-banner/prompt state for zero user-visible benefit (the *displayed* text at these components was already renamed). |
| Component filename `XauAiLogo.jsx`, asset path `/xauai-logo.png` | `frontend/src/components/cloud/` | Internal filenames, not displayed to users. Renaming is purely cosmetic-to-developers and carries a nonzero risk of a missed import/reference for no customer-visible benefit — the component's actual rendered `alt` text and doc comment (what a screen reader or future maintainer reads as "what is this") were already corrected. |
| Env var **names** (`MONGO_URL`, `DB_NAME`, `JWT_SECRET`, etc.) | `backend/server.py`, deployment config | Confirmed (Phase 0/3) that **none** of these names contain "xauai" already — nothing needed changing, and this is noted so it's clear the check was made, not skipped. |
| DB name / Mongo collection names | MongoDB | Same — grepped, none contain "xauai"; no rename needed or performed. |
| TOTP issuer label rename (`XauAISniperAdmin` → `XauCloudAdmin`) | `backend/server.py:777` | Renamed (it's cosmetic/display-only, doesn't affect the underlying MFA secret), but flagged: any admin already enrolled will see the **old** issuer label in their authenticator app until they re-scan/re-enroll. This does not break MFA — the secret and validation are unchanged — only the label shown in an already-added authenticator entry is stale until re-enrollment. |

## Compiled customer artifact filename (`XauCloud.ex5`) — deferred, not fabricated

The owner directive requires the customer-facing compiled file to be named exactly
`XauCloud.ex5`. The download architecture already supports this with **zero code
change**: `/download/ea-release` (`backend/server.py:1136-1166`) serves the file under
`release["customer_filename"]` — a value read from `backend/ea_releases/manifest.json`,
completely decoupled from the actual stored artifact path (`release["ex5_filename"]`).
Changing the served filename is a **manifest data change**, not a code change.

However: `manifest.json`'s `current_version` is still `v6.25.8` — the v6.25.24 M10
fixed-SL work on this branch has never been compiled into a real, hash-verified
`ea_releases/` entry (confirmed: no MetaEditor/Wine toolchain available in this session
to compile it, matching the existing code comment at `server.py:1079-1084` that this
backend has never compiled EA binaries on demand). **Two source edits were made this
session** (the XC-002 re-entry-cap fix and the cosmetic rebrand strings), which means
the `.ex5` binary already checked into the repo root and `backend/ea_code/` no longer
matches the current `.mq5` source — it must be recompiled before any release claim.

Adding a fabricated manifest entry with an invented hash would be exactly the kind of
"unverified claim" the owner's brief prohibits. Instead, the exact manifest entry to add
**after** a real MetaEditor compile is packaged in Phase 8 (live-step package), ready to
paste in once you have a real `0 errors/0 warnings` result and a real SHA-256.

## Verification

- `py_compile backend/server.py`: passed after every backend string edit.
- `cmp` confirmed root/backend `.mq5` byte-identity preserved after every EA edit.
- Grepped `tests/`, `backend/tests/`, `scripts/` before each rename for any test/tooling
  match on the literal strings being changed — none found except the XauIndex distinctness
  test noted above, which is unaffected.
- Full repo grep after all changes: no remaining "XAU AI Sniper" / "XauAI Sniper" /
  "XAUUSD AI Sniper" in `frontend/src` outside the pre-existing forensic contract test
  (which doesn't assert on brand strings) or in the EA banners/backend strings listed above
  as changed.
