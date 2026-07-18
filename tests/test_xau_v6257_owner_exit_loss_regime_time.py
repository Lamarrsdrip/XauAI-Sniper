from datetime import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8", errors="ignore")
BACKEND = (ROOT / "backend/ea_code/XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8", errors="ignore")


def owner_floor(profile: str, peak: float):
    if profile == "TREND_DN_SPECIAL":
        if peak < .50:
            return 0.0
        if peak < .70:
            return .40
        return max(.40, peak * .70)
    if peak < .40:
        return 0.0
    if peak < .50:
        return .30
    return max(.30, peak * .70)


def blocked_at(t: time):
    sec = t.hour * 3600 + t.minute * 60 + t.second
    return 6*3600+10*60 <= sec <= 7*3600+30*60+59 or 14*3600+10*60 <= sec <= 15*3600+30*60+59


def test_canonical_and_backend_sources_match():
    assert EA == BACKEND


def test_release_identity_is_v6257():
    assert '#define XAUAI_EA_VERSION "v6.25.7"' in EA
    assert '#property version   "6.257"' in EA


def test_special_profile_is_trend_dn_only():
    fn = EA[EA.index("ENUM_XAU_OWNER_EXIT_PROFILE XAU_OwnerExitProfileForEntryRegime"):][:500]
    assert "entryRegime == REGIME_TRENDING_DOWN ? OWNER_EXIT_TREND_DN_SPECIAL : OWNER_EXIT_GENERAL" in fn
    assert "REGIME_TRENDING_UP ? OWNER_EXIT_TREND_DN_SPECIAL" not in EA
    assert "TREND_UP_SPECIAL" not in EA


def test_profile_frozen_at_core_and_pyramids_inherit():
    core = EA[EA.index("void XAU_CampaignOpenCore("):EA.index("void XAU_CampaignRegisterAdd(")]
    add = EA[EA.index("void XAU_CampaignRegisterAdd("):EA.index("string XAU_TryConvertBasketToSingleFloor")]
    assert "XAU_OwnerExitProfileForEntryRegime(currentRegime)" in core
    assert "ownerExitProfile" in core and "OWNER_EXIT_PROFILE_FROZEN" in core
    assert "OWNER_EXIT_PROFILE_INHERITED" in add
    assert "mixedProfiles=false" in add


def test_corrected_profile_boundaries_and_ratchets():
    expected = {
        ("GENERAL", .39): 0.0, ("GENERAL", .40): .30, ("GENERAL", .49): .30,
        ("GENERAL", .50): .35, ("GENERAL", .60): .42,
        ("TREND_DN_SPECIAL", .49): 0.0, ("TREND_DN_SPECIAL", .50): .40,
        ("TREND_DN_SPECIAL", .69): .40, ("TREND_DN_SPECIAL", .70): .49,
        ("TREND_DN_SPECIAL", 1.0): .70,
    }
    for (profile, peak), floor in expected.items():
        assert abs(owner_floor(profile, peak) - floor) < 1e-9
    assert max(owner_floor("GENERAL", .60), owner_floor("GENERAL", .50)) == .42


def test_one_owner_floor_function_shared_by_individual_and_basket():
    assert EA.count("double XAU_ComputeOwnerRequiredFloorR(") == 1
    assert EA.count("XAU_ComputeOwnerRequiredFloorR(") >= 4
    assert "MathMax(existingValidFloorR, ownerRequiredFloorR)" in EA
    assert "MathMax(basketExistingValidFloorR, basketOwnerRequiredFloorR)" in EA


def test_hard_stop_uses_original_1r_and_preserves_lot():
    assert "#define XAU_OWNER_EFFECTIVE_SL_CAP_R 0.75" in EA
    assert "g.effectiveHardStopDistance = g.finalOriginalRiskDistance * XAU_OWNER_EFFECTIVE_SL_CAP_R;" in EA
    lot_idx = EA.index("double rawLots = riskAmount / slDollarPerLotRaw;")
    cap_idx = EA.index("double ownerEffectiveSLDistance = finalGeometry.effectiveHardStopDistance;")
    assert lot_idx < cap_idx
    cap_window = EA[cap_idx:EA.index("bool requestOk;", cap_idx)]
    assert "lots =" not in cap_window
    assert "OWNER_LOT_PRESERVED_FROM_ORIGINAL_1R" in cap_window


def test_core_and_pyramid_confirm_broker_sl_and_reject_impossible_geometry():
    assert EA.count("OWNER_SL_BROKER_CONFIRMED") >= 2
    assert EA.count("BROKER_MINIMUM_WOULD_FORCE_WIDER_THAN_075R") >= 2
    assert "OWNER_SL_CAP_BROKER_CONFIRMATION_FAILED" in EA
    pyramid = EA[EA.index("void CheckPyramidOpportunity()"):EA.index("//+------------------------------------------------------------------+\n//| TICK")]
    assert "XAU_ComputeFinalRiskGeometry(pyramidStructuralDistance)" in pyramid
    assert "pyramidGeometry.effectiveHardStopDistance" in pyramid


def test_breakout_permissions_and_double_enforcement():
    fn = EA[EA.index("bool XAU_OwnerEntryPermission("):EA.index("bool XAU_FinalEntryArbiter(")]
    assert "REGIME_BREAKOUT_DOWN" in fn and "OWNER_BRKT_DN_ENTRY_BLOCK" in fn
    assert 'canonicalGrade != "A" && canonicalGrade != "A+"' in fn
    assert "OWNER_BRKT_UP_REQUIRES_A_OR_A_PLUS" in fn
    assert EA.count('XAU_OwnerEntryPermission("CANDIDATE_ACCEPTANCE"') >= 2
    assert EA.count('XAU_OwnerEntryPermission("FINAL_EXECUTION"') >= 2


def test_exact_broker_time_boundaries():
    assert not blocked_at(time(6, 9, 59))
    assert blocked_at(time(6, 10, 0)) and blocked_at(time(7, 30, 59))
    assert not blocked_at(time(7, 31, 0))
    assert not blocked_at(time(14, 9, 59))
    assert blocked_at(time(14, 10, 0)) and blocked_at(time(15, 30, 59))
    assert not blocked_at(time(15, 31, 0))
    assert "TimeCurrent()" in EA[EA.index("bool XAU_OwnerEntryPermission("):][:600]


def test_blocked_m30_candidate_is_terminal_and_open_management_unchanged():
    candidate = EA[EA.index("First enforcement point:"):][:1400]
    assert "XAU_M30FinalizeCandidateWithoutTrade(ownerCandidateBlock)" in candidate
    assert "firstCandidateTime = 0" in candidate
    core_start = EA.index("void XAU_RExitCoreLoop()")
    core = EA[core_start:EA.index("void ManagePositions()", core_start)]
    assert "XAU_OwnerEntryPermission" not in core


def test_m30_same_direction_exemption_remains():
    assert "if(InpDecisionMode != XAU_DECISION_M30_THREE_M10_CONSENSUS)" in EA
    assert "EXHAUSTED_SAME_DIRECTION_REENTRY_BLOCK" in EA


def test_truthful_profile_labels_only():
    assert "OWNER_EXIT_PROFILE=GENERAL" not in EA or "GENERAL" in EA
    assert 'return profile == OWNER_EXIT_TREND_DN_SPECIAL ? "TREND_DN_SPECIAL" : "GENERAL";' in EA
    assert "OWNER_EXIT_PROFILE=TREND_UP" not in EA
