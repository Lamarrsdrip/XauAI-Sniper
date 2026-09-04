"""EA static/unit regression coverage for the v6.28.5 exhaustion
sustained-dormancy decay fix.

Root cause fixed: XAU_AdaptiveMarketTransitionEngine's exhaustion ratchet
(g_transitionPersistentExhaustion) only ever came down on a direction flip
or a strict continuation-confirmed reset ("realContinuationReset"). There
was no path for "the old trend simply died without reversing" -- live
production evidence on 2026-09-04 showed the decision-driving value
(d.exhaustionProbability) frozen bit-for-bit at 82.16 for 90+ minutes while
the live, honestly-recomputed rawExhaustion reading had genuinely cooled to
the low-to-mid 60s. This pinned XAU_SmartEntryCautionGate in WAIT_BOUNDED
for every candidate that reached it, with zero ever reaching
XAU_FinalEntryArbiter, across a 3-day window.

Same testing convention as tests/test_xau_v6283_outlook_aurum_unified.py:
MT5/MQL5 has no local unit-test runner, so these are static/structural
assertions against the real committed source text plus the real MetaEditor
compiler log -- not simulated execution.

The single most important guarantee this file proves: the fix is additive
and strictly more conservative than the mechanism it sits beside. It does
NOT touch the direction-flip reset, does NOT touch the existing
realContinuationReset condition or its -10 step, and cannot fire on a
single noisy reading or while real reversal evidence is building -- it can
only ever move the ratchet by a smaller step (5 vs 10), and only after many
consecutive M10 bars (a full hour) of a sustained, meaningful gap. This is
the guard against reproducing the 2026-07-14 "86% forgotten" failure that
motivated the sticky ratchet design in the first place.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "backend" / "ea_code" / "XauCloud-Aurum.mq5"
COMPILE_LOG = ROOT / "backend" / "ea_code" / "compile_logs" / "XauCloud-Aurum_v6.28.5_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def fn_body(ea: str, signature: str, size: int = 6000) -> str:
    idx = ea.index(signature)
    return ea[idx: idx + size]


# ---------------------------------------------------------------------------
# Identity / compile proof
# ---------------------------------------------------------------------------
def test_version_identity_is_v6285():
    ea = read(EA)
    assert '#define XAUAI_EA_VERSION "XAUCloud-Aurum_v6.28.5"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.285"' in ea


def test_compile_reports_zero_errors_and_zero_warnings():
    log_bytes = COMPILE_LOG.read_bytes()
    text = log_bytes.decode("utf-16-le", errors="ignore")
    assert "0 errors, 0 warnings" in text
    assert "XauCloud-Aurum.mq5" in text


# ---------------------------------------------------------------------------
# The ratchet function itself
# ---------------------------------------------------------------------------
def _engine_body(ea: str) -> str:
    return fn_body(ea, "XAU_AdaptiveTransitionDecision XAU_AdaptiveMarketTransitionEngine()", 15000)


def test_original_2026_07_14_protection_untouched():
    # The exact strict continuation-reset condition and its explanatory
    # comment must survive byte-for-byte -- this fix must never weaken the
    # thing that was built specifically to prevent that failure.
    ea = read(EA)
    fn = _engine_body(ea)
    assert "2026-07-14 failure (86% -> forgotten -> SELL again) is impossible here" in fn
    assert "bool realContinuationReset = freshProgress && continuationQuality>=82.0 &&" in fn
    assert "oppositeMomentum<=30.0 && failedExtremes<=1 &&" in fn
    assert "d.remainingRewardPips>=InpTransitionMinRewardPips;" in fn
    assert "g_transitionPersistentExhaustion=MathMax(rawExhaustion,g_transitionPersistentExhaustion-10.0);" in fn


def test_direction_flip_and_ratchet_up_branches_unchanged_in_substance():
    ea = read(EA)
    fn = _engine_body(ea)
    assert "if(g_transitionPersistentDirection!=dir)" in fn
    assert "else if(rawExhaustion>=g_transitionPersistentExhaustion)" in fn


def test_dormancy_branch_is_the_last_resort_else():
    # Ordering guarantee: dormancy can only ever be reached once direction
    # flip, ratchet-up, AND realContinuationReset have all already failed to
    # match -- never a shortcut ahead of any of them.
    ea = read(EA)
    fn = _engine_body(ea)
    flip_idx = fn.index("if(g_transitionPersistentDirection!=dir)")
    ratchet_idx = fn.index("else if(rawExhaustion>=g_transitionPersistentExhaustion)")
    reset_idx = fn.index("else if(realContinuationReset)")
    dormancy_idx = fn.index("Sustained-dormancy decay:")
    assert flip_idx < ratchet_idx < reset_idx < dormancy_idx


def test_dormancy_requires_sustained_multi_bar_gap_not_one_reading():
    ea = read(EA)
    fn = _engine_body(ea)
    dormancy = fn[fn.index("Sustained-dormancy decay:"):]
    # Must dedupe by closed-bar identity (never advance twice inside the
    # same bar from repeated ticks) and require multiple consecutive bars.
    assert "if(bar!=g_transitionExhaustionDormancyBarTime)" in dormancy
    assert "g_transitionExhaustionDormantBars++;" in dormancy
    assert "if(g_transitionExhaustionDormantBars>=XAU_EXHAUSTION_DORMANCY_BARS_REQUIRED)" in dormancy


def test_dormancy_never_fires_while_reversal_evidence_is_building():
    ea = read(EA)
    fn = _engine_body(ea)
    dormancy = fn[fn.index("Sustained-dormancy decay:"):]
    assert "bool noActiveReversalBuildup = counterOpposite<15.0 && oppositeMomentum<30.0;" in dormancy
    assert "if(dormancyGapMet && noActiveReversalBuildup)" in dormancy


def test_dormancy_gap_and_step_are_conservative_relative_to_continuation_reset():
    ea = read(EA)
    # Gap threshold and decay step are named constants, not magic numbers
    # buried in the branch -- and structurally smaller/stricter than the
    # existing continuation-reset's instant -10.
    assert "#define XAU_EXHAUSTION_DORMANCY_GAP           15.0" in ea
    assert "#define XAU_EXHAUSTION_DORMANCY_BARS_REQUIRED 6" in ea
    assert "#define XAU_EXHAUSTION_DORMANCY_DECAY_STEP    5.0" in ea
    # 5-point step is half the continuation-reset's 10-point step, and it
    # additionally requires 6 consecutive bars where continuation-reset
    # requires none (just the current bar's evidence).
    dormancy_step = 5.0
    continuation_step = 10.0
    assert dormancy_step < continuation_step


def test_dormancy_streak_resets_on_direction_flip_ratchet_up_or_continuation_reset():
    ea = read(EA)
    fn = _engine_body(ea)
    # Each of the three prior branches must clear the dormancy streak, so a
    # partially-built streak can never survive into an unrelated regime.
    flip_branch = fn[fn.index("if(g_transitionPersistentDirection!=dir)"): fn.index("else if(rawExhaustion>=g_transitionPersistentExhaustion)")]
    ratchet_branch = fn[fn.index("else if(rawExhaustion>=g_transitionPersistentExhaustion)"): fn.index("else if(realContinuationReset)")]
    reset_branch = fn[fn.index("else if(realContinuationReset)"): fn.index("Sustained-dormancy decay:")]
    assert "g_transitionExhaustionDormantBars=0;" in flip_branch
    assert "g_transitionExhaustionDormantBars=0;" in ratchet_branch
    assert "g_transitionExhaustionDormantBars=0;" in reset_branch


def test_dormancy_streak_resets_when_gap_not_sustained():
    ea = read(EA)
    fn = _engine_body(ea)
    dormancy = fn[fn.index("Sustained-dormancy decay:"):]
    assert 'g_transitionExhaustionDormantBars=0; // gap not sustained this bar -- restart the streak' in dormancy


def test_dormancy_decay_step_applied_correctly_and_never_undershoots_raw():
    ea = read(EA)
    fn = _engine_body(ea)
    dormancy = fn[fn.index("Sustained-dormancy decay:"):]
    # MathMax against rawExhaustion mirrors the existing continuation-reset
    # pattern: the ratchet can never decay BELOW the live raw reading in one
    # step, only toward it.
    assert "g_transitionPersistentExhaustion=MathMax(rawExhaustion,g_transitionPersistentExhaustion-XAU_EXHAUSTION_DORMANCY_DECAY_STEP);" in dormancy
    assert "g_transitionExhaustionDormantBars=0; // require a fresh full window before decaying again" in dormancy


def test_dormancy_decay_fire_event_is_logged():
    ea = read(EA)
    fn = _engine_body(ea)
    assert "EXHAUSTION_DORMANCY_DECAY" in fn
    assert "before=%.2f after=%.2f" in fn


def test_dormancy_state_visible_in_every_exhaustion_calc_reading():
    ea = read(EA)
    fn = _engine_body(ea)
    calc_print = fn[fn.index('PrintFormat("EXHAUSTION_CALC'):]
    assert "dormantBars=%d/%d" in calc_print
    assert "g_transitionExhaustionDormantBars, XAU_EXHAUSTION_DORMANCY_BARS_REQUIRED" in calc_print


# ---------------------------------------------------------------------------
# State lifecycle: the new globals must be cleared everywhere the existing
# exhaustion-ratchet globals are cleared, so a partial dormancy streak can
# never survive a state reset the rest of the package doesn't.
# ---------------------------------------------------------------------------
def test_dormancy_globals_declared_alongside_ratchet_globals():
    ea = read(EA)
    idx = ea.index("double   g_transitionPersistentExhaustion = 0.0;")
    nearby = ea[idx: idx + 400]
    assert "int      g_transitionExhaustionDormantBars = 0;" in nearby
    assert "datetime g_transitionExhaustionDormancyBarTime = 0;" in nearby


def test_dormancy_globals_cleared_in_every_full_transition_state_reset():
    ea = read(EA)
    # Every site that resets g_transitionPersistentExhaustion=0.0 (tester
    # isolation, weekend reopen, staleness clear) must also reset the new
    # dormancy counters, so no site can leak a stale partial streak.
    reset_sites = [
        m for m in range(len(ea))
        if ea.startswith("g_transitionPersistentExhaustion=0.0;", m)
    ]
    assert len(reset_sites) >= 3, "expected at least 3 full-reset sites (tester isolation, weekend reopen, staleness clear)"
    for site in reset_sites:
        window = ea[site: site + 250]
        assert "g_transitionExhaustionDormantBars=0;" in window, f"reset site at offset {site} missing dormancy counter clear"
        assert "g_transitionExhaustionDormancyBarTime=0;" in window, f"reset site at offset {site} missing dormancy bar-time clear"


# ---------------------------------------------------------------------------
# No duplicate/competing canonical source left behind.
# ---------------------------------------------------------------------------
def test_exactly_one_canonical_aurum_source_in_ea_code():
    matches = sorted(p.name for p in (ROOT / "backend" / "ea_code").glob("XauCloud-Aurum*.mq5"))
    assert matches == ["XauCloud-Aurum.mq5"]
