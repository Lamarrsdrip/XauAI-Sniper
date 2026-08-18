# XauCloud Architecture Map (Phase 1)

> **Hosting update (18 August 2026):** The earlier unconfirmed/Vercel wording
> below is historical only. Production is verified as a Hostinger Web App; see
> `20260818_production_hosting_verification.md`.

Recorded: 2026-07-24, from repo inspection only (no external dashboard access). This is a
**single monorepo** — one EA, one FastAPI backend, one React frontend (Command Center +
marketing site share this frontend). No separate repos for website vs. Command Center were
found; `AskUserQuestion` earlier in this session already confirmed no other XauAI-branded
repo/directory exists on this machine.

## Flow

```
user → frontend (React, CRA, REACT_APP_BACKEND_URL) → backend (FastAPI, backend/server.py, ~6230 lines)
     → MongoDB (MONGO_URL/DB_NAME) → EA (XAUUSD_AI_Sniper_EA.mq5, WebRequest to PUBLIC_SITE_URL)
     → MT5/broker → telemetry back through /cloud/monitor/* → notifications (OneSignal via
       backend/notifications.py) → email (SMTP_EMAIL/SMTP_PASSWORD) → admin (/admin/* routes)
```

## Services

| Service | Repo path | Framework | Hosting | DB | Notes |
|---|---|---|---|---|---|
| Marketing site + Command Center | `frontend/` | React (Create React App, not Next.js) | Not in-repo (no vercel.json found) — hosting target unconfirmed, see gap below | via backend API | shares one SPA; `frontend/src/pages`, `frontend/src/components/cloud` is Command Center |
| Backend API | `backend/server.py` + `notifications.py`, `market_outlook.py`, `market_outlook_routes.py`, `llm_adapter.py` | FastAPI | Not in-repo — hosting target unconfirmed | MongoDB (`MONGO_URL`, `DB_NAME`) | ~100 routes across auth/cloud/admin/ai/journal/download/docs |
| EA | `XAUUSD_AI_Sniper_EA.mq5` (root, mirrored at `backend/ea_code/`) | MQL5 | Customer MT5 terminals + owner's Mac/VPS | none (talks to backend via WebRequest) | `PUBLIC_SITE_URL` default `https://xauaisniper.com` |
| Payments | Paystack (`PAYSTACK_SECRET_KEY`, `PAYSTACK_PIN_PRICE_KOBO`) | — | Paystack-hosted | licenses/PINs stored in Mongo | |
| Email | SMTP (`SMTP_EMAIL`, `SMTP_PASSWORD`) | — | external SMTP provider (unspecified) | — | |
| Push notifications | OneSignal, `backend/notifications.py` | — | OneSignal-hosted | device registrations in Mongo | |
| Admin tooling | `/admin/*` routes in `server.py` | same backend | same | same DB | separate `get_current_admin` auth |

## CI/CD (confirmed from `.github/workflows/`)

- `backend.yml`, `frontend.yml`, `ea.yml` — path-triggered on `main` and `release/**`, so this
  audit branch already gets CI coverage on push (see `00_baseline_state.md`).
- No CD/deploy workflow found in `.github/workflows/` — deployment to production appears to be
  manual or managed entirely through the Vercel dashboard / VPS scripts outside version control.

## Confirmed gap (cannot be resolved from repo alone — flagged, not guessed)

The actual **currently-deployed** production Vercel project name/URL and VPS host identity are
not present in this repository. `deploy/` only contains EA installer PowerShell scripts for the
VPS, not a backend/frontend deploy manifest. This is carried into Phase 8 as a question for the
user rather than assumed.

## Finding surfaced during this pass (carried into Phase 2/3 findings register)

`backend/server.py:1383-1404` (`/architecture`, `/docs/how-it-works`, `/docs/installation`,
`/docs/setup-guide`, `/docs/video-guide`) describe a **"Selectable Decision Authority"**: "Legacy
M10 remains the source default; optional M30 mode combines three consecutive M10 snapshots," and
instruct customers to "Review Decision Mode... M30 three-snapshot mode must be selected explicitly
until an approved release changes the default."

On this production-foundation branch, `InpDecisionMode` is **not an input** — it is a
compile-time `const` locked to `XAU_DECISION_M10_LEGACY`
(`XAUUSD_AI_Sniper_EA.mq5:2126`), and the M30 three-snapshot path is confirmed dead/unreachable
code (comment at line 20299: "There is no selectable or executable M30 consensus branch in this
build"). **The customer-facing docs describe a mode-selection feature that does not exist as a
live option in the shipped EA.** This is exactly the class of defect the owner's brief prohibits
("no misleading behaviour," "everything shown to users must be genuine"). Logged as finding
`XC-001` (see `02_ea_root_audit.md`) — to be fixed in Phase 5 by correcting the docs to state M10
legacy is the sole authoritative decision mode in this release, not by re-enabling M30.
