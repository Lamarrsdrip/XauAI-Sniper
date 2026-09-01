# XauCloud Command Center Mobile-First Redesign (Phase 4)

Scope: owner's detailed 2026-iPhone-app mobile redesign spec for the Command Center
(`frontend/src/components/cloud/`). Verified in a real browser against a real (throwaway,
isolated) local backend + Mongo instance, not just a successful build.

## Starting state (confirmed before changing anything)

A prior audit pass had already built most of the required infrastructure: a fixed bottom
tab nav with `env(safe-area-inset-bottom)` handling, a PWA manifest + custom service
worker, an "Add to Home Screen" prompt with iOS/Android detection, and Tailwind
mobile-first responsive classes throughout. The gap was **information hierarchy and copy**,
not missing infrastructure — `HomePage` rendered an 8-metric equal-weighted technical grid
before the M10 signal/outlook cards, with no dedicated open-trade or recent-activity
summary on Home, matching none of the owner's "recommended mobile home structure" order.

## Changes made

1. **Reordered `HomePage`** (`frontend/src/components/cloud/CloudDashboard.jsx`) to match
   the owner's spec: Hero status → **Equity/Today's P&L** (promoted to a prominent 2-up row,
   no longer buried in an 8-cell grid) → **open-trade summary** (new, conditional) →
   M10 Market Outlook (`AIMarketOutlookCard`) → M10 signal (`M10SignalCard`) →
   `M10VsOutlookCard` → **recent activity** (new, compact) → license CTA → M30 consensus →
   **Advanced details** (new, collapsed by default) → quick-nav.
2. **Open-trade summary**: added `HomeOpenTradeSummary`, which fetches
   `/cloud/monitor/current-opinion` (the exact endpoint the Trading tab's full
   `AIThoughtFeed` already uses) and renders the **same, already-audited**
   `CurrentTradePanel` component (newly exported from `AIThoughtFeed.jsx`) — zero new
   data fields invented, zero duplicated trade-rendering logic. Renders nothing when no
   trade is open or the account isn't linked/online (verified in browser: correctly
   absent on a fresh unlinked account).
3. **Recent activity**: mounted the existing `<AIThoughtFeed compact />` view (already
   built, previously unused on Home) below the M10 cards — condensed to the single latest
   decision card plus an "Open full feed →" handoff to the Activity tab, exactly matching
   the owner's "group repetitive events, don't flood the user" requirement, using the
   feed's existing dedupe (`freshCards`) logic.
4. **Advanced details**: wrapped the previous 8-metric technical grid (open trades, open
   risk, market bias, AI confidence, session, trading status) in a native `<details>/
   <summary>` disclosure — no new JS state, no new dependency, accessible by default,
   collapsed on first load so the primary hierarchy isn't competing with it.
5. Regression-tested via a real signup → real backend (isolated throwaway DB, dropped
   after the session) → real dashboard render, not just a production build check.

## Browser verification (this session, not assumed)

- `npm run build`: compiled successfully (198.11 kB gzip main bundle, no new warnings).
- Started `backend` (isolated `DB_NAME=xaucloud_browser_audit_20260724`, dropped after
  verification) and `frontend` dev servers locally.
- Signed up a fresh throwaway account in a real browser session end-to-end.
- Confirmed the redesigned Home hierarchy renders exactly as specified: truthful
  Offline/no-connection state, Equity/P&L row showing honest "—/Not live" (no fabricated
  numbers), AI Market Outlook card showing "EA offline — showing no live outlook until a
  fresh heartbeat arrives" (genuine degraded-state copy, not fake data), open-trade
  summary correctly absent (no license linked), "Connect your license" CTA present,
  "Advanced details" disclosure present, collapsed, and correctly expands on click
  (chevron rotates, technical metrics render).
- Spot-checked the Trading tab after the `AIThoughtFeed`/`CurrentTradePanel` export change
  — renders correctly, no console errors on either tab across the whole session.
- **Limitation, stated plainly**: the browser automation tool's `resize_window` did not
  actually shrink the tab's reported viewport below ~1289×712 in this sandboxed Chrome
  session (a tool/environment constraint, not a page bug) — so true narrow-iPhone-width
  rendering (390×844 etc.) was not visually confirmed pixel-for-pixel in this pass. The
  existing and new layout code uses Tailwind's mobile-first convention (unprefixed
  classes are the base/mobile styles, `sm:`/`md:` add width-up overrides), consistent with
  the rest of the already-audited codebase, but this specific claim — exact rendering at
  each iPhone size in the owner's responsive test matrix — is carried to Phase 8 as a
  live step for the user to confirm on a real device or with working viewport emulation.

## Explicitly not done in this pass (scope discipline, not oversight)

- Full extraction of the 1665-line `CloudDashboard.jsx` into per-tab files — the owner's
  spec is about the experience, not the file layout; restructuring a file this large
  carries real regression risk for a change that wouldn't be user-visible, so it was left
  alone.
- A systematic replace of every technical enum/code shown anywhere in the Command Center
  with a plain-language mapping (the owner's `PRIMARY_BAR_PENDING`/
  `EXECUTION_GATE_SPREAD_REJECT`-style examples were illustrative, not literal strings
  found in this codebase — grepped, confirmed absent). The existing code already does
  real plain-language work in most places (e.g. `humanBotState`, the M10 signal card's
  `displayReason` sentence) with the raw code kept as a smaller secondary label, which
  matches the spirit of the requirement; a full audit of every remaining raw-code
  display across all tabs (Analytics, Intelligence, Activity, Control, License, Settings)
  was not performed and is logged as remaining scope, not silently declared done.
- Manifest/PWA branding rename (`XAU AI Sniper Command Center` → `XauCloud`) — deferred to
  Phase 5 (rebrand), where all branding surfaces are handled together and tracked in one
  ledger.
- Full responsive test matrix screenshots across iPhone SE/standard/Pro Max/landscape/
  Android/tablet/desktop — blocked by the viewport-emulation limitation above; packaged
  as a live/manual step in Phase 8.
- Independent UX review — scheduled as part of Phase 7 (independent review pass), not
  performed standalone here to avoid reviewing my own work as if it were separate.
