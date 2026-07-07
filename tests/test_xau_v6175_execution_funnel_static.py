from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.5.mq5"
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


def test_version_bumped_to_v6175():
    ea = read(BACKEND_EA)
    assert '#property version   "6.175"' in ea
    assert '#define XAUAI_EA_VERSION "v6.17.5"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.17.5"' in ea
    assert "v6175-execution-funnel-telemetry-20260707" in ea


def test_m5_candidate_is_not_reported_as_final_execution_allowed():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_RecordMarketSnapshot(string phase, int signal, string setupName, string grade,")
    assert "BotMonitorFunnelDetails(candidate, false" in fn
    assert 'candidate ? "WAITING" : "BLOCKED"' in fn
    assert 'BotMonitorDecisionEvent("M5_DECISION", "INFO"' in fn
    assert '"DecisionCycle", scanDecision, false' in fn
    assert "scanFunnel" in fn


def test_blocked_candidates_publish_final_blocker_without_open_trade_called():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_AppendBlockedMemory(string eventName, BlockedIdea &idea, int checkpointMin,")
    assert 'BotMonitorExecutionFunnel("EXECUTION_FUNNEL", "BLOCK", blockKey' in fn
    assert 'true, false, "BLOCKED", blockKey' in fn
    assert "false, false, false, 0, 0" in fn
    assert '"OpenTradeCalled=NO; blocked before execution gate"' in fn


def test_open_trade_publishes_called_blocked_executed_and_broker_retcode():
    ea = read(BACKEND_EA)
    # v6.17.7: OpenTrade changed from void to bool (item 4) -- landmark updated.
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti)")
    assert '"OPEN_TRADE_CALLED"' in fn
    assert '"FINAL_RISK_RECONCILE"' in fn
    assert "trade.Buy" in fn and "trade.Sell" in fn
    assert '"EXECUTED"' in fn
    assert '"BROKER_RETCODE"' in fn
    assert "trade.ResultRetcode()" in fn


def test_personality_gate_softens_only_confirmed_breakout_continuation():
    # v6.17.6 correction: continuationPersonalitySoftPass is structural/market-fact
    # evidence (confirmed breakout continuation + regime alignment + Active
    # Direction not hostile), not an AI opinion -- gating it behind
    # XAU_StructuralBypassAllowed() (AI_DIRECTOR-mode only) meant it never fired
    # under the default AI_FILTER_ONLY mode. Runtime-proven: a STRONG-tier
    # Active-Direction-confirmed SELL BREAKOUT was hard-blocked by PERSONALITY on
    # 2026-07-07 19:55:11 (signalPrice=4126.63); price fell to 4092.19 within the
    # hour (~3.4R) with minimal adverse excursion first. The anti-repeat-loss
    # guard is kept as the baseline safety check; the AI-authority-mode gate is
    # not, since this path never was AI opinion in the first place.
    # Window widened in v6.17.6: the explanatory comment above the fixed
    # branch grew, pushing the STRONG_MOMENTUM_OVERRIDE branch this test also
    # checks further from the section marker. Verified directly that both
    # assertion targets are present in the source before widening -- this was
    # a test window-size bug, not a code regression.
    ea = read(BACKEND_EA)
    marker = "// v6.4.0 UPGRADE 1 — Market Personality Gate"
    window = ea[ea.index(marker): ea.index(marker) + 5600]
    assert "continuationPersonalitySoftPass" in window
    assert "IsXAUConfirmedBreakoutContinuation(signal, setupName)" in window
    assert "regimeAlignedPersonality" in window
    assert "!activeDirectionHostile" in window
    assert "if(continuationPersonalitySoftPass && !XAU_AntiRepeatLossActive(signal))" in window
    # STRONG_MOMENTUM_OVERRIDE (the AI-opinion-flavored quality override) keeps
    # its AI-authority-mode gate.
    assert "strongMomentumPrecheck && InpXAU_SMO_AllowBGradeBalanced &&\n                 !XAU_AntiRepeatLossActive(signal) && XAU_StructuralBypassAllowed()" in window


def test_backend_accepts_execution_funnel_fields():
    server = read(ROOT / "backend" / "server.py")
    for field in (
        "candidate_allowed",
        "final_execution_allowed",
        "final_decision",
        "final_blocker",
        "open_trade_called",
        "trade_buy_called",
        "trade_sell_called",
        "broker_retcode",
        "broker_error",
        "pipeline_stage",
    ):
        assert field in server


def test_command_center_displays_final_execution_not_candidate_allowed():
    dash = read(ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx")
    assert '["Candidate", yesNo(candidateAllowed)]' in dash
    assert '["Final", finalAllowed === undefined ? yesNo(allowed) : yesNo(finalAllowed)]' in dash
    assert '["FinalBlocker", finalBlocker]' in dash
    assert '["OpenTrade", yesNo(openTradeCalled)]' in dash
    assert '<Metric label="Final"' in dash
