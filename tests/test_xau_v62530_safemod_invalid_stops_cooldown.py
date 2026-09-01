from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
BACKEND_EA = (ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5").read_text(encoding="utf-8")
WITH_OWNER = (ROOT / "research" / "local_ai_m10" / "XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5").read_text(encoding="utf-8")


def function(text: str, signature: str, next_signature: str) -> str:
    start = text.index(signature)
    return text[start:text.index(next_signature, start)]


def test_root_backend_and_with_owner_copies_stay_synced():
    assert EA == BACKEND_EA
    assert EA == WITH_OWNER


def test_frozen_retcode_added_to_benign_throttled_set():
    # Third pass: the dominant real-world rejection in the historical
    # Feb-2024 XAUUSD replay MetaQuotes runs was retcode 10029 (FROZEN,
    # "order or position frozen because price is within the freeze
    # level"), not 10016 (INVALID_STOPS) as the second pass assumed --
    # the two read very similarly in the trade journal ("close to
    # market" vs "Invalid stops") but are distinct codes.
    fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    assert "bool benign = (ret == 10025 || ret == 10004 || ret == 10021 || ret == 10016 || ret == 10029 || err == 4756 || err == 10025);" in fn


def test_cooldown_check_and_write_share_the_same_statics():
    fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    # Regression guard for a real scoping bug caught before this shipped: an
    # earlier draft declared the check-side and write-side statics in two
    # separate braces with different names, so the write never reached the
    # check. Each tracking variable must be declared exactly once (with
    # "static"), then assigned again later at the write site -- proving
    # both the check and the write reference the same persistent storage
    # rather than two independent same-named-but-different variables.
    import re
    for var, decl_type in (
        ("g_lastRejectedModifyTicket", "ulong"),
        ("g_lastRejectedModifySL", "double"),
        ("g_lastRejectedModifyAt", "datetime"),
    ):
        decls = re.findall(rf"static {decl_type}\s+{var}\b", fn)
        assert len(decls) == 1, f"{var} must be declared exactly once, found {len(decls)}"
        assignments = re.findall(rf"{var}\s*=", fn)
        assert len(assignments) >= 2, f"{var} must be both declared/checked and later reassigned at the write site"
    # The old, narrower (retcode==10016-only) names must be fully gone --
    # not just superseded -- so nothing still reads/writes an orphaned copy.
    assert "g_lastInvalidStopsTicket" not in fn
    assert "g_lastInvalidStopsSL" not in fn
    assert "g_lastInvalidStopsAt" not in fn


def test_cooldown_skips_before_the_real_modify_and_is_checked_against_the_same_ticket_and_sl():
    fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    cooldown_idx = fn.index("g_lastRejectedModifyTicket == ticket")
    modify_idx = fn.index("if(!trade.PositionModify(ticket, newSL, tp))")
    assert cooldown_idx < modify_idx, "the cooldown skip must be checked before attempting the real broker request"
    window = fn[cooldown_idx:modify_idx]
    assert "MathAbs(g_lastRejectedModifySL - newSL) < slTol" in window
    # Fourth pass: 5s wasn't long enough -- a position stuck in a broker
    # freeze/stops-level rejection for tens of seconds of simulated time
    # still produced several repeats before the window re-armed. Widened
    # to 60s (matching this file's existing 60s benign-log-throttle
    # convention) so each affected ticket produces at most one rejection
    # per minute of real backoff instead of one every 5 seconds.
    assert "TimeCurrent() - g_lastRejectedModifyAt < 60" in window
    assert "return false;" in window


def test_position_close_authority_has_its_own_rejection_cooldown():
    # Fourth pass: SafeModifySL() (SL/TP modify) had a cooldown, but
    # OWNER_R_EXIT_CLOSE_ONLY() (the sole authority allowed to actually
    # close a position) had none at all -- every tick the exit condition
    # stayed true, it re-called trade.PositionClose() unconditionally.
    # A MetaQuotes Market validation run showed this spamming identically
    # ("failed market buy/sell ... close #N ...") whenever the broker
    # rejected the close (e.g. price frozen near this level), completely
    # unsuppressed. Same fix, same rationale, applied to this function.
    fn = function(EA, "bool OWNER_R_EXIT_CLOSE_ONLY(", "bool SafePositionClose(")
    cooldown_idx = fn.index("g_lastRejectedCloseTicket == ticket")
    close_idx = fn.index("bool ok = trade.PositionClose(ticket);")
    assert cooldown_idx < close_idx, "the cooldown skip must be checked before attempting the real broker close"
    window = fn[cooldown_idx:close_idx]
    assert "TimeCurrent() - g_lastRejectedCloseAt < 60" in window
    assert "return false;" in window
    # The write (recording a rejection) must happen in the failure branch,
    # after the close attempt, so a *successful* close never gets throttled.
    write_idx = fn.index("g_lastRejectedCloseTicket = ticket;")
    assert close_idx < write_idx < fn.index("return false;", write_idx)


def test_rejection_is_recorded_unconditionally_for_any_retcode():
    # Third pass: recording the cooldown must NOT be gated on a specific
    # retcode (that was the second pass's bug -- it only caught 10016 and
    # missed 10029, which is what MetaQuotes' validator actually hit).
    # The write must sit directly after computing ret/err (post-retry),
    # with no `if(ret == ...)` gate in between.
    fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    write_idx = fn.index("g_lastRejectedModifyTicket = ticket;")
    retry_block_end = fn.index("err = GetLastError();\n      }") + len("err = GetLastError();\n      }")
    between = fn[retry_block_end:write_idx]
    assert "if(ret ==" not in between, f"cooldown write must be unconditional, found a retcode gate: {between!r}"
    assert "if(err ==" not in between, f"cooldown write must be unconditional, found an errcode gate: {between!r}"


def test_other_transient_retcode_handling_untouched():
    # The pre-existing context-busy retry (err==4756 || ret==10016, one
    # 150ms-yield retry) and the 3-per-second throttle for non-emergency
    # tags are unrelated to this fix and must be byte-present unchanged.
    fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    assert "if(err == 4756 || ret == 10016)" in fn
    assert "Sleep(150);" in fn
    assert "if(g_slModsThisSec >= 3)" in fn


def test_safe_min_stop_distance_uses_a_real_floor_not_just_reported_levels():
    # Fifth pass: the actual root cause of the still-failing MetaQuotes
    # validation was that the pre-flight clamp/freeze checks only acted
    # when the broker-reported SYMBOL_TRADE_STOPS_LEVEL/FREEZE_LEVEL was
    # > 0 -- on the MetaQuotes-Demo validation account both report 0 for
    # XAUUSD, silently disabling the pre-checks entirely, while the
    # underlying broker/tester still rejected requests within roughly
    # 100-150 points of a position's stop. The floor must apply
    # unconditionally, not gated on the reported value being nonzero.
    fn = function(EA, "double XAU_SafeMinStopDistance()", "double XAU_NormalizeToTick(")
    assert "MathMax(reported, floorDist)" in fn
    assert "150.0 * pt" in fn


def test_normalize_to_tick_uses_tick_size_not_just_digits():
    fn = function(EA, "double XAU_NormalizeToTick(", "bool SafeModifySL(")
    assert "SYMBOL_TRADE_TICK_SIZE" in fn
    assert "MathRound(price / tickSize) * tickSize" in fn


def test_safemodifysl_checks_freeze_against_current_sl_not_just_new_target():
    # The dominant remaining spam after the fourth pass was rejections
    # where the position's EXISTING SL (not the newly requested target)
    # was within the freeze band of price -- MT5 freezes all operations
    # on a position once price nears its current stop, independent of
    # what a new target would be. Checking only the new target (pre-
    # fifth-pass behavior) missed this.
    fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    assert "double distCurSL = MathAbs(curPrice - curSL);" in fn
    assert "double distNewSL = isBuy ? MathAbs(curPrice - newSL) : MathAbs(newSL - curPrice);" in fn
    # Both checks must use the real floor, not the old reported-only distance.
    assert fn.count("distCurSL < minSafeDist") == 1
    assert fn.count("distNewSL < minSafeDist") == 1


def test_safemodifysl_rereads_fresh_price_before_validating():
    fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    fresh_idx = fn.index("double freshPrice = isBuy ? SymbolInfoDouble(Symbol(), SYMBOL_BID)")
    clamp_idx = fn.index("if(isBuy)\n   {\n      double maxAllowedSL")
    assert fresh_idx < clamp_idx, "fresh price must be re-read before the clamp/freeze checks use it"


def test_close_and_modify_share_a_trade_guard_to_prevent_racing_on_the_same_ticket():
    # Fifth pass: OWNER_R_EXIT_CLOSE_ONLY() now marks close-intent BEFORE
    # attempting the broker close; SafeModifySL() checks that same flag
    # and defers rather than fighting an in-flight close for the same
    # ticket. Both must reference the same shared XAU_TradeGuard_* API.
    close_fn = function(EA, "bool OWNER_R_EXIT_CLOSE_ONLY(", "bool SafePositionClose(")
    intent_idx = close_fn.index("g_tradeGuard[trgIdx].closeIntentActive = true;")
    close_call_idx = close_fn.index("bool ok = trade.PositionClose(ticket);")
    assert intent_idx < close_call_idx, "close-intent must be set before the broker call, not after"

    modify_fn = function(EA, "bool SafeModifySL(", "double StrategyReferenceBalance()")
    assert "g_tradeGuard[trgIdx].closeIntentActive && TimeCurrent() - g_tradeGuard[trgIdx].closeIntentAt < 30" in modify_fn


def test_owner_r_exit_close_only_has_its_own_freeze_preflight_check():
    fn = function(EA, "bool OWNER_R_EXIT_CLOSE_ONLY(", "bool SafePositionClose(")
    preflight_idx = fn.index("MathAbs(freshPx - curSLNow) < minSafeDistClose")
    close_call_idx = fn.index("bool ok = trade.PositionClose(ticket);")
    assert preflight_idx < close_call_idx, "the freeze pre-check must run before ever attempting the broker close"


def test_market_session_check_exists_before_new_entries():
    # A MetaQuotes validation report showed one entry attempt sent while
    # XAUUSD's actual trading session was closed ("[Market closed]").
    # SYMBOL_TRADE_MODE_DISABLED only catches an administrative disable,
    # not a daily session close -- must check SymbolInfoSessionTrade too.
    assert "MARKET_SESSION_CLOSED" in EA
    assert "SymbolInfoSessionTrade(Symbol(), (ENUM_DAY_OF_WEEK)dtNow.day_of_week, 0, sessFrom, sessTo)" in EA
    # Must appear near the existing administrative-disable check, i.e. as
    # part of the same entry gate, not some unrelated/unused function.
    disabled_idx = EA.index('rejectReason = "SYMBOL_TRADING_DISABLED";')
    session_idx = EA.index('rejectReason = "MARKET_SESSION_CLOSED";')
    assert 0 < session_idx - disabled_idx < 2000


def test_trade_guard_array_has_bounded_cleanup():
    # Guards against the new g_tradeGuard[] array growing unbounded across
    # a long run/backtest -- entries for tickets with no open position
    # must be pruned, and that pruning must actually be invoked somewhere
    # (not just defined and never called).
    assert "void XAU_TradeGuard_PruneClosed()" in EA
    assert "XAU_TradeGuard_PruneClosed();" in EA
