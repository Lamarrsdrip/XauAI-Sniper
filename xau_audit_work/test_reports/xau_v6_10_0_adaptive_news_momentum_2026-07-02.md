# XAU AI Sniper v6.10.0 Adaptive News Momentum Audit

Date: 2026-07-02

## Problem

The EA treated scheduled high-impact news as a binary calendar block. That protected the first dangerous release impulse, but it also kept the bot blocked after spread and structure had normalized. The observed failure was a missed post-Jobless-Claims XAUUSD continuation move.

## Root Cause

The existing `IsScheduledNewsWindow()` path blocked the whole Thursday Jobless Claims and Friday US data window. `XAU_NewsAftermathCanFastTrack()` also refused fast-track while the scheduled window was active, so a valid continuation signal could remain blocked even after the release chaos had settled.

## Fix

Added `v6.10.0_ADAPTIVE_NEWS_MOMENTUM_ENGINE` on top of v6.9.0:

- `NEWS_PROTECTION`: pre-news entries blocked, open trades still managed.
- `NEWS_RELEASE_COOLDOWN`: first post-release minutes observed, no first-candle chasing.
- `NEWS_OBSERVING`: post-release calendar block becomes a confirmation gate instead of a blind block.
- `NEWS_ENTRY_ALLOWED`: allows only confirmed continuation after spread normalization, impulse direction match, midpoint hold, M5/M15 momentum, HTF/regime alignment, room, RR, grade, and AI-confidence checks.
- Anti-chase blocks: `NEWS_ENTRY_BLOCKED_OVEREXTENDED`, `NEWS_ENTRY_BLOCKED_SPREAD`, `NEWS_ENTRY_BLOCKED_POOR_RR`.
- Post-news risk multiplier: `NEWS_POST_RISK` applies after grade-floor enforcement.

## Files Changed

- `XAUUSD_AI_Sniper_EA_v6.10.0.mq5`
- `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- `backend/server.py`
- `frontend/src/components/DownloadSection.jsx`
- `frontend/src/components/Footer.jsx`
- `frontend/src/components/FeaturesSection.jsx`
- `frontend/src/components/AdminPortal.jsx`
- `frontend/src/components/cloud/CloudLanding.jsx`
- `frontend/src/components/cloud/CloudDashboard.jsx`
- `tests/test_xau_v6100_adaptive_news_momentum_static.py`
- release/static test fixtures updated to point at v6.10.0.

## Verification

- MetaEditor compile: `test_reports/metaeditor_v6100_adaptive_news.log`
  - Result: 0 errors, 0 warnings.
- Static tests:
  - `pytest -q tests`: 200 passed.
- Frontend build:
  - `npm run build` in `frontend`: compiled successfully.
- Full root `pytest -q` is still blocked by the existing unrelated `/app/frontend/.env` assumption in `backend/tests/test_cloud_billing_and_copy_trading.py`.

## Download Integrity

The public download source is synced to v6.10.0:

- Named source: `XAUUSD_AI_Sniper_EA_v6.10.0.mq5`
- Public download source: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`
- Public filename prefix: `XAUUSD_AI_Sniper_EA`
- Admin-only master filename prefix: `XAUUSD_AI_Sniper_EA_MASTER`
