"""
XauAi Cloud — Windows VPS Worker Agent
======================================

A self-contained polling worker that:
  1. Pulls pending subscriber MT5 credentials from the backend
  2. Keeps each subscriber's headless MT5 terminal logged in
  3. Mirrors every master signal (open/close) into each subscriber's account,
     scaling lot size to their balance + risk tier
  4. Reports fills, closes, equity snapshots, and worker heartbeat back to
     the backend so the admin panel + user dashboards stay live

Usage (Windows VPS):
  > copy config.example.env .env
  > edit .env → fill CLOUD_URL, CLOUD_AGENT_TOKEN, WORKER_ID
  > pip install -r requirements.txt
  > python worker_agent.py

Mock mode (any OS, for dry-run testing):
  > set MOCK_MT5=1 && python worker_agent.py
  → logs every action but never actually calls MT5. Perfect for sanity-checking
    the backend round-trip before you rent the VPS.

Author: XauAi Sniper   |   Version: 1.5.5  (isolated account health + retry cooldown)
"""
from __future__ import annotations

import json
import logging
import os
import platform
import signal
import socket
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple

import requests
from dotenv import load_dotenv

# ---------- MT5 import (optional — falls back to mock on non-Windows) ----------
MOCK_MT5 = os.environ.get("MOCK_MT5", "").strip() in ("1", "true", "yes")
mt5 = None  # type: ignore
if not MOCK_MT5:
    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception as e:
        print(f"[INFO] MetaTrader5 package not available ({e}). Running in MOCK mode.")
        MOCK_MT5 = True

# ---------- Config ----------
load_dotenv()

def _interactive_pair():
    """First-run pairing — prompts for cloud URL + 6-digit code, writes .env."""
    print("=" * 60)
    print(" XauAi Cloud Worker — first-run pairing")
    print("=" * 60)
    print(" 1. Open your admin panel → Cloud → Infrastructure")
    print(" 2. Click 'Generate Pairing Code'")
    print(" 3. Paste the 6-digit code below.\n")
    cloud_url = input("Cloud URL [https://xauaisniper.com]: ").strip() or "https://xauaisniper.com"
    code = input("6-digit pairing code: ").strip()
    if not code.isdigit() or len(code) != 6:
        print("[FAIL] Code must be 6 digits."); sys.exit(1)
    try:
        r = requests.post(f"{cloud_url.rstrip('/')}/api/cloud/agent/pair",
                          json={"code": code, "hostname": socket.gethostname()},
                          timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"[FAIL] Pair failed: {e}"); sys.exit(1)
    cfg = (
        f"CLOUD_URL={cloud_url}\n"
        f"CLOUD_AGENT_TOKEN={data['agent_token']}\n"
        f"WORKER_ID={data['worker_id']}\n"
        f"POLL_SEC=1\n"
        f"HEARTBEAT_SEC=30\n"
        f"EQUITY_SEC=30\n"
        f"HTTP_TIMEOUT=8\n"
        f"MOCK_MT5={os.environ.get('MOCK_MT5','0')}\n"
    )
    here = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(here, ".env")
    with open(env_path, "w") as f: f.write(cfg)
    print(f"\n[OK] Paired as worker '{data.get('worker_name')}'.")
    print(f"[OK] Config saved to {env_path}\n")
    load_dotenv(env_path, override=True)

# If .env config is missing critical fields, drop into pairing wizard
if not (os.environ.get("CLOUD_URL") and os.environ.get("CLOUD_AGENT_TOKEN") and os.environ.get("WORKER_ID")):
    if os.environ.get("XAUAI_NO_PAIR") == "1":
        print("[FAIL] Missing CLOUD_URL/CLOUD_AGENT_TOKEN/WORKER_ID and XAUAI_NO_PAIR=1 set.")
        sys.exit(1)
    _interactive_pair()

CLOUD_URL = os.environ["CLOUD_URL"].rstrip("/")
AGENT_TOKEN = os.environ["CLOUD_AGENT_TOKEN"]
WORKER_ID = os.environ["WORKER_ID"]
POLL_SEC = int(os.environ.get("POLL_SEC", "1"))
HEARTBEAT_SEC = int(os.environ.get("HEARTBEAT_SEC", "30"))
EQUITY_SEC = int(os.environ.get("EQUITY_SEC", "30"))
HTTP_TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "8"))
VERSION = "1.5.5"

# The MetaTrader5 Python package exposes one global terminal session per worker
# process. One worker must therefore manage one live MT5 account by default;
# otherwise account A and account B keep replacing each other's terminal login.
WORKER_MAX_USERS = max(1, int(os.environ.get("WORKER_MAX_USERS", "1")))
WORKER_USER_ID = os.environ.get("WORKER_USER_ID", "").strip()
WORKER_MT5_LOGIN = os.environ.get("WORKER_MT5_LOGIN", "").strip()

# Per-account fault isolation. The MT5 Python bridge is global, so a bad login
# must be quarantined quickly instead of being retried on every loop and
# poisoning execution for healthy accounts.
LOGIN_RETRY_BASE_SEC = int(os.environ.get("WORKER_LOGIN_RETRY_BASE_SEC", "30"))
LOGIN_RETRY_MAX_SEC = int(os.environ.get("WORKER_LOGIN_RETRY_MAX_SEC", "900"))
LOGIN_NEEDS_ATTENTION_AFTER = int(os.environ.get("WORKER_LOGIN_NEEDS_ATTENTION_AFTER", "5"))

# Catch-up window: on cold start we only execute signals from the last N minutes
# to avoid replaying historic trades. 0 = only signals fired AFTER worker start.
SIGNAL_CATCHUP_MIN = int(os.environ.get("SIGNAL_CATCHUP_MIN", "5"))

HEADERS = {"X-Agent-Token": AGENT_TOKEN, "X-Worker-Id": WORKER_ID, "Content-Type": "application/json"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("xauai-worker")

# Common XAUUSD symbol variants to probe when broker uses a non-standard name.
SYMBOL_VARIANTS = [
    "XAUUSD", "XAUUSDm", "XAUUSD.r", "XAUUSD.s", "XAUUSD.c", "XAUUSDc",
    "XAUUSD-Z", "XAUUSDpro", "XAUUSD#", "XAUUSD.", "GOLD", "GOLDm",
    "GOLD.s", "GOLD.", "GOLDmicro", "GOLDpro", "XAU/USD", "XAUUSDX",
    "XAUUSD_i", "XAUUSD.raw", "XAUUSD-RAW", "XAUUSDecn", "XAUUSD_ECN",
]


# ---------- State ----------
@dataclass
class UserSession:
    user_id: str
    email: str
    mt5_login: int
    mt5_server: str
    mt5_password: str
    risk_tier: str = "balanced"        # conservative | balanced | aggressive
    last_balance: float = 1000.0
    last_equity: float = 1000.0
    logged_in: bool = False
    resolved_symbol: str = ""          # cached XAUUSD-equivalent for THIS broker
    # signal_id -> MT5 ticket, so we can close precisely when master closes
    open_tickets: Dict[str, int] = field(default_factory=dict)
    # diagnostic counters
    fanout_attempts: int = 0
    fanout_successes: int = 0
    last_fanout_error: str = ""
    status: str = "CONNECTING"       # CONNECTING | ACTIVE | COPYING | LOGIN_FAILED | EA_DISABLED | PAUSED | DISABLED | NEEDS_ATTENTION | NEEDS_DEDICATED_WORKER
    retry_count: int = 0
    next_retry_at: float = 0.0
    last_login_attempt_at: float = 0.0
    last_success_at: float = 0.0
    last_status_report_at: float = 0.0
    algo_ok: bool = True


RISK_PCT = {"conservative": 0.6, "balanced": 1.2, "aggressive": 2.0}

# v1.5.3 — STRICT PROPORTIONAL MIRROR BY DEFAULT.
# Previous workers secretly capped mirror lots to 10% estimated SL risk, so a
# larger cloud account could receive a smaller trade than the master. That is
# wrong for a copier. Default 0 disables this optional cap; real safety remains:
# broker min/max lot, lot step, margin/free-margin checks, symbol rules, and the
# tiny-account floor below. Operators may set WORKER_MAX_RISK_PCT manually if
# they want an extra cap for a specific VPS.
MAX_RISK_PCT_PER_TRADE = float(os.environ.get("WORKER_MAX_RISK_PCT", "0"))
MIN_BALANCE_USD        = float(os.environ.get("WORKER_MIN_BALANCE_USD", "10.0"))
XAU_USD_PER_LOT_PER_PRICE = 100.0   # XAUUSD: 1.0 lot ≈ $100 P&L per $1 price move


class WorkerAgent:
    def __init__(self) -> None:
        self.users: Dict[str, UserSession] = {}
        # cold-start cursor: only pick up signals fired after worker boot
        # (minus a small catch-up window for very recent ones)
        boot = datetime.now(timezone.utc) - timedelta(minutes=SIGNAL_CATCHUP_MIN)
        self.last_signal_poll: str = boot.isoformat()
        self.last_hb: float = 0.0
        self.last_eq: float = 0.0
        self.running = True
        self._last_bulletproof_notice: Dict[str, float] = {}
        # which user currently owns the active MT5 terminal connection
        self._active_user_id: str = ""
        self._capacity_reported: Dict[str, float] = {}
        # v1.4 — persist open_tickets across worker restarts. Without this,
        # any restart between OPEN and CLOSE orphans cloud trades because
        # the in-memory sig_id → ticket map is lost.
        self.state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        "worker_state.json")
        self._load_state()

    # ---------- State persistence (sig_id → ticket survives worker restart) ----------
    def _save_state(self) -> None:
        try:
            data = {uid: u.open_tickets for uid, u in self.users.items()}
            with open(self.state_path, "w") as f:
                json.dump(data, f)
        except Exception as e:
            log.warning("save_state failed: %s", e)

    def _load_state(self) -> None:
        try:
            if not os.path.exists(self.state_path): return
            with open(self.state_path) as f:
                data = json.load(f)
            self._pending_state = data or {}
            log.info("loaded worker_state.json with %d users' open_tickets", len(self._pending_state))
        except Exception as e:
            log.warning("load_state failed: %s", e)
            self._pending_state = {}

    # ---------- HTTP helpers ----------
    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        r = requests.get(f"{CLOUD_URL}{path}", headers=HEADERS, params=params, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict) -> dict:
        r = requests.post(f"{CLOUD_URL}{path}", headers=HEADERS, data=json.dumps(body), timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()

    def _post_safe(self, path: str, body: dict) -> None:
        """Best-effort POST that logs but never raises."""
        try:
            self._post(path, body)
        except Exception as e:
            log.warning("POST %s failed: %s", path, e)

    def _report_capacity_skip(self, row: dict, reason: str) -> None:
        uid = row.get("id")
        if not uid:
            return
        now = time.time()
        if now - float(self._capacity_reported.get(uid, 0.0)) < 60:
            return
        self._capacity_reported[uid] = now
        self._post_safe("/api/cloud/agent/account-status", {
            "user_id": uid,
            "worker_id": WORKER_ID,
            "status": "NEEDS_DEDICATED_WORKER",
            "logged_in": False,
            "algo_ok": True,
            "retry_count": 0,
            "next_retry_at": "",
            "last_success_at": "",
            "last_error": reason,
            "server": row.get("mt5_server") or row.get("broker_server") or "",
            "login": int(row.get("mt5_login") or 0),
            "resolved_symbol": "",
        })

    def _retry_delay(self, u: UserSession) -> int:
        exp = min(max(int(u.retry_count) - 1, 0), 6)
        return int(min(LOGIN_RETRY_MAX_SEC, LOGIN_RETRY_BASE_SEC * (2 ** exp)))

    def _retry_due(self, u: UserSession) -> bool:
        return time.time() >= float(u.next_retry_at or 0.0)

    def _status_payload(self, u: UserSession) -> dict:
        return {
            "user_id": u.user_id,
            "worker_id": WORKER_ID,
            "status": u.status,
            "logged_in": bool(u.logged_in),
            "algo_ok": bool(u.algo_ok),
            "retry_count": int(u.retry_count),
            "next_retry_at": datetime.fromtimestamp(u.next_retry_at, timezone.utc).isoformat() if u.next_retry_at else "",
            "last_success_at": datetime.fromtimestamp(u.last_success_at, timezone.utc).isoformat() if u.last_success_at else "",
            "last_error": u.last_fanout_error or "",
            "server": u.mt5_server,
            "login": int(u.mt5_login or 0),
            "resolved_symbol": u.resolved_symbol or "",
        }

    def _report_account_status(self, u: UserSession, force: bool = False) -> None:
        now = time.time()
        if not force and now - float(u.last_status_report_at or 0.0) < 20:
            return
        u.last_status_report_at = now
        self._post_safe("/api/cloud/agent/account-status", self._status_payload(u))

    def _mark_account_ok(self, u: UserSession, status: str = "ACTIVE") -> None:
        u.logged_in = True
        u.status = status
        u.retry_count = 0
        u.next_retry_at = 0.0
        u.last_success_at = time.time()
        u.algo_ok = True
        u.last_fanout_error = ""
        self._report_account_status(u, force=True)

    def _mark_account_failed(self, u: UserSession, status: str, error: str) -> None:
        u.logged_in = False
        u.status = "NEEDS_ATTENTION" if u.retry_count + 1 >= LOGIN_NEEDS_ATTENTION_AFTER else status
        u.retry_count += 1
        delay = self._retry_delay(u)
        u.next_retry_at = time.time() + delay
        u.last_fanout_error = error
        u.algo_ok = status != "EA_DISABLED"
        if self._active_user_id == u.user_id:
            self._active_user_id = ""
        log.warning(
            "ACCOUNT LOGIN FAILED: user=%s status=%s retry=%d next_retry=%ds — account skipped, other accounts continuing | %s",
            u.email, u.status, u.retry_count, delay, error,
        )
        log.warning("ACCOUNT RETRY SCHEDULED: user=%s next_retry=%s",
                    u.email, datetime.fromtimestamp(u.next_retry_at, timezone.utc).isoformat())
        log.info("MASTER TRADE BROADCAST CONTINUES — failed account isolated user=%s", u.email)
        self._report_account_status(u, force=True)

    def _can_attempt_account(self, u: UserSession, action: str) -> bool:
        if u.status in ("DISABLED", "PAUSED"):
            log.warning("COPY SKIPPED FOR FAILED ACCOUNT: user=%s action=%s status=%s",
                        u.email, action, u.status)
            return False
        if not self._retry_due(u):
            wait = int(max(0, u.next_retry_at - time.time()))
            log.warning("COPY SKIPPED FOR FAILED ACCOUNT: user=%s action=%s status=%s retry_in=%ds last_error=%s",
                        u.email, action, u.status, wait, u.last_fanout_error)
            return False
        return True

    def _history_profit_for_position(self, position_id: int, fallback: float) -> float:
        """Best-effort realized P&L lookup after MT5 closes a position.

        MT5's open position profit is only a snapshot. The dashboard needs the
        realized close deal, including swap/commission when the broker reports
        them. If history is slow or unavailable, keep the live snapshot fallback.
        """
        if MOCK_MT5 or not position_id:
            return fallback
        try:
            time.sleep(0.15)
            to_dt = datetime.now(timezone.utc) + timedelta(minutes=2)
            from_dt = to_dt - timedelta(days=3)
            deals = mt5.history_deals_get(from_dt, to_dt) or ()
            out_codes = {
                int(getattr(mt5, "DEAL_ENTRY_OUT", 1)),
                int(getattr(mt5, "DEAL_ENTRY_INOUT", 2)),
                1, 2,
            }
            total = 0.0
            found = False
            for d in deals:
                if int(getattr(d, "position_id", 0) or 0) != int(position_id):
                    continue
                if int(getattr(d, "entry", -1) or -1) not in out_codes:
                    continue
                total += float(getattr(d, "profit", 0.0) or 0.0)
                total += float(getattr(d, "swap", 0.0) or 0.0)
                total += float(getattr(d, "commission", 0.0) or 0.0)
                found = True
            return total if found else fallback
        except Exception as e:
            log.debug("history profit lookup failed position=%s: %s", position_id, e)
            return fallback

    # ---------- MT5 session swap ----------
    def _ensure_active(self, u: UserSession) -> bool:
        """CRITICAL: the MetaTrader5 Python SDK has a SINGLE global terminal
        connection. To swap accounts we MUST:
          1. mt5.initialize() exactly ONCE (no login args)
          2. mt5.login(login, password, server) for each account swap
        Calling initialize() repeatedly with login args triggers
        (-2, 'Terminal: Invalid params'). Cached active-user id avoids
        redundant swaps when the same user is already logged in."""
        if MOCK_MT5:
            self._mark_account_ok(u, "COPYING")
            self._active_user_id = u.user_id
            return True
        if not self._can_attempt_account(u, "LOGIN"):
            return False
        if self._active_user_id == u.user_id and u.logged_in:
            # Already active for this user — verify MT5 did not get switched by
            # a failed fallback/login attempt. The Python bridge is global.
            try:
                acct = mt5.account_info()
                if acct and int(getattr(acct, "login", 0) or 0) == int(u.mt5_login):
                    return True
            except Exception:
                pass
            log.warning("ACTIVE SESSION DRIFT: cached user=%s but MT5 account differs; re-authenticating",
                        u.email)
            u.logged_in = False
            self._active_user_id = ""
        # 1. Ensure terminal is up exactly once.
        if not getattr(self, "_mt5_inited", False):
            ok = mt5.initialize()
            if not ok:
                err = mt5.last_error()
                msg = f"mt5.initialize failed: {err}. Start MT5 on the VPS and confirm the terminal is reachable."
                log.error("mt5.initialize FAIL err=%s — is MT5 terminal installed and reachable?", err)
                self._mark_account_failed(u, "NEEDS_ATTENTION", msg)
                return False
            self._mt5_inited = True
            log.info("mt5 terminal initialized")
        # 2. Switch account via mt5.login (preferred for swaps).
        u.last_login_attempt_at = time.time()
        try:
            ok = mt5.login(login=int(u.mt5_login),
                           password=str(u.mt5_password or ""),
                           server=str(u.mt5_server or ""))
        except Exception as e:
            ok = False
            log.error("mt5.login raised user=%s: %s", u.email, e)
        if not ok:
            err = mt5.last_error()
            # Fallback: some SDK versions only accept account-swap via
            # re-initialize with explicit login args. Try that path.
            ok2 = False
            try:
                ok2 = mt5.initialize(login=int(u.mt5_login),
                                     server=str(u.mt5_server or ""),
                                     password=str(u.mt5_password or ""))
            except Exception as e:
                err = (-2, f"initialize-fallback raised: {e}")
            if not ok2:
                msg = (
                    f"login swap failed: {err}. "
                    f"Login={u.mt5_login} Server='{u.mt5_server}'. "
                    "Common causes: (a) broker server name typo "
                    "(must match exactly what shows in MT5 → File → Login → Server dropdown), "
                    "(b) user's broker uses a different server than what was entered, "
                    "(c) password was changed in MT5 but not updated in cloud."
                )
                log.error("mt5 login swap FAIL user=%s server=%s err=%s",
                          u.email, u.mt5_server, err)
                self._mark_account_failed(u, "LOGIN_FAILED", msg)
                return False
        acct = mt5.account_info()
        if not acct:
            self._mark_account_failed(u, "LOGIN_FAILED", "account_info() returned None after login; account skipped.")
            return False
        if int(getattr(acct, "login", 0) or 0) != int(u.mt5_login):
            self._mark_account_failed(
                u, "LOGIN_FAILED",
                f"MT5 login drift: requested {u.mt5_login}, terminal is on {getattr(acct, 'login', 'unknown')}. Account skipped."
            )
            return False
        term = mt5.terminal_info()
        account_trade_ok = bool(getattr(acct, "trade_allowed", True))
        account_expert_ok = bool(getattr(acct, "trade_expert", True))
        terminal_ok = bool(getattr(term, "trade_allowed", True)) if term else True
        if not account_trade_ok:
            self._mark_account_failed(u, "EA_DISABLED", "Account connected but trading permission is disabled. Use the trading password, not investor password.")
            return False
        if not account_expert_ok or not terminal_ok:
            self._mark_account_failed(u, "EA_DISABLED", "EA/ALGO DISABLED: MT5 AutoTrading or Expert Advisors permission is off on the VPS terminal.")
            return False
        u.last_balance = float(acct.balance)
        u.last_equity = float(getattr(acct, "equity", acct.balance) or acct.balance)
        self._active_user_id = u.user_id
        self._mark_account_ok(u, "COPYING")
        log.info("ACCOUNT HEALTH OK: user=%s copying active balance=%.2f equity=%.2f server=%s",
                 u.email, u.last_balance, u.last_equity, u.mt5_server)
        return True

    def mt5_login(self, u: UserSession) -> bool:
        if MOCK_MT5:
            self._mark_account_ok(u, "COPYING")
            self._active_user_id = u.user_id
            log.info("[MOCK] login ok user=%s login=%s server=%s", u.email, u.mt5_login, u.mt5_server)
            return True
        return self._ensure_active(u)

    # ---------- Symbol auto-resolution ----------
    def _resolve_symbol(self, u: UserSession, requested: str) -> Optional[str]:
        """Find the broker-specific XAUUSD symbol for THIS user's terminal.
        Caches per-user. Tries the master-EA's name first, then known variants."""
        if u.resolved_symbol:
            return u.resolved_symbol
        if MOCK_MT5:
            u.resolved_symbol = requested or "XAUUSD"
            return u.resolved_symbol
        # 1. Try the requested name exactly.
        candidates: List[str] = []
        if requested:
            candidates.append(requested)
        candidates.extend([s for s in SYMBOL_VARIANTS if s != requested])
        for sym in candidates:
            info = mt5.symbol_info(sym)
            if info is None:
                continue
            # Symbol exists in the broker's universe. Activate it.
            if not info.visible:
                if not mt5.symbol_select(sym, True):
                    continue
            u.resolved_symbol = sym
            log.info("symbol resolved user=%s requested=%s → broker=%s",
                     u.email, requested, sym)
            return sym
        # 2. Fallback: scan all symbols for one that begins with XAU.
        all_syms = mt5.symbols_get() or []
        for s in all_syms:
            name = getattr(s, "name", "")
            if name.upper().startswith("XAU") and "USD" in name.upper():
                if mt5.symbol_select(name, True):
                    u.resolved_symbol = name
                    log.info("symbol resolved (scan) user=%s → %s", u.email, name)
                    return name
        log.error("symbol_resolve FAIL user=%s — no XAUUSD-equivalent on this broker. "
                  "Asked for '%s'. Add a gold instrument to MT5 → Market Watch.",
                  u.email, requested)
        u.last_fanout_error = f"no XAUUSD-equivalent symbol on broker"
        return None

    # ---------- Trade ops ----------
    # Human-readable retcode → reason map. Anything not listed falls back to
    # the broker's `comment` field.
    _RETCODE_HINTS = {
        10004: "Requote — broker price moved; retried with fresh tick",
        10006: "Order rejected by broker (generic). Check broker server log.",
        10013: "Invalid request (malformed parameters)",
        10014: "Invalid lot volume — outside broker's min/max/step bounds",
        10015: "Invalid price — refresh tick and retry",
        10016: "Invalid stops — SL/TP too close to price (broker stops_level violation)",
        10017: "Trading is DISABLED on this symbol or terminal. Open the user's MT5 → Tools → Options → Expert Advisors → enable 'Allow algorithmic trading'. Also check the AutoTrading button in the toolbar is GREEN.",
        10018: "Market is CLOSED — gold trades 23:00 Sun → 22:00 Fri UTC",
        10019: "Insufficient money / margin in user's account for this lot size",
        10021: "No prices (off-quotes) — broker temporarily not streaming",
        10027: "AutoTrading is DISABLED on the user's MT5 terminal. Click the AutoTrading button in MT5 toolbar to turn it GREEN.",
        10030: "Filling mode rejected by broker — auto-retried IOC/FOK/RETURN",
        10031: "Connection lost to trade server",
    }

    def _human_mt5_error(self, err) -> str:
        raw = str(err or "")
        text = raw.lower()
        if not raw or raw == "None":
            return "Unknown MT5 connection error"
        if "authorization" in text or "invalid account" in text:
            return f"Invalid MT5 login/password or wrong broker server: {raw}"
        if "invalid params" in text:
            return f"MT5 rejected login parameters. This is usually an MT4/MT5 mismatch or exact server-name problem: {raw}"
        if "timeout" in text or "timed out" in text:
            return f"MT5 broker server timeout. Check server name, broker region, and VPS network latency: {raw}"
        if "terminal" in text or "initialize" in text:
            return f"MT5 terminal not reachable on this VPS. Start MT5 and confirm it can log in manually: {raw}"
        return raw

    def _account_mode_name(self, acct) -> str:
        mode = getattr(acct, "trade_mode", None)
        mapping = {
            0: "demo",
            1: "contest",
            2: "real",
        }
        return mapping.get(int(mode), str(mode)) if mode is not None else ""

    @staticmethod
    def _retcode_msg(retcode: int, comment: str) -> str:
        hint = WorkerAgent._RETCODE_HINTS.get(int(retcode), "")
        c = (comment or "").strip()
        if hint and c: return f"retcode={retcode} {c} — {hint}"
        if hint: return f"retcode={retcode} — {hint}"
        return f"retcode={retcode} {c}".strip()

    def _normalize_lots(self, info, lots: float) -> float:
        step = float(getattr(info, "volume_step", 0.01) or 0.01)
        min_lot = float(getattr(info, "volume_min", 0.01) or 0.01)
        max_lot = float(getattr(info, "volume_max", 100.0) or 100.0)
        if step <= 0: step = 0.01
        if lots < min_lot:
            return 0.0
        # Round DOWN to step so we never exceed the user's risk envelope.
        n = int(lots / step)
        rounded = round(n * step, 8)
        # Decimals derived from step (0.01→2, 0.1→1, 1.0→0)
        decimals = max(0, -int(round(__import__("math").log10(step)))) if step < 1 else 0
        rounded = round(rounded, decimals or 2)
        if rounded < min_lot:
            return 0.0
        return min(max_lot, rounded)

    def _supported_fillings(self, info) -> List[int]:
        """Return ordered list of filling modes the broker says it supports.
        We then try them in order until one is accepted."""
        modes = int(getattr(info, "filling_mode", 0) or 0)
        out: List[int] = []
        # Bitmask: 1=FOK, 2=IOC, 4=RETURN. MetaQuotes-Demo and many MT5 brokers
        # only set the IOC bit but actually accept FOK too — try all 3 anyway.
        if modes & 1: out.append(mt5.ORDER_FILLING_FOK)
        if modes & 2: out.append(mt5.ORDER_FILLING_IOC)
        if modes & 4: out.append(mt5.ORDER_FILLING_RETURN)
        # Always end with all 3 in case the symbol bit-mask is wrong (common!).
        for m in (mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN):
            if m not in out: out.append(m)
        return out

    def _clamp_stops(self, info, side: str, price: float, sl: float, tp: float) -> Tuple[float, float]:
        """Ensure SL/TP respect the broker's minimum stop distance.
        If master sent SL/TP too close (e.g. 8 points but broker requires 30),
        widen them to broker_min + 20% buffer instead of failing the trade."""
        point = float(getattr(info, "point", 0.01) or 0.01)
        digits = int(getattr(info, "digits", 2) or 2)
        # stops_level is in POINTS (not price). Some brokers report 0 — treat as
        # "no min" but still enforce a tiny buffer to avoid 10016.
        stops_pts = int(getattr(info, "trade_stops_level", 0) or 0)
        min_dist = max(stops_pts * point, 0.0)
        # Add 20% safety buffer + minimum 5-point absolute floor.
        buffered = max(min_dist * 1.2, 5 * point)
        if side == "BUY":
            # SL below price, TP above price.
            if sl > 0 and (price - sl) < buffered:
                sl = round(price - buffered, digits)
            if tp > 0 and (tp - price) < buffered:
                tp = round(price + buffered, digits)
        else:  # SELL
            if sl > 0 and (sl - price) < buffered:
                sl = round(price + buffered, digits)
            if tp > 0 and (price - tp) < buffered:
                tp = round(price - buffered, digits)
        return float(sl), float(tp)

    def _build_req(self, symbol: str, side: str, lots: float, price: float,
                   sl: float, tp: float, filling: int, deviation: int,
                   comment: str) -> dict:
        return {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(lots),
            "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL,
            "price": float(price),
            "sl": float(sl),
            "tp": float(tp),
            "deviation": int(deviation),
            "magic": 77007007,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling,
        }

    def mt5_order_open(self, u: UserSession, sig: dict, lots: float) -> Tuple[Optional[int], str]:
        """Hardened executor with full pre-flight + retry across every common
        rejection path. Returns (ticket, error_msg)."""
        side = sig["side"].upper()
        sl, tp = float(sig["sl"]), float(sig["tp"])
        comment = f"XAUAI|{sig['id'][:8]}"
        if not self._ensure_active(u):
            return None, u.last_fanout_error or "mt5 login failed"
        symbol = self._resolve_symbol(u, sig.get("symbol", "XAUUSD"))
        if not symbol:
            return None, "symbol not found on broker — add a XAUUSD-equivalent to MT5 Market Watch"
        if MOCK_MT5:
            fake_ticket = int(time.time() * 1000) % 2_000_000_000
            log.info("[MOCK] order_send user=%s %s %s lots=%.2f sl=%.2f tp=%.2f ticket=%d",
                     u.email, side, symbol, lots, sl, tp, fake_ticket)
            return fake_ticket, ""

        # ---- Pre-flight 1: account allows trading? -------------------------
        acct = mt5.account_info()
        if acct is None:
            return None, "account_info() returned None — terminal lost connection"
        if not bool(getattr(acct, "trade_allowed", True)):
            return None, ("Account has trade_allowed=False — likely an INVESTOR "
                          "(read-only) password. User must use the MASTER password.")
        if not bool(getattr(acct, "trade_expert", True)):
            return None, ("trade_expert=False — Expert Advisors are blocked on this "
                          "account. Tools → Options → Expert Advisors → enable 'Allow algo trading' in the user's MT5.")
        # AutoTrading button on the terminal toolbar (different from per-account flag)
        term = mt5.terminal_info()
        if term is not None and not bool(getattr(term, "trade_allowed", True)):
            return None, ("Terminal AutoTrading is OFF — click the AutoTrading button "
                          "in the MT5 toolbar so it turns GREEN, then retry.")

        # ---- Pre-flight 2: symbol info + select ----------------------------
        info = mt5.symbol_info(symbol)
        if info is None:
            return None, f"symbol_info('{symbol}') returned None"
        if not info.visible:
            mt5.symbol_select(symbol, True)
            info = mt5.symbol_info(symbol) or info

        # ---- Pre-flight 3: fresh tick + price ------------------------------
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or (tick.ask == 0 and tick.bid == 0):
            return None, f"no live tick for {symbol} — market may be closed or symbol not streaming"
        price = tick.ask if side == "BUY" else tick.bid

        # ---- Pre-flight 4: lot size normalize + margin check ---------------
        requested_lots = float(lots)
        lots = self._normalize_lots(info, lots)
        if lots <= 0:
            min_lot = float(getattr(info, "volume_min", 0.01) or 0.01)
            step = float(getattr(info, "volume_step", 0.01) or 0.01)
            return None, (f"requested lot {requested_lots:.4f} below broker minimum "
                          f"{min_lot:.4f} after step {step:.4f}; trade skipped safely")
        if abs(lots - requested_lots) > 1e-9:
            log.info("LOT NORMALIZE user=%s requested=%.4f final=%.4f min=%.4f max=%.2f step=%.4f",
                     u.email, requested_lots, lots,
                     float(getattr(info, "volume_min", 0.01) or 0.01),
                     float(getattr(info, "volume_max", 100.0) or 100.0),
                     float(getattr(info, "volume_step", 0.01) or 0.01))
        # Margin pre-check via order_calc_margin — saves a round-trip if NO_MONEY.
        try:
            order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
            need = mt5.order_calc_margin(order_type, symbol, lots, price)
            free = float(getattr(acct, "margin_free", 0.0) or 0.0)
            if need is not None and free > 0 and need > free * 0.95:
                # Auto-shrink lot to fit ~90% of free margin instead of failing.
                shrunk = self._normalize_lots(info, lots * (free * 0.90 / max(need, 1e-9)))
                if shrunk <= 0:
                    return None, (f"insufficient free margin: need ${need:.2f}, "
                                  f"free ${free:.2f}. Reduce open positions or top up.")
                log.warning("user=%s margin shrink %.2f → %.2f (need=$%.0f free=$%.0f)",
                            u.email, lots, shrunk, need, free)
                lots = shrunk
        except Exception as e:
            log.debug("margin pre-check skipped user=%s: %s", u.email, e)

        # ---- Pre-flight 5: SL/TP clamp to stops_level + buffer -------------
        sl_clamped, tp_clamped = self._clamp_stops(info, side, price, sl, tp)
        if (sl_clamped, tp_clamped) != (sl, tp):
            log.warning("user=%s SL/TP clamped: %.2f/%.2f → %.2f/%.2f (broker stops_level=%s)",
                        u.email, sl, tp, sl_clamped, tp_clamped,
                        getattr(info, "trade_stops_level", "?"))
        sl, tp = sl_clamped, tp_clamped

        # ---- Try filling modes with retry on common transient errors -----
        fillings = self._supported_fillings(info)
        deviation = 50
        last_err = ""
        attempts: List[str] = []
        for attempt, filling in enumerate(fillings):
            req = self._build_req(symbol, side, lots, price, sl, tp, filling, deviation, comment)

            # Use order_check first — cheap pre-validation that returns the same
            # retcode order_send would, without actually sending. Lets us cycle
            # filling modes / fix lots without spamming the broker.
            chk = mt5.order_check(req)
            if chk is None:
                last_err = f"order_check returned None err={mt5.last_error()}"
                attempts.append(f"fill={filling} {last_err}")
                continue
            if chk.retcode not in (0, mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED):
                # Try to auto-fix the most common pre-check rejects.
                if chk.retcode == 10030:  # invalid filling
                    last_err = f"order_check fill rejected (retcode=10030)"
                    attempts.append(f"fill={filling} 10030")
                    continue
                if chk.retcode == 10014:  # invalid volume
                    lots = self._normalize_lots(info, lots)
                    last_err = "volume re-normalized"
                    # fall through to send anyway
                elif chk.retcode == 10016:  # invalid stops — widen further
                    sl, tp = self._clamp_stops(info, side, price, sl * 0 if False else sl, tp)
                    # Force a 2× buffer this time
                    point = float(getattr(info, "point", 0.01) or 0.01)
                    extra = 30 * point
                    if side == "BUY":
                        sl = round(min(sl, price - max((price - sl), extra) * 1.5), info.digits or 2)
                        tp = round(max(tp, price + max((tp - price), extra) * 1.5), info.digits or 2) if tp > 0 else tp
                    else:
                        sl = round(max(sl, price + max((sl - price), extra) * 1.5), info.digits or 2)
                        tp = round(min(tp, price - max((price - tp), extra) * 1.5), info.digits or 2) if tp > 0 else tp
                    log.warning("user=%s order_check 10016 — widening SL/TP and retrying", u.email)
                    req = self._build_req(symbol, side, lots, price, sl, tp, filling, deviation, comment)
                elif chk.retcode in (10004, 10015, 10021):  # requote / off / invalid price
                    tick = mt5.symbol_info_tick(symbol) or tick
                    price = tick.ask if side == "BUY" else tick.bid
                    deviation = min(deviation * 2, 500)
                    req = self._build_req(symbol, side, lots, price, sl, tp, filling, deviation, comment)
                else:
                    # Permanent / informative error — don't bother sending.
                    last_err = self._retcode_msg(chk.retcode, getattr(chk, "comment", ""))
                    attempts.append(f"fill={filling} CHK_{chk.retcode}")
                    if chk.retcode in (10017, 10018, 10019, 10027):
                        # Don't keep trying — these are user-side issues.
                        return None, last_err + " | tried: " + ", ".join(attempts)
                    continue

            log.info("order_send user=%s %s %s lots=%.2f price=%.2f sl=%.2f tp=%.2f fill=%s dev=%d (attempt %d/%d)",
                     u.email, side, symbol, lots, price, sl, tp, filling, deviation,
                     attempt + 1, len(fillings))
            res = mt5.order_send(req)
            if res is None:
                last_err = f"order_send returned None err={mt5.last_error()}"
                attempts.append(f"fill={filling} None")
                continue
            if res.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, 10010):
                log.info("order FILLED user=%s ticket=%d fill=%s", u.email, int(res.order), filling)
                return int(res.order), ""

            last_err = self._retcode_msg(res.retcode, res.comment)
            attempts.append(f"fill={filling} ret={res.retcode}")
            log.warning("order_send rejected user=%s %s — retrying with next mode", u.email, last_err)

            # Refresh price for the next attempt (handles requote/price-off).
            if res.retcode in (10004, 10015, 10021, 10006):
                tick = mt5.symbol_info_tick(symbol) or tick
                price = tick.ask if side == "BUY" else tick.bid
                deviation = min(deviation * 2, 500)

            # User-side hard errors → stop trying.
            if res.retcode in (10017, 10018, 10019, 10027):
                return None, last_err + " | tried: " + ", ".join(attempts)

        return None, (last_err or "all filling modes rejected") + " | tried: " + ", ".join(attempts)

    def mt5_order_close(self, u: UserSession, ticket: int) -> Tuple[float, float, str]:
        """Closes position by ticket. Returns (exit_price, profit, error)."""
        if not self._ensure_active(u):
            return 0.0, 0.0, u.last_fanout_error or "login fail"
        if MOCK_MT5:
            log.info("[MOCK] close_position user=%s ticket=%d", u.email, ticket)
            return 0.0, 0.0, ""
        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            return 0.0, 0.0, "position not found"
        p = positions[0]
        info = mt5.symbol_info(p.symbol)
        if info is None:
            return 0.0, float(p.profit), "symbol_info None on close"
        if not info.visible:
            mt5.symbol_select(p.symbol, True)
        tick = mt5.symbol_info_tick(p.symbol)
        if not tick:
            return 0.0, float(p.profit), "no tick on close"
        position_id = int(getattr(p, "identifier", 0) or getattr(p, "ticket", ticket) or ticket)
        fallback_profit = float(getattr(p, "profit", 0.0) or 0.0)
        # Try every supported filling mode for the close too.
        for filling in self._supported_fillings(info):
            tick = mt5.symbol_info_tick(p.symbol) or tick
            close_price = tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask
            req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": ticket,
                "symbol": p.symbol,
                "volume": float(p.volume),
                "type": mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY,
                "price": float(close_price),
                "deviation": 100, "magic": 77007007,
                "comment": "XAUAI|close",
                "type_filling": filling,
            }
            res = mt5.order_send(req)
            if res is not None and res.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, 10010):
                realized = self._history_profit_for_position(position_id, fallback_profit)
                return float(close_price), float(realized), ""
            if res is not None and res.retcode == 10030:
                continue  # try next filling mode
            err = self._retcode_msg(getattr(res, "retcode", 0), getattr(res, "comment", "") if res else "")
            log.error("close FAIL user=%s ticket=%d %s", u.email, ticket, err)
            return float(close_price), fallback_profit, err
        return 0.0, fallback_profit, "close: all filling modes rejected"

    def mt5_order_close_partial(self, u: UserSession, ticket: int, close_percent: float) -> Tuple[float, float, float, float, str]:
        """Partially closes a position. Returns (exit_price, est_profit, closed_lots, remaining_lots, error)."""
        if not self._ensure_active(u):
            return 0.0, 0.0, 0.0, 0.0, u.last_fanout_error or "login fail"
        if MOCK_MT5:
            log.info("[MOCK] partial_close user=%s ticket=%d pct=%.1f", u.email, ticket, close_percent)
            return 0.0, 0.0, 0.0, 0.0, ""
        positions = mt5.positions_get(ticket=int(ticket))
        if not positions:
            return 0.0, 0.0, 0.0, 0.0, "position not found"
        p = positions[0]
        info = mt5.symbol_info(p.symbol)
        if info is None:
            return 0.0, float(p.profit), 0.0, float(p.volume), "symbol_info None on partial close"
        if not info.visible:
            mt5.symbol_select(p.symbol, True)
        tick = mt5.symbol_info_tick(p.symbol)
        if not tick:
            return 0.0, float(p.profit), 0.0, float(p.volume), "no tick on partial close"

        vol = float(p.volume)
        step = float(getattr(info, "volume_step", 0.01) or 0.01)
        min_lot = float(getattr(info, "volume_min", 0.01) or 0.01)
        pct = max(1.0, min(float(close_percent or 0.0), 99.0))
        raw_close = vol * pct / 100.0
        close_vol = int(raw_close / step) * step
        close_vol = round(close_vol, 4)
        remaining = round(vol - close_vol, 4)
        if close_vol < min_lot:
            return 0.0, float(p.profit), 0.0, vol, f"partial close below broker min lot ({close_vol:.4f} < {min_lot:.4f})"
        if remaining > 0 and remaining < min_lot:
            return 0.0, float(p.profit), 0.0, vol, f"partial would leave below broker min lot ({remaining:.4f} < {min_lot:.4f})"

        position_id = int(getattr(p, "identifier", 0) or getattr(p, "ticket", ticket) or ticket)
        est_profit = float(p.profit) * (close_vol / vol) if vol > 0 else 0.0
        last_err = ""
        for filling in self._supported_fillings(info):
            tick = mt5.symbol_info_tick(p.symbol) or tick
            close_price = tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask
            req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": int(ticket),
                "symbol": p.symbol,
                "volume": float(close_vol),
                "type": mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY,
                "price": float(close_price),
                "deviation": 100,
                "magic": 77007007,
                "comment": "XAUAI|partial",
                "type_filling": filling,
            }
            res = mt5.order_send(req)
            if res is not None and res.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, 10010):
                realized = self._history_profit_for_position(position_id, est_profit)
                log.info("partial close OK user=%s ticket=%d closed=%.2f remain=%.2f",
                         u.email, int(ticket), close_vol, remaining)
                return float(close_price), float(realized), float(close_vol), float(remaining), ""
            if res is not None and res.retcode == 10030:
                continue
            last_err = self._retcode_msg(getattr(res, "retcode", 0), getattr(res, "comment", "") if res else "")
            log.error("partial close FAIL user=%s ticket=%d %s", u.email, ticket, last_err)
            return float(close_price), est_profit, 0.0, vol, last_err
        return 0.0, est_profit, 0.0, vol, last_err or "partial close: all filling modes rejected"

    def _position_snapshot(self, ticket: int) -> dict:
        """Capture position fields before close so dashboard rows keep real lots/side/entry."""
        if MOCK_MT5:
            return {}
        try:
            positions = mt5.positions_get(ticket=int(ticket))
            if not positions:
                return {}
            p = positions[0]
            side = "BUY" if int(getattr(p, "type", 0)) == mt5.ORDER_TYPE_BUY else "SELL"
            return {
                "symbol": str(getattr(p, "symbol", "") or "XAUUSD"),
                "side": side,
                "lots": float(getattr(p, "volume", 0.0) or 0.0),
                "entry": float(getattr(p, "price_open", 0.0) or 0.0),
                "opened_at": datetime.fromtimestamp(int(getattr(p, "time", 0) or 0), timezone.utc).isoformat()
                             if int(getattr(p, "time", 0) or 0) > 0 else "",
            }
        except Exception:
            return {}

    def mt5_equity(self, u: UserSession) -> Optional[dict]:
        if not self._ensure_active(u):
            return None
        if MOCK_MT5:
            return {"balance": u.last_balance, "equity": u.last_balance,
                    "margin": 0.0, "free_margin": u.last_balance,
                    "cloud_positions_count": 0}
        acct = mt5.account_info()
        if not acct: return None
        # v1.4.3 — also report how many positions we have open with our magic
        # (77007007). The backend compares this against the count of currently
        # open master signals to surface orphan-trade alerts in the admin UI.
        try:
            positions = mt5.positions_get() or ()
            cloud_pos = sum(1 for p in positions
                            if int(getattr(p, "magic", 0) or 0) == 77007007)
        except Exception:
            cloud_pos = 0
        return {"balance": float(acct.balance), "equity": float(acct.equity),
                "margin": float(acct.margin), "free_margin": float(acct.margin_free),
                "cloud_positions_count": int(cloud_pos)}

    # ---------- Core loops ----------
    def verify_queue(self) -> None:
        """Try logging into pending users' MT5 accounts and report verified/rejected."""
        try:
            data = self._get("/api/cloud/agent/verify-queue")
        except Exception as e:
            log.error("verify_queue fetch failed: %s", e); return
        for row in data.get("users", []):
            uid = row.get("id")
            email = row.get("email", "")
            login = int(row.get("mt5_login") or 0)
            server = row.get("mt5_server") or row.get("broker_server") or ""
            pwd = row.get("mt5_password") or ""
            if not uid or login <= 0 or not server or not pwd: continue
            log.info("verify attempt user=%s login=%s server=%s", email, login, server)
            ok, err, bal, eq, ccy, health = self._mt5_try_login(login, server, pwd)
            try:
                payload = {
                    "user_id": uid, "ok": ok, "error": err,
                    "balance": bal, "equity": eq, "currency": ccy,
                    "health": health,
                    "broker_name": health.get("broker_name", ""),
                    "server": health.get("server", server),
                    "account_type": health.get("account_type", ""),
                    "trade_allowed": health.get("trade_allowed"),
                    "terminal_trade_allowed": health.get("terminal_trade_allowed"),
                    "symbol": health.get("resolved_symbol", ""),
                    "symbol_mapping": health.get("symbol_mapping", ""),
                    "latency_ms": health.get("latency_ms", 0),
                }
                self._post("/api/cloud/agent/verify-credentials", payload)
                log.info("verify result user=%s ok=%s latency=%sms symbol=%s err=%s",
                         email, ok, health.get("latency_ms", 0),
                         health.get("resolved_symbol", ""), err)
            except Exception as e:
                log.error("verify-credentials POST failed user=%s: %s", email, e)

    def _mt5_try_login(self, login: int, server: str, password: str):
        """Returns (ok, error, balance, equity, currency, health)."""
        started = time.time()
        health = {
            "server": server,
            "platform": "MT5",
            "login": int(login),
            "latency_ms": 0,
            "resolved_symbol": "",
            "symbol_mapping": "",
            "trade_allowed": False,
            "terminal_trade_allowed": False,
            "checks": [],
        }
        if MOCK_MT5:
            health.update({
                "broker_name": "MOCK",
                "account_type": "demo",
                "trade_allowed": True,
                "terminal_trade_allowed": True,
                "resolved_symbol": "XAUUSD",
                "symbol_mapping": "XAUUSD→XAUUSD",
                "latency_ms": int((time.time() - started) * 1000),
                "checks": ["mock login", "mock symbol", "mock trading permission"],
            })
            if password.lower() == "wrong":
                return False, "Invalid credentials (mock)", None, None, "", health
            return True, "", 1000.0, 1000.0, "USD", health
        # Ensure terminal up exactly once (same pattern as _ensure_active).
        if not getattr(self, "_mt5_inited", False):
            if not mt5.initialize():
                health["latency_ms"] = int((time.time() - started) * 1000)
                return False, self._human_mt5_error(f"mt5.initialize: {mt5.last_error()}"), None, None, "", health
            self._mt5_inited = True
        health["checks"].append("terminal initialized")
        # Use mt5.login() for swaps (avoids -2 'Invalid params' on re-init).
        ok = False
        try:
            ok = mt5.login(login=int(login), password=str(password or ""),
                           server=str(server or ""))
        except Exception:
            ok = False
        if not ok:
            err = mt5.last_error()
            ok2 = False
            try:
                ok2 = mt5.initialize(login=int(login), server=server, password=password)
            except Exception as e:
                err = (-2, f"initialize-fallback raised: {e}")
            if not ok2:
                health["latency_ms"] = int((time.time() - started) * 1000)
                return False, self._human_mt5_error(err), None, None, "", health
        health["checks"].append("login accepted")
        # Verification swap invalidates the active session — clear cache so the
        # next operation re-authenticates as the intended user.
        self._active_user_id = ""
        acct = mt5.account_info()
        if not acct:
            health["latency_ms"] = int((time.time() - started) * 1000)
            return False, "account_info() returned None after login", None, None, "", health
        bal, eq, ccy = float(acct.balance), float(acct.equity), str(acct.currency or "")
        health.update({
            "broker_name": str(getattr(acct, "company", "") or ""),
            "account_type": self._account_mode_name(acct),
            "trade_allowed": bool(getattr(acct, "trade_allowed", True)),
            "balance": bal,
            "equity": eq,
            "currency": ccy,
        })
        term = mt5.terminal_info()
        if term:
            health["terminal_trade_allowed"] = bool(getattr(term, "trade_allowed", True))
        if not health["trade_allowed"]:
            health["latency_ms"] = int((time.time() - started) * 1000)
            return False, "Account connected but trading permission is disabled. Use the trading password, not investor password.", bal, eq, ccy, health
        if term and not health["terminal_trade_allowed"]:
            health["latency_ms"] = int((time.time() - started) * 1000)
            return False, "Terminal AutoTrading is disabled on the worker MT5.", bal, eq, ccy, health
        health["checks"].append("trading permission ok")
        tmp = UserSession(user_id="verify", email="verify", mt5_login=login,
                          mt5_server=server, mt5_password=password)
        sym = self._resolve_symbol(tmp, "XAUUSD")
        if not sym:
            health["latency_ms"] = int((time.time() - started) * 1000)
            return False, tmp.last_fanout_error or "No XAUUSD-equivalent symbol on broker", bal, eq, ccy, health
        health["resolved_symbol"] = sym
        health["symbol_mapping"] = f"XAUUSD→{sym}"
        info = mt5.symbol_info(sym)
        tick = mt5.symbol_info_tick(sym)
        if info:
            health.update({
                "lot_min": float(getattr(info, "volume_min", 0.0) or 0.0),
                "lot_max": float(getattr(info, "volume_max", 0.0) or 0.0),
                "lot_step": float(getattr(info, "volume_step", 0.0) or 0.0),
                "stops_level": int(getattr(info, "trade_stops_level", 0) or 0),
                "filling_mode": int(getattr(info, "filling_mode", 0) or 0),
                "contract_size": float(getattr(info, "trade_contract_size", 0.0) or 0.0),
            })
        if not tick:
            health["latency_ms"] = int((time.time() - started) * 1000)
            return False, f"{sym} exists but broker is not streaming live ticks. Market may be closed or symbol hidden.", bal, eq, ccy, health
        health["checks"].append("gold symbol selected")
        health["latency_ms"] = int((time.time() - started) * 1000)
        return True, "", bal, eq, ccy, health

    def sync_users(self) -> None:
        try:
            data = self._get("/api/cloud/agent/pending-users")
        except Exception as e:
            log.error("sync_users failed: %s", e); return
        rows = [r for r in data.get("users", []) if r.get("id") and r.get("mt5_password")]
        selected_rows = self._select_worker_rows(rows)
        selected_ids = {r.get("id") for r in selected_rows}
        skipped = [r for r in rows if r.get("id") not in selected_ids]
        if skipped:
            reason = (
                f"Worker {WORKER_ID} is dedicated to {WORKER_MAX_USERS} MT5 account(s). "
                "Start a separate worker/MT5 terminal for this linked account; no login swap was attempted."
            )
            log.warning("DEDICATED WORKER GUARD: loaded=%d skipped=%d max=%d selected=%s",
                        len(selected_rows), len(skipped), WORKER_MAX_USERS,
                        ",".join(str(r.get("mt5_login") or "") for r in selected_rows))
            for row in skipped:
                self._report_capacity_skip(row, reason)
        wanted: Dict[str, UserSession] = {}
        for row in selected_rows:
            uid = row.get("id")
            existing = self.users.get(uid)
            s = existing or UserSession(
                user_id=uid,
                email=row.get("email", ""),
                mt5_login=int(row.get("mt5_login") or 0),
                mt5_server=(row.get("mt5_server") or row.get("broker_server") or ""),
                mt5_password=row.get("mt5_password") or "",
            )
            s.risk_tier = row.get("risk_tier") or "balanced"
            s.last_balance = float(row.get("last_balance") or s.last_balance)
            s.last_equity = float(row.get("last_equity") or s.last_equity or s.last_balance)
            new_login = int(row.get("mt5_login") or s.mt5_login)
            # Backend stores the broker server under `broker_server`; older test
            # data used `mt5_server`. Accept either.
            new_server = (row.get("mt5_server") or row.get("broker_server") or s.mt5_server)
            new_pwd = row.get("mt5_password") or s.mt5_password
            # If creds changed, force re-login + re-resolve symbol.
            if (new_login != s.mt5_login or new_server != s.mt5_server
                or new_pwd != s.mt5_password):
                s.logged_in = False
                s.resolved_symbol = ""
                s.status = "CONNECTING"
                s.retry_count = 0
                s.next_retry_at = 0.0
                s.last_fanout_error = ""
            s.mt5_login = new_login
            s.mt5_server = new_server
            s.mt5_password = new_pwd
            # v1.4 — restore persisted open_tickets so close-mirror survives
            # worker restarts. Apply once per user (only if their dict is empty).
            pending = getattr(self, "_pending_state", {}).get(uid)
            if pending and not s.open_tickets:
                s.open_tickets.update({k: int(v) for k, v in pending.items()})
                log.info("restored %d open_tickets for user %s from disk",
                         len(s.open_tickets), s.email)
            if not s.logged_in and self._retry_due(s):
                self.mt5_login(s)
            wanted[uid] = s
        for gone in set(self.users) - set(wanted):
            log.info("dropping user %s (no longer active)", self.users[gone].email)
            self.users.pop(gone, None)
        self.users = wanted
        if self.users:
            counts: Dict[str, int] = {}
            for u in self.users.values():
                counts[u.status] = counts.get(u.status, 0) + 1
            log.info("users synced: %d loaded status=%s [%s]",
                     len(self.users),
                     ",".join(f"{k}:{v}" for k, v in sorted(counts.items())),
                     ", ".join(f"{u.email}({u.mt5_login})" for u in self.users.values()))
        else:
            log.info("users synced: 0 active")

    def _select_worker_rows(self, rows: List[dict]) -> List[dict]:
        if not rows:
            return []
        if WORKER_USER_ID:
            picked = [r for r in rows if str(r.get("id") or "") == WORKER_USER_ID]
            if not picked:
                log.warning("WORKER_USER_ID=%s is set but no pending user matched it.", WORKER_USER_ID)
            return picked[:WORKER_MAX_USERS]
        if WORKER_MT5_LOGIN:
            picked = [r for r in rows if str(r.get("mt5_login") or "") == WORKER_MT5_LOGIN]
            if not picked:
                log.warning("WORKER_MT5_LOGIN=%s is set but no pending user matched it.", WORKER_MT5_LOGIN)
            return picked[:WORKER_MAX_USERS]

        selected: List[dict] = []
        seen: Set[str] = set()

        # Keep the account this worker already owns before considering new rows.
        for uid in list(self.users.keys()):
            for row in rows:
                rid = str(row.get("id") or "")
                if rid == uid and rid not in seen:
                    selected.append(row)
                    seen.add(rid)
                    break
            if len(selected) >= WORKER_MAX_USERS:
                return selected

        for row in rows:
            rid = str(row.get("id") or "")
            if rid in seen:
                continue
            selected.append(row)
            seen.add(rid)
            if len(selected) >= WORKER_MAX_USERS:
                break
        return selected

    def compute_lots(self, u: UserSession, sig: dict) -> Tuple[float, str]:
        """v1.5.3 STRICT MIRROR + BROKER/MARGIN SAFETY:
          1. lot = (userBalance / masterBalance) × masterLots  (strict 1:1)
          2. Use the user's latest equity when available so floating P/L is
             reflected in proportional scaling.
          3. Optional WORKER_MAX_RISK_PCT can cap lot size, but default is off.
          4. ABORT only if (a) account below MIN_BALANCE_USD floor OR
                          (b) proportional lot < 0.01 broker minimum.
        Returns (lots, source_label_for_logging). lots == 0.0 means SKIP."""
        # --- Tiny-account hard-floor: cheaper than fixing a blown account ---
        scale_base = float(u.last_equity or u.last_balance or 0.0)
        if scale_base <= 0:
            scale_base = float(u.last_balance or 0.0)
        if scale_base > 0 and scale_base < MIN_BALANCE_USD:
            return 0.0, (f"SKIP tiny-account: equity/balance ${scale_base:.2f} < "
                         f"min ${MIN_BALANCE_USD:.2f} (cloud copying not safe)")

        try:
            entry = float(sig.get("entry") or 0.0)
            sl = float(sig.get("sl") or 0.0)
        except (TypeError, ValueError):
            return 0.0, "SKIP malformed-signal: entry/sl not numeric"

        sl_dist = abs(entry - sl)
        if sl_dist <= 0:
            return 0.0, "SKIP malformed-signal: missing or zero SL distance"

        master_lots = float(sig.get("master_lots") or 0.0)
        master_bal  = float(sig.get("master_balance") or 0.0)
        if master_lots > 0 and master_bal > 0:
            ratio = scale_base / master_bal
            ideal_lot = master_lots * ratio
            lots = round(ideal_lot, 2)
            rounded_lot = lots
            est_loss_usd = lots * sl_dist * XAU_USD_PER_LOT_PER_PRICE
            risk_pct = (est_loss_usd / scale_base * 100.0) if scale_base > 0 else 999
            scaled_note = ""
            # Optional operator cap. Disabled by default because copier lots
            # must mirror proportionally unless the broker/margin layer rejects.
            if MAX_RISK_PCT_PER_TRADE > 0 and risk_pct > MAX_RISK_PCT_PER_TRADE and sl_dist > 0:
                cap_usd = scale_base * MAX_RISK_PCT_PER_TRADE / 100.0
                fitted_lot = round(cap_usd / (sl_dist * XAU_USD_PER_LOT_PER_PRICE), 2)
                scaled_note = (f" | OPTIONAL-RISK-CAP: mirror was {lots:.2f} lots "
                               f"({risk_pct:.1f}%) → reduced to {fitted_lot:.2f} "
                               f"because WORKER_MAX_RISK_PCT={MAX_RISK_PCT_PER_TRADE:.1f}%")
                lots = fitted_lot
                est_loss_usd = lots * sl_dist * XAU_USD_PER_LOT_PER_PRICE
                risk_pct = (est_loss_usd / scale_base * 100.0) if scale_base > 0 else 999
            # Round-DOWN to broker step happens in mt5_order_open via _normalize_lots;
            # here we just need a viability check. If even the scaled lot is below
            # 0.01 (broker minimum) the account is too small to take this signal at all.
            if lots < 0.01:
                return 0.0, (f"SKIP under-min: lot {lots:.4f} < 0.01 broker min "
                             f"(scaleBase=${scale_base:.0f} master=${master_bal:.0f} "
                             f"× master_lots={master_lots:.2f}).{scaled_note}")
            final_lots = min(lots, 100.0)
            cap_note = " | capped by worker hard max 100.00" if lots > 100.0 else ""
            return final_lots, (f"strict_mirror masterLots={master_lots:.2f} masterBal=${master_bal:.0f} "
                                f"userBal=${u.last_balance:.0f} userEq=${u.last_equity:.0f} "
                                f"scaleBase=${scale_base:.0f} ratio={ratio:.4f} "
                                f"ideal={ideal_lot:.4f} rounded={rounded_lot:.2f} final={final_lots:.2f} "
                                f"estSLRisk=${est_loss_usd:.2f} ({risk_pct:.1f}% of scaleBase) "
                                f"riskCap={'disabled' if MAX_RISK_PCT_PER_TRADE <= 0 else f'{MAX_RISK_PCT_PER_TRADE:.1f}%'}"
                                f"{scaled_note}{cap_note}")

        # Legacy fallback (ONLY runs if master EA hasn't been upgraded yet).
        risk_pct_cfg = RISK_PCT.get(u.risk_tier, 1.2)
        risk_usd = scale_base * risk_pct_cfg / 100.0
        lots = round(risk_usd / (sl_dist * XAU_USD_PER_LOT_PER_PRICE), 2)
        if lots < 0.01:
            return 0.0, (f"SKIP legacy-under-min: calculated {lots:.4f} < 0.01 "
                         f"from risk={risk_pct_cfg}% scaleBase=${scale_base:.0f}")
        return min(lots, 100.0), f"legacy_fallback risk={risk_pct_cfg}% final={min(lots, 100.0):.2f} (master EA outdated — no master_lots in signal)"

    def poll_signals(self) -> None:
        try:
            data = self._get("/api/cloud/agent/pending-signals",
                             params={"since": self.last_signal_poll, "limit": 50})
        except Exception as e:
            log.error("poll_signals failed: %s", e); return
        opens = data.get("opens", [])
        partials = data.get("partials", [])
        closes = data.get("closes", [])
        if opens or partials or closes:
            log.info("polled signals: opens=%d partials=%d closes=%d users=%d",
                     len(opens), len(partials), len(closes), len(self.users))
        # Process opens (oldest first so chronological)
        for sig in reversed(opens):
            self._handle_open(sig)
        for p in reversed(partials):
            self._handle_partial(p)
        for c in reversed(closes):
            self._handle_close(c)
        # advance cursor — only if we got server_time back
        st = data.get("server_time")
        if st:
            self.last_signal_poll = st

    def _handle_open(self, sig: dict) -> None:
        sig_id = sig.get("id")
        if not sig_id: return
        log.info("OPEN signal %s %s @%.2f sl=%.2f tp=%.2f users=%d", sig_id[:8],
                 sig.get("side"), float(sig.get("entry", 0)),
                 float(sig.get("sl", 0)), float(sig.get("tp", 0)),
                 len(self.users))
        if not self.users:
            log.warning("OPEN signal %s arrived but worker has 0 active users — "
                        "verify users have mt5_connected=True + verification_status=verified.",
                        sig_id[:8])
            # Push a sentinel fanout-log so admin can see this on the dashboard
            # without having to SSH-into the VPS to read worker logs.
            self._post_safe("/api/cloud/agent/trade-open", {
                "user_id": "(no-active-users)",
                "signal_id": sig_id,
                "ticket": 0,
                "symbol": sig.get("symbol", "XAUUSD"),
                "side": sig.get("side", ""),
                "lots": 0.0,
                "entry": float(sig.get("entry", 0)),
                "sl": float(sig.get("sl", 0)),
                "tp": float(sig.get("tp", 0)),
                "ok": False,
                "error": ("Worker has 0 active users at signal time. "
                          "Subscribers must have mt5_connected=True AND "
                          "mt5_verification_status='verified' AND paused=False AND "
                          "status in [trial, active]."),
                "opened_at": datetime.now(timezone.utc).isoformat(),
            })
            return
        for u in self.users.values():
            if sig_id in u.open_tickets: continue  # already executed for this user
            if not self._can_attempt_account(u, "OPEN"):
                continue
            # DUPLICATE GUARD #1: ask MT5 itself. First check the exact signal
            # comment, then check for a near-identical recent XAUAI position.
            # The second guard catches master/backend retry cases where the
            # repeated open received a new UUID but is clearly the same trade.
            if not MOCK_MT5:
                if not self._ensure_active(u):
                    log.warning("OPEN: skipping user=%s — login swap failed", u.email)
                    continue
                existing = self._scan_positions_by_sig(sig_id)
                if existing:
                    log.warning("DUP-GUARD user=%s sig=%s — already have position(s) %s on MT5; skipping order_send",
                                u.email, sig_id[:8], existing)
                    # Make sure our memory map records the existing ticket so
                    # close-mirror works for it.
                    u.open_tickets[sig_id] = int(existing[0])
                    self._save_state()
                    continue
                similar = self._scan_recent_similar_open(sig)
                if similar:
                    log.warning("DUP-GUARD user=%s sig=%s — similar recent cloud position ticket=%s; skipping duplicate order_send",
                                u.email, sig_id[:8], similar)
                    continue
            u.fanout_attempts += 1
            lots, lot_src = self.compute_lots(u, sig)
            log.info("LOT CALC user=%s → %.2f (%s)", u.email, lots, lot_src)
            # v1.4.2 — tiny-account safety: lot==0 means compute_lots said NOPE
            # (account too small / would risk too much). Log + report to backend
            # so user sees WHY their account didn't mirror. No order_send.
            if lots <= 0:
                self._post_safe("/api/cloud/agent/trade-open", {
                    "user_id": u.user_id,
                    "signal_id": sig_id,
                    "ticket": 0,
                    "symbol": u.resolved_symbol or sig.get("symbol", "XAUUSD"),
                    "side": sig.get("side", ""),
                    "lots": 0.0,
                    "entry": float(sig.get("entry", 0)),
                    "sl": float(sig.get("sl", 0)),
                    "tp": float(sig.get("tp", 0)),
                    "ok": False,
                    "error": lot_src,
                    "opened_at": datetime.now(timezone.utc).isoformat(),
                })
                u.last_fanout_error = lot_src
                continue
            tkt, err = self.mt5_order_open(u, sig, lots)
            # Always report attempt to backend so admin/user can see fills + errors
            self._post_safe("/api/cloud/agent/trade-open", {
                "user_id": u.user_id,
                "signal_id": sig_id,
                "ticket": int(tkt or 0),
                "symbol": u.resolved_symbol or sig.get("symbol", "XAUUSD"),
                "side": sig.get("side", ""),
                "lots": float(lots),
                "entry": float(sig.get("entry", 0)),
                "sl": float(sig.get("sl", 0)),
                "tp": float(sig.get("tp", 0)),
                "ok": bool(tkt),
                "error": err,
                "opened_at": datetime.now(timezone.utc).isoformat(),
            })
            if tkt:
                u.open_tickets[sig_id] = tkt
                u.fanout_successes += 1
                u.last_fanout_error = ""
                self._save_state()       # v1.4 — persist after each new ticket
            else:
                u.last_fanout_error = err

    def _handle_partial(self, p: dict) -> None:
        sig_id = p.get("signal_id")
        if not sig_id:
            return
        pct = float(p.get("close_percent") or 0.0)
        if pct <= 0:
            return
        log.info("PARTIAL signal %s close=%.1f%% exit=%s", sig_id[:8], pct, p.get("exit_price"))
        any_action = False
        for u in self.users.values():
            if not self._can_attempt_account(u, "PARTIAL"):
                continue
            if not self._ensure_active(u):
                log.warning("PARTIAL: skipping user=%s — login swap failed", u.email)
                continue
            tickets: List[int] = []
            mem_tkt = u.open_tickets.get(sig_id)
            if mem_tkt:
                tickets.append(int(mem_tkt))
            for t in self._scan_positions_by_sig(sig_id):
                if t not in tickets:
                    tickets.append(t)
            if not tickets:
                continue
            for tkt in tickets:
                snap = self._position_snapshot(tkt)
                exit_px, profit, closed_lots, remaining_lots, err = self.mt5_order_close_partial(u, tkt, pct)
                ok = not err and closed_lots > 0
                self._post_safe("/api/cloud/agent/trade-partial", {
                    "user_id": u.user_id,
                    "signal_id": sig_id,
                    "ticket": int(tkt),
                    "symbol": snap.get("symbol") or u.resolved_symbol or "XAUUSD",
                    "side": snap.get("side") or "",
                    "closed_lots": float(closed_lots),
                    "remaining_lots": float(remaining_lots or snap.get("lots") or 0.0),
                    "close_percent": float(pct),
                    "entry": float(snap.get("entry") or 0.0),
                    "exit_price": float(exit_px or p.get("exit_price", 0)),
                    "profit": float(profit),
                    "ok": bool(ok),
                    "error": err,
                    "closed_at": datetime.now(timezone.utc).isoformat(),
                    "reason": p.get("reason") or "master partial close",
                })
                any_action = True
        if not any_action:
            log.warning("PARTIAL signal %s — no matching cloud ticket found", sig_id[:8])

    def _scan_positions_by_sig(self, sig_id: str) -> List[int]:
        """v1.4 — MT5-side reconciliation. Returns ticket numbers of the
        currently active terminal user that match comment 'XAUAI|<sigid[:8]>'.
        Source-of-truth fallback when in-memory map is missing/stale."""
        if MOCK_MT5: return []
        prefix = f"XAUAI|{sig_id[:8]}"
        try:
            positions = mt5.positions_get()
        except Exception:
            return []
        if not positions: return []
        tickets: List[int] = []
        for p in positions:
            if int(getattr(p, "magic", 0) or 0) != 77007007: continue
            cmt = str(getattr(p, "comment", "") or "")
            if cmt.startswith(prefix):
                tickets.append(int(p.ticket))
        return tickets

    def _scan_recent_similar_open(self, sig: dict) -> Optional[int]:
        """Suppress same-trade duplicate opens even when backend retry made a
        new signal id. Allows real pyramids because price/time must be close."""
        if MOCK_MT5:
            return None
        try:
            side = str(sig.get("side") or "").upper()
            entry = float(sig.get("entry") or 0.0)
            sl = float(sig.get("sl") or 0.0)
            sl_dist = abs(entry - sl)
            max_gap = min(max(sl_dist * 0.15, 2.0), 6.0)
            sig_ts_raw = str(sig.get("ts") or "")
            sig_ts = datetime.fromisoformat(sig_ts_raw.replace("Z", "+00:00")) if sig_ts_raw else datetime.now(timezone.utc)
            positions = mt5.positions_get() or ()
        except Exception:
            return None
        want_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
        for p in positions:
            try:
                if int(getattr(p, "magic", 0) or 0) != 77007007:
                    continue
                if int(getattr(p, "type", -1)) != want_type:
                    continue
                cmt = str(getattr(p, "comment", "") or "")
                if not cmt.startswith("XAUAI|"):
                    continue
                opened_ts = int(getattr(p, "time", 0) or 0)
                opened = datetime.fromtimestamp(opened_ts, timezone.utc) if opened_ts > 0 else sig_ts
                if abs((sig_ts - opened).total_seconds()) > 180:
                    continue
                opened_price = float(getattr(p, "price_open", 0.0) or 0.0)
                if entry > 0 and opened_price > 0 and abs(opened_price - entry) <= max_gap:
                    return int(getattr(p, "ticket", 0) or 0)
            except Exception:
                continue
        return None

    def _handle_close(self, c: dict) -> None:
        sig_id = c.get("signal_id")
        if not sig_id: return
        log.info("CLOSE signal %s exit=%s", sig_id[:8], c.get("exit_price"))
        any_action = False
        for u in self.users.values():
            if not self._can_attempt_account(u, "CLOSE"):
                continue
            # 1. Activate this user's MT5 session (needed for both the in-memory
            #    ticket close AND the MT5 scan fallback below).
            if not self._ensure_active(u):
                log.warning("CLOSE: skipping user=%s — login swap failed", u.email)
                continue

            # 2. Collect every ticket we should close for this signal:
            #    a) the in-memory mapping (fastest happy-path)
            #    b) MT5 scan by comment prefix (handles worker-restart, pyramid
            #       partials, and any drift between memory and reality)
            tickets: List[int] = []
            mem_tkt = u.open_tickets.get(sig_id)
            if mem_tkt: tickets.append(int(mem_tkt))
            scan_tkts = self._scan_positions_by_sig(sig_id)
            for t in scan_tkts:
                if t not in tickets: tickets.append(t)
            if not tickets:
                continue
            log.info("CLOSE user=%s sig=%s — closing %d ticket(s) %s",
                     u.email, sig_id[:8], len(tickets),
                     "(mem+scan)" if mem_tkt and scan_tkts else
                     ("(memory)" if mem_tkt else "(MT5 scan only)"))

            # 3. Close each ticket. Only delete the in-memory mapping AFTER
            #    a successful close — so a transient broker error doesn't lose
            #    the ticket forever.
            close_succeeded_for_mem = False
            for tkt in tickets:
                snap = self._position_snapshot(tkt)
                exit_px, profit, err = self.mt5_order_close(u, tkt)
                self._post_safe("/api/cloud/agent/trade-close", {
                    "user_id": u.user_id, "signal_id": sig_id, "ticket": int(tkt),
                    "symbol": snap.get("symbol") or u.resolved_symbol or "XAUUSD",
                    "side": snap.get("side") or "",
                    "lots": float(snap.get("lots") or 0.0),
                    "entry": float(snap.get("entry") or 0.0),
                    "exit_price": float(exit_px or c.get("exit_price", 0)),
                    "profit": float(profit),
                    "opened_at": snap.get("opened_at") or "",
                    "closed_at": datetime.now(timezone.utc).isoformat(),
                    "reason": (c.get("reason") or "master close") + (f" | err={err}" if err else "")})
                if not err and mem_tkt and int(tkt) == int(mem_tkt):
                    close_succeeded_for_mem = True
                any_action = True
            if close_succeeded_for_mem:
                u.open_tickets.pop(sig_id, None)
                self._save_state()
            elif mem_tkt and not close_succeeded_for_mem:
                # All close attempts failed — leave mapping so next poll retries.
                log.warning("CLOSE retry-armed user=%s sig=%s — keeping mapping for next poll",
                            u.email, sig_id[:8])
        if not any_action:
            log.warning("CLOSE signal %s — NO ticket matched on ANY user. "
                        "If master positions still open on cloud, check magic=77007007 "
                        "and comment prefix 'XAUAI|%s' in user's MT5.",
                        sig_id[:8], sig_id[:8])

    def bulletproof_reconcile(self) -> None:
        """v1.4.7 — THE primary close-sync mechanism. Runs every 20s.
        Guarantees: any position open on a cloud MT5 whose master signal has
        closed (or never existed) will be closed within ~20 seconds.

        Sources scanned (union):
          A) In-memory `u.open_tickets` (sig_id -> ticket)
          B) MT5 positions_get() filtered by magic=77007007, comment parsed for
             sig_id (recovers from worker restart, partial fills, etc.)

        For every sig_id in the union, ask backend /signal-status.
        Backend returns closed=true for: signals with closed_at set, AND signals
        that don't exist in cloud_signals at all (defensive: orphan).
        Close every position whose sig_id is reported closed."""
        if not self.users: return
        # Collect every sig_id we care about across all users + current MT5 state
        per_user_sigs: Dict[str, Set[str]] = {}
        all_sigs: Set[str] = set()
        for uid, u in self.users.items():
            sigs: Set[str] = set(u.open_tickets.keys())
            # MT5 scan: parse comments of magic-77007007 positions
            if not MOCK_MT5 and self._ensure_active(u):
                try:
                    positions = mt5.positions_get() or ()
                    for p in positions:
                        if int(getattr(p, "magic", 0) or 0) != 77007007: continue
                        cmt = str(getattr(p, "comment", "") or "")
                        # comment format: "XAUAI|<sigid_prefix8>"
                        if cmt.startswith("XAUAI|"):
                            prefix = cmt.split("|", 1)[1].strip()[:8]
                            if prefix:
                                # We only have an 8-char prefix from the comment.
                                # Find any sig_id in open_tickets matching, OR
                                # treat the prefix itself as the sig (backend
                                # will return "not found" → close it).
                                matched = None
                                for sid in u.open_tickets:
                                    if sid[:8] == prefix:
                                        matched = sid; break
                                sigs.add(matched or prefix)
                except Exception:
                    pass
            per_user_sigs[uid] = sigs
            all_sigs.update(sigs)

        if not all_sigs:
            return

        # Ask backend which of these are closed
        try:
            resp = self._post("/api/cloud/agent/signal-status",
                              {"signal_ids": list(all_sigs)})
            sig_map = (resp or {}).get("signals", {}) if isinstance(resp, dict) else {}
        except Exception as e:
            log.debug("bulletproof_reconcile signal-status fetch failed: %s", e)
            return

        # Close everything reported closed
        for uid, sigs in per_user_sigs.items():
            u = self.users.get(uid)
            if not u: continue
            if not self._can_attempt_account(u, "BULLETPROOF"):
                continue
            for sid in sigs:
                info = sig_map.get(sid) or sig_map.get(sid[:8]) or {}
                # Prefix-key lookup fallback for cases where we only had a comment prefix
                if not info:
                    for k, v in sig_map.items():
                        if k.startswith(sid[:8]) or sid.startswith(k[:8]):
                            info = v; break
                if not info or not info.get("closed"):
                    continue
                # Sig is closed on master → close every matching cloud position.
                tickets: List[int] = []
                mem_tkt = u.open_tickets.get(sid)
                if mem_tkt: tickets.append(int(mem_tkt))
                # ALWAYS also re-scan MT5 by comment prefix — catches partials.
                scan_tkts = self._scan_positions_by_sig(sid)
                for t in scan_tkts:
                    if t not in tickets: tickets.append(t)
                if not tickets:
                    # Nothing physically open for this sigid on user's terminal.
                    # Drop the stale mapping so we don't keep asking about it.
                    u.open_tickets.pop(sid, None)
                    continue
                if not self._ensure_active(u): continue
                notice_key = f"{u.user_id}:{sid[:8]}"
                notice_due = time.time() - self._last_bulletproof_notice.get(notice_key, 0.0) >= 60
                if notice_due:
                    log.warning("BULLETPROOF user=%s sig=%s — master CLOSED, closing %d cloud ticket(s) reason=%s",
                                u.email, sid[:8], len(tickets), info.get("reason", ""))
                    self._last_bulletproof_notice[notice_key] = time.time()
                close_ok = False
                for tkt in tickets:
                    snap = self._position_snapshot(tkt)
                    exit_px, profit, err = self.mt5_order_close(u, tkt)
                    if not err or "position not found" in str(err).lower():
                        close_ok = True
                    self._post_safe("/api/cloud/agent/trade-close", {
                        "user_id": u.user_id, "signal_id": sid, "ticket": int(tkt),
                        "symbol": snap.get("symbol") or u.resolved_symbol or "XAUUSD",
                        "side": snap.get("side") or "",
                        "lots": float(snap.get("lots") or 0.0),
                        "entry": float(snap.get("entry") or 0.0),
                        "exit_price": float(exit_px or info.get("exit_price", 0)),
                        "profit": float(profit),
                        "opened_at": snap.get("opened_at") or "",
                        "closed_at": datetime.now(timezone.utc).isoformat(),
                        "reason": "bulletproof_reconcile: " + (info.get("reason", "") or "master closed")
                                  + (f" | err={err}" if err else "")})
                if close_ok:
                    u.open_tickets.pop(sid, None)
        self._save_state()

    def reconcile_orphans(self) -> None:
        """v1.4 — periodic safety net. For every user, scan MT5 for positions
        whose signals are already CLOSED on the backend but the position is
        still open locally. Force-close them. Catches any close that slipped
        through the polling cycle (HTTP failure, worker dead at the moment, etc)."""
        # v1.4.3 — also process admin "force-close-all" markers BEFORE the
        # closed-signal sweep. Admins push markers via /admin/cloud/force-close-user
        # to nuke orphan positions left over from pre-v1.4 worker versions.
        try:
            qd = self._get("/api/cloud/agent/force-close-queue")
            for item in (qd or {}).get("items", []) if isinstance(qd, dict) else []:
                tgt_uid = item.get("user_id", "")
                marker_id = item.get("id", "")
                if item.get("kind") != "force_close_all": continue
                if tgt_uid not in self.users:
                    self._post_safe("/api/cloud/agent/force-close-ack",
                                    {"marker_id": marker_id, "result": "user_not_on_this_worker"})
                    continue
                u = self.users[tgt_uid]
                if not self._can_attempt_account(u, "FORCE_CLOSE"):
                    continue
                if not self._ensure_active(u):
                    continue  # try again next cycle
                if MOCK_MT5:
                    self._post_safe("/api/cloud/agent/force-close-ack",
                                    {"marker_id": marker_id, "result": "mock"})
                    continue
                try:
                    positions = mt5.positions_get()
                except Exception:
                    positions = None
                closed = 0
                if positions:
                    for p in positions:
                        if int(getattr(p, "magic", 0) or 0) != 77007007: continue
                        exit_px, profit, err = self.mt5_order_close(u, int(p.ticket))
                        if not err: closed += 1
                        self._post_safe("/api/cloud/agent/trade-close", {
                            "user_id": u.user_id, "signal_id": "", "ticket": int(p.ticket),
                            "symbol": str(p.symbol or ""), "side": "",
                            "lots": float(p.volume or 0), "entry": float(p.price_open or 0),
                            "exit_price": float(exit_px or 0),
                            "profit": float(profit),
                            "opened_at": "", "closed_at": datetime.now(timezone.utc).isoformat(),
                            "reason": "admin force-close-all" + (f" | err={err}" if err else "")})
                # Clear ALL local mappings for this user (everything just got closed)
                u.open_tickets.clear()
                self._save_state()
                log.warning("FORCE-CLOSE user=%s marker=%s — closed %d positions",
                            u.email, marker_id[:8], closed)
                self._post_safe("/api/cloud/agent/force-close-ack",
                                {"marker_id": marker_id,
                                 "result": f"closed_{closed}_positions"})
        except Exception as e:
            log.debug("force-close queue poll failed: %s", e)

        try:
            data = self._get("/api/cloud/agent/closed-signals", params={"hours": 6, "limit": 200})
        except Exception as e:
            log.debug("reconcile: closed-signals fetch failed: %s", e); return
        closed_sigs = data.get("signals", []) if isinstance(data, dict) else []
        if not closed_sigs: return
        for u in self.users.values():
            if not self._can_attempt_account(u, "RECONCILE"):
                continue
            if not self._ensure_active(u): continue
            for sig in closed_sigs:
                sid = sig.get("id")
                if not sid: continue
                tickets = self._scan_positions_by_sig(sid)
                if not tickets: continue
                log.warning("RECONCILE user=%s sig=%s — found %d orphan position(s) for an already-closed signal. Force-closing.",
                            u.email, sid[:8], len(tickets))
                for tkt in tickets:
                    exit_px, profit, err = self.mt5_order_close(u, tkt)
                    self._post_safe("/api/cloud/agent/trade-close", {
                        "user_id": u.user_id, "signal_id": sid, "ticket": int(tkt),
                        "symbol": u.resolved_symbol or "XAUUSD", "side": "",
                        "lots": 0.0, "entry": 0.0,
                        "exit_price": float(exit_px or sig.get("exit_price", 0)),
                        "profit": float(profit),
                        "opened_at": "", "closed_at": datetime.now(timezone.utc).isoformat(),
                        "reason": "reconcile orphan" + (f" | err={err}" if err else "")})
                u.open_tickets.pop(sid, None)
        self._save_state()

    def heartbeat(self) -> None:
        try:
            self._post("/api/cloud/agent/heartbeat", {
                "worker_id": WORKER_ID,
                "active_users": len(self.users),
                "version": VERSION,
                "hostname": socket.gethostname(),
            })
        except Exception as e:
            log.warning("heartbeat failed: %s", e)

    def push_equity(self) -> None:
        for u in self.users.values():
            if not self._can_attempt_account(u, "EQUITY"):
                self._report_account_status(u)
                continue
            eq = self.mt5_equity(u)
            if not eq: continue
            u.last_balance = eq["balance"]
            u.last_equity = eq["equity"]
            self._post_safe("/api/cloud/agent/equity-snapshot",
                            {"user_id": u.user_id, **eq})

    def push_equity_for(self, user_ids: list) -> None:
        if not user_ids: return
        for uid in user_ids:
            u = self.users.get(uid)
            if not u:
                log.info("refresh requested but user not in active set: %s", uid); continue
            if not self._can_attempt_account(u, "REFRESH"):
                self._report_account_status(u, force=True)
                continue
            eq = self.mt5_equity(u)
            if not eq: continue
            u.last_balance = eq["balance"]
            u.last_equity = eq["equity"]
            self._post_safe("/api/cloud/agent/equity-snapshot",
                            {"user_id": u.user_id, **eq})
            log.info("REFRESH pushed for user=%s balance=%.2f", u.email, eq["balance"])

    def poll_refresh_queue(self) -> None:
        try:
            data = self._get("/api/cloud/agent/refresh-queue")
        except Exception as e:
            log.warning("refresh-queue fetch failed: %s", e); return
        ids = data.get("user_ids", [])
        if ids: self.push_equity_for(ids)

    # ---------- Entrypoint ----------
    def run(self) -> None:
        log.info("XauAi Worker Agent %s starting — worker_id=%s mock=%s host=%s os=%s",
                 VERSION, WORKER_ID, MOCK_MT5, socket.gethostname(), platform.system())
        log.warning("DEDICATED WORKER MODE: WORKER_MAX_USERS=%d. The MT5 Python bridge has one global terminal session; run one worker/terminal per live account.",
                    WORKER_MAX_USERS)
        log.info("Signal cursor cold-start: %s (catchup=%dmin)",
                 self.last_signal_poll, SIGNAL_CATCHUP_MIN)
        if MAX_RISK_PCT_PER_TRADE > 0:
            log.warning("WORKER_MAX_RISK_PCT=%.2f is enabled. This can make a larger cloud "
                        "account take a smaller lot than master. Set it to 0 for strict proportional mirror.",
                        MAX_RISK_PCT_PER_TRADE)
        self.verify_queue()
        self.sync_users()
        last_user_sync = time.time()
        last_reconcile = 0.0
        last_bulletproof = 0.0
        while self.running:
            now = time.time()
            try:
                if now - last_user_sync >= 30:
                    self.verify_queue()
                    self.sync_users(); last_user_sync = now
                self.poll_signals()
                self.poll_refresh_queue()
                # v1.4.7 — PRIMARY close-sync: every 20s ask backend for the
                # current closed-status of every sig_id we have open and close
                # anything stale. Trumps the legacy 90s reconcile entirely.
                if now - last_bulletproof >= 20:
                    self.bulletproof_reconcile(); last_bulletproof = now
                # Legacy 90s safety net (closed-signals feed + force-close queue)
                if now - last_reconcile >= 90:
                    self.reconcile_orphans(); last_reconcile = now
                if now - self.last_hb >= HEARTBEAT_SEC:
                    self.heartbeat(); self.last_hb = now
                if now - self.last_eq >= EQUITY_SEC:
                    self.push_equity(); self.last_eq = now
            except Exception as e:
                log.exception("loop error: %s", e)
            time.sleep(POLL_SEC)
        log.info("shutdown complete")


def _install_signal_handlers(agent: WorkerAgent) -> None:
    def _stop(*_):
        log.info("shutdown requested")
        agent.running = False
    signal.signal(signal.SIGINT, _stop)
    try: signal.signal(signal.SIGTERM, _stop)
    except Exception: pass


if __name__ == "__main__":
    agent = WorkerAgent()
    _install_signal_handlers(agent)
    sys.exit(agent.run() or 0)
