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

Author: XauAi Sniper   |   Version: 1.0.0
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
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

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
VERSION = "1.0.0"

HEADERS = {"X-Agent-Token": AGENT_TOKEN, "Content-Type": "application/json"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("xauai-worker")


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
    # signal_id -> MT5 ticket, so we can close precisely when master closes
    open_tickets: Dict[str, int] = field(default_factory=dict)


RISK_PCT = {"conservative": 0.6, "balanced": 1.2, "aggressive": 2.0}


class WorkerAgent:
    def __init__(self) -> None:
        self.users: Dict[str, UserSession] = {}
        self.last_signal_poll: str = ""   # ISO timestamp of last /pending-signals poll
        self.last_hb: float = 0.0
        self.last_eq: float = 0.0
        self.running = True

    # ---------- HTTP helpers ----------
    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        r = requests.get(f"{CLOUD_URL}{path}", headers=HEADERS, params=params, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict) -> dict:
        r = requests.post(f"{CLOUD_URL}{path}", headers=HEADERS, data=json.dumps(body), timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        return r.json()

    # ---------- MT5 helpers (mockable) ----------
    def mt5_login(self, u: UserSession) -> bool:
        if MOCK_MT5:
            u.logged_in = True
            log.info("[MOCK] login ok user=%s login=%s server=%s", u.email, u.mt5_login, u.mt5_server)
            return True
        ok = mt5.initialize(login=int(u.mt5_login), server=u.mt5_server, password=u.mt5_password)
        if not ok:
            log.error("MT5 login FAIL user=%s err=%s", u.email, mt5.last_error())
            return False
        acct = mt5.account_info()
        if acct:
            u.last_balance = float(acct.balance)
        u.logged_in = True
        log.info("MT5 login OK user=%s balance=%.2f", u.email, u.last_balance)
        return True

    def mt5_order_open(self, u: UserSession, sig: dict, lots: float) -> Optional[int]:
        """Returns MT5 ticket on success, else None."""
        side = sig["side"].upper()
        symbol = sig.get("symbol", "XAUUSD")
        sl, tp = float(sig["sl"]), float(sig["tp"])
        comment = f"XAUAI|{sig['id'][:8]}"
        if MOCK_MT5:
            fake_ticket = int(time.time() * 1000) % 2_000_000_000
            log.info("[MOCK] order_send user=%s %s %s lots=%.2f sl=%.2f tp=%.2f ticket=%d",
                     u.email, side, symbol, lots, sl, tp, fake_ticket)
            return fake_ticket
        if not mt5.symbol_select(symbol, True):
            log.error("symbol_select failed for %s", symbol); return None
        tick = mt5.symbol_info_tick(symbol)
        price = tick.ask if side == "BUY" else tick.bid
        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(lots),
            "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL,
            "price": price, "sl": sl, "tp": tp,
            "deviation": 20, "magic": 77007007,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        res = mt5.order_send(req)
        if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
            log.error("order_send FAIL user=%s ret=%s", u.email, res)
            return None
        return int(res.order)

    def mt5_order_close(self, u: UserSession, ticket: int) -> Tuple[float, float]:
        """Closes position by ticket. Returns (exit_price, profit)."""
        if MOCK_MT5:
            log.info("[MOCK] close_position user=%s ticket=%d", u.email, ticket)
            return 0.0, 0.0
        positions = mt5.positions_get(ticket=ticket)
        if not positions: return 0.0, 0.0
        p = positions[0]
        tick = mt5.symbol_info_tick(p.symbol)
        close_price = tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask
        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": ticket,
            "symbol": p.symbol,
            "volume": p.volume,
            "type": mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY,
            "price": close_price,
            "deviation": 20, "magic": 77007007,
            "comment": "XAUAI|close",
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        res = mt5.order_send(req)
        return float(close_price), float(p.profit)

    def mt5_equity(self, u: UserSession) -> Optional[dict]:
        if MOCK_MT5:
            return {"balance": u.last_balance, "equity": u.last_balance,
                    "margin": 0.0, "free_margin": u.last_balance}
        acct = mt5.account_info()
        if not acct: return None
        return {"balance": float(acct.balance), "equity": float(acct.equity),
                "margin": float(acct.margin), "free_margin": float(acct.margin_free)}

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
            # Mock: anything with password "wrong" → reject. Otherwise pretend ok.
            if password.lower() == "wrong":
                return False, "Invalid credentials (mock)", None, None, ""
            return True, "", 1000.0, 1000.0, "USD"
        ok = mt5.initialize(login=int(login), server=server, password=password)
        if not ok:
            err = mt5.last_error()
            return False, f"{err}", None, None, ""
        acct = mt5.account_info()
        if not acct:
            mt5.shutdown()
            return False, "account_info() returned None", None, None, ""
        bal, eq, ccy = float(acct.balance), float(acct.equity), str(acct.currency or "")
        # leave terminal connected for trading; don't shut down
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
                mt5_server=row.get("mt5_server") or "",
                mt5_password=row.get("mt5_password") or "",
            )
            s.risk_tier = row.get("risk_tier") or "balanced"
            s.last_balance = float(row.get("last_balance") or s.last_balance)
            s.mt5_login = int(row.get("mt5_login") or s.mt5_login)
            s.mt5_server = row.get("mt5_server") or s.mt5_server
            s.mt5_password = row.get("mt5_password") or s.mt5_password
            if not s.logged_in:
                self.mt5_login(s)
            wanted[uid] = s
        # drop users no longer active
        for gone in set(self.users) - set(wanted):
            log.info("dropping user %s (no longer active)", self.users[gone].email)
            self.users.pop(gone, None)
        self.users = wanted
        log.info("users synced: %d active", len(self.users))

    def compute_lots(self, u: UserSession, sig: dict) -> float:
        """Risk-scaled lot size. XAUUSD: ~$100 per lot per $1 move."""
        sl_dist = abs(float(sig["entry"]) - float(sig["sl"]))
        if sl_dist <= 0: return 0.01
        risk_pct = RISK_PCT.get(u.risk_tier, 1.2)
        risk_usd = u.last_balance * risk_pct / 100.0
        lots = risk_usd / (sl_dist * 100.0)
        lots = max(0.01, round(lots, 2))
        return min(lots, 10.0)

    def poll_signals(self) -> None:
        try:
            data = self._get("/api/cloud/agent/pending-signals",
                             params={"since": self.last_signal_poll, "limit": 50})
        except Exception as e:
            log.error("poll_signals failed: %s", e); return
        # Process opens (oldest first so chronological)
        for sig in reversed(data.get("opens", [])):
            self._handle_open(sig)
        for c in reversed(data.get("closes", [])):
            self._handle_close(c)
        # advance cursor
        self.last_signal_poll = data.get("server_time") or self.last_signal_poll

    def _handle_open(self, sig: dict) -> None:
        sig_id = sig.get("id")
        if not sig_id: return
        log.info("OPEN signal %s %s @%.2f sl=%.2f tp=%.2f", sig_id[:8],
                 sig.get("side"), float(sig.get("entry", 0)),
                 float(sig.get("sl", 0)), float(sig.get("tp", 0)))
        for u in self.users.values():
            if sig_id in u.open_tickets: continue  # already executed for this user
            lots = self.compute_lots(u, sig)
            tkt = self.mt5_order_open(u, sig, lots)
            if tkt: u.open_tickets[sig_id] = tkt

    def _handle_close(self, c: dict) -> None:
        sig_id = c.get("signal_id")
        if not sig_id: return
        log.info("CLOSE signal %s exit=%s", sig_id[:8], c.get("exit_price"))
        for u in self.users.values():
            tkt = u.open_tickets.pop(sig_id, None)
            if not tkt: continue
            exit_px, profit = self.mt5_order_close(u, tkt)
            try:
                self._post("/api/cloud/agent/trade-close", {
                    "user_id": u.user_id, "ticket": int(tkt),
                    "symbol": "XAUUSD", "side": "",
                    "lots": 0.0, "entry": 0.0,
                    "exit_price": float(exit_px or c.get("exit_price", 0)),
                    "profit": float(profit),
                    "opened_at": "", "closed_at": datetime.now(timezone.utc).isoformat(),
                    "reason": c.get("reason") or "master close"})
            except Exception as e:
                log.error("trade-close POST failed user=%s: %s", u.email, e)

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
            try:
                self._post("/api/cloud/agent/equity-snapshot", {
                    "user_id": u.user_id, **eq})
            except Exception as e:
                log.warning("equity push failed user=%s: %s", u.email, e)

    def push_equity_for(self, user_ids: list) -> None:
        """Targeted equity push — used for user-initiated 'Refresh balance' clicks."""
        if not user_ids: return
        for uid in user_ids:
            u = self.users.get(uid)
            if not u:
                log.info("refresh requested but user not in active set: %s", uid); continue
            eq = self.mt5_equity(u)
            if not eq: continue
            u.last_balance = eq["balance"]
            try:
                self._post("/api/cloud/agent/equity-snapshot", {"user_id": u.user_id, **eq})
                log.info("REFRESH pushed for user=%s balance=%.2f", u.email, eq["balance"])
            except Exception as e:
                log.warning("refresh push failed user=%s: %s", u.email, e)

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
        self.verify_queue()
        self.sync_users()
        last_user_sync = time.time()
        while self.running:
            now = time.time()
            try:
                if now - last_user_sync >= 30:
                    self.verify_queue()
                    self.sync_users(); last_user_sync = now
                self.poll_signals()
                self.poll_refresh_queue()
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
