"""Static regression tests for recovered-trade expansion ownership.

The live bug this protects against:

    deep MAE -> recovery through breakeven -> tiny positive close -> market
    continues in the original trade direction.

The fix must not touch entry logic. It must make the exit side recognize a
deep recovered trade in own-R terms, protect it, and veto low-priority
small-profit exits while structure/momentum still support continuation.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.5.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def mql_body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


def test_recovery_expansion_state_and_inputs_are_own_r_based():
    ea = read(EA)
    struct = mql_body(ea, "struct TradeTTMRecord")
    for field in (
        "recoveryExpansionActive",
        "recoveryExpansionActivatedAt",
        "recoveryExpansionCrossTime",
        "recoveryExpansionProtectedR",
        "recoveryExpansionPeakR",
        "recoveryExpansionMFER",
        "recoveryExpansionLastOwner",
    ):
        assert field in struct

    for inp in (
        "InpRecoveryExpansionEnable",
        "InpRecoveryExpansionMinMAER",
        "InpRecoveryExpansionActivateR",
        "InpRecoveryExpansionMeaningfulR",
        "InpRecoveryExpansionTargetR",
        "InpRecoveryExpansionMaxGivebackPct",
    ):
        assert inp in ea

    assert "previousLossUSD" not in ea
    assert "nextTradeTargetUSD" not in ea


def test_ttm_entry_initializes_recovery_expansion_state_cleanly():
    ea = read(EA)
    fn = mql_body(ea, "void TTM_RecordEntry(ulong posId, int signal, string setupName, string grade,")
    assert "r.recoveryExpansionActive      = false;" in fn
    assert "r.recoveryExpansionProtectedR  = 0.0;" in fn
    assert "r.recoveryExpansionPeakR       = 0.0;" in fn
    assert "r.recoveryExpansionMFER        = 0.0;" in fn


def test_recovery_expansion_manager_activates_only_after_deep_mae_and_positive_own_r():
    ea = read(EA)
    fn = mql_body(ea, "int XAU_RecoveryExpansionManage(")
    assert "double currentR = profit / rDollars;" in fn
    assert "double maeR = g_ttm[ttmIdx].triWorstAdversePct;" in fn
    assert "maeR < InpRecoveryExpansionMinMAER" in fn
    assert "currentR < InpRecoveryExpansionActivateR" in fn
    assert "!continuationValid" in fn
    assert "RECOVERY_EXPANSION_ELIGIBLE" in fn
    assert "RECOVERY_EXPANSION_ACTIVATED" in fn


def test_recovery_floor_ratchets_and_never_loosens():
    ea = read(EA)
    fn = mql_body(ea, "bool XAU_RecoveryExpansionApplyFloor(")
    assert "XAU_RecoveryExpansionFloorR(currentR, peakR)" in fn
    assert "MathMax(g_ttm[ttmIdx].recoveryExpansionProtectedR, requestedFloorR)" in fn
    assert "SafeModifySL(ticket, newSL, curTP, isBuy, curPrice, \"RECOVERY_EXPANSION_FLOOR\")" in fn
    assert "g_ttm[ttmIdx].recoveryExpansionProtectedR = floorR;" in fn


def test_tri_weak_recovery_exit_must_offer_recovery_expansion_first():
    ea = read(EA)
    manage = mql_body(ea, "void ManagePositions()")
    tri_idx = manage.index("if(triAction == TRI_ACTION_WEAK_EXIT)")
    block = manage[tri_idx:tri_idx + 1600]
    assert "XAU_RecoveryExpansionManage(" in block
    assert "\"TRI_WEAK_RECOVERY_EXIT\"" in block
    assert "if(recAction == RECOVERY_EXPANSION_HOLD)" in block
    assert "SafePositionClose(ticket, \"TRI_WEAK_RECOVERY_EXIT\")" in block
    assert block.index("XAU_RecoveryExpansionManage(") < block.index("SafePositionClose(ticket, \"TRI_WEAK_RECOVERY_EXIT\")")


def test_active_recovery_expansion_owns_exit_before_lower_priority_managers():
    ea = read(EA)
    manage = mql_body(ea, "void ManagePositions()")
    active_idx = manage.index("g_ttm[activeTtmIdx].recoveryExpansionActive")
    growth_idx = manage.index("XAU_GrowthGuardManagePosition(")
    protected_peak_idx = manage.index("XAU_ProtectPeakProfitFloor(")
    assert active_idx < growth_idx < protected_peak_idx
    active_block = manage[active_idx:active_idx + 1000]
    assert "XAU_RecoveryExpansionManage(" in active_block
    assert "if(recAction == RECOVERY_EXPANSION_HOLD)" in active_block
    assert "continue;" in active_block


def test_basket_second_chance_tiny_profit_exit_is_vetoable_for_recovered_runner():
    ea = read(EA)
    veto = mql_body(ea, "bool XAU_RecoveryExpansionBasketVeto(")
    assert "basketR >= InpRecoveryExpansionMeaningfulR" in veto
    assert "g_ttm[i].recoveryExpansionActive" in veto
    assert "g_ttm[i].triWorstAdversePct >= InpRecoveryExpansionMinMAER" in veto
    assert "basketR >= InpRecoveryExpansionActivateR" in veto
    assert "XAU_BasketStructureBroken(dir)" in veto
    assert "RECOVERY_EXPANSION_EXIT_VETO" in veto

    lifecycle = mql_body(ea, "bool XAU_BasketLifecycleManager(")
    branch_idx = lifecycle.index("if(g_basketProfitToLossSeen && totalPnL >= secondChanceUSD)")
    branch = lifecycle[branch_idx:]
    sc_idx = branch.index("SECOND_CHANCE_PROFIT_EXIT BASKET")
    veto_idx = branch.index("XAU_RecoveryExpansionBasketVeto(")
    close_idx = branch.index("CloseAll(lastExitReason);")
    assert sc_idx < veto_idx < close_idx


def test_recovery_expansion_logs_close_owner_and_all_required_events():
    ea = read(EA)
    fn = mql_body(ea, "int XAU_RecoveryExpansionManage(")
    for event in (
        "RECOVERY_EXPANSION_ELIGIBLE",
        "RECOVERY_EXPANSION_ACTIVATED",
        "RECOVERY_EXPANSION_HOLD",
        "RECOVERY_EXPANSION_EXIT_VETO",
        "RECOVERY_EXPANSION_CLOSE",
    ):
        assert event in fn
    assert "exitOwner=RECOVERY_EXPANSION_MANAGER" in fn
    assert "RECOVERY_EXPANSION_CLOSE_THESIS_FAILED" in fn
    assert "RECOVERY_EXPANSION_CLOSE_CONTINUATION_FAILED" in fn
    assert "RECOVERY_EXPANSION_CLOSE_GIVEBACK" in fn


def test_recovery_expansion_keeps_global_emergency_and_loss_firewall_paths_intact():
    ea = read(EA)
    # The manager uses the normal close wrapper, so the existing project-wide
    # loss-close firewall still decides whether a negative non-emergency close
    # is allowed.
    fn = mql_body(ea, "int XAU_RecoveryExpansionManage(")
    assert "SafePositionClose(ticket, closeReason)" in fn
    wrapper = mql_body(ea, "bool SafePositionClose(ulong ticket, string ctx = \"\")")
    assert "XAU_LossCloseFirewallAllows(ticket, ctx, 0.0)" in wrapper
    firewall = mql_body(ea, "bool XAU_LossCloseFirewallAllows(")
    assert "LOSS_CLOSE_BLOCKED" in firewall
    assert "XAU_EmergencyLossCloseAllowed(ctx)" in firewall


def test_no_inverse_experiment_code_was_added_to_main_bot():
    ea = read(EA)
    assert "XAUAI_INVERSE_DRAWDOWN_MILKER_EXP1" not in ea
    assert "INV_EXP|" not in ea
    assert "INVERT EXECUTION" not in ea
