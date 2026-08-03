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
    assert "TimeCurrent() - g_lastRejectedModifyAt < 5" in window
    assert "return false;" in window


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
