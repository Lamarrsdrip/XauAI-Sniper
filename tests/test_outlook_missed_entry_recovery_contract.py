from pathlib import Path
import re


SOURCE = Path(__file__).resolve().parents[1] / "backend/ea_code/XauCloud-Final_FIXED10_60P_EXIT_ONLY_TEST.mq5"


def _source() -> str:
    return SOURCE.read_text()


def _function(source: str, name: str) -> str:
    match = re.search(rf"(?:void|bool)\s+{re.escape(name)}\(", source)
    assert match, f"missing {name}"
    start = match.start()
    brace = source.index("{", start)
    depth = 0
    for index in range(brace, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    raise AssertionError(f"unterminated {name}")


def test_extension_miss_arms_recovery_instead_of_terminal_skip():
    process = _function(_source(), "XAU_ProcessPendingOutlook")
    assert 'if(skipReason == "PRICE_MOVED_TOO_FAR")' in process
    assert "XAU_ArmOutlookRecovery(skipReason, price);" in process
    assert process.index("XAU_ArmOutlookRecovery") < process.index("if(StringLen(skipReason) > 0)")


def test_recovery_uses_original_one_hour_window_and_persists_it():
    source = _source()
    assert "#define XAU_OUTLOOK_OPPORTUNITY_SECONDS 3600" in source
    assert "g_pendingOutlook.expiryTime    = oGenTime + XAU_OUTLOOK_OPPORTUNITY_SECONDS;" in source
    assert "XAU_SavePendingOutlookState();" in source
    assert "XAU_LoadPendingOutlookState();" in source


def test_recovery_has_no_second_normal_entry_delay():
    recovery = _function(_source(), "XAU_ProcessOutlookRecovery")
    assert "OpenTrade(dir, atr, \"OUTLOOK_RECOVERY" in recovery
    assert "XAU_TimingAuthorityAllows" not in recovery
    assert "immediate current timing" in recovery


def test_recovery_cancels_on_invalidation_or_expiry_and_consumes_signal():
    recovery = _function(_source(), "XAU_ProcessOutlookRecovery")
    for required in (
        "OUTLOOK_RECOVERY_EXPIRE",
        "OUTLOOK_RECOVERY_CANCEL",
        "XAU_OutlookRecoveryThesisInvalid",
        "XAU_ClearPendingOutlook(true);",
    ):
        assert required in recovery
    source = _source()
    assert "XAU_MarkOutlookSignalConsumed" in source
    assert "OUTLOOK_DUPLICATE_ALREADY_CONSUMED" in source


def test_normal_outlook_delay_and_canonical_open_path_remain():
    process = _function(_source(), "XAU_ProcessPendingOutlook")
    assert "if(TimeCurrent() < g_pendingOutlook.armTime) return" in process
    assert "OpenTrade(dir, atrNow, reason, 1.0, true, outlookSL)" in process
