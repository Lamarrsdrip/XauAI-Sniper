from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.4.6.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_v648_version_identity_is_single_source_and_backend_matches_root():
    root = read(EA_ROOT)
    backend = read(EA_BACKEND)

    assert root == backend
    assert '#property version   "6.4.8"' in root
    assert '#define XAUAI_EA_VERSION "v6.4.8"' in root
    assert '#define XAUAI_EA_VERSION_NUM "6.4.8"' in root
    assert '\\"ea_version\\":\\"%s\\"' in root
    assert "XAUAI_EA_VERSION" in root[root.index("void BotMonitorHeartbeat()"):]
    assert "XAUAI_DiagnosticsText()" in root


def test_ampl_giveback_refuses_tiny_locks_after_meaningful_peak():
    ea = read(EA_ROOT)
    ampl = ea[ea.index("v6.4.3 ADAPTIVE MOMENTUM PROFIT LOCK"):ea.index("PHASE 1: BREAKEVEN LOCK")]

    assert "InpAMPL_MinRetainUSD" in ampl
    assert "InpAMPL_MinRetainPeakPct" in ampl
    assert "InpAMPL_GivebackMinCurrentPct" in ampl
    assert "AMPL_GIVEBACK_HOLD_TINY_LOCK" in ampl
    assert "amplLockUSD" in ampl
    assert re.search(r"amplLockUSD\s*<\s*amplRequiredLockUSD", ampl)
    assert "amplTinyLockSkipped" in ampl
    assert "if(!amplTinyLockSkipped && inProfit_a && sane_a && ratchet_a)" in ampl


def test_exit_reason_is_captured_for_sl_tp_and_forced_closes():
    ea = read(EA_ROOT)

    assert "void XAU_SetPendingExitReason" in ea
    assert "string XAU_ResolveExitReason" in ea
    assert "ENUM_DEAL_REASON" in ea
    assert "DEAL_REASON_SL" in ea
    assert "lastExitReason = resolvedExitReason;" in ea
    assert "CloseAll(string reason" in ea
    assert "XAU_SetPendingExitReason(posInfo.Ticket(), reason)" in ea
    assert "XAU_ResolveExitReason(posId" in ea


def test_diagnostics_screen_contains_environment_comparison_fields():
    ea = read(EA_ROOT)
    diag = ea[ea.index("string XAUAI_DiagnosticsText()"):ea.index("void UpdateDashboard")]

    for label in [
        "EA version:",
        "Build hash:",
        "Input hash:",
        "Account number:",
        "Broker:",
        "Symbol:",
        "Digits:",
        "Point:",
        "Spread now:",
        "Average spread:",
        "Magic number:",
        "News state:",
        "Trade state:",
        "Exit engine state:",
        "Last trade reason:",
        "Last exit reason:",
    ]:
        assert label in diag


def test_v646_preserves_adaptive_not_fear_based_protection_defaults():
    ea = read(EA_ROOT)

    assert re.search(r"InpPG_PostLossCooldown\s*=\s*0", ea)
    assert re.search(r"InpTwoLossCooldownMin\s*=\s*0", ea)
    assert re.search(r"InpEPF_HardDailyDDPct\s*=\s*0", ea)
    assert re.search(r"InpEPF_T4BlockHardDD\s*=\s*false", ea)
    assert re.search(r"InpEPF_CooldownMin\s*=\s*0", ea)
    assert re.search(r"InpStreakPauseSec\s*=\s*0", ea)
    assert re.search(r"InpDirectionLockout\s*=\s*false", ea)
    assert re.search(r"InpDailyLossLimit\s*=\s*3\.0;.*EA never pauses", ea)
    assert "g_adaptiveRecoveryMode = true;" in ea
    assert "ADAPTIVE_RECOVERY_CLEARED" in ea
