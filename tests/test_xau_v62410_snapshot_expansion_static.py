"""v6.24.10: expanded immutable decision snapshot.

Adds the remaining fields from the requested schema (campaignId, version,
buildHash, first/primary/runner destination, expiry, approvalReasons) on
top of the horizon/slSource/thesis fields already added in v6.24.5/v6.24.8.
campaignId reflects the EXISTING campaign object (v6.24.9) rather than a
second, parallel ID source. expiry reuses the same freshness window
XAU_SmartEntryCautionGate already enforces.

Also verifies the progressive-transition-lifecycle naming layer built in
v6.24.8 (XAU_DirectionTransitionStageName / XAU_CampaignLifecycleName)
covers the exact vocabulary requested: CURRENT_DIRECTION_HEALTHY through
NEW_CAMPAIGN_ACTIVE, and CAMPAIGN_NONE through CAMPAIGN_INVALIDATED.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.10.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v62410_snapshot_expansion_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v62410():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.10"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


def test_property_version_placeholder_follows_established_v61710_precedent():
    # #property version is MQL5-Market-only bookkeeping (documented at
    # v6.17.10, which hit the same "4-digit patch" compile warning and
    # solved it the same way: an incrementing placeholder, NOT an attempt
    # to encode the real x.y.z into the constrained field).
    ea = read(BACKEND_EA)
    assert '#property version   "6.250"' in ea
    assert '#property version   "6.2410"' not in ea


def test_snapshot_has_all_v62410_fields():
    ea = read(BACKEND_EA)
    struct_body = ea[ea.index("struct XAU_EntryDecisionSnapshot"):ea.index("XAU_EntryDecisionSnapshot g_latestDecisionSnapshot;")]
    for field in ("campaignId", "version", "buildHash", "firstDestination",
                  "primaryDestination", "runnerDestination", "expiry", "approvalReasons"):
        assert field in struct_body, f"missing {field}"


def test_campaign_id_reuses_existing_campaign_object_not_a_second_id_source():
    ea = read(BACKEND_EA)
    section = ea[ea.index("g_latestDecisionSnapshot.campaignId"):][:300]
    assert "g_campaign[cSlot].campaignId" in section
    assert "g_nextCampaignId" not in section  # must not allocate a new ID here


def test_expiry_reuses_existing_timing_window_not_a_second_timer():
    ea = read(BACKEND_EA)
    section = ea[ea.index("g_latestDecisionSnapshot.expiry"):][:300]
    assert "XAU_EffectiveEntryDelaySeconds()" in section


def test_version_and_build_hash_are_compile_time_constants_not_hardcoded_literals():
    ea = read(BACKEND_EA)
    section = ea[ea.index("g_latestDecisionSnapshot.version"):][:200]
    assert "XAUAI_EA_VERSION" in section
    assert "XAUAI_BUILD_HASH" in section


def test_direction_transition_stage_covers_requested_vocabulary():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("string XAU_DirectionTransitionStageName("):][:1200]
    for stage in ("CURRENT_DIRECTION_HEALTHY", "CURRENT_DIRECTION_MATURE",
                  "CURRENT_DIRECTION_EXHAUSTED", "TRANSITION_WATCH",
                  "OPPOSITE_DISCOVERY", "OPPOSITE_CONFIRMED", "NEW_CAMPAIGN_ACTIVE"):
        assert stage in fn


def test_campaign_lifecycle_covers_requested_vocabulary():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("string XAU_CampaignLifecycleName("):][:1000]
    for stage in ("CAMPAIGN_NONE", "CAMPAIGN_DISCOVERY", "CAMPAIGN_EARLY",
                  "CAMPAIGN_CONFIRMED", "CAMPAIGN_EXPANSION", "CAMPAIGN_MATURE",
                  "CAMPAIGN_EXHAUSTED", "CAMPAIGN_TRANSITION",
                  "CAMPAIGN_REVERSAL_CONFIRMED", "CAMPAIGN_INVALIDATED"):
        assert stage in fn
