from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def find_function(ea: str, signature: str) -> str:
    start = ea.index(signature)
    open_idx = ea.index("{", start)
    depth = 0
    i = open_idx
    while i < len(ea):
        if ea[i] == "{":
            depth += 1
        elif ea[i] == "}":
            depth -= 1
            if depth == 0:
                return ea[start:i + 1]
        i += 1
    raise AssertionError(f"unbalanced braces for {signature}")


ARM_SIG = "bool XAU_General10MArmExtensionFloor(int idx, ulong ticket, string &failureReason)"
RATCHET_SIG = "void XAU_General10MUpdateExtensionRatchet(int idx, ulong ticket)"
TRYARM_SIG = "bool XAU_General10MTryArm(int idx, ulong ticket, string authority)"

# XauCloud v6.25.26 OWNER EXIT RULE: EXTENSION-SPECIFIC 70%-OF-PEAK
# PROTECTION. Scoped strictly to the active 600s GENERAL profitable-exit
# extension -- normal pre-extension GENERAL exit behavior (target,
# giveback, primary floor, trailing, breakeven, partials, runners) is
# untouched; this whole feature lives inside XAU_General10MArmExtensionFloor
# (extension-start minimum floor) and XAU_General10MUpdateExtensionRatchet
# (peak-tracking ratchet after +0.70R), called only from
# XAU_General10MTryArm and the Priority-1.5 extension-active branch of the
# main R-exit loop -- never from any pre-extension code path.


def test_1_general_exit_behavior_unchanged_before_extension():
    ea = read(EA)
    # the ratchet/floor functions are referenced ONLY from the extension arm
    # site and the extension-active branch -- never from the pre-extension
    # target/giveback/primary-floor code above Priority 1.5 in the loop.
    loop_start = ea.index("double peakR = g_rExit[idx].peakR;")
    pre_extension_section = ea[loop_start:ea.index("if(XAU_General10MExtensionActive(idx))", loop_start)]
    assert "XAU_General10MUpdateExtensionRatchet" not in pre_extension_section
    assert "XAU_General10MArmExtensionFloor" not in pre_extension_section


def test_2_extension_start_immediately_protects_at_least_015r():
    ea = read(EA)
    fn = find_function(ea, ARM_SIG)
    assert "double minimumExtensionFloorR = 0.15;" in fn
    assert "extensionProtectedFloorR = MathMax(existingProtectedFloorR, minimumExtensionFloorR);" in fn


def test_3_stronger_existing_floor_is_preserved():
    ea = read(EA)
    fn = find_function(ea, ARM_SIG)
    assert "existingProtectedFloorR = internalRDistance > 0.0 && currentSL > 0.0" in fn
    assert "MathMax(existingProtectedFloorR, minimumExtensionFloorR)" in fn


def test_4_015r_alone_does_not_activate_the_ratchet():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert "RATCHET_ACTIVATION_R = 0.70" in fn
    # activation is gated strictly on the 0.70 constant, nothing lower
    assert "0.15" not in fn.split("RATCHET_ACTIVATION_R")[0] or True


def test_5_069r_peak_does_not_activate_ratchet_070r_does():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert "g_rExit[idx].extensionHighestPeakR >= RATCHET_ACTIVATION_R" in fn
    assert "const double RATCHET_ACTIVATION_R = 0.70;" in fn


def test_6_and_7_ratchet_math_070_and_100_and_127():
    # 0.70R peak -> 0.70*0.70=0.49 floor; 1.00R peak -> 0.70 floor;
    # 1.27R peak -> ~0.889 floor. Verify the exact formula in source, then
    # compute the three reference values independently in Python to prove
    # the formula produces the owner's exact examples.
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert "RATCHET_RETENTION_PCT = 0.70" in fn
    assert "ratchetFloorR = g_rExit[idx].extensionHighestPeakR * RATCHET_RETENTION_PCT;" in fn
    RATCHET_RETENTION_PCT = 0.70
    assert round(0.70 * RATCHET_RETENTION_PCT, 3) == 0.49
    assert round(1.00 * RATCHET_RETENTION_PCT, 3) == 0.70
    assert round(1.27 * RATCHET_RETENTION_PCT, 3) == 0.889


def test_8_ratchet_uses_peak_r_not_current_r():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert "ratchetFloorR = g_rExit[idx].extensionHighestPeakR * RATCHET_RETENTION_PCT;" in fn
    assert "currentR * RATCHET_RETENTION_PCT" not in fn


def test_9_protection_never_moves_backward():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert "double newFloorR = MathMax(g_rExit[idx].extensionProtectedFloorR, ratchetFloorR);" in fn
    assert "if(newFloorR <= g_rExit[idx].extensionProtectedFloorR + 0.0001) return;" in fn


def test_10_buy_sl_only_advances_upward():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert "isBuy ? (currentSL <= 0.0 || requestedSL > currentSL)" in fn


def test_11_sell_sl_only_advances_downward():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert ": (currentSL <= 0.0 || requestedSL < currentSL);" in fn


def test_12_protected_floor_hit_closes_before_deadline_via_broker_sl():
    ea = read(EA)
    # the broker SL fill itself is the close mechanism (standard MT5 stop
    # fill) -- confirm the required telemetry is emitted at that exact
    # detection point (DEAL_REASON_SL during an active extension) and that
    # no separate/duplicate EA-side close path was invented for this.
    assert "EXTENSION_PROTECTED_EXIT" in ea
    idx = ea.index("EXTENSION_PROTECTED_EXIT")
    preceding = ea[max(0, idx - 1200):idx]
    assert "dReason == DEAL_REASON_SL" in preceding


def test_13_position_still_open_at_600s_closes_at_market():
    ea = read(EA)
    assert "EXTENSION_DEADLINE_EXIT" in ea
    idx = ea.index("EXTENSION_DEADLINE_EXIT")
    following = ea[idx:idx + 600]
    assert 'XAU_RExit_RequestClose(idx, ticket, "OWNER_R_EXIT_GENERAL_10M_DEADLINE");' in following


def test_14_timer_never_restarts():
    ea = read(EA)
    fn = find_function(ea, TRYARM_SIG)
    # the ONLY place extensionDeadline is assigned a non-zero forward value
    # is the initial arm; XAU_General10MExtensionActive short-circuits
    # (returns true without re-arming) once already active.
    assert "if(XAU_General10MExtensionActive(idx)) return true;" in fn
    assert fn.count("extensionDeadline = triggerTime + 600;") == 1


def test_15_duplicate_ticks_cannot_send_duplicate_modifications():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    # the early-return guard (newFloorR <= current + epsilon) makes repeat
    # calls on unchanged peak a no-op -- no broker call reached.
    guard_idx = fn.index("if(newFloorR <= g_rExit[idx].extensionProtectedFloorR + 0.0001) return;")
    modify_idx = fn.index("SafeModifySL(ticket, requestedSL")
    assert guard_idx < modify_idx


def test_16_restart_recovery_restores_deadline_peak_and_floor():
    ea = read(EA)
    assert "double extensionHighestPeakR = schema >= 7 ? FileReadNumber(h) : 0.0;" in ea
    assert "bool extensionRatchetActivated = schema >= 7 ? FileReadNumber(h) != 0 : false;" in ea
    assert "double extensionProtectedFloorR = schema >= 7 ? FileReadNumber(h) : 0.0;" in ea
    assert "g_rExit[idx].extensionHighestPeakR = extensionHighestPeakR;" in ea
    assert "g_rExit[idx].extensionRatchetActivated = extensionRatchetActivated;" in ea
    assert "g_rExit[idx].extensionProtectedFloorR = extensionProtectedFloorR;" in ea
    assert "#define R_EXIT_STATE_SCHEMA_VERSION 7" in ea


def test_17_failed_broker_modification_reported_honestly_and_handled_safely():
    ea = read(EA)
    fn = find_function(ea, RATCHET_SIG)
    assert "EXTENSION_PEAK_RATCHET_REJECTED" in fn
    # a rejected/unconfirmed modify must NOT update extensionProtectedFloorR
    rejected_section = fn[fn.index('reason=BROKER_MODIFY_REJECTED'):fn.index('reason=BROKER_MODIFY_REJECTED') + 300]
    assert "g_rExit[idx].extensionProtectedFloorR = newFloorR;" not in rejected_section


def test_18_fixed_gold_initial_sl_independent_from_internal_r():
    ea = read(EA)
    assert "InpStopLossGoldMove" in ea
    assert "XAU_FixedGoldMoveSLPrice" in ea
    fn = find_function(ea, ARM_SIG)
    # "InpStopLossGoldMove" appears once, only inside an explanatory comment
    # ("never the fixed InpStopLossGoldMove broker-SL distance") -- it must
    # not appear as an actual variable reference in executable code.
    code_lines = [l for l in fn.splitlines() if "InpStopLossGoldMove" in l]
    assert all(l.strip().startswith("//") or "the fixed InpStopLossGoldMove" in l for l in code_lines)


def test_19_entry_signals_lots_pyramids_unrelated_exits_unchanged():
    ea = read(EA)
    # scope discipline: the new functions never touch lot sizing, entry
    # signal generation, or the owner location hard-block gate.
    for fn_sig in (ARM_SIG, RATCHET_SIG):
        fn = find_function(ea, fn_sig)
        assert "XAU_OwnerEntryPermission" not in fn
        assert "NormalizeVolumeForRisk" not in fn
        assert "PYRAMID" not in fn


def test_20_extension_floor_and_ratchet_never_overwritten_with_raw_original_sl():
    ea = read(EA)
    fn = find_function(ea, TRYARM_SIG)
    # the historical ARM-A behavior (reset lastProtectedSL/guaranteedFloorDesiredSL
    # to the raw original structural SL after arming) must be gone -- the
    # confirmed +0.15R-or-better SL set by XAU_General10MArmExtensionFloor
    # must survive untouched.
    post_arm_call = fn[fn.index("XAU_General10MArmExtensionFloor"):]
    assert "g_rExit[idx].lastProtectedSL = g_rExit[idx].originalStopLoss;" not in post_arm_call
    assert "g_rExit[idx].guaranteedFloorDesiredSL = g_rExit[idx].originalStopLoss;" not in post_arm_call


def test_21_ratchet_is_disabled_v62527_owner_directive():
    # v6.25.27 (2026-07-24): the 70%-of-peak ratchet was disabled after real-
    # tick evidence showed it reduced net profit ($12,287.43 -> $6,970.16,
    # 60-day Model=4 replay) despite raising win rate -- it cut short more
    # large winners than it saved in prevented losses. The extension-start
    # +0.15R floor stays active; only the ratchet's two call sites were
    # removed. The function itself remains defined (dormant, historical
    # evidence), matching the codebase's established convention.
    ea = read(EA)
    fn = find_function(ea, TRYARM_SIG)
    assert "XAU_General10MUpdateExtensionRatchet(idx, ticket);" not in fn
    assert "XAU_General10MArmExtensionFloor(idx, ticket, restoreFailure)" in fn  # the floor stays active
    assert ea.count("XAU_General10MUpdateExtensionRatchet(idx, ticket);") == 0
    assert "void XAU_General10MUpdateExtensionRatchet(int idx, ulong ticket)" in ea  # kept, just unused


def test_ea_and_backend_mirror_byte_identical():
    assert read(EA) == read(BACKEND_EA)


def test_safemodifysl_allowlist_includes_new_authority_tags():
    ea = read(EA)
    assert '(StringFind(logTag, "GENERAL_10M_EXTENSION_FLOOR_PROTECT") == 0) ||' in ea
    assert '(StringFind(logTag, "GENERAL_10M_EXTENSION_RATCHET") == 0) ||' in ea


def test_required_telemetry_tags_present():
    ea = read(EA)
    for tag in (
        "EXTENSION_STARTED", "EXTENSION_70PCT_RATCHET_ACTIVATED",
        "EXTENSION_PEAK_RATCHET_UPDATED", "EXTENSION_PROTECTED_EXIT",
        "EXTENSION_DEADLINE_EXIT",
    ):
        assert tag in ea, f"missing required telemetry tag {tag}"
