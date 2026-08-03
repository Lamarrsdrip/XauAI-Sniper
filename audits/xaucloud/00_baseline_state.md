# XauCloud Final Production Audit — Baseline State (Phase 0)

Recorded: 2026-07-24. Canonical project: `/Users/libertyelectronics/XauAI-Sniper-m10-fixed-sl`.
Owner-approved production foundation branch: `experiment/v62524-m10-fixed-sl` @ `210f0e8`.

## Backup and working branch

- Backup tag: `pre-xaucloud-audit-20260724` → `210f0e8` (untouched restore point).
- Finalization branch (this audit's work happens here only):
  `release/xaucloud-final-production-audit`, created off `210f0e8`.
- `main` and `experiment/v62524-m10-fixed-sl` are NOT modified by this audit unless/until
  an explicit merge is approved at the end (see Phase 9 gate).

## Repository/worktree SHA snapshot at audit start

| Branch/worktree | HEAD SHA | Local path | Notes |
|---|---|---|---|
| `experiment/v62524-m10-fixed-sl` (audit base) | `210f0e8` | this repo | owner-designated production foundation (M10 + fixed Gold-move SL + own TradeBrain) |
| `release/xaucloud-final-production-audit` | `210f0e8` (start) | this repo | new, this audit's branch |
| `main` | `e2cebc9` | `/Users/libertyelectronics/XauAI-Sniper-v6257` | 14 commits behind `origin/main`; v6.25.13 line — NOT the production foundation, do not promote |
| `final-v62524-production-20260722` | `e2bca80` | `/Users/libertyelectronics/XauAI-Sniper-v62524-final-audit` | prior v6.25.24 release-gate audit (structural SL, no fixed-SL), 3 behind origin/main |
| `experiment/v62525-full-m5-scan` | `40d6909` | `/Users/libertyelectronics/XauAI-Sniper-m5-experiment` | experimental M5-only entry authority — owner explicitly says NOT to promote |
| `experiment/v62525-m5-tradebrain-learning` | `58f79aa` | `/Users/libertyelectronics/XauAI-Sniper-m5-tradebrain` | experimental — NOT to promote |
| `experiment/v62526-two-m5-scan-m10-execution` | `0f3ee24` | `/Users/libertyelectronics/XauAI-Sniper-hybrid-m5scan-m10exec` | two-M5 hybrid experiment — owner explicitly says NOT to promote |
| `opportunity-recovery-v62525` | `e6fb120` | `/Users/libertyelectronics/XauAI-Sniper-opportunity-recovery-v62525` | separate experiment, tracks its own `origin/opportunity-recovery-v62525` |
| `release-v62514` | `e2cebc9` | `/Users/libertyelectronics/XauAI-Sniper-release-v62514-wt` | older release worktree, 14 behind origin/main |
| `rollback/pre-v62524-final-audit-20260722` | `6d9ae81` | this repo (local branch) | pre-existing rollback point from a prior audit pass |

`origin` = `https://github.com/Lamarrsdrip/XauAI-Sniper.git`. `origin/main` currently points at
`210f0e8` (same as this audit's base) per `git branch -vv` at audit start.

## CI/CD surfaces discovered

`.github/workflows/`:
- `backend.yml` — triggers on push/PR to `main` and `release/**` touching `backend/**`; spins up a
  `mongo:7` service container for tests. **This means pushes to
  `release/xaucloud-final-production-audit` will automatically run backend CI.**
- `ea.yml` — triggers on `**.mq5`/`**.mqh`/`tests/test_xau_*.py` changes on `main`/`release/**`;
  static checks (no live MetaEditor compile in CI — compile is a local/manual step, see Phase 8).
- `frontend.yml` — triggers on `frontend/**` changes on `main`/`release/**`.

No `vercel.json`/`vercel.ts` found in the repo root — frontend/backend production hosting is
managed outside this repo's version control (Vercel dashboard project settings and/or the VPS
scripts under `deploy/`). `deploy/` currently only contains VPS EA installer scripts
(`install_v6231_active_vps.ps1`, `install_v6232_active_vps.ps1`) — no backend/frontend deploy
automation lives in-repo. This is recorded as a gap for Phase 1.

## Environment variable NAMES referenced in code (no values recorded or exposed)

Backend (`backend/server.py` and siblings):
`MONGO_URL`, `DB_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `AI_COST_CACHE_TTL_SECONDS`,
`AI_COST_DAILY_CALL_LIMIT`, `AI_COST_DUAL_AI_CONFIDENCE_GAP`, `AI_COST_MIN_SECONDS`,
`AI_COST_TOKEN_PRICE_PER_1K`, `CLOUD_AGENT_TOKEN`, `COOKIE_SECURE`, `CORS_ORIGINS`,
`EMERGENT_LLM_KEY`, `ENVIRONMENT`, `JWT_SECRET`, `PAYSTACK_PIN_PRICE_KOBO`,
`PAYSTACK_SECRET_KEY`, `PUBLIC_SITE_URL`, `SMTP_EMAIL`, `SMTP_PASSWORD`,
`WRITE_TEST_CREDENTIALS`.

Frontend build-time: `REACT_APP_BACKEND_URL`.

None of these names contain "xauai"/"xaucloud" — confirmed clean of rebrand impact; **none of
these names are to be renamed** (would break deployed environment configuration).

## Rollback plan (before any further change)

1. **Code rollback**: `git checkout pre-xaucloud-audit-20260724 -- .` or
   `git reset --hard pre-xaucloud-audit-20260724` on a disposable branch — never on `main` or the
   owner's dirty worktrees. The tag is the single source of truth for "last known-good before this
   audit."
2. **EA binary rollback**: redeploy the previously-attached EX5 (see Phase 8 compile package for
   the exact SHA-256 once this audit's build is produced); do not overwrite a running terminal's
   Experts folder without confirming the current running hash first.
3. **Backend rollback**: redeploy the previous production commit (must be recorded explicitly once
   Phase 1 confirms the actual deployed production SHA — not yet known from this repo alone, since
   no in-repo deploy manifest exists; this is flagged as a Phase 1/8 action item to obtain from the
   user's Vercel/VPS dashboards).
4. **Database rollback**: no in-repo migration/backup tooling found yet under `backend/migrations`
   audit (Phase 3 will confirm); until confirmed, treat any schema change in this audit as
   requiring a manual pre-change backup step called out explicitly at that point.
5. **No merge, push, or deploy happens as part of this audit** without a separate, explicit
   go-ahead once Phase 9's release-gate verdict is reached.

## Open gap carried into Phase 1

The actual **currently-deployed** production backend/frontend commit SHA and Vercel
project/VPS host identity are not derivable from this repository alone (no vercel.json, no
deploy manifest committed). Phase 1 will ask the user for these specifically, since guessing
them would violate the "no guesswork" requirement.
