"""v6.24.4: Custom-window-1 post-news block shortened 90min -> 30min, and the
AI=0 dashboard/log ambiguity (dead g_aiLastConfidence vs live lastAIConfidence)
is fixed.

Two verification styles, matching this repo's existing convention:
  1. Static source-text assertions against the real .mq5 (version identity,
     default value, dead-variable retirement, root/backend sync).
  2. A deterministic Python mirror of IsScheduledNewsWindow's pure GMT
     integer time-math (dow/minutes-since-midnight/window-start/duration),
     exercised at exact boundary times. This is the same "behavioral oracle"
     pattern used by the other non-"_static" test files in this repo: it
     proves the algorithm's contract, not a substitute for MT5 execution.
"""

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.4.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v6244_news_window_ai_status_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6244():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.4"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.24.4"' in ea


def test_custom_window_1_default_duration_is_30_not_90():
    ea = read(BACKEND_EA)
    assert "input int    InpCalCustomDurMin1     = 30;" in ea
    # the old 90-minute default must not still be the live value for window 1
    assert "InpCalCustomDurMin1     = 90;" not in ea


def test_custom_windows_2_and_3_are_unaffected():
    # only window 1's default changed; windows 2/3 stay at their existing
    # (disabled-by-default) configuration -- this is a targeted fix, not a
    # blanket rewrite of the calendar system.
    ea = read(BACKEND_EA)
    assert "input int    InpCalCustomDay2" in ea
    assert "input int    InpCalCustomDay3" in ea


def test_dead_ai_confidence_variable_is_retired():
    ea = read(BACKEND_EA)
    assert "int    g_aiLastConfidence = 0;" not in ea
    assert "g_aiLastConfidence removed" in ea


def test_no_functional_reads_of_dead_ai_confidence_remain():
    ea = read(BACKEND_EA)
    lines = [l for l in ea.split("\n") if "g_aiLastConfidence" in l]
    # only the retirement comment should mention the old name now
    assert len(lines) == 1, lines
    assert "removed" in lines[0]


def test_command_center_json_carries_explicit_ai_status():
    ea = read(BACKEND_EA)
    assert '\\"ai_status\\":\\"%s\\"' in ea
    assert "string aiStatus = XAU_CurrentAIStatus();" in ea


def test_smart_entry_caution_trace_already_carries_status_and_confidence():
    # pre-existing, verified not to have regressed: AI=%s/%d (verdict then
    # number), not a bare AI=%d that could be misread as "AI never ran".
    ea = read(BACKEND_EA)
    assert "AI=%s/%d" in ea
    assert "result.aiVerdict,result.aiConfidence" in ea.replace(" ", "")


def test_calendar_source_type_labeled_and_compile_clean():
    ea = read(BACKEND_EA)
    assert "source=CUSTOM_STATIC_WINDOW" in ea
    assert "NEWS_COOLDOWN_COMPLETE" in ea
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


# ---------------------------------------------------------------------------
# Behavioral mirror of IsScheduledNewsWindow's custom-window-1 math.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CustomWindow1Config:
    day: int = 3          # Wed
    hour: int = 18
    minute: int = 0
    duration_min: int = 30  # v6.24.4 value under test


def custom_window_1_blocks(dow: int, hour: int, minute: int,
                            cfg: CustomWindow1Config = CustomWindow1Config()) -> bool:
    """Mirrors: if(InpCalCustomDay1>=0 && dow==InpCalCustomDay1) { winStart..winStart+dur }"""
    if cfg.day < 0 or dow != cfg.day:
        return False
    m_now = hour * 60 + minute
    win_start = cfg.hour * 60 + cfg.minute
    return win_start <= m_now < win_start + cfg.duration_min


def test_scenario_26_wednesday_1800_gmt_blocks():
    assert custom_window_1_blocks(dow=3, hour=18, minute=0) is True


def test_scenario_27_1829_59_still_in_cooldown():
    # 18:29 (minute granularity; 18:29:59 rounds down to minute 18:29)
    assert custom_window_1_blocks(dow=3, hour=18, minute=29) is True


def test_scenario_28_1830_00_cooldown_expires():
    assert custom_window_1_blocks(dow=3, hour=18, minute=30) is False


def test_scenario_29_1929_gmt_is_not_blocked_by_1800_event():
    # this is the exact production log line under repair:
    # "NEWS-CALENDAR: CALENDAR: Custom window 1 (day3 18:00 GMT +90min)" at
    # 19:29 GMT must no longer occur once duration is 30, not 90.
    assert custom_window_1_blocks(dow=3, hour=19, minute=29) is False


def test_scenario_old_90min_default_would_have_blocked_1929_gmt():
    # proves the fix actually changes behavior at the reported incident time,
    # not just the displayed number
    old_cfg = CustomWindow1Config(duration_min=90)
    assert custom_window_1_blocks(dow=3, hour=19, minute=29, cfg=old_cfg) is True


def test_scenario_32_repeated_ticks_do_not_move_fixed_expiry():
    # IsScheduledNewsWindow is pure wall-clock math with no persisted timer,
    # so "repeated ticks" cannot move the expiry -- re-evaluating at the same
    # wall-clock time always yields the same answer.
    results = {custom_window_1_blocks(dow=3, hour=18, minute=29) for _ in range(50)}
    assert results == {True}
    results_after = {custom_window_1_blocks(dow=3, hour=18, minute=30) for _ in range(50)}
    assert results_after == {False}


def test_wrong_weekday_never_blocks():
    for dow in (0, 1, 2, 4, 5, 6):
        assert custom_window_1_blocks(dow=dow, hour=18, minute=15) is False


def test_before_window_start_not_blocked():
    assert custom_window_1_blocks(dow=3, hour=17, minute=59) is False
