from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.22.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61722():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.22"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.22"


def test_pending_entry_confirmation_struct_exists():
    ea = read(BACKEND_EA)
    assert "struct PendingEntryConfirmation" in ea
    assert "PendingEntryConfirmation g_pendingEntryConfirm;" in ea


def test_timing_engine_requires_next_bar_reconfirmation():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "nowCandle == g_pendingEntryConfirm.firstSeenCandle + PeriodSeconds(PERIOD_M5)" in fn
    assert "SIGNAL_DETECTED" in fn and "WAITING_FOR_ENTRY_WINDOW" in fn
    assert "ENTRY_CONFIRMING" in fn and "ENTRY_ALLOWED" in fn
    assert "ENTRY_WINDOW_EXPIRED" in fn and "REASSESS_FROM_CURRENT_MARKET" in fn


def test_timing_engine_never_blindly_resumes_a_different_signal():
    # A different setup/direction arriving must start a brand-new window
    # (fresh signalPrice/atr/firstSeenCandle), not reuse the expired one's.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    # the "no match" fallthrough always rewrites every field of the pending record
    tail = fn[fn.index("// No confirmed pending match"):]
    for field in ("g_pendingEntryConfirm.dir             = dir;",
                  "g_pendingEntryConfirm.setup           = setup;",
                  "g_pendingEntryConfirm.signalPrice     = signalPrice;",
                  "g_pendingEntryConfirm.atr             = atr;",
                  "g_pendingEntryConfirm.firstSeenCandle = nowCandle;"):
        assert field in tail


def test_timing_engine_anti_chase_rejects_overextended_confirmation():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TimingEngineConfirmsEntry(int dir, string setup, string grade, double sizeMulti, double atr)")
    assert "movedInFavor > g_pendingEntryConfirm.atr * 1.0" in fn
    assert "OVEREXTENDED_ON_CONFIRM" in fn


def test_opentrade_call_site_gated_by_timing_engine():
    ea = read(BACKEND_EA)
    fn = body(ea, "void OnTick()")
    gate_idx = fn.index("XAU_TimingEngineConfirmsEntry(signal, setupName, grade, finalSzMult, bufATR[1])")
    opentrade_idx = fn.index('bool tradeOpened = OpenTrade(signal, bufATR[1], setupName + " [" + grade + "]", finalSzMult);')
    assert gate_idx < opentrade_idx


# ---------------------------------------------------------------------------
# Behavioral simulation of the state machine (mirrors the MQL5 control flow)
# ---------------------------------------------------------------------------
def test_timing_engine_state_machine_simulation():
    class Pending:
        active = False
        dir = 0
        setup = ""
        signal_price = 0.0
        atr = 0.0
        first_seen_candle = 0

    pending = Pending()
    BAR = 300  # PeriodSeconds(PERIOD_M5)

    def confirms(dir_, setup, price, atr, now_candle):
        same = (pending.active and pending.dir == dir_ and pending.setup == setup and
                now_candle == pending.first_seen_candle + BAR)
        if same:
            moved = (price - pending.signal_price) if dir_ == 1 else (pending.signal_price - price)
            if moved <= pending.atr * 1.0:
                pending.active = False
                return True
        pending.active = True
        pending.dir = dir_
        pending.setup = setup
        pending.signal_price = price
        pending.atr = atr
        pending.first_seen_candle = now_candle
        return False

    # Bar 1: fresh SELL signal detected -> must NOT fire yet.
    assert confirms(-1, "TREND_PULLBACK", 4038.25, 6.39, 1000) is False
    # Bar 2 (same setup+dir, next bar, small move): confirmed -> fires.
    assert confirms(-1, "TREND_PULLBACK", 4037.90, 6.39, 1300) is True

    # A signal that reverses direction on the next bar never blindly fires
    # the OLD direction -- it opens a brand new window instead.
    assert confirms(-1, "TREND_PULLBACK", 4050.00, 6.00, 2000) is False
    assert confirms(1, "TREND_PULLBACK", 4051.00, 6.00, 2300) is False  # different dir -> fresh window, not confirmed
    assert confirms(1, "TREND_PULLBACK", 4052.00, 6.00, 2600) is True   # now confirms on ITS OWN next bar

    # Overextension on the confirming bar re-opens a fresh window instead of firing.
    assert confirms(-1, "SQUEEZE_RELEASE", 4038.26, 6.0, 3000) is False
    assert confirms(-1, "SQUEEZE_RELEASE", 4038.26 - 20.0, 6.0, 3300) is False  # moved 20 > 1xATR(6) -> re-armed, not fired
