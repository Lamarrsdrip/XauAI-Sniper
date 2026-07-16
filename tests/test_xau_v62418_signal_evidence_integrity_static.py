from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def engine_body(ea: str) -> str:
    idx = ea.index("XAU_AdaptiveTransitionDecision XAU_AdaptiveMarketTransitionEngine()")
    # function is large; grab a generous window covering exhaustion + pressure calc
    return ea[idx: idx + 16000]


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_exhaustion_is_not_a_hardcoded_constant():
    ea = engine_body(read(BACKEND_EA))
    # rawExhaustion must be a weighted sum of multiple named, independently
    # computed real evidence variables -- not a literal number assigned to
    # exhaustionProbability.
    assert "double rawExhaustion = XAU_ATClamp(d.trendMaturity*0.34" in ea
    for component in ["d.trendMaturity", "d.continuationConfidence", "absorption",
                       "oppositeMomentum", "d.remainingRewardR", "counterOpposite",
                       "oldDirectionFailureActive"]:
        assert component in ea, f"rawExhaustion formula missing expected real component: {component}"
    assert "d.exhaustionProbability=XAU_ATClamp(g_transitionPersistentExhaustion);" in ea


def test_one_indicator_alone_cannot_produce_100pct_exhaustion():
    ea = engine_body(read(BACKEND_EA))
    # RSI must not appear anywhere in the exhaustion formula's inputs -- the
    # only indicator-like input is ATR (used purely for distance
    # normalization, not as a standalone exhaustion signal).
    formula_start = ea.index("double rawExhaustion")
    formula_end = ea.index(";", formula_start)
    formula = ea[formula_start:formula_end]
    assert "RSI" not in formula
    assert "bufRSI" not in formula
    # the formula must combine at least 5 distinct weighted terms (5 "*0."
    # or "*0," style multipliers / additive named terms), i.e. genuinely
    # multi-factor, not a single-term passthrough.
    assert formula.count("0.") + formula.count("0,") >= 5


def test_stale_bar_data_fails_closed_before_computing_exhaustion():
    ea = engine_body(read(BACKEND_EA))
    assert "int barAgeSec = (int)(TimeCurrent() - bar);" in ea
    stale_idx = ea.index("if(barAgeSec > 900)")
    exhaustion_idx = ea.index("double rawExhaustion")
    assert stale_idx < exhaustion_idx, "staleness gate must run before the exhaustion formula, not after"
    window = ea[stale_idx: stale_idx + 700]
    assert "EVIDENCE_STALE" in window
    assert "d.continuationEntryPaused = true;" in window
    assert "return d;" in window


def test_buy_and_sell_confidence_are_not_a_naive_complement():
    ea = engine_body(read(BACKEND_EA))
    assert "d.buyConfidence = dir==1 ? d.continuationConfidence : d.reversalProbability;" in ea
    assert "d.sellConfidence = dir==-1 ? d.continuationConfidence : d.reversalProbability;" in ea
    # explicitly must NOT be written as sellConfidence = 100 - buyConfidence
    assert "100.0 - d.buyConfidence" not in ea
    assert "100 - d.buyConfidence" not in ea
    assert "100.0-d.buyConfidence" not in ea


def test_continuation_confidence_and_reversal_probability_use_independent_formulas():
    ea = engine_body(read(BACKEND_EA))
    cc_idx = ea.index("d.continuationConfidence = XAU_ATClamp(continuationQuality")
    rp_idx = ea.index("d.reversalProbability = XAU_ATClamp(d.transitionProbability*0.55")
    cc_line = ea[cc_idx: ea.index(";", cc_idx)]
    rp_line = ea[rp_idx: ea.index(";", rp_idx)]
    # different source variables feed each -- not simply referencing one another
    assert "continuationQuality" in cc_line
    assert "d.transitionProbability" in rp_line
    assert cc_line != rp_line


def test_exhaustion_calc_structured_log_exposes_every_component():
    ea = engine_body(read(BACKEND_EA))
    idx = ea.index('PrintFormat("EXHAUSTION_CALC')
    window = ea[idx: idx + 700]
    for field in ["direction=", "atrExtensionScore=", "locationScore=", "continuationFailureScore=",
                  "momentumDecayScore=", "rejectionScore=", "oppositePressureScore=", "remainingRoomScore=",
                  "rawScore=", "finalPct=", "dataTimestamp=", "dataFreshnessSec="]:
        assert field in window, f"EXHAUSTION_CALC missing field {field}"


def test_exhaustion_calc_log_uses_real_variables_not_new_placeholders():
    ea = engine_body(read(BACKEND_EA))
    idx = ea.index('PrintFormat("EXHAUSTION_CALC')
    # the args list (up to the closing ");") must reference the same
    # variables already used to build rawExhaustion -- not fresh literals.
    args_end = ea.index(");", idx)
    args = ea[idx:args_end]
    for real_var in ["d.trendMaturity", "d.sessionRangeConsumed", "d.continuationConfidence",
                      "absorption", "oppositeMomentum", "d.remainingRewardR", "rawExhaustion",
                      "d.exhaustionProbability"]:
        assert real_var in args, f"EXHAUSTION_CALC log does not reference real variable {real_var}"


def test_pressure_calc_structured_log_exposes_every_component():
    ea = engine_body(read(BACKEND_EA))
    idx = ea.index('PrintFormat("PRESSURE_CALC')
    window = ea[idx: idx + 900]
    for field in ["buyRaw=", "sellRaw=", "buyNormalized=", "sellNormalized=",
                  "bullishReclaim=", "bearishReclaim=", "bullishRetestHeld=", "bearishRetestHeld=",
                  "bullishDisplacement=", "bearishDisplacement=", "bullishBodyShare=", "bearishBodyShare=",
                  "buyRoomR=", "sellRoomR="]:
        assert field in window, f"PRESSURE_CALC missing field {field}"


def test_weak_opposite_pressure_does_not_satisfy_exhaustion_counter_reaction_gate():
    ea = read(BACKEND_EA)
    fn_idx = ea.index("int XAU_ExhaustionCounterReactionScore(")
    window = ea[fn_idx: fn_idx + 1600]
    # mandatory minimum-2-of-5 gate must exist and be enforced at the call site
    call_idx = ea.index("if(reactionScore < 2)")
    assert call_idx > fn_idx
    reject_window = ea[call_idx: call_idx + 700]
    assert "INSUFFICIENT_REACTION_EVIDENCE" in reject_window
    assert "return;" in reject_window


def test_exhaustion_counter_requires_the_engines_own_real_exhaustion_reading():
    ea = read(BACKEND_EA)
    fn_idx = ea.index("bool XAU_ExhaustionCounterEligible(")
    window = ea[fn_idx: fn_idx + 900]
    assert "td.exhaustionProbability < InpExhaustionCounterMinExhaustionPct" in window
    assert "td.exhaustionProbability > InpExhaustionCounterMaxExhaustionPct" in window


def test_every_signal_source_call_is_closed_bar_or_explicitly_live_tick():
    ea = engine_body(read(BACKEND_EA))
    # the transition engine itself is a closed-bar function (evaluatedBar =
    # iTime(...,PERIOD_M5,1), i.e. the last COMPLETED bar) -- shift 1 or
    # greater everywhere, never shift 0 (the still-forming bar), which would
    # mix an incomplete bar into otherwise-closed-bar structural evidence.
    import re
    for m in re.finditer(r"i(Open|Close|High|Low)\(Symbol\(\),\s*PERIOD_M5,\s*(\d+)\)", ea):
        shift = int(m.group(2))
        assert shift >= 1, f"transition engine reads a forming (shift=0) M5 bar at match {m.group(0)}"
