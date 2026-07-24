# XauCloud Live-Step Packages (Phase 8)

**Update**: §1 (compile) and §2 (real-tick replay) were completed for real later in this
session, once an isolated MetaEditor/MT5 install (separate from the live/attached
terminal) was found at `tester_sandbox/MT5_Isolated/`. Real results are in
`08_60day_replay_results.md`. §3-§6 below (Mac/VPS runtime, email, deploy, load test)
still require live infrastructure/production credentials this session does not have and
remain exactly as originally packaged. Each package states the exact command/config, the
expected result, and the failure conditions to watch for — evidence returned will be
inspected against those before any gate is marked passed.

---

## 1. EA compile (MetaEditor) — ✅ DONE, see `08_60day_replay_results.md`

Originally: no MetaEditor/Wine install was found in this session's first (too-shallow)
search, so the source edits made this session (XC-002 re-entry-cap fix, cosmetic rebrand
strings) had **not**
been recompiled — the `.ex5` binaries currently checked into the repo root and
`backend/ea_code/` are now stale relative to `.mq5` source.

**What I noticed, not what I did**: `/Users/libertyelectronics/XauAI-Sniper/tester_sandbox/MT5_Isolated/config/assistant.ini`
already configures an MCP MetaEditor/MetaTrader bridge (`http://127.0.0.1:2234[5|6]/mcp`)
from prior sessions. I did not connect to it — it's unclear from here whether it's
currently bound to a live/demo terminal in active use (a prior audit noted "the active
terminal is currently being used for live/demo operation"), and touching that without
your explicit go-ahead is exactly the kind of action this process asks me to confirm
first, not assume.

**What to run** (adjust the `.mq5` path to wherever your MetaEditor install expects it):

```
MetaEditor64.exe /compile:<path-to>\XAUUSD_AI_Sniper_EA.mq5 /log:<path-to>\compile.log
```

**Expected result**: `Result: 0 errors, 0 warnings, <N> ms elapsed` in `compile.log`, and a
freshly generated `.ex5` next to the source.

**Then compute and send back**:
```
shasum -a 256 XAUUSD_AI_Sniper_EA.mq5 backend/ea_code/XAUUSD_AI_Sniper_EA.mq5 <new>.ex5
cmp XAUUSD_AI_Sniper_EA.mq5 backend/ea_code/XAUUSD_AI_Sniper_EA.mq5
```

**Failure conditions**: any error/warning in the compile log; the two `.mq5` copies not
being byte-identical (`cmp` non-zero exit); a hash that doesn't change between two
compiles of what should be the same source (indicates a stale cache).

**Once you have a real `0 errors/0 warnings` result and hash**, add this manifest entry to
`backend/ea_releases/manifest.json` (fill in the placeholders from your actual compile —
do not reuse any hash from this document, none of these are real):

```json
"v6.25.24": {
  "version": "v6.25.24",
  "edition": "M10 decision authority + fixed configurable Gold-move broker SL (XauCloud production foundation)",
  "source_commit": "<git rev-parse HEAD on this branch after merge>",
  "build_timestamp": "<compile timestamp, ISO 8601>",
  "compiler_result": "<paste the exact MetaEditor Result: line>",
  "ex5_filename": "XAUUSD_AI_Sniper_EA_v6.25.24.ex5",
  "ex5_sha256": "<real sha256 of the compiled ex5>",
  "customer_filename": "XauCloud.ex5",
  "release_notes": "<summarize what actually changed vs v6.25.8>",
  "stable_status": false
}
```
Set `"current_version": "v6.25.24"` only once the real-tick replay below (§2) and VPS/Mac
runtime verification both pass — not merely because it compiled.

---

## 2. Real-tick MT5 Strategy Tester replay — ✅ DONE (60-day, see `08_60day_replay_results.md`)

Originally packaged below as a live step; completed for real later in this session. A
60-day window was run instead of 30 (see that doc for exact numbers, honest caveats, and
why an out-of-sample holdout is still worth running).

Prior sessions already built and used exactly this pattern (see
`analysis/m10_fixed_sl_experiment/M10_FIXEDSL_ISOLATION_REPLAY.md` — a real 30-day
isolated replay comparing the fixed-SL mechanism to the structural-SL baseline, both
real MT5-generated HTML reports, not modeled). Reuse the same isolated tester
environment (`/Users/libertyelectronics/XauAI-Sniper/tester_sandbox/MT5_Isolated/`, **not**
any actively-attached live terminal) and the same `.ini` convention, e.g.
`tester_sandbox/MT5_Isolated/config/v62524_m10fixedsl_30d.ini`:

```
[Common]
Login=<your isolated demo account>
Password=<kept out-of-band, never in a tracked file>
Server=MetaQuotes-Demo

[Tester]
Expert=<path to the newly compiled EX5's Experts-folder location>
ExpertParameters=<a .set file with only InpStopLossGoldMove and InpLicensePIN set explicitly, everything else at compiled default>
Symbol=XAUUSD
Period=M10
Model=1
FromDate=2026.06.21
ToDate=2026.07.21
ForwardMode=0
Deposit=10000
Currency=USD
Leverage=100
ExecutionMode=0
Optimization=0
Visual=false
Report=<new report name>
ShutdownTerminal=1
ReplaceReport=1
```

Run via `terminal64.exe /config:<path-to-ini>`.

**Expected result**: a real MT5-generated `.htm`/`.html` report with `History Quality:
100%` and specific `Bars`/`Ticks` counts (proves genuine tick data was used, not a
partial/degraded run). Compare against the existing baseline numbers already on record
(net +$6,404.13, 57 trades, 68.42% win rate, PF 1.63 for the 2026-06-21→2026-07-21 window)
to confirm this is the same behavior, now compiled from the current (bugfixed) source.

**Also run the June 19 GENERAL-extension-deadline focused replay** called out as the
required final gate in `FINAL_PRODUCTION_READINESS_AUDIT.md`: confirm one broker
close request/confirmation, not `LOSS_CLOSE_BLOCKED` retries.

**Failure conditions**: `History Quality` below 100%; any `LOSS_CLOSE_BLOCKED` retry loop
on the June 19 window; net result materially different from the recorded baseline without
an explained reason (would indicate the recompiled source behaves differently than
expected — investigate before treating the replay as a pass).

**Send back**: the `.htm` report file(s), the compile log from §1, and the terminal
journal text for the June 19 window.

---

## 3. Runtime verification on Mac and VPS

1. Confirm the exact EX5 SHA-256 from §1 is what's actually loaded in both the Mac
   terminal's Experts folder and the VPS (`173.212.249.202` per prior handover notes)
   Experts folder.
2. Detach and reattach the EA on both (MT5 does not hot-reload an already-attached
   expert — confirmed in a prior session's handover).
3. Confirm the MT5 journal on both shows: the new version string, matching build hash,
   `InpStopLossGoldMove` at its intended value, and Decision Mode = M10 legacy.

**Send back**: journal screenshots/text from both Mac and VPS showing the above.

---

## 4. Email deliverability

`SMTP_EMAIL`/`SMTP_PASSWORD` are read from environment (confirmed in Phase 3, not
committed anywhere). This session cannot send to a real inbox. For each of the renamed
templates (PIN delivery, password reset — both now say "XauCloud" per Phase 5):

1. Trigger each flow against a real test inbox you control.
2. Confirm actual inbox delivery (not just a 200 from the send call) — check spam
   placement too.
3. Check SPF/DKIM/DMARC alignment for the sending domain in the received message headers.

**Failure conditions**: landed in spam; SPF/DKIM failure shown in message headers; subject
or body still showing old branding (would indicate a cached/undeployed backend).

**Send back**: the received message headers (redact anything sensitive) and spam-folder
placement result.

---

## 5. Staged production deployment

No in-repo deploy manifest exists (confirmed in Phase 1) — I don't know your actual
Vercel project / VPS deployment mechanism from this repository alone. Before deploying
anything from this branch, tell me (or run yourself):

1. What actually serves `backend/server.py` and `frontend/` in production today (Vercel
   project name/URL, or another host) — needed to know if this is a single-instance or
   multi-worker deployment (directly decides whether XC-007's in-memory rate limiter is a
   release blocker at your actual scale).
2. Stage → canary → production, per your existing process, with the automatic-rollback
   triggers from the original brief (auth failure, license failure, wrong user isolation,
   duplicate trades, missing SL, elevated API errors, wrong P&L, broken downloads, failed
   payment webhooks, security incident).
3. Post-deploy: hit `/api/download/info`, confirm it reflects the new manifest entry;
   confirm `/architecture` and `/docs/*` show the corrected M10-only language; confirm the
   Command Center manifest/title show "XauCloud".

---

## 6. Scale/load test

Given XC-007 (in-memory rate limiter), a real load test matters most at your actual
deployment topology (§5.1). Once that's known: run a login-endpoint load test at your
target concurrency (10,000+ users implies bursts well above the 5-per-email/10-per-IP
per-5-minutes limits already in place) and confirm the limiter behaves as intended across
however many worker processes/instances you actually run — a single-instance deployment
needs no further work here; a multi-instance one needs either sticky routing to a single
rate-limiting instance or a shared store (Redis) before the limiter's guarantee holds at
scale.

---

## 7. Full historical test-suite classification

The full `tests/` suite currently reports (this session, `release/xaucloud-final-production-audit`,
after all Phase 2-6 changes): **1504 passed, 469 failed, 1 collection error** — see Phase 6
(`audits/xaucloud/06_regression_test_results.md`) for the honest breakdown of which
failures are pre-existing decay (confirmed via a baseline-tag diff, not assumed) versus
anything this session's changes could plausibly have caused. None of the 469 were newly
introduced by this session's changes (verified). This is not a green gate — it's the same
"historical version-pin/retired-feature decay" pattern already documented in this repo's
own prior audits, carried forward honestly rather than reported as passing.
