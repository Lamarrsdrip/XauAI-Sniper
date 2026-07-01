from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.5.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_v6425_fixes_are_still_present_and_backend_stays_synced():
    # v6.5.0 (audit bug #11): the original exact v6.4.25 identity assertions
    # are obsolete now that the file has moved on to v6.5.0 (verified by its
    # own dedicated test file). What still matters from this file's original
    # purpose — that root and backend/ea_code never drift apart — is kept;
    # the four Phase-1 bug-fix assertions below are the enduring value.
    ea = read(EA)
    backend = read(BACKEND_EA)
    assert ea == backend


def test_bug1_phantom_basket_peak_only_reconstructs_from_closed_bars():
    ea = read(EA)

    fn_start = ea.index("double XAU_ReconstructOpenBasketPeakUSD(double currentPnL)")
    fn_end = ea.index("\n}\n", fn_start)
    fn_body = ea[fn_start:fn_end]

    # shift 0 (the still-forming bar) must be rejected before any bar copy happens
    assert "if(startShift <= 0)" in fn_body
    assert "return MathMax(0.0, currentPnL);" in fn_body

    # reconstruction must start at shift 1 (first CLOSED bar), never shift 0
    assert "CopyLow(Symbol(), PERIOD_M5, 1, barsToCopy, lows)" in fn_body
    assert "CopyHigh(Symbol(), PERIOD_M5, 1, barsToCopy, highs)" in fn_body
    assert "CopyLow(Symbol(), PERIOD_M5, 0, barsToCopy, lows)" not in fn_body
    assert "CopyHigh(Symbol(), PERIOD_M5, 0, barsToCopy, highs)" not in fn_body


def test_bug2_basket_structure_break_requires_a_flip_since_entry():
    ea = read(EA)

    # basket-level entry snapshot exists and is reset with the rest of basket state
    assert "int        g_basketEntryBOS = -999;" in ea
    assert "int        g_basketEntryHTF = -999;" in ea
    assert "g_basketEntryBOS = -999;\n   g_basketEntryHTF = -999;" in ea

    # snapshot is captured once per basket cycle, before any structure check runs
    assert "if(g_basketEntryBOS == -999)\n   {\n      g_basketEntryBOS = g_smc_bos_dir;\n      g_basketEntryHTF = g_htfConsensusDir;" in ea

    fn_start = ea.index("bool XAU_BasketStructureBroken(int basketDir)")
    fn_end = ea.index("\n}\n", fn_start)
    fn_body = ea[fn_start:fn_end]

    # must compare against the entry snapshot (a FLIP), not the absolute
    # "currently opposes basket direction" test the bug used
    assert "g_basketEntryBOS != -999 && g_basketEntryBOS != 0 && g_smc_bos_dir == -g_basketEntryBOS" in fn_body
    assert "g_basketEntryHTF != -999 && g_basketEntryHTF != 0 && g_htfConsensusDir == -g_basketEntryHTF" in fn_body
    assert "g_smc_bos_dir != 0 && g_smc_bos_dir == -basketDir" not in fn_body
    assert "g_htfConsensusDir != 0 && g_htfConsensusDir == -basketDir" not in fn_body


def test_bug3_basket_soft_lock_bypasses_cloud_safe_and_only_taken_on_success():
    ea = read(EA)

    assert 'input bool   InpBasketSoftLockIgnoresCloudSafe = true;' in ea

    # CloseBasketPartial must respect the new bypass
    close_partial_start = ea.index("bool CloseBasketPartial(double closePct, string reason)")
    close_partial_snippet = ea[close_partial_start:close_partial_start + 400]
    assert "if(InpCloudSafeDisablePartials && !InpBasketSoftLockIgnoresCloudSafe)" in close_partial_snippet

    # all three soft-lock attempt sites must use the bypassable condition, not
    # the old unconditional "!InpCloudSafeDisablePartials" guard
    assert ea.count("(InpBasketSoftLockIgnoresCloudSafe || !InpCloudSafeDisablePartials)") == 3
    assert "InpBasketSoftLockFirst && !InpCloudSafeDisablePartials && !g_basketSoftLockTaken" not in ea

    # g_basketSoftLockTaken must only be set inside a partialDone-success branch,
    # never unconditionally right before the outcome is known
    assert "g_basketSoftLockTaken = true;\n                  if(partialDoneFR)" not in ea
    assert "g_basketSoftLockTaken = true;\n                  if(partialDoneHC)" not in ea
    assert "g_basketSoftLockTaken = true;\n\n         if(partialDone)" not in ea

    # the remaining ungated full close ("BASKET LOCK") must now require either
    # a genuine prior soft-lock or a confirmed structure break
    assert "bool basketLockConfirmed = floorTriggerAlreadySoftLocked || InpAllowGivebackPanicClose ||" in ea
    assert "BASKET_LOCK_PROFIT_BREATHE" in ea


def test_bug4_ttm_evaluates_once_per_bar_not_per_tick():
    ea = read(EA)

    assert "datetime lastEvalBarTime;" in ea
    assert "r.lastEvalBarTime    = 0;" in ea

    fn_start = ea.index('string TTM_Evaluate(int idx, bool isBuy, double liveScore,')
    fn_snippet = ea[fn_start:fn_start + 1200]

    assert "datetime curBarTime = iTime(Symbol(), PERIOD_M5, 0);" in fn_snippet
    assert 'if(g_ttm[idx].lastEvalBarTime != 0 && curBarTime == g_ttm[idx].lastEvalBarTime)\n      return "";' in fn_snippet
    assert "g_ttm[idx].lastEvalBarTime = curBarTime;" in fn_snippet
    # the guard must run BEFORE barsHeld is touched
    assert fn_snippet.index("curBarTime == g_ttm[idx].lastEvalBarTime") < fn_snippet.index("g_ttm[idx].barsHeld++")


def test_no_new_protective_or_restrictive_defaults_introduced():
    ea = read(EA)

    # Phase 1 must not touch entry strictness, lot sizing, or B-grade handling
    assert "InpAllowEarlyLossExit            = false;" in ea  # unchanged from v6.4.22
    assert "InpAllowGivebackPanicClose       = false;" in ea  # unchanged from v6.4.24
    # the new bypass input defaults to UNLOCKING behavior (true), not restricting it
    assert 'InpBasketSoftLockIgnoresCloudSafe = true;' in ea
