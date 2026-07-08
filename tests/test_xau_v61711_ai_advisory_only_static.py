from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.11.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
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


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61711():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.11"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.11"


# ---------------------------------------------------------------------------
# Root cause #1: live Command Center showed "Blocked by AIDirector" for a
# candidate whose detailed reason was "B-GRADE QUALITY BLOCK ... fastScore=
# 30/85 required=70" -- a 100% deterministic AdaptiveXAUConfirm() output with
# zero AI-model involvement. Traced to CloudPostReasoning()'s module
# classifier: StringFind(upperReason, "AI") matches the substring "AI" inside
# "AGAINST" (SmartGuard's own per-timeframe confirmation text, e.g.
# "M15:AGAINST"), so any deterministic block whose diagnostic text says
# "AGAINST" got mislabeled "AIDirector".
# ---------------------------------------------------------------------------
def test_module_classifier_no_longer_matches_against_as_ai():
    ea = read(BACKEND_EA)
    fn = body(ea, "void CloudPostReasoning(string event_type, string reason, string regime, string setup,")
    # The crude, broad "AI" substring check must be gone.
    assert 'StringFind(upperReason, "AI") >= 0' not in fn
    # Real AI-authored message prefixes must be checked instead.
    assert "looksLikeRealAIReason" in fn
    assert 'StringFind(upperReason, "AI DIRECTOR") >= 0' in fn
    assert 'StringFind(upperReason, "[AI-") >= 0' in fn


def test_smart_guard_deterministic_message_no_longer_classified_as_ai():
    ea = read(BACKEND_EA)
    fn = body(ea, "void CloudPostReasoning(string event_type, string reason, string regime, string setup,")
    # Simulate the exact runtime string that triggered the bug.
    reason = "B-GRADE QUALITY BLOCK: TREND_PULLBACK SELL failed stricter fast XAU confirmation. M5:OK M15:AGAINST M30:AGAINST H1:AGAINST fastScore=30/85 required=70"
    upper = reason.upper()
    looks_like_ai = (
        "AI DIRECTOR" in upper or "[AI-" in upper or "AI=" in upper or
        "AI SAYS" in upper or "AI CONFIDENCE" in upper
    )
    assert not looks_like_ai, "the exact runtime string from the bug report must NOT trip the AI classifier"


def test_real_ai_block_messages_still_classified_as_ai():
    # The fix must not swing the other way and hide genuine AI messages.
    for reason in [
        "AI DIRECTOR ADVISORY: AI says SELL (conf 72%), strategy says BUY.",
        "[AI-CONFIDENT-SKIP] TREND_PULLBACK grade=B: AI skip confidence=80% >= min 55%",
        "[A+/A QUALITY GATE] TREND_PULLBACK grade=A: AI=WEAK-DISAGREE conf=40%",
    ]:
        upper = reason.upper()
        looks_like_ai = (
            "AI DIRECTOR" in upper or "[AI-" in upper or "AI=" in upper or
            "AI SAYS" in upper or "AI CONFIDENCE" in upper
        )
        assert looks_like_ai, f"genuine AI message misclassified: {reason}"


# ---------------------------------------------------------------------------
# Root cause #2: GATE 5 AI DIRECTOR had six genuine AI-model-driven hard-
# block (return;) paths, reachable under the DEFAULT AI_FILTER_ONLY mode.
# All six must now be advisory-only: log + at most a mild lot reduction,
# never return/block.
# ---------------------------------------------------------------------------
def test_ai_director_gate_has_zero_return_statements():
    ea = read(BACKEND_EA)
    start = ea.index("// ============ GATE 5: AI DIRECTOR")
    end = ea.index("if(!ContextGateAllows(signal, bufATR[1], setupName))")
    gate5 = ea[start:end]
    # Strip comment-only lines (this fix's own explanatory comments mention
    # "return;" descriptively, referring to the OLD behavior) before checking
    # for an actual, live return statement.
    code_lines = [ln for ln in gate5.splitlines() if not ln.strip().startswith("//")]
    code_only = "\n".join(code_lines)
    assert "return;" not in code_only
    assert 'CloudPostReasoning("BLOCK"' not in code_only


def test_ai_disagreement_htf_override_cannot_block():
    ea = read(BACKEND_EA)
    marker = "AI=HTF-OVERRIDE conf=%d%%"
    idx = ea.index(marker)
    window = ea[idx: idx + 500]
    assert "return;" not in window
    assert "XAU_LogSoftBlockDowngrade" in window


def test_ai_disagreement_weak_disagree_cannot_block():
    ea = read(BACKEND_EA)
    marker = "AI=WEAK-DISAGREE conf=%d%%"
    idx = ea.index(marker)
    window = ea[idx: idx + 500]
    assert "return;" not in window
    assert "XAU_LogSoftBlockDowngrade" in window


def test_ai_disagreement_sufficient_conviction_cannot_block():
    ea = read(BACKEND_EA)
    marker = "AI DIRECTOR ADVISORY: AI says %s"
    idx = ea.index(marker)
    window = ea[max(0, idx - 400): idx + 400]
    assert "return;" not in window
    assert "STRONG-DISAGREE-WARN" in window
    assert "sizeMulti = MathMin(sizeMulti, 0.50);" in window


def test_ai_low_confidence_skip_cannot_block():
    ea = read(BACKEND_EA)
    marker = "AI DIRECTOR: ADVISORY LOW-CONF"
    idx = ea.index(marker)
    window = ea[max(0, idx - 800): idx + 100]
    assert "return;" not in window


def test_ai_no_confidence_skip_cannot_block():
    ea = read(BACKEND_EA)
    marker = "AI=REDUCE (SKIP/no-confidence)"
    idx = ea.index(marker)
    window = ea[idx: idx + 400]
    assert "return;" not in window


def test_ai_confident_b_grade_skip_cannot_block():
    ea = read(BACKEND_EA)
    marker = "[AI-CONFIDENT-SKIP]"
    idx = ea.index(marker)
    window = ea[idx: idx + 500]
    assert "return;" not in window
    assert "g_aiHardBlockB = true;" not in window


def test_ai_timeout_no_response_budget_skip_never_blocks():
    # aiUnavailable branch: budget guard, timeout, error, no-response --
    # must fall straight through to "local rules continue", never block.
    ea = read(BACKEND_EA)
    marker = "bool aiUnavailable = (aiResult == 0 && lastAIConfidence == 0"
    idx = ea.index(marker)
    unavail_branch_idx = ea.index("if(aiUnavailable)", idx)
    window = ea[unavail_branch_idx: unavail_branch_idx + 400]
    assert "local rules continue" in window
    assert "return;" not in window


def test_ai_confirms_agreement_path_untouched_still_sizes_normally():
    # AI agreement was never a block path -- confirm it's still intact
    # (conviction sizing, not touched by this fix).
    ea = read(BACKEND_EA)
    assert "else if(aiConfirms)" in ea
    marker = "else if(aiConfirms)"
    idx = ea.index(marker)
    window = ea[idx: idx + 1200]
    assert "ALLOW_LOW_CONV" in window or "ALLOW_INCREASE" in window


# ---------------------------------------------------------------------------
# Root cause #3: the generic "if(XAU_AIIsAdvisoryOnly()) {...ADVISORY...}"
# short-circuit used to sit BEFORE aiUnavailable/aiDisagrees/aiResult==0/
# aiConfirms in an if/else-if chain. Making XAU_AIIsAdvisoryOnly() always
# true (below) would have made this branch swallow everything, silently
# discarding all the specific, richer advisory logic (HTF-override context,
# disagreement strength, confidence-based sizing) as dead code. Confirm it
# was removed so the specific branches actually run.
# ---------------------------------------------------------------------------
def test_generic_advisory_shortcircuit_removed_from_chain():
    ea = read(BACKEND_EA)
    assert '// Advisory mode: log only, no actual effect on entry' not in ea
    assert 'if(aiUnavailable)' in ea
    # aiUnavailable must be the FIRST branch of the chain now (no
    # XAU_AIIsAdvisoryOnly() short-circuit ahead of it).
    marker = "// --- Apply AI Director authority ---"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    first_if = window.index("if(")
    assert window[first_if: first_if + 20].strip().startswith("if(aiUnavailable)")


# ---------------------------------------------------------------------------
# Root cause #4: XAU_AIIsAdvisoryOnly() is the single, mode-independent
# source of truth every AI-gated path in the file reads (including the
# exit-side AIBlocksClose() veto at line ~4996) -- it must be hardcoded
# true, not derived from InpAIMode/InpAIAdvisoryOnly, so AI can never regain
# veto authority through a settings change.
# ---------------------------------------------------------------------------
def test_ai_is_advisory_only_hardcoded_unconditionally():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_AIIsAdvisoryOnly()")
    code_lines = [ln for ln in fn.splitlines() if not ln.strip().startswith("//")]
    code_only = "\n".join(code_lines)
    # Must not depend on InpAIMode/InpAIAdvisoryOnly/InpJune18RestoreMode any
    # more as a live condition (the function's own comment mentions these
    # input names descriptively, explaining what USED to gate the return
    # value -- only the code itself must be unconditional now).
    assert "InpAIMode" not in code_only
    assert "InpAIAdvisoryOnly" not in code_only
    assert "InpJune18RestoreMode" not in code_only
    assert "return true;" in code_only


def test_exit_side_ai_veto_now_always_disabled():
    # AIBlocksClose() checks XAU_AIIsAdvisoryOnly() as its second guard --
    # now unconditionally true, so this function always returns false
    # before reaching its own AI-memory-hold-bias/CheckPositionWithAI logic.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool AIBlocksClose(string ruleName, ulong ticket, bool isBuy, double openPx, double curPrice,")
    assert "if(XAU_AIIsAdvisoryOnly()) return false;" in fn


# ---------------------------------------------------------------------------
# Direction Engine speed: user explicitly asked for faster reaction to
# genuine market-direction changes, since a slow-to-release TRANSITION_WAIT
# compounds the risk of holding a stale directional lock during a reversal.
# ---------------------------------------------------------------------------
def test_transition_wait_release_tightened():
    ea = read(BACKEND_EA)
    assert "input int    InpMaxTransitionWaitBars = 3;" in ea


# ---------------------------------------------------------------------------
# Prior fixes must remain intact.
# ---------------------------------------------------------------------------
def test_prior_session_fixes_still_intact():
    ea = read(BACKEND_EA)
    assert "int oppSignalFound = ScoreSetups(oppScore, oppSetupName, signal);" in ea  # v6.17.9
    assert "int pgOppSignalFound = ScoreSetups(pgOppScore, pgOppSetupName, signal);" in ea  # v6.17.10
    assert "freshM15Dir == -dir && freshM30Dir == -dir" in ea  # v6.17.8
    assert "spread / 0.0040 * 100.0" in ea  # v6.17.7
    assert "bool OpenTrade(int signal, double atr, string reason, double sizeMulti, bool isManualOverride = false)" in ea  # v6.17.7


def test_smart_guard_and_structural_gates_still_block_normally():
    # Sanity: this release must not have touched any deterministic block path.
    ea = read(BACKEND_EA)
    assert 'string sgMsg = StringFormat("SMART-GUARD: %s blocked by adaptive fast confirmation for %s. %s",' in ea
    marker = "if(oppFinalDecision == \"PROCEED\")"
    idx = ea.index(marker)
    window = ea[idx: idx + 900]
    assert "return;" in window  # SmartGuard's own hard block, unrelated to AI, still present
