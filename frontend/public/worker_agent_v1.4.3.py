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

Author: XauAi Sniper   |   Version: 1.4.2  (tiny-account safety: skip if would blow user)
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
from typing import Dict, List, Optional, Tuple

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
    cloud_url = input("Cloud URL [https://xaucloud.io]: ").strip() or "https://xaucloud.io"
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
        f"POLL_SEC=10\n"
        f"HEARTBEAT_SEC=60\n"
        f"EQUITY_SEC=120\n"
        f"HTTP_TIMEOUT=15\n"
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
POLL_SEC = int(os.environ.get("POLL_SEC", "10"))
HEARTBEAT_SEC = int(os.environ.get("HEARTBEAT_SEC", "60"))
EQUITY_SEC = int(os.environ.get("EQUITY_SEC", "120"))
HTTP_TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "15"))
VERSION = "1.4.3"

# Catch-up window: on cold start we only execute signals from the last N minutes
# to avoid replaying historic trades. 0 = only signals fired AFTER worker start.
SIGNAL_CATCHUP_MIN = int(os.environ.get("SIGNAL_CATCHUP_MIN", "5"))

HEADERS = {"X-Agent-Token": AGENT_TOKEN, "Content-Type": "application/json"}

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
    "GOLD.s", "XAU/USD", "XAUUSDX", "XAUUSD_i",
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
    logged_in: bool = False
    resolved_symbol: str = ""          # cached XAUUSD-equivalent for THIS broker
    # signal_id -> MT5 ticket, so we can close precisely when master closes
    open_tickets: Dict[str, int] = field(default_factory=dict)
    # diagnostic counters
    fanout_attempts: int = 0
    fanout_successes: int = 0
    last_fanout_error: str = ""


RISK_PCT = {"conservative": 0.6, "balanced": 1.2, "aggressive": 2.0}

# v1.4.2 — TINY-ACCOUNT SAFETY (protects $10/$50/$100 users from broker
# minimum-lot blow-ups). Without these guards, a $10 account would take
# 0.01 lots (broker minimum) which is ~20× their fair share of a master
# trade, and a single SL hit would blow the account 15× over.
#
# Two-layer protection:
#   1. MAX_RISK_PCT — never let any single trade risk more than X% of
#      the user's equity, regardless of master lots. Computed as
#      (lot × sl_distance × $100/lot/$1) / equity. Skip trade if exceeds.
#   2. MIN_BALANCE_USD — accounts below this threshold are simply not
#      eligible for cloud copy. Logged once as a clear "needs $X minimum".
MAX_RISK_PCT_PER_TRADE = float(os.environ.get("WORKER_MAX_RISK_PCT", "5.0"))
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
        # which user currently owns the active MT5 terminal connection
        self._active_user_id: str = ""
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
            u.logged_in = True
            self._active_user_id = u.user_id
            return True
        if self._active_user_id == u.user_id and u.logged_in:
            # Already active for this user — nothing to do.
            return True
        # 1. Ensure terminal is up exactly once.
        if not getattr(self, "_mt5_inited", False):
            ok = mt5.initialize()
            if not ok:
                err = mt5.last_error()
                log.error("mt5.initialize FAIL err=%s — is MT5 terminal installed and reachable?", err)
                u.logged_in = False
                u.last_fanout_error = f"mt5.initialize failed: {err}"
                return False
            self._mt5_inited = True
            log.info("mt5 terminal initialized")
        # 2. Switch account via mt5.login (preferred for swaps).
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
                u.logged_in = False
                u.last_fanout_error = (
                    f"login swap failed: {err}. "
                    f"Login={u.mt5_login} Server='{u.mt5_server}'. "
                    "Common causes: (a) broker server name typo "
                    "(must match exactly what shows in MT5 → File → Login → Server dropdown), "
                    "(b) user's broker uses a different server than what was entered, "
                    "(c) password was changed in MT5 but not updated in cloud."
                )
                log.error("mt5 login swap FAIL user=%s server=%s err=%s",
                          u.email, u.mt5_server, err)
                return False
        u.logged_in = True
        self._active_user_id = u.user_id
        acct = mt5.account_info()
        if acct:
            u.last_balance = float(acct.balance)
        return True

    def mt5_login(self, u: UserSession) -> bool:
        if MOCK_MT5:
            u.logged_in = True
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
        # Round DOWN to step so we never exceed the user's risk envelope.
        n = int(lots / step)
        rounded = round(n * step, 8)
        # Decimals derived from step (0.01→2, 0.1→1, 1.0→0)
        decimals = max(0, -int(round(__import__("math").log10(step)))) if step < 1 else 0
        rounded = round(rounded, decimals or 2)
        return max(min_lot, min(max_lot, rounded))

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
        lots = self._normalize_lots(info, lots)
        if lots <= 0:
            return None, f"lot {lots} below broker min after rounding"
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
                return float(close_price), float(p.profit), ""
            if res is not None and res.retcode == 10030:
                continue  # try next filling mode
            err = self._retcode_msg(getattr(res, "retcode", 0), getattr(res, "comment", "") if res else "")
            log.error("close FAIL user=%s ticket=%d %s", u.email, ticket, err)
            return float(close_price), float(p.profit), err
        return 0.0, float(p.profit), "close: all filling modes rejected"

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
            ok, err, bal, eq, ccy = self._mt5_try_login(login, server, pwd)
            try:
                self._post("/api/cloud/agent/verify-credentials", {
                    "user_id": uid, "ok": ok, "error": err,
                    "balance": bal, "equity": eq, "currency": ccy})
                log.info("verify result user=%s ok=%s err=%s", email, ok, err)
            except Exception as e:
                log.error("verify-credentials POST failed user=%s: %s", email, e)

    def _mt5_try_login(self, login: int, server: str, password: str):
        """Returns (ok, error, balance, equity, currency)."""
        if MOCK_MT5:
            if password.lower() == "wrong":
                return False, "Invalid credentials (mock)", None, None, ""
            return True, "", 1000.0, 1000.0, "USD"
        # Ensure terminal up exactly once (same pattern as _ensure_active).
        if not getattr(self, "_mt5_inited", False):
            if not mt5.initialize():
                return False, f"mt5.initialize: {mt5.last_error()}", None, None, ""
            self._mt5_inited = True
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
                return False, f"{err}", None, None, ""
        # Verification swap invalidates the active session — clear cache so the
        # next operation re-authenticates as the intended user.
        self._active_user_id = ""
        acct = mt5.account_info()
        if not acct:
            return False, "account_info() returned None", None, None, ""
        bal, eq, ccy = float(acct.balance), float(acct.equity), str(acct.currency or "")
        return True, "", bal, eq, ccy

    def sync_users(self) -> None:
        try:
            data = self._get("/api/cloud/agent/pending-users")
        except Exception as e:
            log.error("sync_users failed: %s", e); return
        wanted: Dict[str, UserSession] = {}
        for row in data.get("users", []):
            uid = row.get("id")
            if not uid or not row.get("mt5_password"): continue
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
            if not s.logged_in:
                self.mt5_login(s)
            wanted[uid] = s
        for gone in set(self.users) - set(wanted):
            log.info("dropping user %s (no longer active)", self.users[gone].email)
            self.users.pop(gone, None)
        self.users = wanted
        if self.users:
            log.info("users synced: %d active [%s]",
                     len(self.users),
                     ", ".join(f"{u.email}({u.mt5_login})" for u in self.users.values()))
        else:
            log.info("users synced: 0 active")

    def compute_lots(self, u: UserSession, sig: dict) -> Tuple[float, str]:
        """v1.4.2 STRICT MIRROR + TINY-ACCOUNT SAFETY:
          1. lot = (userBalance / masterBalance) × masterLots  (strict 1:1)
          2. ABORT (returns 0.0) if user balance < MIN_BALANCE_USD
          3. ABORT (returns 0.0) if estimated max loss > MAX_RISK_PCT% of equity
             — protects $10/$50/$100 accounts from broker minimum-lot blow-ups
        Returns (lots, source_label_for_logging). lots == 0.0 means SKIP."""
        # --- Tiny-account hard-floor: cheaper than fixing a blown account ---
        if u.last_balance > 0 and u.last_balance < MIN_BALANCE_USD:
            return 0.0, (f"SKIP tiny-account: balance ${u.last_balance:.2f} < "
                         f"min ${MIN_BALANCE_USD:.2f} (cloud copying not safe)")

        master_lots = float(sig.get("master_lots") or 0.0)
        master_bal  = float(sig.get("master_balance") or 0.0)
        if master_lots > 0 and master_bal > 0:
            ratio = u.last_balance / master_bal
            ideal_lot = master_lots * ratio
            lots = round(ideal_lot, 2)
            # Round-DOWN to broker step happens in mt5_order_open via _normalize_lots;
            # here we just need a viability check. If the ideal lot is below 0.01
            # (broker minimum) the user CAN'T mirror this trade safely — skip.
            if lots < 0.01:
                return 0.0, (f"SKIP under-min: ideal {ideal_lot:.4f} lots < 0.01 "
                             f"broker min (user=${u.last_balance:.0f} master=${master_bal:.0f} "
                             f"× master_lots={master_lots:.2f}). "
                             f"Account too small to proportionally mirror this signal.")
            # Risk gate: would this trade risk more than MAX_RISK_PCT of equity?
            sl_dist = abs(float(sig["entry"]) - float(sig["sl"]))
            est_loss_usd = lots * sl_dist * XAU_USD_PER_LOT_PER_PRICE
            risk_pct = (est_loss_usd / u.last_balance * 100.0) if u.last_balance > 0 else 999
            if risk_pct > MAX_RISK_PCT_PER_TRADE:
                return 0.0, (f"SKIP risk-cap: trade would risk ${est_loss_usd:.2f} "
                             f"= {risk_pct:.1f}% of ${u.last_balance:.0f} (cap "
                             f"{MAX_RISK_PCT_PER_TRADE:.1f}%). Account too small for this signal's SL distance.")
            return min(lots, 100.0), (f"strict_mirror master={master_lots:.2f}@${master_bal:.0f} "
                                       f"user=${u.last_balance:.0f} ratio={ratio:.4f} "
                                       f"risk=${est_loss_usd:.2f} ({risk_pct:.1f}% of eq)")

        # Legacy fallback (ONLY runs if master EA hasn't been upgraded yet).
        sl_dist = abs(float(sig["entry"]) - float(sig["sl"]))
        if sl_dist <= 0: return 0.01, "legacy_fallback (sl_dist=0)"
        risk_pct_cfg = RISK_PCT.get(u.risk_tier, 1.2)
        risk_usd = u.last_balance * risk_pct_cfg / 100.0
        lots = max(0.01, round(risk_usd / (sl_dist * XAU_USD_PER_LOT_PER_PRICE), 2))
        return min(lots, 10.0), f"legacy_fallback risk={risk_pct_cfg}% (master EA outdated — no master_lots in signal)"

    def poll_signals(self) -> None:
        try:
            data = self._get("/api/cloud/agent/pending-signals",
                             params={"since": self.last_signal_poll, "limit": 50})
        except Exception as e:
            log.error("poll_signals failed: %s", e); return
        opens = data.get("opens", [])
        closes = data.get("closes", [])
        if opens or closes:
            log.info("polled signals: opens=%d closes=%d users=%d",
                     len(opens), len(closes), len(self.users))
        # Process opens (oldest first so chronological)
        for sig in reversed(opens):
            self._handle_open(sig)
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
            # v1.4.1 — DUPLICATE GUARD #1: ask MT5 itself.
            # Even if two workers race the same signal, the second one will
            # see the position from the first one and skip. Magic+comment
            # prefix is unique to (us, this signal).
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

    def _handle_close(self, c: dict) -> None:
        sig_id = c.get("signal_id")
        if not sig_id: return
        log.info("CLOSE signal %s exit=%s", sig_id[:8], c.get("exit_price"))
        any_action = False
        for u in self.users.values():
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
                exit_px, profit, err = self.mt5_order_close(u, tkt)
                self._post_safe("/api/cloud/agent/trade-close", {
                    "user_id": u.user_id, "ticket": int(tkt),
                    "symbol": u.resolved_symbol or "XAUUSD", "side": "",
                    "lots": 0.0, "entry": 0.0,
                    "exit_price": float(exit_px or c.get("exit_price", 0)),
                    "profit": float(profit),
                    "opened_at": "", "closed_at": datetime.now(timezone.utc).isoformat(),
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
                            "user_id": u.user_id, "ticket": int(p.ticket),
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
                        "user_id": u.user_id, "ticket": int(tkt),
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
            eq = self.mt5_equity(u)
            if not eq: continue
            u.last_balance = eq["balance"]
            self._post_safe("/api/cloud/agent/equity-snapshot",
                            {"user_id": u.user_id, **eq})

    def push_equity_for(self, user_ids: list) -> None:
        if not user_ids: return
        for uid in user_ids:
            u = self.users.get(uid)
            if not u:
                log.info("refresh requested but user not in active set: %s", uid); continue
            eq = self.mt5_equity(u)
            if not eq: continue
            u.last_balance = eq["balance"]
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
        log.info("Signal cursor cold-start: %s (catchup=%dmin)",
                 self.last_signal_poll, SIGNAL_CATCHUP_MIN)
        self.verify_queue()
        self.sync_users()
        last_user_sync = time.time()
        last_reconcile = 0.0
        while self.running:
            now = time.time()
            try:
                if now - last_user_sync >= 30:
                    self.verify_queue()
                    self.sync_users(); last_user_sync = now
                self.poll_signals()
                self.poll_refresh_queue()
                # v1.4 — reconcile orphan positions every 90s as a safety net
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
