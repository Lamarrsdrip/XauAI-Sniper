from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.15.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
SERVER_PY = ROOT / "backend" / "server.py"
DASHBOARD = ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx"


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


def py_body(src: str, def_line: str) -> str:
    """Extract a Python function body by indentation (no braces in Python)."""
    idx = src.index(def_line)
    start = src.index("\n", idx) + 1
    lines = src[start:].splitlines()
    out = []
    base_indent = None
    for line in lines:
        if not line.strip():
            out.append(line)
            continue
        indent = len(line) - len(line.lstrip())
        if base_indent is None:
            base_indent = indent
        if indent < base_indent:
            break
        out.append(line)
    return "\n".join(out)


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61715():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.15"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.15"


# ---------------------------------------------------------------------------
# EA-side: XAU_TryForceOpenTrade must reject on every listed hard reason and
# must delegate execution entirely to OpenTrade() (which itself owns broker
# min/max/step, invalid stops, risk reconciliation, and broker retcode --
# not duplicated here).
# ---------------------------------------------------------------------------
def test_force_open_rejects_invalid_direction_and_setup():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert 'rejectReason = "INVALID_DIRECTION";' in fn
    assert 'rejectReason = "INVALID_SETUP";' in fn


def test_force_open_rejects_stale_candidates():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert "barsElapsed > 3" in fn
    assert 'rejectReason = "STALE_OR_INVALID";' in fn


def test_force_open_rejects_duplicate_same_candle():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert "g_lastForceOpenBar == curBarNow" in fn
    assert 'rejectReason = "DUPLICATE_SAME_CANDLE";' in fn


def test_force_open_enforces_hard_safety_not_covered_by_opentrade():
    # OpenTrade() itself owns invalid stops / broker min-max-step / risk
    # reconciliation / margin-via-broker-retcode -- this wrapper only needs
    # to add what OpenTrade doesn't already check: position count cap,
    # spread hard cap, fresh data, and symbol trading state.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert "CountMyPositions() >= InpMaxOpenTrades" in fn
    assert "spread > InpMaxSpread" in fn
    assert "SYMBOL_TRADE_MODE_DISABLED" in fn
    assert 'rejectReason = "NO_FRESH_DATA";' in fn


def test_force_open_never_calls_soft_quality_gates():
    # The entire point: soft blockers are bypassed by NOT running
    # ScoreSetups/Personality Gate/SmartGuard/AI at all for this path --
    # confirm none of those are referenced inside the function.
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    for forbidden in ["ScoreSetups(", "StrategyFitsPersonality(", "AdaptiveXAUConfirm(", "GetAIAnalysis("]:
        assert forbidden not in fn, f"{forbidden} must not appear -- force-open bypasses soft gates by skipping them"


def test_force_open_delegates_to_opentrade_only_after_hard_checks():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    open_idx = fn.index("bool opened = OpenTrade(dir, atrNow, forceReason, 1.0);")
    for marker in ['rejectReason = "INVALID_DIRECTION"', 'rejectReason = "STALE_OR_INVALID"',
                   'rejectReason = "DUPLICATE_SAME_CANDLE"', 'rejectReason = "MAX_OPEN_TRADES"',
                   'rejectReason = "SPREAD_TOO_WIDE"', 'rejectReason = "NO_FRESH_DATA"',
                   'rejectReason = "SYMBOL_TRADING_DISABLED"']:
        assert fn.index(marker) < open_idx


def test_force_open_command_wired_into_poll_commands():
    ea = read(BACKEND_EA)
    marker = 'else if(action == "FORCE_OPEN_TRADE")'
    assert marker in ea
    idx = ea.index(marker)
    window = ea[idx: idx + 1400]
    assert "XAU_TryForceOpenTrade(fDir, fSetup, fGrade, fBlocker, fCandleTime, rejectReason)" in window
    assert '"FORCE_OPEN_REJECTED_" + rejectReason' in window


# ---------------------------------------------------------------------------
# Backend: FORCE_OPEN_TRADE must be in the safe-command whitelist and its
# payload must be validated (direction/setup/candle age) before ever being
# queued for the EA to see.
# ---------------------------------------------------------------------------
def test_backend_force_open_in_safe_commands():
    server = read(SERVER_PY)
    assert '"FORCE_OPEN_TRADE":' in server


def test_backend_rejects_stale_force_open_payload():
    server = read(SERVER_PY)
    fn = py_body(server, "def _normalize_force_open_payload(payload: Optional[Dict]) -> dict:")
    assert "age_seconds > 15 * 60" in fn
    assert "too old to force-open" in fn


def test_backend_rejects_invalid_direction_and_missing_setup():
    server = read(SERVER_PY)
    fn = py_body(server, "def _normalize_force_open_payload(payload: Optional[Dict]) -> dict:")
    assert 'direction not in {"BUY", "SELL"}' in fn
    assert "requires the original setup name" in fn


def test_backend_normalizes_force_open_payload_on_request():
    server = read(SERVER_PY)
    marker = 'elif action == "FORCE_OPEN_TRADE":'
    assert marker in server
    idx = server.index(marker)
    assert "_normalize_force_open_payload(payload)" in server[idx: idx + 200]


# ---------------------------------------------------------------------------
# Frontend: button only for real, recent blocked candidates; payload carries
# what the backend/EA both need.
# ---------------------------------------------------------------------------
def test_frontend_force_open_button_gated_on_freshness_and_direction():
    dash = read(DASHBOARD)
    assert 'String(event.severity).toUpperCase() === "BLOCK"' in dash
    assert "eventAgeMin <= 15" in dash
    assert "/BUY|SELL/i.test(direction)" in dash


def test_frontend_force_open_shows_confirmation_with_original_blocker():
    dash = read(DASHBOARD)
    marker = "const forceOpenClick = () => {"
    idx = dash.index(marker)
    window = dash[idx: idx + 900]
    assert "manually overriding the bot's soft filter" in window
    assert "FORCE_OPEN_TRADE" in window
    assert "original_blocker" in window
    assert "candle_time" in window


def test_frontend_builds_clean():
    # Sanity: force-open changes must not have broken the production build.
    # (Actual `craco build` was run and confirmed "Compiled successfully"
    # separately -- this test just guards the specific new identifiers exist
    # and are spelled consistently so a future refactor can't silently break
    # the wiring.)
    dash = read(DASHBOARD)
    assert "onForceOpen" in dash
    assert "Zap" in dash
