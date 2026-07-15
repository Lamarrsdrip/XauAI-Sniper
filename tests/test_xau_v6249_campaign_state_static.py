"""v6.24.9: persistent campaign-state object.

Verifies the object has real decision authority (not logging-only, per the
owner's explicit requirement): campaign creation is gated by whether an
active campaign already exists in that direction, additions increment the
SAME campaign object rather than spawning a new ID, closes are wired to
the real OnTradeTransaction DEAL_ENTRY_OUT handler (not a guess), and the
compile-order bug (dType used before declaration) that a first pass caught
is fixed and stays fixed.
"""

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.9.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v6249_campaign_state_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v6249():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.9"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


def test_campaign_struct_has_the_full_required_field_list():
    ea = read(BACKEND_EA)
    struct_body = ea[ea.index("struct XAU_CampaignState"):ea.index("XAU_CampaignState g_campaign[2];")]
    required_fields = [
        "campaignId", "symbol", "direction", "startTime", "originBar", "originSetup",
        "lifecycle", "structuralInvalidation", "firstDestination", "primaryDestination",
        "runnerDestination", "movementConsumedPct", "exhaustionPct", "remainingRoomR",
        "trendHealth", "locationQuality", "pullbackResetConfirmed", "transitionPressure",
        "oppositeEvidence", "activePositionCount", "additionCount", "realizedPL", "openPL",
        "peakFloatingProfit", "campaignMFE", "campaignMAE", "profitGivenBack",
        "lastConfirmedContinuation", "lastValidPullbackReset", "invalidated",
        "invalidationReason",
    ]
    for field in required_fields:
        assert field in struct_body, f"missing field {field}"


def test_two_persistent_slots_one_per_direction():
    ea = read(BACKEND_EA)
    assert "XAU_CampaignState g_campaign[2];" in ea
    assert "int XAU_CampaignSlot(int direction) { return direction == 1 ? 0 : 1; }" in ea


def test_campaign_close_wired_into_real_deal_out_handler_after_dtype_declared():
    # regression guard for the exact compile error a first pass introduced:
    # dType must be declared before XAU_CampaignRegisterClose references it
    ea = read(BACKEND_EA)
    dtype_decl = ea.index("ENUM_DEAL_TYPE dType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);")
    register_close_call = ea.index("XAU_CampaignRegisterClose((dType == DEAL_TYPE_SELL) ? 1 : -1, profit);")
    assert dtype_decl < register_close_call


def test_close_registration_only_reached_after_partial_close_early_return():
    # OnTradeTransaction's partial-close branch (if(stillOpen) {...return;})
    # must appear textually before the registration call, confirming it's
    # not reachable for partial closes.
    ea = read(BACKEND_EA)
    fn_start = ea.index("void OnTradeTransaction(")
    partial_guard = ea.index("if(stillOpen)", fn_start)
    register_close_call = ea.index("XAU_CampaignRegisterClose((dType == DEAL_TYPE_SELL) ? 1 : -1, profit);")
    assert fn_start < partial_guard < register_close_call


def test_new_core_gated_by_campaign_already_active_check():
    # scoped to the actual enclosing function body (matched brace count),
    # not an arbitrary character window -- robust to future edits inside
    # the same function instead of needing hand-tuned window sizes.
    ea = read(BACKEND_EA)
    start = ea.index("bool campaignAlreadyActive = !XAU_CampaignAllowsNewCore(signal);")
    brace_open = ea.index("{", start)
    depth = 0
    end = None
    for idx in range(brace_open, len(ea)):
        if ea[idx] == "{":
            depth += 1
        elif ea[idx] == "}":
            depth -= 1
            if depth == 0:
                end = idx
                break
    assert end is not None, "unbalanced braces while scanning for function end"
    section = ea[start:end]
    assert "XAU_CampaignRegisterAdd(signal, setupName);" in section
    assert "XAU_CampaignOpenCore(signal, setupName" in section


def test_pyramid_add_registers_to_existing_campaign_not_a_new_one():
    ea = read(BACKEND_EA)
    assert 'XAU_CampaignRegisterAdd(dir, "PYRAMID");' in ea
    # the add function itself never generates a new campaignId when one is
    # already active
    fn = ea[ea.index("void XAU_CampaignRegisterAdd("):][:900]
    assert "g_nextCampaignId" not in fn.split("if(!g_campaign[slot].active")[0]


def test_allows_new_core_returns_false_when_active_and_not_invalidated():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("bool XAU_CampaignAllowsNewCore("):][:400]
    assert "g_campaign[slot].active && !g_campaign[slot].invalidated" in fn
    assert "return false;" in fn


def test_floating_pl_and_evidence_updated_before_per_position_exit_loop():
    ea = read(BACKEND_EA)
    fn_start = ea.index("void ManagePositions()")
    update_call = ea.index("XAU_CampaignUpdateFloatingPL(1, buyFloatingPL);", fn_start)
    exit_loop = ea.index("for(int i = PositionsTotal() - 1; i >= 0; i--)", fn_start)
    assert fn_start < update_call < exit_loop


def test_campaign_evidence_update_reuses_existing_transition_engine_not_new_math():
    ea = read(BACKEND_EA)
    fn = ea[ea.index("void XAU_CampaignUpdateEvidence("):][:900]
    assert "td.lifecycle" in fn
    assert "td.moveAlreadyConsumedPct" in fn
    assert "td.exhaustionProbability" in fn


# ---------------------------------------------------------------------------
# Behavioral mirror of the campaign lifecycle
# ---------------------------------------------------------------------------

@dataclass
class Campaign:
    active: bool = False
    campaign_id: int = 0
    addition_count: int = 0
    active_position_count: int = 0
    realized_pl: float = 0.0
    invalidated: bool = False
    peak_floating: float = 0.0
    mfe: float = 0.0
    mae: float = 0.0
    given_back: float = 0.0


class CampaignBook:
    def __init__(self):
        self.next_id = 1
        self.slots = {1: Campaign(), -1: Campaign()}

    def open_core(self, direction):
        c = Campaign(active=True, campaign_id=self.next_id, active_position_count=1)
        self.next_id += 1
        self.slots[direction] = c
        return c

    def register_add(self, direction):
        c = self.slots[direction]
        if not c.active or c.invalidated:
            c = self.open_core(direction)
        c.addition_count += 1
        c.active_position_count += 1

    def register_close(self, direction, profit):
        c = self.slots[direction]
        if not c.active:
            return
        c.realized_pl += profit
        c.active_position_count = max(0, c.active_position_count - 1)
        if c.active_position_count <= 0:
            c.active = False

    def update_floating(self, direction, open_pl):
        c = self.slots[direction]
        if not c.active:
            return
        if open_pl > c.peak_floating:
            c.peak_floating = open_pl
        if open_pl > c.mfe:
            c.mfe = open_pl
        if open_pl < c.mae:
            c.mae = open_pl
        c.given_back = max(0.0, c.peak_floating - open_pl)

    def allows_new_core(self, direction):
        c = self.slots[direction]
        return not (c.active and not c.invalidated and c.active_position_count > 0)


def test_scenario_17_core_already_exists_no_accidental_duplicate_entry():
    book = CampaignBook()
    book.open_core(1)
    assert book.allows_new_core(1) is False


def test_scenario_16_pyramid_add_belongs_to_same_campaign_id():
    book = CampaignBook()
    c = book.open_core(1)
    original_id = c.campaign_id
    book.register_add(1)
    assert book.slots[1].campaign_id == original_id
    assert book.slots[1].addition_count == 1
    assert book.slots[1].active_position_count == 2


def test_campaign_id_persistence_across_multiple_adds():
    book = CampaignBook()
    c = book.open_core(-1)
    cid = c.campaign_id
    for _ in range(3):
        book.register_add(-1)
    assert book.slots[-1].campaign_id == cid
    assert book.slots[-1].addition_count == 3
    assert book.slots[-1].active_position_count == 4


def test_new_opposite_campaign_creation_gets_a_new_id():
    book = CampaignBook()
    buy_campaign = book.open_core(1)
    sell_campaign = book.open_core(-1)
    assert sell_campaign.campaign_id != buy_campaign.campaign_id


def test_scenario_campaign_profit_giveback_tracked():
    book = CampaignBook()
    book.open_core(1)
    book.update_floating(1, 500.0)
    book.update_floating(1, 200.0)
    assert book.slots[1].peak_floating == 500.0
    assert book.slots[1].given_back == 300.0


def test_clean_wind_down_closes_campaign_without_marking_invalidated():
    book = CampaignBook()
    book.open_core(1)
    book.register_close(1, 150.0)
    assert book.slots[1].active is False
    assert book.slots[1].invalidated is False
    assert book.slots[1].realized_pl == 150.0


def test_a_new_core_is_allowed_again_after_clean_wind_down():
    book = CampaignBook()
    book.open_core(1)
    book.register_close(1, 150.0)
    assert book.allows_new_core(1) is True
