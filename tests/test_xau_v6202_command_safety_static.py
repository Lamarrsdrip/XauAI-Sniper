from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.20.2.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
SERVER = ROOT / "backend" / "server.py"
DASHBOARD = ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx"
THOUGHT_FEED = ROOT / "frontend" / "src" / "components" / "cloud" / "AIThoughtFeed.jsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def mql_body(src: str, signature: str) -> str:
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


def test_v6202_identity_and_download_source_sync():
    ea = read(EA)
    assert '#property version   "6.201"' in ea
    assert '#define XAUAI_EA_VERSION "v6.20.2"' in ea
    assert '#define XAUAI_EA_VERSION_NUM "6.20.2"' in ea
    assert read(EA) == read(BACKEND_EA)


def test_loss_firewall_treats_remote_force_close_as_manual_only():
    ea = read(BACKEND_EA)
    fn = mql_body(ea, "bool XAU_EmergencyLossCloseAllowed(string ctx)")
    assert 'StringFind(c, "REMOTE_FORCE_CLOSE") >= 0' in fn
    assert 'StringFind(c, "REMOTE_COMMAND_CLOSE_ALL") >= 0' in fn
    assert 'StringFind(c, "MANUAL") >= 0' in fn


def test_force_close_ticket_is_exact_magic_symbol_scoped():
    ea = read(BACKEND_EA)
    fn = mql_body(ea, "bool XAU_TryForceCloseTicket(ulong ticket, string requestedSymbol, string &result)")
    for marker in [
        "PositionSelectByTicket(ticket)",
        "POSITION_SYMBOL",
        "POSITION_MAGIC",
        "posMagic != InpMagicNumber",
        "XAU_SetPendingExitReason(ticket, closeReason)",
        "SafePositionClose(ticket, closeReason)",
        "trade.ResultRetcode()",
        "REMOTE_FORCE_CLOSE_TICKET_MANUAL",
    ]:
        assert marker in fn


def test_ea_sl_tp_modify_paths_do_not_fail_silently():
    ea = read(BACKEND_EA)
    assert 'SafeModifySL(ticket, newSL, PositionGetDouble(POSITION_TP),' in ea
    assert '"DAILY_PROFIT_LOCK"' in ea
    assert "TP_EXTEND FAIL" in ea
    assert "trade.ResultRetcodeDescription()" in ea
    assert "PG ratchet modify failed" in ea
    assert "broker rejected SLTP update" in ea


def test_ea_command_poller_has_separate_force_close_branch():
    ea = read(BACKEND_EA)
    branch = ea[ea.index('else if(action == "FORCE_CLOSE_TRADE")'):ea.index('else if(action == "FORCE_SYNC")')]
    assert 'JsonStringField(body, "ticket")' in branch
    assert 'JsonStringField(body, "symbol")' in branch
    assert "XAU_TryForceCloseTicket(targetTicket, reqSymbol, closeResult)" in branch
    assert 'status = closed ? "EXECUTED" : "FAILED";' in branch


def test_force_open_carries_signal_price_symbol_and_score_to_ea():
    ea = read(BACKEND_EA)
    branch = ea[ea.index('else if(action == "FORCE_OPEN_TRADE")'):ea.index("g_lastRemoteCommandState = action")]
    assert 'JsonNumberField(body, "signal_price")' in branch
    assert 'JsonNumberField(body, "score")' in branch
    assert 'JsonStringField(body, "symbol")' in branch
    assert "fSignalPx, fScore" in branch
    fn = mql_body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert "SYMBOL_MISMATCH_REQUESTED" in fn
    assert "missedMove" in fn
    assert "executionImprovement" in fn
    assert "signalPx=%.5f currentPx=%.5f" in fn


def test_backend_validates_force_close_and_extends_force_open_payload():
    server = read(SERVER)
    assert '"FORCE_CLOSE_TRADE": "Force-close one exact ticket"' in server
    assert '"FORCE_CLOSE_TRADE": 5' in server
    assert '"CLOSE_ALL_TRADES": 5' in server
    assert '"FORCE_OPEN_TRADE": 15' in server
    assert "async def _expire_stale_pending_commands" in server
    expiry_fn = py_body(server, "async def _expire_stale_pending_commands(now: Optional[datetime] = None) -> int:")
    for marker in [
        '"status": "PENDING"',
        '"requested_at": {"$lt": cutoff}',
        '"status": "EXPIRED"',
        '"ack_status": "EXPIRED"',
        "Command expired before EA acknowledgement",
    ]:
        assert marker in expiry_fn
    open_fn = py_body(server, "def _normalize_force_open_payload(payload: Optional[Dict]) -> dict:")
    for marker in ['"symbol": symbol', '"signal_price": signal_price', '"score": score', '"event_time":']:
        assert marker in open_fn
    close_fn = py_body(server, "def _normalize_force_close_payload(payload: Optional[Dict]) -> dict:")
    assert "Force-close requires the exact open MT5 ticket id." in close_fn
    assert "ticket.isdigit()" in close_fn
    handler_start = server.index("async def cloud_command_request")
    request_window = server[handler_start:server.index("doc = {", handler_start)]
    assert "_normalize_force_close_payload(payload)" in request_window


def test_backend_pending_endpoint_expires_stale_commands_before_serving():
    server = read(SERVER)
    start = server.index("async def cloud_command_pending")
    end = server.index("@api_router.post(\"/cloud/command/ack\")", start)
    pending_fn = server[start:end]
    expire_idx = pending_fn.index("expired = await _expire_stale_pending_commands()")
    query_idx = pending_fn.index('query = {"status": "PENDING"}')
    find_idx = pending_fn.index("db.cloud_bot_commands.find(query")
    assert expire_idx < query_idx < find_idx
    assert '"expired": expired' in pending_fn


def test_frontend_force_open_payload_includes_audit_fields():
    dash = read(DASHBOARD)
    click = dash[dash.index("const forceOpenClick = () => {"):dash.index("const facts = [")]
    for marker in ["symbol,", "signal_price:", "score:", "event_time:", "signal_id:"]:
        assert marker in click


def test_frontend_open_trade_panel_has_exact_ticket_force_close():
    feed = read(THOUGHT_FEED)
    assert "onForceClose" in feed
    assert 'action: "FORCE_CLOSE_TRADE"' in feed
    assert "Force Close Ticket" in feed
    assert "ticket," in feed
    assert "symbol," in feed
    dash = read(DASHBOARD)
    assert "openCommand={setModalCommand}" in dash
    assert "onForceClose={openCommand}" in dash
