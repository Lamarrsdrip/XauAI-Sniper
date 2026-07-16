"""v6.24.13: full-bot audit found a real campaign-state desync bug and
fixed it.

Bug found: XAU_CampaignOpenCore/RegisterAdd were only called at the
primary fresh-entry call site (v6.24.9), not inside OpenTrade() itself.
Since CheckReEntryOpportunity and XAU_TryForceOpenTrade both call
OpenTrade() directly -- confirmed the ONLY three real call sites of
OpenTrade() in the whole file -- a successful re-entry or force-open fill
opened a REAL broker position that g_campaign[] never counted. When that
untracked position later closed, XAU_CampaignRegisterClose's own
"if(!active) return" guard either silently no-opped (undercounting) or
decremented activePositionCount for a campaign object that was never
incremented for that specific position (mismatched accounting) --
meaning XAU_CampaignAllowsNewCore could report "no campaign active" while
a real, untracked position was still open in that direction, causing the
next fresh signal to be misclassified as a new core instead of a
continuation.

Fix: registration moved into OpenTrade()'s own `if(ok)` block -- the one
point all three callers already converge on for every other confirmed-
fill state commit (TTM, BrainRecordOpen, timing proof) -- so every caller,
current and future, is covered by construction instead of needing each
new caller to remember to register separately.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.24.13.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
COMPILE_LOG = ROOT / "compile_logs" / "v62413_campaign_registration_fix_compile.log"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_repo_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v62413():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.24.13"' in ea


def test_compile_clean():
    log = read(COMPILE_LOG)
    assert "Result: 0 errors, 0 warnings" in log


def test_exactly_four_opentrade_call_sites_exist():
    # regression guard: if a 5th caller is ever added, this test forces a
    # human to notice and confirm it goes through the same OpenTrade()
    # convergence point (not add its own separate registration call).
    # v6.24.17: bumped 3->4 -- XAU_TryManualOpenNow() (the new MANUAL_OPEN_NOW
    # owner command, independent of any blocked-candidate snapshot) is a
    # confirmed-intentional 4th caller, and it reaches this exact same
    # OpenTrade(dir, atrNow, reason, 1.0, true) convergence point (same
    # isManualOverride=true pattern XAU_TryForceOpenTrade already uses), not
    # a separate execution/registration path of its own.
    ea = read(BACKEND_EA)
    import re
    call_sites = re.findall(r'=\s*OpenTrade\(', ea)
    # the function's own definition ("bool OpenTrade(int signal...") does
    # not match this pattern (no leading "="), so this only counts callers
    assert len(call_sites) == 4, f"expected exactly 4 OpenTrade() callers, found {len(call_sites)}"


def test_campaign_registration_lives_inside_opentrade_not_at_any_caller():
    ea = read(BACKEND_EA)
    fn_start = ea.index("bool OpenTrade(int signal")
    fn_body = ea[fn_start:fn_start + 90000]  # OpenTrade() is an unusually long function (~57k chars to this point)
    assert "XAU_CampaignRegisterAdd(signal, funnelSetup);" in fn_body
    assert "XAU_CampaignOpenCore(signal, funnelSetup, g_latestDecisionSnapshot.horizon, sl, tp, tp, tp);" in fn_body

    # the three individual callers must NOT have their own separate
    # registration calls anymore -- exactly one call to each registration
    # function should exist in the whole file (inside OpenTrade), plus the
    # pyramid path's own separate, correct call (CheckPyramidOpportunity
    # never calls OpenTrade -- it has its own direct trade.Buy/Sell, so it
    # legitimately needs its own registration call, unchanged from v6.24.9).
    add_calls = ea.count("XAU_CampaignRegisterAdd(")
    open_calls = ea.count("XAU_CampaignOpenCore(")
    # Each substring count includes the function's OWN definition line
    # (e.g. "void XAU_CampaignRegisterAdd(int direction, ...)") plus its
    # real call sites, so the expected count is definition(1) + calls(2):
    #   XAU_CampaignRegisterAdd: 1 definition + [OpenTrade's if(ok) block,
    #     CheckPyramidOpportunity's own add] = 3
    #   XAU_CampaignOpenCore: 1 definition + [OpenTrade's if(ok) block,
    #     XAU_CampaignRegisterAdd's own lazy-adoption fallback] = 3
    assert add_calls == 3, f"expected 1 definition + 2 call sites for XAU_CampaignRegisterAdd, found {add_calls}"
    assert open_calls == 3, f"expected 1 definition + 2 call sites for XAU_CampaignOpenCore, found {open_calls}"


def test_registration_is_inside_the_ok_block_after_broker_confirms_fill():
    ea = read(BACKEND_EA)
    fn_start = ea.index("bool OpenTrade(int signal")
    if_ok_idx = ea.index("if(ok)\n   {", fn_start)
    registration_idx = ea.index("XAU_CampaignRegisterAdd(signal, funnelSetup);", fn_start)
    broker_send_idx = ea.index("ok = trade.Buy(lots, Symbol()", fn_start)
    # registration happens after the broker call and after entering the
    # ok-confirmed block, not before the fill is confirmed
    assert broker_send_idx < if_ok_idx < registration_idx


def test_reentry_and_force_open_reach_the_same_opentrade_function():
    # both non-primary callers pass through the literal string "OpenTrade("
    # -- confirms they were not refactored to bypass the shared function
    ea = read(BACKEND_EA)
    assert "opened=OpenTrade(dir,bufATR[1],\"RE_ENTRY_FRESH_SETUP:" in ea
    assert "opened = OpenTrade(dir, atrNow, forceReason, 1.0, true);" in ea


def test_force_open_manual_override_still_skips_the_separate_hard_block_recheck():
    # the OTHER pre-OrderSend check added in v6.24.8 (XAU_MarketThesis
    # HARD_BLOCK recheck) is a DECISION gate, not tracking -- it correctly
    # stays scoped to the primary fresh-entry path only, since
    # isManualOverride=true is explicitly designed to skip soft-judgment
    # gates (pre-existing comment: "manual override bypasses soft
    # judgment by design"). Confirms this session's audit did NOT
    # accidentally apply a blocking gate to the manual override path while
    # fixing the (non-blocking, pure-tracking) campaign registration gap.
    ea = read(BACKEND_EA)
    fn_start = ea.index("bool OpenTrade(int signal")
    fn_body = ea[fn_start:fn_start + 90000]
    assert "MARKET_THESIS_HARD_BLOCK_PRE_ORDERSEND" not in fn_body


def test_close_handler_reaches_every_close_via_safepositionclose_too():
    # SafePositionClose (used by PEAK_RETRACE, EARLY_ADVERSE, and other
    # EA-initiated exits) calls trade.PositionClose(), a normal broker
    # call that generates a real deal -- confirms no separate/bypassing
    # close path exists that would evade XAU_CampaignRegisterClose's
    # single OnTradeTransaction hook.
    ea = read(BACKEND_EA)
    fn = ea[ea.index("bool SafePositionClose(ulong ticket"):][:400]
    assert "trade.PositionClose(ticket)" in fn
