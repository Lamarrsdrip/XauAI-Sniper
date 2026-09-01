"""v6.24.6: pyramid additions are gated by the existing campaign
exhaustion/transition read, plus an audit of three modules named in the
owner's unified-decision-authority follow-up (Smart Guard, HTF Context
Gate, SMC conflict-count) confirming their current live status.

Audit finding (verified by direct source reading, asserted here so it
can't silently regress): all three are ALREADY not independent veto
authorities in this codebase --
  - Smart Guard's hard-expectancy veto inputs are declared but never read;
    its decision functions are defined but never called from anywhere.
  - The legacy "HTF Context Gate" was already deleted in prior history
    (see the changelog block naming XAU_ClassifySetup as its replacement).
  - SMC's hardBlock output (SMC_GetConflictPenalty) is defined but never
    called; g_smcHardBlockActive is hard-set to false and never read.
This means XAU_SmartEntryCautionGate (entries) and
XAU_AdaptiveMarketTransitionEngine (campaign lifecycle/exhaustion) are
already the two authorities in play, not five-plus competing ones. The
real gap closed by this version: XAU_AdaptiveMarketTransitionEngine's
existingBuyAction/existingSellAction output was already consumed for
existing-position SL tightening, but CheckPyramidOpportunity (new
ADDITIONS to a campaign) never read it at all.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.6.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v6246_pyramid_exhaustion_gate_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6246():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.6"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


# --- Audit: Smart Guard is not a live independent veto ---------------------

def test_smart_guard_hard_expectancy_inputs_are_unused():
    ea = read(BACKEND_EA)
    # declared exactly once each (their own input line) -- no second,
    # functional read site anywhere else in the file
    assert ea.count("InpSmartGuardHardExpectancy") == 1
    assert ea.count("InpSmartGuardHardWinRate") == 1


def test_smart_guard_decision_functions_have_no_call_sites():
    ea = read(BACKEND_EA)
    for fn in ("IsSmartGuardDamageSetup(", "SmartGuardStrongTrendRetest(",
               "GetSmartGuardSetupStats("):
        # exactly one occurrence = the function's own definition, zero callers
        assert ea.count(fn) == 1, f"{fn} expected exactly 1 (definition only), found {ea.count(fn)}"


# --- Audit: legacy HTF Context Gate already removed ------------------------

def test_legacy_context_gate_marked_deleted_in_changelog():
    ea = read(BACKEND_EA)
    assert "deleted legacy context gate" in ea


# --- Audit: SMC hard-conflict path already demoted to context-only ---------

def test_smc_conflict_penalty_function_has_no_call_sites():
    ea = read(BACKEND_EA)
    assert ea.count("SMC_GetConflictPenalty(") == 1  # definition only


def test_smc_hard_block_flag_is_always_false_and_never_read():
    ea = read(BACKEND_EA)
    assert "g_smcHardBlockActive = false;" in ea
    # only the declaration (with its own default) and the one context-only
    # reset should mention it -- no site reads it to actually block anything
    occurrences = [l for l in ea.split("\n") if "g_smcHardBlockActive" in l]
    assert len(occurrences) == 2, occurrences


# --- The actual v6.24.6 fix -------------------------------------------------

def test_pyramid_opportunity_reads_transition_engine_before_spacing_check():
    ea = read(BACKEND_EA)
    fn_start = ea.index("void CheckPyramidOpportunity()")
    transition_call = ea.index("XAU_AdaptiveTransitionDecision pyramidTransition = XAU_AdaptiveMarketTransitionEngine();")
    spacing_check = ea.index("if(!InpPyramidOnTrend || favourableMove<atr*InpPyramidMinATR) return;")
    assert fn_start < transition_call < spacing_check


def test_pyramid_blocks_on_stop_adds_tighten_exit_actions():
    ea = read(BACKEND_EA)
    block_line = ea[ea.index("campaignAction == TRANSITION_STOP_ADDS"):][:400]
    for action in ("TRANSITION_STOP_ADDS", "TRANSITION_TIGHTEN_PROTECTION",
                   "TRANSITION_EXIT_PROFITABLE", "TRANSITION_EXIT_CONTROLLED"):
        assert action in block_line


def test_pyramid_gate_does_not_touch_fresh_opposite_entry_path():
    # the fix must not have been implemented by reading/writing
    # .freshBuyAllowed/.freshSellAllowed (that's the separate,
    # already-correct opposite-entry path) -- it only gates
    # CheckPyramidOpportunity's own early return via existingBuyAction/
    # existingSellAction. (Explanatory comments naming those fields in
    # prose are fine; only field *access* would indicate scope creep.)
    ea = read(BACKEND_EA)
    pyramid_fn = ea[ea.index("void CheckPyramidOpportunity()"):
                    ea.index("void CheckPyramidOpportunity()") + 3000]
    assert ".freshBuyAllowed" not in pyramid_fn
    assert ".freshSellAllowed" not in pyramid_fn


# --- Behavioral mirror: campaign-action -> add permission -------------------

TRANSITION_HOLD = 0
TRANSITION_STOP_ADDS = 1
TRANSITION_TIGHTEN_PROTECTION = 2
TRANSITION_EXIT_PROFITABLE = 3
TRANSITION_EXIT_CONTROLLED = 4
TRANSITION_WAIT_FOR_OPPOSITE_SETUP = 5

BLOCKING_ACTIONS = {TRANSITION_STOP_ADDS, TRANSITION_TIGHTEN_PROTECTION,
                    TRANSITION_EXIT_PROFITABLE, TRANSITION_EXIT_CONTROLLED}


def pyramid_add_allowed(campaign_action: int) -> bool:
    return campaign_action not in BLOCKING_ACTIONS


def test_scenario_15_mature_campaign_additions_stop():
    assert pyramid_add_allowed(TRANSITION_STOP_ADDS) is False


def test_scenario_16_exhausted_campaign_no_stale_add():
    assert pyramid_add_allowed(TRANSITION_TIGHTEN_PROTECTION) is False


def test_exit_signals_also_block_new_adds():
    assert pyramid_add_allowed(TRANSITION_EXIT_PROFITABLE) is False
    assert pyramid_add_allowed(TRANSITION_EXIT_CONTROLLED) is False


def test_scenario_13_early_healthy_campaign_core_and_adds_allowed():
    assert pyramid_add_allowed(TRANSITION_HOLD) is True


def test_wait_for_opposite_does_not_block_existing_direction_adds():
    # WAIT_FOR_OPPOSITE_SETUP describes watching for a *new* opposite
    # campaign; it does not by itself mean the current direction is
    # exhausted (that's TIGHTEN_PROTECTION/STOP_ADDS), so it is
    # deliberately not in the blocking set.
    assert pyramid_add_allowed(TRANSITION_WAIT_FOR_OPPOSITE_SETUP) is True
