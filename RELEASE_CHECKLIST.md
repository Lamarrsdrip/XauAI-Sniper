# XauAI Sniper — Release Checklist

Use this checklist before calling any version "released."
A release is NOT complete until every line is checked.

---

## v6.4.22 — 2026-07-01

### EA Compile
- [x] EA internal version: `#property version "6.422"`
- [x] EA header comment: v6.4.22
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.22.mq5`
- [x] `XAUAI_EA_VERSION` / `XAUAI_EA_VERSION_NUM` / `XAUAI_BUILD_HASH` updated
- [x] **COMPILE IN METAEDITOR — 0 errors, 0 warnings** (see `test_reports/metaeditor_v6422.log`)

### Root Cause (see `test_reports/xau_v6_4_22_early_loss_close_audit_2026-07-01.md`)
Live evidence: basket peak +$126.42 → `PROFIT_FLOOR_SET` → `GIVEBACK_WARNING` →
`GIVEBACK_LIMIT_TRIGGERED` → `CONTINUATION_HOLD_REJECTED` → `FORCE CLOSE
reason=THESIS_BROKEN_EXIT.BASKET` → `CLOSED: LOSS -$2.10`, followed by price
resuming the original trade direction. `XAU_BasketLifecycleManager()` and
several per-ticket "smart exit" / Growth Guard / TTM paths were closing
losing trades on giveback %, cycle count, time-after-peak, or score decay
alone — with no real structural proof — then mislabeling it `THESIS_BROKEN_EXIT`.

### Bugs Fixed This Release
1. **Basket giveback panic-close** (CRITICAL): `XAU_BasketLifecycleManager()`
   closed the whole basket red on giveback % alone, with no structure check,
   even when `InpProtectedPeakBasketCloseRed` was meant to gate red closes.
   Same gap existed in `ManageBasket()`'s fast-reversal, hard-cap, and floor
   red-close branches.
2. **Per-ticket giveback/floor panic-close** (HIGH): `XAU_SmartExit3Layer()`
   and `XAU_ProtectPeakProfitFloor()` closed red positions on floor/giveback
   breach without requiring `structureConfirmedBroken`.
3. **TTM pure score-decay close** (HIGH): `TTM_EXIT` closed on `liveScore <
   InpTTM_ExitThreshold` alone — no BOS/HTF flip required.
4. **Growth Guard early cuts** (MEDIUM): `GROWTH_HARD_LOSS` and
   `GROWTH_BAD_ENTRY_THESIS` cut losers on EMA/RSI/momentum weakness without
   requiring confirmed structure.
5. **Clean Exits giveback/stagnant/stale cuts** (MEDIUM): `CLEAN_STAGNANT`,
   `CLEAN_STALE`, part of `CLEAN_INVALID`, and `APLUS_GIVEBACK_EXIT` could
   close red positions without a structure requirement.

### Fix
Added `InpAllowEarlyLossExit` (default `false`) and a single choke-point
`XAU_GateEarlyLossClose()`. When a position/basket P/L is at or below $0, the
close is blocked unless: it's already profitable, `InpAllowEarlyLossExit` is
true, there's a true emergency (deep equity/R backstop), or structure is
confirmed broken (H1 BOS flip via `g_smc_bos_dir`, HTF consensus flip via
`g_htfConsensusDir`, or a confirmed M5 close through the swing level).
Blocked attempts print `EARLY LOSS CLOSE BLOCKED — letting trade breathe.`
Every attempt (allowed or blocked) prints a `MANUAL_CLOSE_DIAGNOSTIC` line.
Paths that already required confirmed structure or a genuine emergency
backstop (`EARLY_CONVICTION_CUT`, `STRUCTURE_FAILFAST`,
`NO_PARTIAL_SMART_LOSS`, `EXPECTANCY_MAX_LOSS`, `HARD_STOP`/`HARD_STOP_R`,
`GROWTH_HARD_LOSS_EXIT`/`GROWTH_BASKET_LOSS`, `AI_DIRECTOR_EXIT_CLOSE`) were
left unchanged as legitimate backstops.

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.22.mq5` + `.ex5`
- [x] `/Applications/XAUUSD_AI_Sniper_EA_v6.4.22.mq5`
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] `backend/server.py` `ea_version` default bumped
- [ ] GitHub main branch pushed

### Website / Frontend
- [x] Footer.jsx, AdminPortal.jsx, FeaturesSection.jsx: v6.4.22
- [x] DownloadSection.jsx: fallback version/edition/filename bumped (reads live from API otherwise)

### Testing Before Live
- [ ] MT5 journal: `EARLY LOSS CLOSE BLOCKED — letting trade breathe.` appears on a giveback/score-decay attempt with no structure break
- [ ] MT5 journal: a confirmed BOS/HTF/M5 structure break still closes a loser normally
- [ ] MT5 journal: winners (P/L > 0) still protect/close exactly as before — ungated
- [ ] `/api/download/info` returns version v6.4.22

### Sign-off
- Compile verified: YES — 0 errors, 0 warnings (`test_reports/metaeditor_v6422.log`)
- Safe for demo: YES
- Safe for live: NO — validate on demo first that trades now ride to SL/real structure instead of panic-closing

---

## v6.4.2 — 2026-06-28

### EA Compile
- [x] EA internal version: `#property version "6.4.2"`
- [x] EA header comment: v6.4.2
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` (filename kept for MT5 import compatibility)
- [x] Startup Print() banner updated to v6.4.2 (was stale v5.9.1)
- [x] Heartbeat JSON `ea_version` field updated to v6.4.2 (was stale v5.9.1)
- [x] Dashboard string updated to v6.4.2 (was stale v5.9.1)
- [ ] **COMPILE IN METAEDITOR — must confirm 0 errors before going live**

### Bugs Fixed This Release
1. **Startup/heartbeat version strings** (HIGH): Print(), heartbeat JSON `ea_version`, and dashboard
   string all reported v5.9.1 instead of current version. Fixed to v6.4.2.
2. **Calibration JSON key collision** (HIGH): `ExtractJsonDouble()` searched the full response JSON
   for band keys like `"0-49"`. Server returns `"sample_counts"` before `"multipliers"`. Searching
   the full JSON returns sample_count integers (e.g. 12) instead of multiplier floats (e.g. 0.88),
   silently disabling calibration. Fixed by scoping search to the `"multipliers"` sub-object first.
3. **SQUEEZE_RELEASE counter-trend zero bug** (MEDIUM): When HTF consensus vetoes a squeeze, `s`
   is set to 0 but weight multiply and bestScore compare still fired. A score of 0 could win when
   all other setups also scored 0, placing a counter-trend trade. Fixed with `if(s > 0)` guard.

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` updated (v6.4.2 content)
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_MASTER_v6.3.0_AI_DIRECTOR.mq5` version bumped to 6.4.2
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] GitHub main branch pushed

### Website / Frontend
- [x] HeroSection.jsx: v6.4.2
- [x] Footer.jsx: v6.4.2
- [x] DownloadSection.jsx: reads version dynamically (no hardcoded version)

### Testing Before Live
- [ ] MetaEditor compile: 0 errors, 0 critical warnings
- [ ] MT5 journal on attach: `TRADEBRAIN LOAD:` line visible
- [ ] MT5 journal: AI Director initialized
- [ ] MT5 journal: `CONFIDENCE CALIBRATION` line (even if "insufficient data")
- [ ] MT5 journal: startup banner says v6.4.2 (not v5.9.1)
- [ ] Heartbeat to backend: `ea_version` field shows v6.4.2
- [ ] 24h demo: `XAUAI_Scorecard_*.txt` written to MT5 Files
- [ ] 24h demo: `XAUAI_GateReport_*.txt` written
- [ ] `/api/download/info` returns version v6.4.2
- [ ] Website download button shows v6.4.2

### Sign-off
- Compile verified: PENDING
- Safe for demo: YES (audit fixes only — no strategy logic changes except SQUEEZE_RELEASE zero-score guard)
- Safe for live: NO — 2 weeks demo minimum

---

## v6.4.1 — 2026-06-28

### EA Compile
- [x] EA internal version: `#property version "6.4.1"`
- [x] EA header comment: v6.4.1
- [x] Canonical filename: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5`
- [x] File size: ~798 KB
- [x] Root cause of v6.4.0 errors: calibration JSON parser used repeated `int pos` declarations in sibling blocks and unused `n50`/`n65` variables — replaced with `ExtractJsonDouble()` calls
- [ ] **COMPILE IN METAEDITOR — must confirm 0 errors before going live**

### File Distribution
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_v6.4.1.mq5` updated
- [x] MT5 Experts: `XAUUSD_AI_Sniper_EA_MASTER_v6.3.0_AI_DIRECTOR.mq5` updated (same content)
- [x] `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` updated (website download)
- [x] GitHub main branch pushed

### Website / Frontend
- [x] HeroSection.jsx: v6.4.1
- [x] Footer.jsx: v6.4.1
- [x] DownloadSection.jsx: reads version dynamically (no hardcoded version)

### Testing Before Live
- [ ] MetaEditor compile: 0 errors, 0 critical warnings
- [ ] MT5 journal on attach: `TRADEBRAIN LOAD:` line visible
- [ ] MT5 journal: AI Director initialized
- [ ] MT5 journal: `CONFIDENCE CALIBRATION` line (even if "insufficient data")
- [ ] 24h demo: `XAUAI_Scorecard_*.txt` written to MT5 Files
- [ ] 24h demo: `XAUAI_GateReport_*.txt` written
- [ ] `/api/download/info` returns version v6.4.1
- [ ] Website download button shows v6.4.1

### Sign-off
- Compile verified: PENDING
- Safe for demo: YES (no logic changes, parser fix only)
- Safe for live: NO — 2 weeks demo minimum

---

## Release Process (all future versions)

1. Edit EA, increment version string and header comment
2. Write to canonical filename: `XAUUSD_AI_Sniper_EA_vX.X.X.mq5`
3. **Compile in MetaEditor — 0 errors required before anything else**
4. Copy to: `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` and MT5 Experts folder
5. Update HeroSection.jsx and Footer.jsx version strings
6. Update RELEASE_CHECKLIST.md
7. git commit + push
8. Verify `/api/download/info` returns new version after backend redeploy

**Rule: never push a version where step 3 has not been confirmed.**
