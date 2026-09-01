from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "gold_learning" / "extract_90day_post_exit.py"
SPEC = spec_from_file_location("extract_90day_post_exit", SCRIPT)
MOD = module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MOD)


def test_exact_checkpoint_extraction_and_reentry_classification(tmp_path):
    lines = [
        "CS\t0\t00:00:00.000\tEA (XAUUSD,M10)\t2026.06.18 10:00:00   "
        "R_EXIT_ENTRY_CAPTURE_CONFIRMED positionId=42 ticket=42 direction=BUY entry=4000.0",
        "CS\t0\t00:00:00.001\tEA (XAUUSD,M10)\t2026.06.18 10:00:00   "
        "TIMING_PROOF: candidateId=x thesisId=42 sourcePath=REENTRY | exec=ENTER",
        "CS\t0\t00:30:00.000\tEA (XAUUSD,M10)\t2026.06.18 10:30:00   "
        "FORENSIC_POST_EXIT_START | positionId=42 | closeTime=2026.06.18 10:30:00 | "
        "direction=BUY | campaignId=CAMP-7 | legRole=CORE | entryRegime=0 | "
        "ownerExitProfile=TREND_UP | entryPrice=4000.00000 | originalSL=3990.00000 | "
        "riskDistance=10.00000 | riskUSD=100.00 | exitPrice=4004.00000 | "
        "realizedProfitUSD=40.00 | realizedR=0.400000 | peakRWhileOpen=0.700000 | "
        "exitAuthority=OWNER_FLOOR",
    ]
    for minute in MOD.CHECKPOINTS:
        lines.append(
            f"CS\t0\t00:00:00.000\tEA (XAUUSD,M10)\t2026.06.18 10:{30 + min(minute, 29):02d}:00   "
            f"FORENSIC_POST_EXIT_CHECKPOINT | positionId=42 | checkpointMin={minute} | "
            f"cutoffTime=2026.06.18 11:00:00 | observedThrough=2026.06.18 10:59:59 | "
            f"totalFavorableR=0.650000 | missedR=0.250000 | maximumAdverseRAfterExit=0.050000 | "
            f"returnedToEntry=false | crossedOriginalSL=false | firstFavorable010RAt=2026.06.18 10:35:00 | "
            f"firstAdverse010RAt=NONE | classification=CLEAN_CONTINUATION"
        )

    journal = tmp_path / "journal.log"
    journal.write_text("\r\n".join(lines), encoding="utf-16le")
    starts, checkpoints, entry_times, source_paths = MOD.scan_journal(journal)
    rows = MOD.build_rows(starts, checkpoints, entry_times, source_paths)

    assert len(rows) == 1
    row = rows[0]
    assert row["leg_role"] == "RE_ENTRY"
    assert row["entry_regime"] == "TREND_UP"
    assert row["frozen_owner_exit_profile"] == "TREND_UP"
    assert row["missed_r_20m"] == 0.25
    assert row["maximum_adverse_r_after_exit_60m"] == 0.05
    assert row["clean_continuation_or_immediate_reversal"] == "CLEAN_CONTINUATION"
    assert "LATEST_30_DAYS" in row["period_membership"]


def test_period_boundaries_are_exact_60_plus_30_days():
    assert (MOD.RECENT_START - MOD.RUN_START).days == 60
    assert (MOD.RUN_END - MOD.RECENT_START).days == 30
    assert (MOD.RUN_END - MOD.RUN_START).days == 90


def test_forensic_telemetry_is_default_off_and_giveback_is_canonical_guarded_rule():
    source = (ROOT / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
    backend = (ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
    assert source == backend
    assert "InpForensicPostExitTelemetry  = false" in source
    assert "rule=GIVEBACK_45" in source
    assert 'XAU_RExit_RequestClose(idx,ticket,"OWNER_R_EXIT_GIVEBACK_45")' in source
    assert 'StringFind(ctx, "OWNER_R_EXIT_GIVEBACK_45") == 0' in source
    assert "independent_smart_ai_be_time_ema_ttm_partial=OFF" in source
