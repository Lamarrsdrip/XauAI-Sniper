# v6.9.0 — Command Center Live Feed Fix

Date: 2026-07-02
Scope: gold-only bot (v6.8.0 → v6.9.0) + backend + frontend.

## What was stale, and why

Audited the full pipeline (EA → backend → frontend) before touching anything. Backend dedup logic, timestamp handling, and frontend polling (8s) were all already correct. The actual bug: **every cloud post came from deep inside the gated entry-scan pipeline.** If any of 8+ higher-level gates (equity protect, weekly target hit, growth daily lock, weekend close, prop-firm loss lock, etc.) was active, literally nothing posted to the cloud for as long as that gate stayed active — so the dashboard kept showing whatever the last real event was, however old that got.

A second, separate gap: `XAU_LogTradeThesisStatus` (thesis health, hold/protect/exit reasoning, TRI recovery-mode state) was **local-only** — it printed to the MT5 journal and never left the terminal, so none of that rich per-trade data could ever reach the Command Center regardless of freshness.

## What changed

**Root fix (staleness):** the existing 60-second local heartbeat now also posts `BOT_STATUS_HEARTBEAT` to the cloud, unconditionally, before any of the gates that could otherwise suppress it. Classifies into: Scanning / Waiting / Blocked / Managing trade / Protecting profit / Holding / Preparing exit (Entering/Exiting come from the trade-event posts, which already worked). New `/cloud/monitor/bot-status` endpoint serves this to a dedicated "Live Bot Thought" panel that flags itself stale if no update arrives in >6 minutes.

**Second fix (thesis data never reached the cloud):** `XAU_LogTradeThesisStatus` now also posts to a new `/cloud/monitor/thesis-status` endpoint (upserted per ticket) — including distance to SL/TP, which wasn't computed anywhere in the cloud pipeline before. "Open Trade Thinking" now shows recovery-mode status, hold/protect/exit reasoning, and distance to SL/TP, sourced from data that used to exist only in the journal.

**Real bug found and fixed along the way:** the "Trade Blocked" card always said the same generic "Waiting for higher quality setup" no matter what actually blocked it — a bug in my own earlier work. It now shows the specific reason (e.g. "Blocked because the reward-to-risk ratio is too low," "Blocked because AI confidence is weak," "Blocked because market structure strongly disagrees") via a new humanizer that maps the EA's actual block codes to plain English, falling back to a cleaned version of any unrecognized code rather than ever going generic or blank.

**Less noise:** the new heartbeat is excluded from the conversational feed (it has its own panel); consecutive identical decisions in the feed now collapse into one card with a repeat count and "last repeated at" times instead of N duplicate cards.

**Three-way verdict:** "Would I enter this trade again right now?" now answers YES / NO / WAIT instead of forcing a binary guess on a genuinely ambiguous read.

## Testing

New `tests/test_xau_v690_command_center_live_feed_static.py` (11 tests) — verifies the heartbeat posts before any gate (checked by position in `OnTick()`, not just presence), thesis-status actually reaches the cloud, the blocked-reason bug is gone, the three-way verdict exists, and the new frontend panels/fields are wired in. Compiled clean: 0 errors, 0 warnings. Full suite: **194/194 passed**.

## Deploy

Pushed to GitHub. As with every release this session, making it live on the site requires the manual Deploy trigger in the Emergent dashboard — I can't trigger that myself. (Skipped generating a Cloudflare preview link per your instruction.)
