from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
EA_NAMED = ROOT / "XAUUSD_AI_Sniper_EA_v6.11.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    assert path.exists(), f"Missing expected EA file: {path}"
    return path.read_text(encoding="utf-8", errors="ignore")


def function_body(src: str, name: str) -> str:
    match = re.search(rf"\b(?:bool|void|double|string|int)\s+{re.escape(name)}\s*\(", src)
    assert match, f"Function {name} not found"
    start = src.find("{", match.end())
    assert start != -1, f"Function {name} has no body"
    depth = 0
    for idx in range(start, len(src)):
        if src[idx] == "{":
            depth += 1
        elif src[idx] == "}":
            depth -= 1
            if depth == 0:
                return src[start : idx + 1]
    raise AssertionError(f"Function {name} body was not closed")


def test_v6110_identity_and_backend_sync():
    named = read(EA_NAMED)
    backend = read(EA_BACKEND)

    assert '#define XAUAI_EA_VERSION "v6.11.0"' in named
    assert "STRONG_MOMENTUM_OVERRIDE" in named
    assert "v6110-strong-momentum-override-20260703" in named
    assert named == backend


def test_strong_momentum_override_inputs_exist():
    src = read(EA_NAMED)

    required_inputs = [
        "InpXAU_StrongMomentumOverride",
        "InpXAU_SMO_MinTrendScore",
        "InpXAU_SMO_MinRoomATR",
        "InpXAU_SMO_EarlyMaxSignalAgeBars",
        "InpXAU_SMO_MaxMissedMoveATR",
        "InpXAU_SMO_MaxExhaustionProb",
        "InpXAU_SMO_MinRRQuality",
        "InpXAU_SMO_LotMulti",
        "InpXAU_SMO_AllowBGradeBalanced",
    ]
    for input_name in required_inputs:
        assert input_name in src


def test_override_requires_momentum_structure_room_and_not_hostile_htf():
    src = read(EA_NAMED)
    body = function_body(src, "XAU_StrongMomentumOverrideAllowed")

    assert "g_htfConsensusDir == -signal" in body
    assert "freshStructureBreak" in body
    assert "structureContinuationCandidate" in body
    assert "trueBreakoutContinuation" in body
    assert "postNewsAligned" in body
    assert "InpXAU_SMO_MinRoomATR" in body
    assert "m5MomentumStrong" in body
    assert "m15MomentumStrong" in body
    assert "STRONG_MOMENTUM_OVERRIDE" in body


def test_override_preserves_late_chase_and_exhaustion_blocks():
    src = read(EA_NAMED)
    body = function_body(src, "XAU_StrongMomentumOverrideAllowed")

    assert "lateChaseEntry" in body
    assert "spikeCooldown" in body
    assert "hasExhaustionDiv" in body
    assert "InpXAU_SMO_MaxExhaustionProb" in body
    assert "InpXAU_SMO_MaxMissedMoveATR" in body
    assert "candlesSinceSignal" in body


def test_personality_and_b_grade_gates_can_soften_for_strong_momentum():
    src = read(EA_NAMED)

    assert "XAU_BasicStrongMomentumPrecheck" in src
    assert "PERSONALITY-GATE SOFTENED" in src
    assert "B-GRADE QUALITY SOFTENED" in src
    assert "InpXAU_SMO_AllowBGradeBalanced" in src


def test_timing_report_exposes_hard_soft_and_missed_move_context():
    src = read(EA_NAMED)
    timing = function_body(src, "XAUEntryTimingGuard")

    assert "blockClass=" in timing
    assert "whatNeedsToChange=" in timing
    assert "missedMoveATR" in timing
    assert "strongMomentumOverrideQualified" in timing
