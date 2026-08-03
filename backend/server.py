from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, io, zipfile, random, string, time, uuid, secrets, smtplib, bcrypt, jwt, httpx, asyncio, re, hashlib, hmac, json as _json
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
except ImportError:
    from llm_adapter import LlmChat, UserMessage
import performance_engine
import lease_service

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# v6.25.3 owner directive 2026-07-17 (Phase 6 P0, final pre-launch hardening)
# -- unknown/unset ENVIRONMENT is treated as production (the strict,
# fail-closed default), not development -- a misconfigured deployment must
# never silently fall back to the permissive local-dev behavior below.
ENVIRONMENT = os.environ.get("ENVIRONMENT", "production").strip().lower()
IS_PRODUCTION = ENVIRONMENT not in ("development", "dev", "local", "test", "testing")


def _load_or_create_jwt_secret() -> str:
    """v6.5.0 (audit bug #9), hardened v6.25.3 (Phase 6 P0) -- a fresh
    secrets.token_hex(32) on every process start invalidates every session
    on restart and, on a multi-worker deployment, makes tokens minted by one
    worker invalid on another. The old fix persisted a generated secret to a
    local file (.jwt_secret) so restarts on the SAME machine shared it -- but
    that is itself a real security gap in production: the secret ends up
    sitting in a container filesystem instead of the deployment's secret
    manager, and a second instance/redeploy on a different filesystem still
    gets a DIFFERENT secret, silently invalidating every session and any
    Fernet-encrypted data. In production, refuse to start rather than paper
    over a missing JWT_SECRET with an auto-generated one -- this is a fail
    startup, not fail open, by design. Only local development (ENVIRONMENT=
    development) gets the old persist-to-disk fallback."""
    env_secret = os.environ.get('JWT_SECRET')
    if env_secret:
        return env_secret
    if IS_PRODUCTION:
        raise RuntimeError(
            "JWT_SECRET environment variable is not set. Refusing to start in production with "
            "an auto-generated secret -- this invalidates every session on every restart across "
            "a multi-instance deployment and risks a real secret sitting in a container "
            "filesystem instead of the deployment's secret manager. Set JWT_SECRET explicitly "
            "(a long random value, e.g. `python3 -c \"import secrets; print(secrets.token_hex(32))\"`), "
            "or set ENVIRONMENT=development for local work only."
        )
    secret_file = ROOT_DIR / '.jwt_secret'
    try:
        if secret_file.exists():
            return secret_file.read_text(encoding='utf-8').strip()
        new_secret = secrets.token_hex(32)
        secret_file.write_text(new_secret, encoding='utf-8')
        logging.getLogger(__name__).warning(
            f"JWT_SECRET env var not set — generated and persisted a secret to {secret_file} "
            "(development mode only). Set JWT_SECRET explicitly for anything beyond local work."
        )
        return new_secret
    except OSError:
        # can't persist (read-only filesystem, etc.) — fall back to the old
        # per-process behavior rather than crashing startup.
        return secrets.token_hex(32)

JWT_SECRET = _load_or_create_jwt_secret()
JWT_ALGORITHM = "HS256"

# v6.25.3 owner directive 2026-07-17 (Phase 6 P0, final pre-launch hardening)
# -- simple, dependency-free rate limiting. Deliberately NOT a new pip
# package (slowapi/limits/etc.) -- this session already hit a real
# production outage (push notifications) caused by a new dependency that
# was declared in requirements.txt but never actually installed in the
# deployed environment; a hand-rolled stdlib limiter cannot fail that way.
# Per-process, in-memory, not shared across worker processes -- acceptable
# for this deployment's scale; the goal is to blunt casual brute-force/
# credential-stuffing/spam, not provide distributed-systems-grade limiting.
_rate_limit_buckets: Dict[str, list] = {}


def _rate_limit(key: str, max_requests: int, window_seconds: int) -> None:
    """Raises HTTPException(429) if `key` has already been called
    max_requests-or-more times in the last window_seconds; otherwise
    records this call. Call at the top of any endpoint that needs
    throttling, keyed by something like f"login:{client_ip}"."""
    now = time.time()
    cutoff = now - window_seconds
    bucket = _rate_limit_buckets.setdefault(key, [])
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)
    if len(bucket) >= max_requests:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait before trying again.")
    bucket.append(now)
    # Bound memory -- occasionally prune buckets that have gone fully quiet,
    # instead of running a dedicated background task for it.
    if len(_rate_limit_buckets) > 5000 and random.random() < 0.01:
        for k in [k for k, v in _rate_limit_buckets.items() if not v]:
            _rate_limit_buckets.pop(k, None)


def _client_ip(request: Request) -> str:
    # X-Forwarded-For is set by the reverse proxy in front of this backend;
    # request.client.host alone would be the proxy's own address, not the
    # real caller, behind Emergent's ingress.
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


PAYSTACK_BASE_URL = "https://api.paystack.co"

# v6.25.3 owner directive 2026-07-17 (final pre-launch hardening, Phase 2) --
# the Paystack callback_url used to be built directly from a client-supplied
# origin_url with no allowlist, so any caller of /purchase/initialize could
# redirect the post-payment browser flow to an arbitrary attacker-controlled
# domain. PUBLIC_SITE_URL is the one canonical, operator-controlled origin
# every payment callback is built from -- client input is never used for it.
PUBLIC_SITE_URL = os.environ.get("PUBLIC_SITE_URL", "https://xauaisniper.com").rstrip("/")
LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
AI_COST_DAILY_CALL_LIMIT = int(os.environ.get("AI_COST_DAILY_CALL_LIMIT", "120"))
AI_COST_MIN_SECONDS = int(os.environ.get("AI_COST_MIN_SECONDS", "45"))
AI_COST_CACHE_TTL_SECONDS = int(os.environ.get("AI_COST_CACHE_TTL_SECONDS", "240"))
AI_COST_DUAL_AI_CONFIDENCE_GAP = int(os.environ.get("AI_COST_DUAL_AI_CONFIDENCE_GAP", "12"))
AI_COST_TOKEN_PRICE_PER_1K = float(os.environ.get("AI_COST_TOKEN_PRICE_PER_1K", "0.003"))
TRADE_MEMORY_PATH = ROOT_DIR / "ai_trade_memory.jsonl"
TRADE_MEMORY_REPORT_PATH = ROOT_DIR / "ai_trade_memory_report.md"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

_ai_cost_cache: Dict[str, dict] = {}
_ai_cost_stats_by_account: Dict[str, dict] = {}  # multi-instance fix: per-account daily-call/throttle buckets, see _ai_account_bucket()
_ai_cost_stats = {
    "day": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    "calls": 0,
    "tokens": 0,
    "estimated_cost": 0.0,
    "cache_hits": 0,
    "skipped": 0,
    "last_call_at": 0.0,
    "reasons": [],
}

def _ai_cost_reset_if_new_day() -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _ai_cost_stats.get("day") == today:
        return
    _ai_cost_stats.update({
        "day": today,
        "calls": 0,
        "tokens": 0,
        "estimated_cost": 0.0,
        "cache_hits": 0,
        "skipped": 0,
        "last_call_at": 0.0,
        "reasons": [],
    })
    _ai_cost_cache.clear()

def _estimate_ai_tokens(*texts: str) -> int:
    chars = sum(len(t or "") for t in texts)
    return max(1, int(chars / 4) + 1)

def _estimate_ai_cost(tokens: int) -> float:
    return round((tokens / 1000.0) * AI_COST_TOKEN_PRICE_PER_1K, 6)

_INDEX_SYMBOL_KEYWORDS = ("INDEX", "VOLATILITY", "VOL", "BOOM", "CRASH", "STEP",
                          "JUMP", "RANGE", "SPREDIX", "VIX", "SYNTHETIC", "DERIV")

def classify_market_mode(symbol: str) -> str:
    """v6.6.0: mirrors the EA's XAU_DetectMarketMode() name-pattern logic so
    reporting can split Gold vs Index performance purely from the `symbol`
    field already recorded on every trade/heartbeat — no EA-side trade
    schema change needed, keeping TradeBrain's sync payload untouched."""
    s = str(symbol or "").upper()
    if "XAU" in s or "GOLD" in s:
        return "GOLD_MODE"
    for kw in _INDEX_SYMBOL_KEYWORDS:
        if kw in s:
            return "INDEX_MODE"
    return "GOLD_MODE"  # same safe default as the EA when the symbol is unrecognized

def _bucket(value: Any, size: float, default: str = "0") -> str:
    try:
        v = float(value)
        if size <= 0:
            return str(round(v, 2))
        return str(int(round(v / size)))
    except Exception:
        return default

def _ai_cost_state_hash(purpose: str, payload: dict) -> str:
    """Hash meaningful market state AND the account-risk-state fields the AI
    prompt itself is told to weight, so repeated unchanged setups reuse AI
    output but two accounts in genuinely different risk postures never share
    a cached verdict that was actually reasoned about only one of them.

    June 17-18 reconstruction / multi-instance fix: the prompt built in
    _build_entry_prompt() explicitly tells the model "if on a loss streak,
    require 75%+ confidence" and includes account_equity/daily_pct/
    basket_float_pl/recent_losses — but this hash used to omit all of that,
    so a cached verdict computed while one account was deep in a loss streak
    could be silently replayed onto a different, healthy account hitting the
    same market-structure bucket. Bucketing (not hashing exact account
    identity) keeps the beneficial cross-instance cache reuse for accounts
    that are in a genuinely similar risk posture, while separating accounts
    that aren't."""
    symbol = str(payload.get("symbol", "XAUUSD")).upper()
    setup = str(payload.get("setup") or payload.get("setup_name") or "NA").upper()
    regime = str(payload.get("regime") or "NA").upper()
    session = str(payload.get("session") or "NA").upper()
    grade = str(payload.get("grade") or "NA").upper()
    direction = str(payload.get("direction") or payload.get("h1_trend") or "NA").upper()
    htf = str(payload.get("htf_consensus") or payload.get("h1_trend") or "NA").upper()
    sig = str(payload.get("signature") or "")[:80]
    features = {
        "purpose": purpose,
        "symbol": symbol,
        "setup": setup,
        "regime": regime,
        "session": session,
        "grade": grade,
        "direction": direction,
        "htf": htf,
        "signature": sig,
        "spread_b": _bucket(payload.get("spread", 0), 5),
        "atr_b": _bucket(payload.get("atr", 0), 0.25),
        "price_b": _bucket(payload.get("price") or payload.get("current_price") or payload.get("entry_price"), 0.50),
        "rsi_b": _bucket(payload.get("rsi", 0), 5),
        "score_b": _bucket(payload.get("combined_score", 0), 1),
        "profit_b": _bucket(payload.get("profit", 0), 25),
        "pending_exit": str(payload.get("pending_exit_reason") or "")[:40],
        # Account-risk-state buckets: coarse enough that two accounts in a
        # similar posture still share a cache entry, fine enough that a deep
        # drawdown/loss-streak account never gets confused with a healthy one.
        "daily_pct_b": _bucket(payload.get("daily_pct", 0), 0.5),
        "basket_pl_b": _bucket(payload.get("basket_float_pl", 0), 25),
        "loss_streak_b": str(min(int(payload.get("recent_losses", 0) or 0), 5)),
        "open_pos_b": str(min(int(payload.get("open_positions", 0) or 0), 4)),
    }
    raw = _json.dumps(features, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

def _ai_cache_get(cache_key: str) -> Optional[dict]:
    _ai_cost_reset_if_new_day()
    item = _ai_cost_cache.get(cache_key)
    if not item:
        return None
    if time.time() - float(item.get("created_at", 0)) > AI_COST_CACHE_TTL_SECONDS:
        _ai_cost_cache.pop(cache_key, None)
        return None
    _ai_cost_stats["cache_hits"] += 1
    result = dict(item.get("result", {}))
    result["ai_status"] = "Cache Reuse"
    result["ai_cost"] = {
        "cache_hit": True,
        "cache_key": cache_key,
        "reason": "AI_COST_CACHE_HIT",
        "calls_today": _ai_cost_stats["calls"],
        "tokens_today": _ai_cost_stats["tokens"],
        "estimated_cost_today": round(_ai_cost_stats["estimated_cost"], 6),
    }
    logger.info("AI_COST_CACHE_HIT key=%s purpose=%s", cache_key, item.get("purpose", "?"))
    return result

def _ai_cache_put(cache_key: str, result: dict, purpose: str, tokens: int) -> None:
    _ai_cost_cache[cache_key] = {
        "created_at": time.time(),
        "result": result,
        "purpose": purpose,
        "tokens": tokens,
    }
    if len(_ai_cost_cache) > 500:
        oldest = sorted(_ai_cost_cache.items(), key=lambda kv: kv[1].get("created_at", 0))[:100]
        for key, _ in oldest:
            _ai_cost_cache.pop(key, None)

def _ai_account_key(account_id: str) -> str:
    return str(account_id or "").strip() or "_shared"

def _ai_account_bucket(account_id: str) -> dict:
    """Multi-instance fix: AI_COST_DAILY_CALL_LIMIT and AI_COST_MIN_SECONDS
    used to be enforced against one process-wide counter shared by every EA
    instance talking to this backend — as more instances were added they
    increasingly starved each other's AI opinions at random (the mechanism
    behind "one account takes a trade, another doesn't" that isn't explained
    by genuine strategic disagreement). Each account now gets its own daily
    budget and throttle. EA builds that don't yet send account_id share one
    "_shared" bucket, preserving the old (imperfect) behavior for them only —
    this is purely additive and backward compatible."""
    key = _ai_account_key(account_id)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    bucket = _ai_cost_stats_by_account.get(key)
    if not bucket or bucket.get("day") != today:
        bucket = {"day": today, "calls": 0, "last_call_at": 0.0}
        _ai_cost_stats_by_account[key] = bucket
    return bucket

def _ai_budget_allows(purpose: str, cache_key: str, high_impact: bool = False, account_id: str = "") -> tuple[bool, str]:
    _ai_cost_reset_if_new_day()
    bucket = _ai_account_bucket(account_id)
    if bucket["calls"] >= AI_COST_DAILY_CALL_LIMIT:
        _ai_cost_stats["skipped"] += 1
        return False, f"AI_COST_SKIP daily_limit {AI_COST_DAILY_CALL_LIMIT} reached (account={_ai_account_key(account_id)})"
    elapsed = time.time() - float(bucket.get("last_call_at", 0))
    if AI_COST_MIN_SECONDS > 0 and elapsed < AI_COST_MIN_SECONDS:
        _ai_cost_stats["skipped"] += 1
        impact = "high_impact" if high_impact else "normal"
        return False, f"AI_COST_SKIP throttle {elapsed:.1f}s < {AI_COST_MIN_SECONDS}s ({impact}; local rules continue, account={_ai_account_key(account_id)})"
    return True, "ok"

def _record_ai_cost(provider: str, model: str, prompt: str, response_text: str,
                    purpose: str, cache_key: str, reason: str, account_id: str = "") -> dict:
    _ai_cost_reset_if_new_day()
    tokens = _estimate_ai_tokens(prompt, response_text)
    cost = _estimate_ai_cost(tokens)
    _ai_cost_stats["calls"] += 1
    _ai_cost_stats["tokens"] += tokens
    _ai_cost_stats["estimated_cost"] = round(float(_ai_cost_stats["estimated_cost"]) + cost, 6)
    _ai_cost_stats["last_call_at"] = time.time()
    # multi-instance fix: bump this account's own budget/throttle bucket too
    account_bucket = _ai_account_bucket(account_id)
    account_bucket["calls"] += 1
    account_bucket["last_call_at"] = time.time()
    entry = {
        "ts": datetime.now(timezone.utc),
        "purpose": purpose,
        "provider": provider,
        "model": model,
        "tokens": tokens,
        "cost": cost,
        "reason": reason,
        "cache_key": cache_key,
    }
    _ai_cost_stats["reasons"].append(entry)
    _ai_cost_stats["reasons"] = _ai_cost_stats["reasons"][-50:]
    logger.info("AI_COST_CALL purpose=%s provider=%s model=%s tokens=%d cost=%.6f reason=%s",
                purpose, provider, model, tokens, cost, reason)
    return {
        "cache_hit": False,
        "cache_key": cache_key,
        "tokens": tokens,
        "estimated_cost": cost,
        "calls_today": _ai_cost_stats["calls"],
        "tokens_today": _ai_cost_stats["tokens"],
        "estimated_cost_today": round(_ai_cost_stats["estimated_cost"], 6),
        "reason": reason,
    }

def _ai_cost_snapshot() -> dict:
    _ai_cost_reset_if_new_day()
    return {
        "day": _ai_cost_stats["day"],
        "daily_call_limit": AI_COST_DAILY_CALL_LIMIT,
        "min_seconds": AI_COST_MIN_SECONDS,
        "cache_ttl_seconds": AI_COST_CACHE_TTL_SECONDS,
        "calls_today": _ai_cost_stats["calls"],
        "estimated_tokens_today": _ai_cost_stats["tokens"],
        "estimated_cost_today": round(_ai_cost_stats["estimated_cost"], 6),
        "cache_hits_today": _ai_cost_stats["cache_hits"],
        "skipped_today": _ai_cost_stats["skipped"],
        "recent_reasons": list(_ai_cost_stats["reasons"])[-20:],
    }

# -------------------------------------------------------------------
# AUTH HELPERS
# -------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(user_id: str, email: str) -> str:
    return jwt.encode({"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(hours=24), "type": "access"}, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_admin(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "): token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"email": payload.get("email")}, {"_id": 0, "password_hash": 0})
        if not user or user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# -------------------------------------------------------------------
# MODELS
# -------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str
    password: str

class EAConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Default Configuration"
    risk_percent: float = 1.0
    daily_loss_limit: float = 3.0
    weekly_drawdown_limit: float = 5.0
    weekly_profit_target: float = 35.0
    max_open_trades: int = 2
    max_trades_per_day: int = 3
    enable_trend_mode: bool = True
    enable_range_mode: bool = True
    enable_breakout_mode: bool = True
    confidence_threshold: int = 75
    ema_fast: int = 50
    ema_slow: int = 200
    min_rr_ratio: float = 1.5
    partial_close_percent: float = 50.0
    trailing_atr_multi: float = 1.5
    sl_atr_multiplier: float = 2.0
    trade_london: bool = True
    trade_new_york: bool = True
    equity_protection: float = 70.0
    profit_mode: str = "moderate"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class EAConfigCreate(BaseModel):
    name: Optional[str] = "Default Configuration"
    risk_percent: Optional[float] = 1.0
    daily_loss_limit: Optional[float] = 3.0
    weekly_drawdown_limit: Optional[float] = 5.0
    weekly_profit_target: Optional[float] = 35.0
    max_open_trades: Optional[int] = 2
    max_trades_per_day: Optional[int] = 3
    enable_trend_mode: Optional[bool] = True
    enable_range_mode: Optional[bool] = True
    enable_breakout_mode: Optional[bool] = True
    confidence_threshold: Optional[int] = 75
    ema_fast: Optional[int] = 50
    ema_slow: Optional[int] = 200
    min_rr_ratio: Optional[float] = 1.5
    partial_close_percent: Optional[float] = 50.0
    trailing_atr_multi: Optional[float] = 1.5
    sl_atr_multiplier: Optional[float] = 2.0
    trade_london: Optional[bool] = True
    trade_new_york: Optional[bool] = True
    equity_protection: Optional[float] = 70.0
    profit_mode: Optional[str] = "moderate"

class PinLicense(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pin: str
    buyer_name: str = ""
    buyer_email: str = ""
    is_active: bool = True
    is_used: bool = False
    activated_at: Optional[str] = None
    mt5_account: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    notes: str = ""
    payment_ref: Optional[str] = None

class PinGenerateRequest(BaseModel):
    count: int = 1
    buyer_name: Optional[str] = ""
    buyer_email: Optional[str] = ""
    notes: Optional[str] = ""

class PinValidateRequest(BaseModel):
    pin: str
    mt5_account: Optional[str] = ""

class PurchaseInitRequest(BaseModel):
    buyer_name: str
    buyer_email: str
    origin_url: str

class AdminSettingsUpdate(BaseModel):
    paystack_secret_key: Optional[str] = None
    pin_price_kobo: Optional[int] = None
    smtp_email: Optional[str] = None
    smtp_password: Optional[str] = None
    # v6.25.3 owner directive 2026-07-17 -- OneSignal REST API credentials.
    # Replaces self-hosted Web Push (pywebpush), which was permanently
    # blocked by a missing Python package in the deployed environment that
    # only a full backend rebuild could fix. OneSignal needs nothing but a
    # plain HTTPS POST (via `requests`, already installed and working), so
    # it can't fail the same way. onesignal_app_id is not secret (the
    # frontend SDK needs it directly); onesignal_api_key is.
    onesignal_app_id: Optional[str] = None
    onesignal_api_key: Optional[str] = None

class AdminAccountUpdate(BaseModel):
    new_email: Optional[str] = None
    new_password: Optional[str] = None
    current_password: str

class NombaConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: Optional[bool] = None
    environment: Optional[str] = None  # "sandbox" | "production"
    sandbox_client_id: Optional[str] = None
    sandbox_client_secret: Optional[str] = None
    sandbox_account_id: Optional[str] = None
    sandbox_webhook_signature_key: Optional[str] = None
    production_client_id: Optional[str] = None
    production_client_secret: Optional[str] = None
    production_account_id: Optional[str] = None
    production_webhook_signature_key: Optional[str] = None
    allowed_payment_methods: Optional[List[str]] = None
    currency: Optional[str] = None
    payment_description: Optional[str] = None
    # Required only when this request changes anything under "production"
    # (any production_* field, or environment -> "production") -- the
    # owner's spec calls for "fresh administrator authentication ... before
    # replacing production credentials", mirroring the existing
    # AdminAccountUpdate.current_password pattern used for email/password
    # changes (see update_admin_account() below).
    current_password: Optional[str] = None

# -------------------------------------------------------------------
# GOLD PRICE
# -------------------------------------------------------------------
_gold_cache: Dict = {}
_gold_cache_time: float = 0

async def fetch_live_gold_price() -> Dict:
    global _gold_cache, _gold_cache_time
    now = time.time()
    if now - _gold_cache_time < 30 and _gold_cache: return _gold_cache
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    price, change, change_pct = None, None, None
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            resp = await http.get("https://www.google.com/finance/quote/GCW00:COMEX", headers=headers, follow_redirects=True)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, 'lxml')
                pe = soup.find('div', class_='YMlKec fxKbKc')
                if pe:
                    try: price = float(pe.get_text(strip=True).replace('$','').replace(',',''))
                    except: pass
                for el in soup.find_all('div', class_='JwB6zf'):
                    t = el.get_text(strip=True)
                    if '%' in t or '$' in t:
                        for p in t.replace('$','').replace(',','').split():
                            c = p.replace('+','').replace('%','')
                            try:
                                v = float(c)
                                if '%' in p: change_pct = v
                                else: change = v
                            except: pass
                        break
    except Exception as e: logger.warning(f"Gold scrape: {e}")
    source = "live"
    if price is None:
        if _gold_cache and _gold_cache.get('available') and _gold_cache.get('bid'):
            return {**_gold_cache, "source": "cached_live", "stale": True}
        # Forensic repair: a failed quote provider is unavailable, not a
        # licence to invent a market price or spread. This endpoint is display
        # only; broker-reported prices remain the only execution authority.
        return {
            "symbol": "XAUUSD", "available": False, "bid": None, "ask": None,
            "spread": None, "change": None, "change_pct": None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "unavailable", "stale": False,
        }
    if change is None: change = 0.0
    if change_pct is None: change_pct = round(change/price*100, 3) if price else 0.0
    # The scraped source has no broker spread. Do not fabricate one.
    result = {"symbol":"XAUUSD","available":True,"bid":round(price,2),"ask":None,"spread":None,"change":round(change,2),"change_pct":round(change_pct,3),"timestamp":datetime.now(timezone.utc).isoformat(),"source":source,"stale":False}
    _gold_cache, _gold_cache_time = result, now
    return result

def generate_unique_pin():
    chars = string.ascii_uppercase + string.digits
    return f"ASE-{''.join(secrets.choice(chars) for _ in range(4))}-{''.join(secrets.choice(chars) for _ in range(4))}"

async def get_settings():
    s = await db.admin_settings.find_one({"key": "main"}, {"_id": 0})
    if not s:
        s = {"key": "main", "paystack_secret_key": os.environ.get('PAYSTACK_SECRET_KEY',''), "pin_price_kobo": int(os.environ.get('PAYSTACK_PIN_PRICE_KOBO','30000000')), "smtp_email": os.environ.get('SMTP_EMAIL',''), "smtp_password": os.environ.get('SMTP_PASSWORD','')}
        await db.admin_settings.insert_one(s)
        s.pop('_id', None)
    return s

# -------------------------------------------------------------------
# NOMBA PAYMENT CONFIG -- separate collection from admin_settings
# (which stores Paystack/SMTP/OneSignal as plaintext) because Nomba
# credentials are encrypted at rest via payment_crypto.py, per the
# owner's explicit spec for this migration. See
# audits/nomba_migration/03_implementation_notes.md for the full
# rationale.
# -------------------------------------------------------------------
_NOMBA_CONFIG_DEFAULT_METHODS = ["card", "transfer", "ussd", "qr"]

def _empty_nomba_env_block() -> dict:
    return {
        "client_id_enc": None, "client_secret_enc": None,
        "account_id_enc": None, "webhook_signature_key_enc": None,
        "last_validated_at": None, "last_validation_ok": None,
        "last_validation_error": None,
    }

async def get_nomba_config() -> dict:
    cfg = await db.payment_nomba_config.find_one({"key": "main"}, {"_id": 0})
    if not cfg:
        cfg = {
            "key": "main", "enabled": False, "environment": "sandbox",
            "sandbox": _empty_nomba_env_block(), "production": _empty_nomba_env_block(),
            "allowed_payment_methods": _NOMBA_CONFIG_DEFAULT_METHODS,
            "currency": "NGN", "payment_description": "XauCloud EA Lifetime License",
        }
        await db.payment_nomba_config.insert_one(cfg)
        cfg.pop('_id', None)
    return cfg

def _decrypt_nomba_env_block(env_block: dict, environment: str):
    """Returns a nomba_service.NombaCredentials or None if any required
    field is missing/unconfigured for this environment."""
    import payment_crypto as _pc
    import nomba_service as _nomba
    try:
        client_id = _pc.decrypt_secret(env_block.get("client_id_enc"))
        client_secret = _pc.decrypt_secret(env_block.get("client_secret_enc"))
        account_id = _pc.decrypt_secret(env_block.get("account_id_enc"))
        webhook_key = _pc.decrypt_secret(env_block.get("webhook_signature_key_enc"))
    except Exception as exc:
        logger.error(f"NOMBA_CONFIG_DECRYPT_FAILED env={environment}: {exc}")
        return None
    if not (client_id and client_secret and account_id):
        return None
    return _nomba.NombaCredentials(
        client_id=client_id, client_secret=client_secret, account_id=account_id,
        webhook_signature_key=webhook_key, environment=environment,
    )

async def get_active_nomba_credentials():
    """Returns (config_dict, NombaCredentials) for the currently active
    environment, or (config_dict, None) if Nomba is disabled or the
    active environment isn't fully configured yet. Never raises -- every
    caller (checkout init, webhook) must treat 'not configured' as a
    normal, handled state (503 to the customer), not a crash."""
    cfg = await get_nomba_config()
    if not cfg.get("enabled"):
        return cfg, None
    environment = cfg.get("environment", "sandbox")
    env_block = cfg.get(environment) or _empty_nomba_env_block()
    creds = _decrypt_nomba_env_block(env_block, environment)
    return cfg, creds

async def _log_nomba_config_audit(admin_email: str, changed_fields: list, environment: str, test_passed: Optional[bool]):
    await db.payment_config_audit_log.insert_one({
        "id": str(uuid.uuid4()),
        "provider": "NOMBA",
        "admin_email": admin_email,
        "changed_fields": changed_fields,  # field NAMES only, never values
        "environment": environment,
        "test_connection_passed": test_passed,
        "at": datetime.now(timezone.utc).isoformat(),
    })

async def _send_email(to_email: str, subject: str, html: str) -> bool:
    """v6.25.3 owner directive 2026-07-17 (Phase 6 P0) -- shared SMTP sender,
    extracted from send_pin_email's own inline logic so the new password-
    reset flow doesn't duplicate the same Gmail SMTP_SSL boilerplate."""
    settings = await get_settings()
    smtp_email = settings.get("smtp_email", "")
    smtp_password = settings.get("smtp_password", "")
    if not smtp_email or not smtp_password:
        logger.info(f"Email not configured. Message to {to_email} ({subject}) not sent.")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = smtp_email
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(smtp_email, smtp_password)
            server.sendmail(smtp_email, to_email, msg.as_string())
        logger.info(f"Email sent to {to_email}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False

async def send_pin_email(to_email: str, buyer_name: str, pin: str):
    html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#B8860B;">XauCloud EA - License PIN</h2>
<p>Hello {buyer_name or 'Trader'},</p>
<p>Thank you for your purchase! Here is your unique license PIN:</p>
<div style="background:#f5f5f5;border:2px solid #B8860B;padding:20px;text-align:center;margin:20px 0;">
<span style="font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:3px;">{pin}</span>
</div>
<p><strong>How to use:</strong></p>
<ol><li>Download the EA from our website</li><li>Install on MetaTrader 5 (follow our Setup Guide)</li><li>Enter this PIN in the EA settings</li><li>Enable Auto Trading and start!</li></ol>
<p style="color:#888;font-size:12px;">Keep this PIN private. Each PIN works on one MT5 account.</p>
</div>"""
    return await _send_email(to_email, "Your XauCloud EA License PIN", html)

# -------------------------------------------------------------------
# PUBLIC ROUTES
# -------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "XauCloud EA API v2.0"}

@api_router.get("/health")
async def health():
    return {"status": "ok"}

@api_router.get("/gold/price")
async def get_gold_price():
    return await fetch_live_gold_price()

# --- Admin MFA/TOTP (v6.25.3 owner directive 2026-07-17, Phase 6 P0) ------
# RFC 6238 TOTP, implemented with stdlib hmac/hashlib/base64/struct only --
# deliberately NOT a new pip dependency (pyotp etc.), for the same reason
# OneSignal replaced the self-hosted push system earlier this phase: a new
# package declared in requirements.txt but never actually installed in the
# deployed environment is exactly what caused a real production outage
# earlier in this project. This is ~20 lines of well-specified, easily
# tested math -- not worth that risk.
def _generate_totp_secret() -> str:
    import base64 as _b64
    return _b64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")

def _totp_code(secret_b32: str, for_time: float, period: int = 30, digits: int = 6) -> str:
    import base64 as _b64, struct as _struct
    key = _b64.b32decode(secret_b32 + "=" * ((8 - len(secret_b32) % 8) % 8), casefold=True)
    counter = int(for_time // period)
    msg = _struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = _struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10 ** digits)).zfill(digits)

def _verify_totp(secret_b32: str, code: str, window: int = 1, period: int = 30) -> bool:
    code = (code or "").strip()
    if not code.isdigit():
        return False
    now = time.time()
    return any(
        hmac.compare_digest(_totp_code(secret_b32, now + offset * period, period), code)
        for offset in range(-window, window + 1)
    )

def _admin_mfa_pending_token(email: str) -> str:
    # Keyed by email, not _id -- matches get_current_admin's own lookup
    # (db.users.find_one({"email": ...})), and avoids needing to parse a
    # stringified ObjectId back out of the JWT.
    return jwt.encode(
        {"email": email, "type": "admin_mfa_pending",
         "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        JWT_SECRET, algorithm=JWT_ALGORITHM)

def _issue_admin_session(user: dict) -> JSONResponse:
    token = create_access_token(str(user["_id"]), user["email"])
    response = JSONResponse(content={"email": user["email"], "name": user.get("name","Admin"), "role": user.get("role","admin")})
    # v6.5.0 (audit bug #9): secure=False meant the admin session cookie could
    # be sent over plain HTTP, exposing it to network interception. Default to
    # secure=True (safe for the production HTTPS deployment); COOKIE_SECURE=false
    # is available for local HTTP-only development.
    # v6.25.3 owner directive 2026-07-17 (Phase 6 P0 -- CSRF hardening) --
    # strict rather than lax: the admin portal has no legitimate top-level
    # cross-site navigation into an authenticated action, so there's no
    # workflow this can break, and it closes the (already narrow, since
    # every mutating admin route is POST/PUT/DELETE which lax already
    # blocks cross-site) remaining edge case around lax's top-level-GET
    # allowance.
    response.set_cookie(key="access_token", value=token, httponly=True,
                        secure=os.environ.get('COOKIE_SECURE', 'true').lower() != 'false',
                        samesite="strict", max_age=86400, path="/")
    return response

# --- Auth ---
@api_router.post("/auth/login")
async def login(req: LoginRequest, request: Request):
    # v6.25.3 owner directive 2026-07-17 (Phase 6 P0) -- rate-limited by both
    # IP and the targeted email, so an attacker can't dodge the IP limit by
    # spraying many emails from one address, nor dodge the email limit by
    # rotating IPs against one known admin account.
    ip = _client_ip(request)
    _rate_limit(f"admin_login_ip:{ip}", max_requests=10, window_seconds=300)
    _rate_limit(f"admin_login_email:{req.email.lower()}", max_requests=5, window_seconds=300)
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        await db.login_audit_log.insert_one({
            "id": str(uuid.uuid4()), "email": req.email.lower(), "ip": ip, "ok": False,
            "role": "admin", "ts": datetime.now(timezone.utc),
        })
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("mfa_enabled"):
        # Password correct, but the session isn't issued until the TOTP
        # code is also verified via /auth/login/mfa -- audit-logged as a
        # distinct "password_ok_awaiting_mfa" entry, not a full success.
        await db.login_audit_log.insert_one({
            "id": str(uuid.uuid4()), "email": user["email"], "ip": ip, "ok": False,
            "role": "admin", "ts": datetime.now(timezone.utc), "stage": "password_ok_awaiting_mfa",
        })
        return {"mfa_required": True, "mfa_token": _admin_mfa_pending_token(user["email"])}
    await db.login_audit_log.insert_one({
        "id": str(uuid.uuid4()), "email": user["email"], "ip": ip, "ok": True,
        "role": "admin", "ts": datetime.now(timezone.utc),
    })
    return _issue_admin_session(user)

class AdminMfaLoginReq(BaseModel):
    mfa_token: str
    code: str

@api_router.post("/auth/login/mfa")
async def login_mfa(req: AdminMfaLoginReq, request: Request):
    ip = _client_ip(request)
    _rate_limit(f"admin_mfa_ip:{ip}", max_requests=10, window_seconds=300)
    try:
        payload = jwt.decode(req.mfa_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="MFA session expired. Log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid MFA session.")
    if payload.get("type") != "admin_mfa_pending":
        raise HTTPException(status_code=401, detail="Invalid MFA session.")
    user = await db.users.find_one({"email": payload.get("email")})
    if not user or not user.get("mfa_enabled") or not user.get("mfa_secret_enc"):
        raise HTTPException(status_code=401, detail="MFA is not active on this account.")
    _rate_limit(f"admin_mfa_email:{user['email']}", max_requests=8, window_seconds=300)
    secret = _cloud_decrypt(user["mfa_secret_enc"])
    if not secret or not _verify_totp(secret, req.code):
        await db.login_audit_log.insert_one({
            "id": str(uuid.uuid4()), "email": user["email"], "ip": ip, "ok": False,
            "role": "admin", "ts": datetime.now(timezone.utc), "stage": "mfa_code_rejected",
        })
        raise HTTPException(status_code=401, detail="Incorrect code.")
    await db.login_audit_log.insert_one({
        "id": str(uuid.uuid4()), "email": user["email"], "ip": ip, "ok": True,
        "role": "admin", "ts": datetime.now(timezone.utc), "stage": "mfa_verified",
    })
    return _issue_admin_session(user)

class AdminMfaEnableReq(BaseModel):
    code: str

class AdminMfaDisableReq(BaseModel):
    password: str
    code: str

@api_router.post("/auth/mfa/setup")
async def admin_mfa_setup(admin: dict = Depends(get_current_admin)):
    """Generates a NEW pending secret every call (not yet enabled) -- lets
    the admin re-scan if a previous setup attempt was abandoned, without
    ever activating a secret the admin never confirmed possession of."""
    secret = _generate_totp_secret()
    await db.users.update_one({"email": admin["email"]},
                               {"$set": {"mfa_pending_secret_enc": _cloud_encrypt(secret)}})
    issuer = "XauCloudAdmin"
    label = admin.get("email", "admin")
    otpauth_uri = f"otpauth://totp/{issuer}:{label}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30"
    return {"secret": secret, "otpauth_uri": otpauth_uri}

@api_router.post("/auth/mfa/enable")
async def admin_mfa_enable(req: AdminMfaEnableReq, admin: dict = Depends(get_current_admin)):
    # get_current_admin projects _id/password_hash out but not other
    # fields -- mfa_pending_secret_enc is present on `admin` if set.
    pending = admin.get("mfa_pending_secret_enc")
    if not pending:
        raise HTTPException(status_code=400, detail="No MFA setup in progress. Call /auth/mfa/setup first.")
    secret = _cloud_decrypt(pending)
    if not secret or not _verify_totp(secret, req.code):
        raise HTTPException(status_code=400, detail="Incorrect code. Scan the QR code again and try the current 6-digit code.")
    await db.users.update_one(
        {"email": admin["email"]},
        {"$set": {"mfa_enabled": True, "mfa_secret_enc": pending}, "$unset": {"mfa_pending_secret_enc": ""}})
    return {"ok": True, "message": "MFA enabled."}

@api_router.post("/auth/mfa/disable")
async def admin_mfa_disable(req: AdminMfaDisableReq, admin: dict = Depends(get_current_admin)):
    # get_current_admin strips password_hash from its projection, so
    # re-fetch the full document here rather than trusting a stripped copy.
    full = await db.users.find_one({"email": admin["email"]})
    if not full or not verify_password(req.password, full.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    secret = _cloud_decrypt(full.get("mfa_secret_enc", ""))
    if not full.get("mfa_enabled") or not secret or not _verify_totp(secret, req.code):
        raise HTTPException(status_code=400, detail="Incorrect code.")
    await db.users.update_one(
        {"email": admin["email"]},
        {"$set": {"mfa_enabled": False}, "$unset": {"mfa_secret_enc": "", "mfa_pending_secret_enc": ""}})
    return {"ok": True, "message": "MFA disabled."}

@api_router.get("/auth/me")
async def auth_me(admin: dict = Depends(get_current_admin)):
    return admin

@api_router.post("/auth/logout")
async def logout():
    response = JSONResponse(content={"message": "Logged out"})
    response.delete_cookie("access_token", path="/")
    return response

# --- PIN Validate (public - EA calls this) ---
@api_router.post("/pins/validate")
async def validate_pin(req: PinValidateRequest):
    """v6.25.3 owner directive 2026-07-17 (Phase 4 P0) -- was its own
    separate, incomplete implementation: it bound mt5_account ONLY on the
    very first call (is_used was still false) and then, on every
    subsequent call for that same PIN, returned {"valid": true} with NO
    account check at all -- meaning a PIN could be validated successfully
    on an unlimited number of different MT5 accounts after its first
    activation, not just the one it was actually sold for. Now routes
    through _resolve_monitor_license(), the same canonical, atomic-
    first-claim, fail-closed-on-mismatch license authority every other
    EA-facing endpoint (heartbeat, activity, thesis status, direction
    reservation, command polling, download authorization) already uses."""
    try:
        lic = await _resolve_monitor_license(req.pin, req.mt5_account or "")
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        return {"valid": False, "reason": detail.get("message") or detail.get("reason") or "License check failed"}
    return {"valid": True, "pin": lic.get("pin", req.pin), "message": "License verified"}

# --- Purchase (public) ---
@api_router.get("/purchase/price")
async def get_pin_price():
    s = await get_settings()
    kobo = s.get("pin_price_kobo", 30000000)
    naira = kobo / 100
    nomba_cfg, nomba_creds = await get_active_nomba_credentials()
    return {
        "price_kobo": kobo, "price_naira": naira, "currency": "NGN",
        "payment_method": "nomba" if nomba_creds else "unavailable",
        "formatted": f"\u20a6{naira:,.0f}",
    }

@api_router.post("/purchase/initialize")
async def initialize_purchase(req: PurchaseInitRequest, request: Request):
    # v-nomba-migration owner directive -- Paystack is no longer the
    # active payment provider for new purchases (historical Paystack
    # transactions/licenses are untouched -- see
    # audits/nomba_migration/01_paystack_audit.md). This endpoint now
    # creates a Nomba checkout order exclusively; if Nomba isn't enabled
    # and fully configured, it fails closed with 503 rather than ever
    # falling back to Paystack for a new sale.
    _rate_limit(f"purchase_init_ip:{_client_ip(request)}", max_requests=10, window_seconds=600)
    nomba_cfg, creds = await get_active_nomba_credentials()
    if not creds:
        raise HTTPException(status_code=503, detail="Payment system not configured yet.")
    kobo = (await get_settings()).get("pin_price_kobo", 30000000)
    naira = kobo / 100
    ref = f"ASE-{uuid.uuid4().hex[:12].upper()}"
    # Same discipline as the pre-existing Paystack code this replaces:
    # callback_url is built ONLY from the operator-controlled
    # PUBLIC_SITE_URL, never from req.origin_url -- a client-supplied
    # origin_url would let any caller redirect the post-payment browser
    # flow to an arbitrary attacker-controlled domain.
    callback_url = f"{PUBLIC_SITE_URL}/purchase/success?reference={ref}"
    tx = {"id": str(uuid.uuid4()), "reference": ref, "amount_kobo": kobo, "currency": "NGN",
          "provider": "NOMBA", "nomba_order_reference": ref, "nomba_transaction_id": None,
          "buyer_name": req.buyer_name, "buyer_email": req.buyer_email,
          "payment_status": "PENDING", "pin_generated": None,
          "created_at": datetime.now(timezone.utc).isoformat(), "state_transitions": {}}
    await db.payment_transactions.insert_one(tx)

    import nomba_service as _nomba
    try:
        result = await _nomba.create_checkout_order(
            creds, order_reference=ref, amount=naira, currency=nomba_cfg.get("currency", "NGN"),
            callback_url=callback_url, customer_email=req.buyer_email,
            allowed_payment_methods=nomba_cfg.get("allowed_payment_methods") or None,
            idempotency_key=ref,
        )
    except _nomba.NombaError as exc:
        logger.error(f"NOMBA_INITIALIZE_FAILED ref={ref}: {exc}")
        raise HTTPException(status_code=502, detail="Payment init failed") from exc
    return {"authorization_url": result["checkout_link"], "reference": result["order_reference"]}


def _verify_paystack_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    """HMAC-SHA512 over the raw (unparsed) request body, exactly as Paystack
    signs it -- must be computed before the body is JSON-decoded, since any
    re-serialization can change byte-for-byte formatting and silently break
    the comparison. Constant-time compare so timing cannot leak a partial
    match."""
    if not signature or not secret:
        return False
    computed = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(computed, signature)


async def _transition_payment_state(reference: str, from_states: list, to_state: str) -> bool:
    """Atomic state transition, single source of truth for the payment state
    machine (PENDING -> VERIFYING -> PAID -> FULFILLING -> FULFILLED). The
    MongoDB filter (reference + current state IN from_states) IS the
    concurrency control: only the one caller whose update actually matches
    a document performs the transition -- every other concurrent caller
    (e.g. the webhook and the browser's polling verify racing each other)
    gets modified_count == 0 and must not proceed as if it won."""
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.payment_transactions.update_one(
        {"reference": reference, "payment_status": {"$in": from_states}},
        {"$set": {"payment_status": to_state, f"state_transitions.{to_state}": now_iso}},
    )
    won = result.modified_count == 1
    logger.info(f"PAYMENT_STATE_TRANSITION ref={reference} to={to_state} won={won}")
    return won


async def _fulfill_payment(reference: str, source: str) -> dict:
    """Single canonical fulfillment path -- used by BOTH the webhook and the
    browser's /purchase/verify polling, so there is exactly one place that
    can ever generate a PIN for a payment reference. Verifies the real
    transaction status, amount, and currency against Paystack's own
    transaction/verify API before ever creating a license -- never trusts
    the webhook body's claims alone, even after signature verification.
    Never creates a license when verification is unavailable (missing
    secret key, network failure, non-200 response) -- returns "pending"
    instead of silently defaulting to success."""
    tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
    if not tx:
        logger.warning(f"PAYSTACK_FULFILL_UNKNOWN_REFERENCE ref={reference} source={source}")
        return {"status": "not_found"}
    if tx.get("pin_generated") and tx.get("payment_status") == "FULFILLED":
        return {"status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}

    won_verifying = await _transition_payment_state(reference, ["PENDING"], "VERIFYING")
    if not won_verifying:
        # Someone else already claimed verification for this reference (or
        # it's further along already) -- reread current truth, never
        # double-process.
        tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
        if tx and tx.get("pin_generated"):
            return {"status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}
        return {"status": "pending"}

    s = await get_settings()
    pk = s.get("paystack_secret_key", "")
    if not pk:
        logger.error(f"PAYSTACK_FULFILL_NO_SECRET_KEY ref={reference}")
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.get(f"{PAYSTACK_BASE_URL}/transaction/verify/{reference}", headers={"Authorization": f"Bearer {pk}"})
    except Exception as e:
        logger.error(f"PAYSTACK_VERIFY_CALL_FAILED ref={reference}: {e}")
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}

    if resp.status_code != 200:
        logger.warning(f"PAYSTACK_VERIFY_NON_200 ref={reference} status={resp.status_code}")
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}

    data = resp.json()
    vdata = data.get("data", {}) if data.get("status") else {}
    if vdata.get("status") != "success":
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}

    # Cross-check the REAL paid amount/currency against what WE expect for
    # this specific transaction -- refuses an under-paid, over-refunded, or
    # wrong-currency transaction even though Paystack itself reports
    # status=success (e.g. a partial/split payment scenario).
    expected_amount = tx.get("amount_kobo", 0)
    expected_currency = tx.get("currency", "NGN")
    paid_amount = vdata.get("amount", 0)
    paid_currency = vdata.get("currency", "")
    if paid_amount < expected_amount or paid_currency != expected_currency:
        logger.error(f"PAYSTACK_AMOUNT_MISMATCH ref={reference} expected={expected_amount}{expected_currency} paid={paid_amount}{paid_currency}")
        await _transition_payment_state(reference, ["VERIFYING"], "REJECTED_AMOUNT_MISMATCH")
        return {"status": "failed", "reason": "amount_mismatch"}

    await _transition_payment_state(reference, ["VERIFYING"], "PAID")
    won_fulfilling = await _transition_payment_state(reference, ["PAID"], "FULFILLING")
    if not won_fulfilling:
        tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
        if tx and tx.get("pin_generated"):
            return {"status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}
        return {"status": "pending"}

    pin = generate_unique_pin()
    while await db.pin_licenses.find_one({"pin": pin}):
        pin = generate_unique_pin()
    doc = PinLicense(pin=pin, buyer_name=tx.get("buyer_name", ""), buyer_email=tx.get("buyer_email", ""),
                      notes=f"{source} - {reference}", payment_ref=reference).model_dump()
    try:
        await db.pin_licenses.insert_one(doc)
    except DuplicateKeyError:
        # The unique index on pin_licenses.payment_ref caught a genuine
        # double-fulfillment attempt that the state-machine transition
        # somehow still let through (defense-in-depth, not the primary
        # guard) -- reread the actual winner's PIN instead of erroring.
        existing = await db.pin_licenses.find_one({"payment_ref": reference})
        pin = existing["pin"] if existing else pin
    await db.payment_transactions.update_one(
        {"reference": reference}, {"$set": {"pin_generated": pin, "payment_status": "FULFILLED"}})
    await send_pin_email(tx.get("buyer_email", ""), tx.get("buyer_name", ""), pin)
    logger.info(f"PAYSTACK_FULFILLED ref={reference} source={source}")
    return {"status": "success", "pin": pin, "buyer_name": tx.get("buyer_name", "")}


async def _fulfill_nomba_payment(reference: str, source: str) -> dict:
    """Nomba's equivalent of _fulfill_payment() above -- deliberately
    mirrors its exact state-machine/idempotency structure (same
    _transition_payment_state helper, same PENDING->VERIFYING->PAID->
    FULFILLING->FULFILLED flow, same unique-index-on-payment_ref
    defense-in-depth) rather than inventing a parallel pattern. Only the
    "how do we ask the provider whether this really succeeded" step
    differs: nomba_service.verify_transaction() instead of a direct
    Paystack HTTP call. Never trusts a webhook body's claims alone, even
    after signature verification -- always re-verifies directly with
    Nomba first."""
    tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
    if not tx:
        logger.warning(f"NOMBA_FULFILL_UNKNOWN_REFERENCE ref={reference} source={source}")
        return {"status": "not_found"}
    if tx.get("pin_generated") and tx.get("payment_status") == "FULFILLED":
        return {"status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}

    won_verifying = await _transition_payment_state(reference, ["PENDING"], "VERIFYING")
    if not won_verifying:
        tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
        if tx and tx.get("pin_generated"):
            return {"status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}
        return {"status": "pending"}

    _cfg, creds = await get_active_nomba_credentials()
    if not creds:
        logger.error(f"NOMBA_FULFILL_NOT_CONFIGURED ref={reference}")
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}

    import nomba_service as _nomba
    try:
        result = await _nomba.verify_transaction(creds, order_reference=reference)
    except _nomba.NombaError as exc:
        logger.error(f"NOMBA_VERIFY_CALL_FAILED ref={reference}: {exc}")
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}

    if result.status == "NOT_FOUND":
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}
    if result.status != "SUCCESS":
        await _transition_payment_state(reference, ["VERIFYING"], "PENDING")
        return {"status": "pending"}

    # Cross-check the REAL paid amount/currency against what WE expect --
    # same discipline as PAYSTACK_AMOUNT_MISMATCH above. tx.amount_kobo is
    # kobo; Nomba's verified amount is in naira (major units).
    expected_naira = tx.get("amount_kobo", 0) / 100
    expected_currency = tx.get("currency", "NGN")
    if result.amount is None or result.amount < expected_naira - 0.01 or (result.currency and result.currency != expected_currency):
        logger.error(
            f"NOMBA_AMOUNT_MISMATCH ref={reference} expected={expected_naira}{expected_currency} "
            f"paid={result.amount}{result.currency}"
        )
        await _transition_payment_state(reference, ["VERIFYING"], "REJECTED_AMOUNT_MISMATCH")
        return {"status": "failed", "reason": "amount_mismatch"}

    await _transition_payment_state(reference, ["VERIFYING"], "PAID")
    won_fulfilling = await _transition_payment_state(reference, ["PAID"], "FULFILLING")
    if not won_fulfilling:
        tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
        if tx and tx.get("pin_generated"):
            return {"status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}
        return {"status": "pending"}

    pin = generate_unique_pin()
    while await db.pin_licenses.find_one({"pin": pin}):
        pin = generate_unique_pin()
    doc = PinLicense(pin=pin, buyer_name=tx.get("buyer_name", ""), buyer_email=tx.get("buyer_email", ""),
                      notes=f"{source} - {reference}", payment_ref=reference).model_dump()
    doc["provider"] = "NOMBA"
    try:
        await db.pin_licenses.insert_one(doc)
    except DuplicateKeyError:
        existing = await db.pin_licenses.find_one({"payment_ref": reference})
        pin = existing["pin"] if existing else pin
    await db.payment_transactions.update_one(
        {"reference": reference},
        {"$set": {"pin_generated": pin, "payment_status": "FULFILLED", "nomba_transaction_id": result.nomba_transaction_id}},
    )
    await send_pin_email(tx.get("buyer_email", ""), tx.get("buyer_name", ""), pin)
    logger.info(f"NOMBA_FULFILLED ref={reference} source={source}")
    return {"status": "success", "pin": pin, "buyer_name": tx.get("buyer_name", "")}


@api_router.get("/purchase/verify/{reference}")
async def verify_purchase(reference: str, request: Request):
    # Generous window -- the frontend legitimately polls this every few
    # seconds while a real customer waits for their payment to confirm.
    _rate_limit(f"purchase_verify_ip:{_client_ip(request)}", max_requests=60, window_seconds=60)
    tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0, "provider": 1})
    provider = (tx or {}).get("provider", "PAYSTACK")  # pre-migration rows have no provider field -> PAYSTACK
    fulfill_fn = _fulfill_nomba_payment if provider == "NOMBA" else _fulfill_payment
    result = await fulfill_fn(reference, source="poll")
    if result["status"] == "success":
        return {"status": "success", "payment_status": "success", "pin": result["pin"], "buyer_name": result.get("buyer_name", "")}
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "pending", "payment_status": "pending", "pin": None}


@api_router.post("/webhook/paystack")
async def paystack_webhook(request: Request):
    # v6.25.3 owner directive 2026-07-17 (Phase 2 P0) -- this endpoint used
    # to trust an unsigned charge.success POST body outright: any caller who
    # knew (or brute-forced/observed) a real reference could POST a forged
    # webhook here and get a real license generated for free, with no
    # signature check and no amount/currency cross-check. Now: (1) verify
    # the raw body's HMAC-SHA512 against Paystack's own secret before
    # touching the body at all, reject with 401 otherwise; (2) never trust
    # the webhook body's claims directly -- _fulfill_payment() re-verifies
    # the real transaction status/amount/currency against Paystack's own
    # transaction/verify API before ever creating a license.
    raw_body = await request.body()
    signature = request.headers.get("x-paystack-signature", "")
    s = await get_settings()
    secret = s.get("paystack_secret_key", "")
    if not _verify_paystack_signature(raw_body, signature, secret):
        client_host = request.client.host if request.client else "unknown"
        logger.warning(f"PAYSTACK_WEBHOOK_SIGNATURE_INVALID ip={client_host}")
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        body = _json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if body.get("event") != "charge.success":
        return {"status": "ignored"}
    ref = body.get("data", {}).get("reference", "")
    if not ref:
        raise HTTPException(status_code=400, detail="Missing reference")
    await _fulfill_payment(ref, source="webhook")
    return {"status": "ok"}


@api_router.post("/webhook/nomba")
async def nomba_webhook(request: Request):
    """Mirrors paystack_webhook()'s exact safety discipline: (1) verify
    the signature BEFORE trusting anything in the body, reject with 401
    otherwise; (2) never trust the webhook body's own claims about
    success -- _fulfill_nomba_payment() always re-verifies the real
    transaction status/amount/currency directly against Nomba's own API.
    A valid signature only proves the request came from Nomba; it does
    not, by itself, prove the payment is real, current, or unprocessed.

    Always returns a 2XX once the payload is structurally valid and
    routed to fulfilment, even for events we don't act on (payout_*) or
    already-fulfilled duplicates -- Nomba retries on any non-2XX with
    exponential backoff (up to 5 times over ~53 minutes, per
    audits/nomba_migration/02_nomba_api_reference.md), and retrying an
    already-handled event serves no purpose."""
    raw_body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    signature = headers.get("nomba-signature", "")
    timestamp = headers.get("nomba-timestamp", "")

    try:
        body = _json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = body.get("event_type", "")
    order_ref = None
    import nomba_service as _nomba
    try:
        order_ref = _nomba.extract_order_reference(body)
    except Exception:
        pass

    # Determine which environment's webhook signature key to check
    # against by looking up the pending transaction's own environment --
    # but the transaction lookup itself must never happen before a valid
    # signature, so first try BOTH configured environments' keys (a
    # merchant only ever has webhooks pointed at one active environment
    # at a time in practice, but checking both is cheap and avoids a
    # chicken-and-egg problem between "which env is this for" and "is
    # the signature even valid").
    cfg = await get_nomba_config()
    sig_fields = _nomba.extract_webhook_signature_fields(body)
    valid = False
    for env_name in ("sandbox", "production"):
        env_block = cfg.get(env_name) or {}
        creds = _decrypt_nomba_env_block(env_block, env_name)
        if not creds or not creds.webhook_signature_key:
            continue
        if _nomba.verify_webhook_signature(
            signature_header=signature, timestamp_header=timestamp,
            webhook_signature_key=creds.webhook_signature_key, **sig_fields,
        ):
            valid = True
            break

    if not valid:
        client_host = request.client.host if request.client else "unknown"
        logger.warning(f"NOMBA_WEBHOOK_SIGNATURE_INVALID ip={client_host} event={event_type} ref={order_ref}")
        raise HTTPException(status_code=401, detail="Invalid signature")

    if event_type not in ("payment_success", "payment_failed", "payment_reversal"):
        # payout_success/payout_failed/payout_refund describe money
        # leaving Nomba's account -- not relevant to this inbound-only
        # checkout integration. Acknowledge with 2XX so Nomba doesn't
        # retry an event we deliberately never act on.
        return {"status": "ignored"}
    if not order_ref:
        raise HTTPException(status_code=400, detail="Missing order reference")

    if event_type == "payment_success":
        await _fulfill_nomba_payment(order_ref, source="webhook")
    elif event_type == "payment_failed":
        await _transition_payment_state(order_ref, ["PENDING", "VERIFYING"], "FAILED")
        logger.info(f"NOMBA_PAYMENT_FAILED_WEBHOOK ref={order_ref}")
    elif event_type == "payment_reversal":
        # A reversal must never remain displayed as a successful settled
        # payment -- flip status to REVERSED regardless of current state
        # (a reversal can arrive after FULFILLED) and flag for admin
        # review. Does not touch the already-issued PIN/license record --
        # per the owner's spec, no automatic destruction of customer data;
        # manual review decides next steps.
        await db.payment_transactions.update_one(
            {"reference": order_ref},
            {"$set": {"payment_status": "REVERSED", "state_transitions.REVERSED": datetime.now(timezone.utc).isoformat()}},
        )
        await db.pin_licenses.update_many(
            {"payment_ref": order_ref}, {"$set": {"review_required": True, "review_reason": "PAYMENT_REVERSED"}},
        )
        logger.warning(f"NOMBA_PAYMENT_REVERSAL ref={order_ref} -- license flagged review_required")
    return {"status": "ok"}

# --- Public Docs ---
def _get_ea_meta(src: str, filename_prefix: str = "XAUUSD_AI_Sniper_EA") -> dict:
    """Extract version, edition tag, and build display name from EA header comments."""
    import re, hashlib
    # Match e.g. "v6.3.6 — AI Director + ML Warm-Start + Adaptive Exits"
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', src[:3000])
    version = f"v{m.group(1)}" if m else "v6.x.x"
    edition_full = m.group(2).strip().rstrip("|").strip() if m else "AI Director"
    # Slug for filename: keep only alpha/digits, collapse to underscores
    edition_slug = re.sub(r'[^A-Za-z0-9]+', '_', edition_full).strip('_').upper()
    filename = f"{filename_prefix}_{version}_{edition_slug}.mq5"
    checksum = hashlib.sha256(src.encode()).hexdigest()[:12]
    return {"version": version, "edition": edition_full, "filename": filename, "checksum": checksum}

# v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired
# _sanitize_ea_for_customer() -- was already dead code (no call sites) even
# before this cleanup; it stripped InpCloudFanout/InpCloudAgentToken from
# the master-fanout EA input block, which belonged to the deleted
# copy-trading subsystem.

# ---------------------------------------------------------------------------
# v6.25.3 owner directive 2026-07-17 (Phase 3 P0, final pre-launch hardening)
# -- STOP PUBLIC MQ5 SOURCE DISTRIBUTION. /download/ea and /download/package
# used to serve the full (sanitized-of-secrets-only) MQ5 SOURCE CODE to any
# anonymous visitor -- no auth, no license check, the entire strategy's IP
# was one click away for anyone who found the URL. Required flow now:
# authenticated Command Center user -> active paid license belonging to
# that user -> short-lived one-time signed download token -> compiled EX5
# release artifact. MQ5 source and the admin master EX5 remain admin-only
# (unchanged, see admin_download_ea_master below).
#
# The compiled EX5 is a checked-in release artifact (backend/ea_releases/),
# not something this backend compiles on demand -- there is no MetaEditor/
# Wine available in the deployed backend environment. Each release's EX5 is
# compiled during development (0 errors/0 warnings, hash-verified against
# the exact source commit) and committed alongside a manifest entry; this
# mirrors how every EA version this project has shipped was actually built.
# ---------------------------------------------------------------------------
EA_RELEASES_DIR = ROOT_DIR / "ea_releases"
DOWNLOAD_TOKEN_TTL_SECONDS = 300  # short-lived, single-purpose, not a session token


def _load_ea_release_manifest() -> dict:
    p = EA_RELEASES_DIR / "manifest.json"
    if not p.exists():
        return {}
    try:
        return _json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"EA_RELEASE_MANIFEST_PARSE_FAILED: {e}")
        return {}


def _current_ea_release() -> Optional[dict]:
    """The one function every version-facing surface (download, Command
    Center display, fulfillment email) must call -- never read
    manifest['current_version'] directly. Fails closed: a release is only
    ever treated as current if it's both pointed to by current_version AND
    explicitly marked stable_status=true. This matters because
    current_version and the releases dict are edited independently (e.g. by
    the CI auto-promotion workflow); a release that fails validation there
    must never become servable just because current_version still points at
    it from a prior, now-stale state."""
    manifest = _load_ea_release_manifest()
    current = manifest.get("current_version")
    if not current:
        return None
    release = manifest.get("releases", {}).get(current)
    if not release:
        return None
    if not release.get("stable_status"):
        logger.error(f"EA_RELEASE_CURRENT_VERSION_NOT_STABLE version={current} -- refusing to serve/display it")
        return None
    return release


# ---------------------------------------------------------------------------
# Public (customer-facing) release identity -- the Command Center header must
# never render whatever internal build/experiment string the currently
# attached EA happens to self-report in its heartbeat (e.g.
# "V6.25.24_M10_FIXED10SL_EXPERIMENT"). It must show a short, stable
# "XauCloud-<version>" derived from the one authoritative release manifest
# (backend/ea_releases/manifest.json), independent of live EA telemetry.
# Raw EA-reported build details remain available separately for Support
# Diagnostics/admin use -- never hidden, just not the customer headline.
# ---------------------------------------------------------------------------

PRODUCTION_TIMEFRAME = "M10"  # the only authoritative production decision mode; see manifest release notes


def _normalize_release_version(v: str) -> str:
    raw = str(v or "").strip()
    # The EA reports a product-qualified identity such as
    # XauCloud-m10_v6.25.30_PURE_M10_CYCLE_AUTHORITY_FIX. The public release
    # manifest intentionally uses only the stable numeric version.
    marker = raw.lower().rfind("_v")
    if marker >= 0:
        raw = raw[marker + 2:]
    return raw.lstrip("vV").split("_", 1)[0]


def _known_release_versions() -> set:
    manifest = _load_ea_release_manifest()
    return {_normalize_release_version(v) for v in (manifest.get("releases") or {}).keys()}


def build_public_release_display(ea_version: str) -> dict:
    """Authoritative publicProductName/publicVersion/publicDisplayName. Adding
    a new release to manifest.json is the only thing that changes what this
    renders -- no frontend component hardcodes a version string."""
    release = _current_ea_release()
    public_version = _normalize_release_version((release or {}).get("version") or "")
    reported = _normalize_release_version(ea_version)
    recognized = bool(reported) and reported in _known_release_versions()
    return {
        "public_product_name": "XauCloud",
        "public_version": public_version or None,
        "public_display_name": f"XauCloud-{public_version}" if public_version else "XauCloud",
        "reported_build_recognized": recognized,
    }


def reconcile_production_timeframe(reported_timeframe: str, build_recognized: bool) -> dict:
    """Prevents an unrecognized/experimental attached EA build from
    overwriting the customer-facing production timeframe status. The product
    is M10-only; a mismatch is real diagnostic signal (worth surfacing to
    Support Diagnostics, never silently discarded) but must never be
    displayed to a customer as if it were the legitimate live status --
    so the customer-facing value always falls back to the authoritative
    PRODUCTION_TIMEFRAME whenever the reported value can't be trusted."""
    reported = str(reported_timeframe or "").strip().upper()
    mismatch = bool(reported) and reported != PRODUCTION_TIMEFRAME
    trust_reported = build_recognized and not mismatch
    return {
        "display_timeframe": reported if trust_reported else PRODUCTION_TIMEFRAME,
        "reported_timeframe": reported or None,
        "timeframe_mismatch": mismatch,
        "build_recognized": build_recognized,
    }


@api_router.get("/download/info")
async def download_info():
    """PUBLIC metadata only -- version, checksum, release notes, whether a
    download is currently available. Never reads or exposes source code;
    reads only the release manifest (backend/ea_releases/manifest.json)."""
    release = _current_ea_release()
    if not release:
        return {"available": False, "reason": "NO_RELEASE_PUBLISHED"}
    return {
        "available": True,
        "version": release["version"],
        "edition": release["edition"],
        "filename": release["customer_filename"],
        "checksum_sha256_12": release["ex5_sha256"][:12],
        "checksum_sha256": release["ex5_sha256"],
        "release_notes": release.get("release_notes", ""),
        "build_timestamp": release.get("build_timestamp"),
        "stable": bool(release.get("stable_status", False)),
        "requires_login": True,
        "download_url": "/command",  # customer flow now goes through Command Center, not a direct link
    }
# NOTE: POST /download/request-token is defined further down in this file,
# right after _get_user_license() and get_cloud_user() both exist -- it
# depends on get_cloud_user via FastAPI's Depends(), which is resolved at
# decoration time, so it cannot be defined lexically before that name
# exists in the module.


@api_router.get("/download/ea-release")
async def download_ea_release(token: str):
    """Serves the compiled EX5 release artifact -- never MQ5 source -- only
    to a caller presenting a valid, unexpired, single-purpose token minted
    by request_ea_download_token() above for a currently-active license.
    Logs every real download (license id, never the raw PIN; see the
    "without exposing the PIN" requirement) for audit."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Download link expired -- request a new one from Command Center.")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid download token.")
    if payload.get("sub") != "ea_download":
        raise HTTPException(status_code=401, detail="Invalid download token.")
    license_id = payload.get("license_id", "")
    lic = await db.pin_licenses.find_one({"id": license_id, "is_active": True}, {"_id": 0})
    if not lic:
        raise HTTPException(status_code=403, detail="License is no longer active.")
    version = payload.get("version", "")
    release = _load_ea_release_manifest().get("releases", {}).get(version)
    # Re-check stable_status here, not just at token-mint time: a release
    # can be disabled by an admin (e.g. a critical bug found) within the
    # token's short lifetime, and an already-minted token must not still be
    # able to pull down a build that's since been pulled from circulation.
    if not release or not release.get("stable_status"):
        await db.ea_download_log.insert_one({
            "id": str(uuid.uuid4()), "user_id": payload.get("user_id", ""), "license_id": license_id,
            "version": version, "downloaded_at": datetime.now(timezone.utc).isoformat(),
            "result": "REJECTED_RELEASE_NOT_AVAILABLE",
        })
        raise HTTPException(status_code=404, detail="Release no longer available.")
    p = EA_RELEASES_DIR / version / release["ex5_filename"]
    if not p.exists():
        logger.error(f"EA_RELEASE_ARTIFACT_MISSING version={version} path={p}")
        await db.ea_download_log.insert_one({
            "id": str(uuid.uuid4()), "user_id": payload.get("user_id", ""), "license_id": license_id,
            "version": version, "downloaded_at": datetime.now(timezone.utc).isoformat(),
            "result": "REJECTED_ARTIFACT_MISSING",
        })
        raise HTTPException(status_code=404, detail="Release artifact missing.")
    # Runtime integrity check -- the CI workflow verifies the EX5 hash
    # against the manifest at push time, but a customer download must never
    # rely solely on a check that ran once at commit time; recompute the
    # hash of the exact bytes about to be served and refuse to serve on any
    # mismatch (corrupted artifact, tampered file, stale manifest entry).
    actual_hash = hashlib.sha256(p.read_bytes()).hexdigest()
    expected_hash = release.get("ex5_sha256", "")
    if actual_hash != expected_hash:
        logger.error(f"EA_RELEASE_HASH_MISMATCH version={version} expected={expected_hash} actual={actual_hash}")
        await db.ea_download_log.insert_one({
            "id": str(uuid.uuid4()), "user_id": payload.get("user_id", ""), "license_id": license_id,
            "version": version, "downloaded_at": datetime.now(timezone.utc).isoformat(),
            "result": "REJECTED_HASH_MISMATCH",
        })
        raise HTTPException(status_code=503, detail="Release integrity check failed. The admin has been alerted.")
    await db.ea_download_log.insert_one({
        "id": str(uuid.uuid4()), "user_id": payload.get("user_id", ""), "license_id": license_id,
        "version": version, "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "result": "SUCCESS",
    })
    return FileResponse(path=str(p), filename=release["customer_filename"], media_type="application/octet-stream")


# ---------------------------------------------------------------------------
# Admin release management -- promote/rollback/disable act directly on
# backend/ea_releases/manifest.json (the same file _current_ea_release()
# reads fresh on every call, so a promotion takes effect immediately, no
# redeploy required). Writes are atomic (temp file + os.replace) to avoid a
# reader ever observing a half-written file.
#
# Durability note: this file write is NOT automatically committed to git.
# The CI auto-promotion workflow (.github/workflows/ea.yml) is the durable
# path -- it updates manifest.json as part of a real commit on main, so the
# change survives the next redeploy. An admin promote/rollback/disable here
# takes effect immediately on the running instance but will be reverted by
# the next redeploy unless the admin (or CI) also commits the resulting
# manifest.json. This makes the admin panel the right tool for an
# in-the-moment incident response (e.g. emergency rollback), while a normal
# version bump should go through the push-to-main flow.
# ---------------------------------------------------------------------------

class ReleasePromoteRequest(BaseModel):
    version: str

class ReleaseDisableRequest(BaseModel):
    version: str
    reason: str = ""

async def _log_release_action(admin_email: str, action: str, version: str, previous_version: Optional[str], detail: str = ""):
    await db.release_audit_log.insert_one({
        "id": str(uuid.uuid4()), "admin_email": admin_email, "action": action,
        "version": version, "previous_version": previous_version, "detail": detail,
        "at": datetime.now(timezone.utc).isoformat(),
    })

def _write_manifest(manifest: dict):
    p = EA_RELEASES_DIR / "manifest.json"
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(_json.dumps(manifest, indent=2), encoding="utf-8")
    os.replace(tmp, p)

def _verify_release_artifact(version: str, release: dict) -> Optional[str]:
    """Returns None if the release's EX5 exists on disk and its hash
    matches the manifest, otherwise a human-readable reason it doesn't."""
    filename = release.get("ex5_filename", "")
    if not filename:
        return "Manifest entry has no ex5_filename."
    p = EA_RELEASES_DIR / version / filename
    if not p.exists():
        return f"EX5 artifact not found at {p}."
    actual_hash = hashlib.sha256(p.read_bytes()).hexdigest()
    expected_hash = release.get("ex5_sha256", "")
    if actual_hash != expected_hash:
        return f"SHA-256 mismatch: manifest says {expected_hash}, artifact is {actual_hash}."
    return None

@api_router.get("/admin/releases", dependencies=[Depends(get_current_admin)])
async def admin_list_releases():
    manifest = _load_ea_release_manifest()
    releases = manifest.get("releases", {})
    current = manifest.get("current_version")
    download_counts = {}
    async for doc in db.ea_download_log.aggregate([
        {"$match": {"result": "SUCCESS"}},
        {"$group": {"_id": "$version", "count": {"$sum": 1}}},
    ]):
        download_counts[doc["_id"]] = doc["count"]
    out = []
    for version, release in releases.items():
        out.append({
            **release,
            "is_current": version == current,
            "artifact_ok": _verify_release_artifact(version, release) is None,
            "download_count": download_counts.get(version, 0),
        })
    out.sort(key=lambda r: r.get("build_timestamp") or "", reverse=True)
    return {"current_version": current, "releases": out}

@api_router.get("/admin/releases/audit-log", dependencies=[Depends(get_current_admin)])
async def admin_release_audit_log(limit: int = 100):
    entries = await db.release_audit_log.find({}, {"_id": 0}).sort("at", -1).limit(min(limit, 500)).to_list(500)
    return {"total": len(entries), "entries": entries}

@api_router.get("/admin/downloads", dependencies=[Depends(get_current_admin)])
async def admin_download_log(limit: int = 100):
    """Read-side of ea_download_log -- previously write-only (every real and
    rejected download was logged, but nothing ever surfaced it to an admin).
    Never returns the license's PIN, only its id."""
    entries = await db.ea_download_log.find({}, {"_id": 0}).sort("downloaded_at", -1).limit(min(limit, 500)).to_list(500)
    return {"total": len(entries), "entries": entries}

@api_router.post("/admin/releases/promote")
async def admin_promote_release(req: ReleasePromoteRequest, admin: dict = Depends(get_current_admin)):
    manifest = _load_ea_release_manifest()
    releases = manifest.get("releases", {})
    release = releases.get(req.version)
    if not release:
        raise HTTPException(status_code=404, detail=f"No release '{req.version}' in the manifest.")
    if not release.get("stable_status"):
        raise HTTPException(status_code=400, detail=f"Release '{req.version}' is not marked stable_status=true. Approve it before promoting.")
    artifact_problem = _verify_release_artifact(req.version, release)
    if artifact_problem:
        raise HTTPException(status_code=422, detail=f"Cannot promote '{req.version}': {artifact_problem}")
    previous = manifest.get("current_version")
    if previous == req.version:
        return {"promoted": True, "version": req.version, "previous_version": previous, "no_op": True}
    manifest["current_version"] = req.version
    _write_manifest(manifest)
    await _log_release_action(admin["email"], "promote", req.version, previous)
    logger.info(f"EA_RELEASE_PROMOTED version={req.version} previous={previous} admin={admin['email']}")
    return {"promoted": True, "version": req.version, "previous_version": previous, "no_op": False}

@api_router.post("/admin/releases/rollback")
async def admin_rollback_release(admin: dict = Depends(get_current_admin)):
    """Restores the most recent DIFFERENT version that was ever the active
    current_version (per release_audit_log's promote history), provided it
    is still stable_status=true and its artifact still checks out. This is
    the one-click incident-response path -- for promoting an arbitrary
    specific version, use POST /admin/releases/promote instead."""
    manifest = _load_ea_release_manifest()
    current = manifest.get("current_version")
    history = await db.release_audit_log.find(
        {"action": {"$in": ["promote", "rollback"]}}, {"_id": 0}
    ).sort("at", -1).to_list(200)
    target = None
    for entry in history:
        candidate = entry.get("previous_version")
        if candidate and candidate != current and candidate in manifest.get("releases", {}):
            target = candidate
            break
    if not target:
        raise HTTPException(status_code=404, detail="No prior version found to roll back to.")
    release = manifest["releases"][target]
    if not release.get("stable_status"):
        raise HTTPException(status_code=409, detail=f"Most recent prior version '{target}' is no longer stable_status=true -- use /admin/releases/promote to choose a specific version instead.")
    artifact_problem = _verify_release_artifact(target, release)
    if artifact_problem:
        raise HTTPException(status_code=422, detail=f"Cannot roll back to '{target}': {artifact_problem}")
    manifest["current_version"] = target
    _write_manifest(manifest)
    await _log_release_action(admin["email"], "rollback", target, current)
    logger.warning(f"EA_RELEASE_ROLLED_BACK version={target} previous={current} admin={admin['email']}")
    return {"rolled_back": True, "version": target, "previous_version": current}

@api_router.post("/admin/releases/disable")
async def admin_disable_release(req: ReleaseDisableRequest, admin: dict = Depends(get_current_admin)):
    """Marks a release unstable so it can never again be promoted, minted a
    download token for, or served -- for a compromised/buggy build found
    after the fact. If the disabled version is the current one, this leaves
    current_version pointing at a now-unstable entry; _current_ea_release()
    already fails closed in that case (serves nothing) rather than silently
    falling back to some other version the admin didn't explicitly choose --
    use /admin/releases/rollback or /promote right after to pick the
    replacement explicitly."""
    manifest = _load_ea_release_manifest()
    release = manifest.get("releases", {}).get(req.version)
    if not release:
        raise HTTPException(status_code=404, detail=f"No release '{req.version}' in the manifest.")
    if release.get("stable_status") is False:
        return {"disabled": True, "version": req.version, "no_op": True}
    release["stable_status"] = False
    manifest["releases"][req.version] = release
    _write_manifest(manifest)
    await _log_release_action(admin["email"], "disable", req.version, manifest.get("current_version"), detail=req.reason)
    logger.warning(f"EA_RELEASE_DISABLED version={req.version} admin={admin['email']} reason={req.reason!r}")
    return {"disabled": True, "version": req.version, "no_op": False, "is_current": req.version == manifest.get("current_version")}


@api_router.get("/download/ea", deprecated=True)
async def download_ea_retired():
    """Retired 2026-07-17 -- public unauthenticated MQ5 source distribution.
    Returns 410 Gone rather than 404 so anything still pointed at the old
    URL gets an explicit, permanent signal, not a transient-looking miss."""
    raise HTTPException(status_code=410, detail="This endpoint is retired. Sign in to Command Center to download your compiled EA build.")


@api_router.get("/download/package", deprecated=True)
async def download_package_retired():
    """Retired 2026-07-17 -- see download_ea_retired() above."""
    raise HTTPException(status_code=410, detail="This endpoint is retired. Sign in to Command Center to download your compiled EA build.")


@api_router.get("/admin/download/ea-master", dependencies=[Depends(get_current_admin)])
async def admin_download_ea_master():
    """Admin-only: serves the FULL master MQ5 SOURCE with agent token intact.
    Never expose publicly -- this is the only place the raw source is ever
    served, and only to an authenticated admin."""
    p = ROOT_DIR / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
    if not p.exists(): raise HTTPException(status_code=404)
    src = p.read_text(encoding="utf-8", errors="ignore")
    meta = _get_ea_meta(src, filename_prefix="XAUUSD_AI_Sniper_EA_MASTER")
    return FileResponse(
        path=str(p),
        filename=meta["filename"],
        media_type="application/octet-stream",
    )

# -------- XauIndex (separate product, separate download) --------
# A DIFFERENT product from XauCloud (gold-only, maintained separately).
# XauIndex has Gold+Index market detection built in and is versioned
# independently (1.0.0+) so the two are never confused with one another.
# Mirrors the XauCloud download endpoints exactly, pointed at its own
# ea_code_xauindex/ directory instead.
# v6.25.3 owner directive 2026-07-17 (Phase 3 P0) -- XauIndex had the exact
# same public MQ5 source exposure as the main EA. It has no compiled EX5
# release artifact yet (this session never compiled a XauIndex build, unlike
# XAUUSD_AI_Sniper_EA's v6.25.2) -- rather than fabricate one, this reports
# honestly as unavailable rather than serving the raw source publicly.
@api_router.get("/download/xauindex/info")
async def download_xauindex_info():
    return {"available": False, "reason": "NO_COMPILED_RELEASE_ARTIFACT_YET",
            "message": "XauIndex download is not yet available through this channel -- no compiled EX5 release has been built."}


@api_router.get("/download/xauindex/ea", deprecated=True)
async def download_xauindex_ea_retired():
    """Retired 2026-07-17 -- see download_ea_retired() above; same public
    MQ5 source exposure issue, same fix. XauIndex has no signed-token/EX5
    flow yet since no compiled release artifact exists for it."""
    raise HTTPException(status_code=410, detail="This endpoint is retired. XauIndex download is not yet available.")


@api_router.get("/admin/download/xauindex-master", dependencies=[Depends(get_current_admin)])
async def admin_download_xauindex_master():
    p = ROOT_DIR / "ea_code_xauindex" / "XauIndex_EA.mq5"
    if not p.exists(): raise HTTPException(status_code=404)
    src = p.read_text(encoding="utf-8", errors="ignore")
    meta = _get_ea_meta(src, filename_prefix="XauIndex_EA")
    return FileResponse(
        path=str(p),
        filename=meta["filename"],
        media_type="application/octet-stream",
    )

@api_router.get("/download/xauindex/package", deprecated=True)
async def download_xauindex_package_retired():
    """Retired 2026-07-17 -- see download_ea_retired() above."""
    raise HTTPException(status_code=410, detail="This endpoint is retired. XauIndex download is not yet available.")

########################################
# PERFORMANCE PERIODS (forward-record reset system)
########################################
# See audits/performance_reset/01_current_system_audit.md for the full
# audit this replaces, and audits/performance_reset/02_implementation_notes.md
# for the design decisions summarized here.
#
# Every displayed statistic comes from exactly one authoritative source:
# performance_engine.compute_period_stats() over a query-scoped,
# eligibility-filtered, deduplicated trade_journal dataset for a single
# performance_periods document. No number is ever hand-typed, cached
# indefinitely, or mixed across two different queries.

class StartPerformancePeriodRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    reason: str
    account_logins: Optional[List[str]] = None   # None = all accounts (see audit doc open item)
    ea_versions: Optional[List[str]] = None       # None = all versions
    symbol: str = "XAUUSD"
    break_even_tolerance_usd: float = performance_engine.DEFAULT_BREAK_EVEN_TOLERANCE_USD
    minimum_sample: int = performance_engine.DEFAULT_MINIMUM_SAMPLE
    current_password: str  # fresh-auth requirement, same pattern as update_admin_account()
    confirm: bool = False


async def get_active_performance_period() -> Optional[dict]:
    return await db.performance_periods.find_one({"status": "ACTIVE"}, {"_id": 0})


def _period_query(period: dict) -> dict:
    query: Dict[str, Any] = {
        "has_rich_ledger_data": True,
        "opened_at": {"$gte": period["epoch_started_at_unix"]},
    }
    if period.get("epoch_ended_at_unix"):
        query["opened_at"]["$lt"] = period["epoch_ended_at_unix"]
    scope = period.get("scope") or {}
    if scope.get("account_logins"):
        query["account_login"] = {"$in": scope["account_logins"]}
    if scope.get("ea_versions"):
        query["ea_version"] = {"$in": scope["ea_versions"]}
    if scope.get("symbol"):
        query["symbol"] = scope["symbol"]
    return query


async def _fetch_period_trades(period: dict) -> list:
    query = _period_query(period)
    raw = await db.trade_journal.find(query, {"_id": 0}).sort("opened_at", 1).to_list(length=20000)
    eligible = [t for t in raw if performance_engine.is_eligible_trade(t)]
    return performance_engine.dedupe_by_ticket(eligible)


async def _period_summary_dict(period: dict) -> dict:
    trades = await _fetch_period_trades(period)
    scope = period.get("scope") or {}
    stats = performance_engine.compute_period_stats(
        trades,
        be_tolerance_usd=scope.get("break_even_tolerance_usd", performance_engine.DEFAULT_BREAK_EVEN_TOLERANCE_USD),
        minimum_sample=scope.get("minimum_sample", performance_engine.DEFAULT_MINIMUM_SAMPLE),
    )
    d = performance_engine.period_stats_to_dict(stats)
    d.update({
        "source": "live_journal",
        "verification": "first_party_ea_journal",
        "independently_verified": False,
        "drawdown_label": "Max Balance Drawdown",
        "period_id": period["id"],
        "period_name": period["name"],
        "period_status": period["status"],
        "epoch_started_at": period["epoch_started_at"],
        "epoch_ended_at": period.get("epoch_ended_at"),
        "ea_version": (_current_ea_release() or {}).get("version", ""),
        "recalculated_at": datetime.now(timezone.utc).isoformat(),
        "recent_trades": performance_engine.build_recent_trades(
            trades,
            be_tolerance_usd=scope.get("break_even_tolerance_usd", performance_engine.DEFAULT_BREAK_EVEN_TOLERANCE_USD),
            limit=20,
        ),
    })
    return d


@api_router.get("/performance/summary")
async def get_performance_summary():
    # v6.25.3 owner directive 2026-07-17 (Phase 7 truthfulness cleanup) --
    # this endpoint used to also return an "ai_features" block that was
    # either a hardcoded 0 or a trivial reshuffle of numbers reported
    # elsewhere, mislabeled as measured AI performance. Removed rather
    # than left reachable.
    #
    # v-performance-reset owner directive -- this endpoint used to
    # aggregate every trade ever logged, all-time, no scope. It now
    # reports ONLY the active forward performance period -- see
    # audits/performance_reset/ for the full history.
    try:
        period = await get_active_performance_period()
    except Exception as e:
        logger.error(f"Performance summary error (period lookup): {e}")
        return {"status": "unavailable"}
    if not period:
        # No forward period has ever been activated -- fail into an
        # honest "unavailable" state rather than silently falling back
        # to the old all-time aggregate.
        return {"status": "unavailable"}
    try:
        d = await _period_summary_dict(period)
    except Exception as e:
        logger.error(f"Performance summary error (calculation): {e}")
        return {"status": "unavailable"}
    d["status"] = "active" if d["sufficient_data"] else "collecting"
    return d


@api_router.get("/performance/full")
async def get_performance_full(period_id: Optional[str] = None):
    """Detailed performance page -- defaults to the active period; pass
    period_id to view any specific (including archived) period's full
    detail through the same one endpoint the historical page also uses."""
    if period_id:
        period = await db.performance_periods.find_one({"id": period_id}, {"_id": 0})
    else:
        period = await get_active_performance_period()
    if not period:
        return {"status": "unavailable"}
    d = await _period_summary_dict(period)
    d["status"] = "active" if d["sufficient_data"] else "collecting"
    return d


@api_router.get("/performance/historical")
async def get_performance_historical():
    """Every ARCHIVED period, oldest first, each with its own
    independently-computed summary -- the read-only archive. Never
    mixes trades across periods; each period's stats come from that
    period's own scoped query only."""
    periods = await db.performance_periods.find({"status": "ARCHIVED"}, {"_id": 0}).sort("epoch_started_at", 1).to_list(length=200)
    results = []
    for period in periods:
        try:
            d = await _period_summary_dict(period)
        except Exception as e:
            logger.error(f"Historical performance error for period {period.get('id')}: {e}")
            continue
        results.append(d)
    return {"periods": results}


@api_router.get("/admin/performance/periods")
async def admin_list_performance_periods(admin: dict = Depends(get_current_admin)):
    periods = await db.performance_periods.find({}, {"_id": 0}).sort("epoch_started_at", -1).to_list(length=200)
    enriched = []
    for period in periods:
        try:
            trades = await _fetch_period_trades(period)
            qualifying = len(trades)
        except Exception:
            qualifying = None
        enriched.append({**period, "qualifying_trade_count": qualifying})
    return {"periods": enriched}


@api_router.post("/admin/performance/periods/start")
async def admin_start_performance_period(req: StartPerformancePeriodRequest, admin: dict = Depends(get_current_admin)):
    # Fresh-auth requirement -- same pattern as update_admin_account() and
    # the Nomba production-credential gate: a destructive/high-stakes
    # admin action requires re-entering the current password, not just an
    # already-valid session cookie.
    full = await db.users.find_one({"email": admin["email"]})
    if not full or not verify_password(req.current_password, full.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Set confirm=true to acknowledge that the previous period will be archived, not deleted.")
    if not req.name.strip() or not req.reason.strip():
        raise HTTPException(status_code=400, detail="A period name and reason are both required.")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    now_unix = now.timestamp()

    current_active = await get_active_performance_period()

    # First-ever activation: also archive an implicit "Historical EA
    # Journal" period covering everything before any period system
    # existed, so the pre-reset 1,217-trade dataset gets its own labeled,
    # queryable, permanently-preserved period rather than being an
    # orphaned, un-scoped blob. Its own start is the earliest eligible
    # trade's opened_at (or, if there is none, the same moment the first
    # real period starts, making it an honest empty bucket rather than a
    # fabricated date range).
    if current_active is None:
        existing_periods_count = await db.performance_periods.count_documents({})
        if existing_periods_count == 0:
            earliest = await db.trade_journal.find(
                {"has_rich_ledger_data": True, "ticket": {"$gt": 0}, "opened_at": {"$gt": 0}},
                {"_id": 0, "opened_at": 1},
            ).sort("opened_at", 1).limit(1).to_list(length=1)
            legacy_start_unix = earliest[0]["opened_at"] if earliest else now_unix
            legacy_period = {
                "id": str(uuid.uuid4()),
                "name": "Historical EA Journal",
                "status": "ARCHIVED",
                "epoch_started_at": datetime.fromtimestamp(legacy_start_unix, timezone.utc).isoformat(),
                "epoch_started_at_unix": legacy_start_unix,
                "epoch_ended_at": now_iso,
                "epoch_ended_at_unix": now_unix,
                "scope": {"account_logins": None, "ea_versions": None, "symbol": None,
                          "break_even_tolerance_usd": performance_engine.DEFAULT_BREAK_EVEN_TOLERANCE_USD,
                          "minimum_sample": performance_engine.DEFAULT_MINIMUM_SAMPLE},
                "created_by_admin_email": admin["email"],
                "reason": "Automatically created to preserve all pre-reset trade history as its own labeled, permanent, read-only period.",
                "created_at": now_iso,
            }
            await db.performance_periods.insert_one(legacy_period)
    elif current_active:
        # Archive the currently active period -- never deleted, never
        # rewritten, just closed off at exactly this moment.
        await db.performance_periods.update_one(
            {"id": current_active["id"]},
            {"$set": {"status": "ARCHIVED", "epoch_ended_at": now_iso, "epoch_ended_at_unix": now_unix}},
        )

    new_period = {
        "id": str(uuid.uuid4()),
        "name": req.name.strip(),
        "status": "ACTIVE",
        "epoch_started_at": now_iso,
        "epoch_started_at_unix": now_unix,
        "epoch_ended_at": None,
        "epoch_ended_at_unix": None,
        "scope": {
            "account_logins": req.account_logins,
            "ea_versions": req.ea_versions,
            "symbol": req.symbol,
            "break_even_tolerance_usd": req.break_even_tolerance_usd,
            "minimum_sample": req.minimum_sample,
        },
        "created_by_admin_email": admin["email"],
        "reason": req.reason.strip(),
        "created_at": now_iso,
    }
    await db.performance_periods.insert_one(new_period)
    logger.info(f"PERFORMANCE_PERIOD_STARTED id={new_period['id']} name={new_period['name']} by={admin['email']} epoch={now_iso}")
    new_period.pop("_id", None)
    return {"started": True, "period": new_period}

@api_router.get("/architecture")
async def get_architecture():
    return {"modules":[{"name":"M10 Evidence Engine","description":"Builds immutable evidence from completed M10 bars and multi-timeframe context.","components":["Completed-bar trend and pressure","Market structure","Volatility","M10 evidence identity"]},{"name":"Decision Authority","description":"M10 legacy is the sole authoritative decision mode in this release. An M30 three-snapshot consensus path exists in source for possible future use but is not selectable or executable in the current build.","components":["M10 legacy mode (active)","M30 three-snapshot consensus (dormant, not selectable)","Immutable candidate identity","No forming-candle evidence"]},{"name":"Entry Lifecycle","description":"A qualifying candidate gets one 120–180 second observation window, followed by execute or cancel.","components":["Single timer","Final revalidation","0.30R missed-move cancellation","No retracement carry-forward"]},{"name":"Risk and Execution","description":"Core orders require a structural invalidation, one 1.20 widening, 10% configured risk sizing, direction exclusivity, and confirmed broker truth.","components":["Structural stop loss","Margin and spread checks","Cross-terminal reservation","Broker reconciliation"]},{"name":"Position Management","description":"Open-position and R-based exit management continues on every tick.","components":["R-based protection","Broker-confirmed close retries","Restart state","Exit audit"]},{"name":"Command Center","description":"Licensed users can inspect heartbeat, evidence, candidates, positions, events, and acknowledged controls.","components":["Tenant isolation","Decision-mode visibility","Audit trail","Admin separation"]}],"filters":[{"name":"Spread","description":"Current execution-risk check"},{"name":"News","description":"Current local evidence plus honest provider status"},{"name":"Structure","description":"Required core invalidation"},{"name":"Margin","description":"Broker/account execution reality"}]}

@api_router.get("/docs/installation")
async def get_installation_guide():
    return {"steps":[{"step":1,"title":"Download EA","description":"Sign in to Command Center and download the verified compiled .ex5 release."},{"step":2,"title":"Open MT5","description":"Launch MetaTrader 5."},{"step":3,"title":"Copy to Folder","description":"File > Open Data Folder > MQL5 > Experts. Paste the compiled file."},{"step":4,"title":"Refresh Navigator","description":"In Navigator, refresh Expert Advisors. Customer-side source compilation is not required."},{"step":5,"title":"Open Chart","description":"Open an XAUUSD M10 chart (including your broker's XAUUSD suffix)."},{"step":6,"title":"Attach EA","description":"Drag the verified EA from Navigator onto the chart."},{"step":7,"title":"Enter PIN","description":"Enter your license PIN. This release runs M10 legacy decision mode only — there is no M30 mode to select in the current build."},{"step":8,"title":"Enable","description":"Enable Algo Trading only after demo verification and broker checks."}],"requirements":["MetaTrader 5","Supported XAUUSD symbol","Valid PIN","Stable internet/VPS","Adequate broker margin","Broker-compatible spread and stops"],"warnings":["Start with demo","No guaranteed profits","Risk only capital you can afford to lose","Keep PIN private","Confirm the active EA version and Decision Mode in the MT5 journal"]}

@api_router.get("/docs/how-it-works")
async def get_how_it_works():
    version = (_current_ea_release() or {}).get("version", "current release")
    return {"sections":[{"title":f"How XauCloud {version} Works","subtitle":"Completed M10 evidence with a single authoritative decision mode","steps":[{"id":1,"title":"M10 Evidence","description":"The EA records one immutable snapshot for each completed M10 candle.","detail":"The forming candle is never used as evidence."},{"id":2,"title":"Decision Mode","description":"M10 legacy is the only decision mode in this release. An M30 three-snapshot consensus path exists in source for possible future use but is not selectable or executable in the current build.","detail":"The journal and Command Center confirm M10 legacy is the active mode."},{"id":3,"title":"One Entry Timer","description":"A qualifying BUY or SELL immediately starts one 120–180 second timer.","detail":"There is no second retracement, candle, slot, or AI wait."},{"id":4,"title":"Execute or Cancel","description":"At final revalidation the EA executes if valid and below 0.30R movement, otherwise it cancels.","detail":"A cancelled candidate cannot be carried or resurrected."},{"id":5,"title":"Risk and Broker Truth","description":"A core order requires structural SL, one 1.20 widening, configured 10% risk sizing, margin, direction exclusivity, and broker confirmation.","detail":"Ambiguous sends are reconciled and never immediately resent."},{"id":6,"title":"Tick-Based Management","description":"Once open, positions and exits continue to be managed on ticks.","detail":"Entry cadence does not slow exit management."}]}],"faq":[{"q":"Is M30 mode available?","a":"No. This release runs M10 legacy decision mode only; M30 is not a selectable option in the current build. Always confirm the active Decision Mode shown in the MT5 journal and Command Center."},{"q":"Do I need to keep MT5 running?","a":"Yes. A properly monitored VPS can provide continuous terminal operation."},{"q":"Does the EA guarantee profit?","a":"No. Trading can lose money; demo and broker-specific verification are required."},{"q":"Which broker?","a":"Use an MT5 broker whose XAUUSD symbol, stops, volume steps, margin, spread, and execution behavior you have verified."},{"q":"What if connectivity fails?","a":"Broker-held SL/TP remain important, but cloud features and EA-side management may be unavailable until connectivity returns."}]}

@api_router.get("/docs/setup-guide")
async def get_setup_guide():
    version = (_current_ea_release() or {}).get("version", "current release")
    return {"title":f"XauCloud {version} Setup Guide","intro":"Install only the verified compiled EX5 and confirm the running inputs before enabling trading.","steps":[{"step":1,"title":"Prepare MT5 Demo","instructions":["Install your broker's MT5 terminal","Sign in to a demo account","Confirm the broker's exact XAUUSD symbol and trading specification"],"tip":"Do not begin with a real-money account."},{"step":2,"title":"Download Verified EX5","instructions":["Sign in to Command Center","Link the active license",f"Download {version} compiled EX5","Compare the displayed checksum with the release manifest"],"tip":"Customers do not need MQ5 source or MetaEditor compilation."},{"step":3,"title":"Install the EA","instructions":["MT5: File > Open Data Folder","Open MQL5 > Experts","Copy the verified EX5","Refresh Expert Advisors in Navigator"],"tip":"Keep older builds clearly separated."},{"step":4,"title":"Open Gold Chart","instructions":["Open your broker's XAUUSD chart","Set the chart to M10","Confirm live prices and normal broker spread"],"tip":"M10 is the primary evidence timeframe."},{"step":5,"title":"Attach and Review Inputs","instructions":["Drag XAUUSD_AI_Sniper_EA onto the chart","Enter the license PIN","Confirm Decision Mode shows M10 legacy","Confirm risk, magic number, server URL, and structural SL settings"],"tip":"This release runs M10 legacy decision mode only; there is no M30 mode to select."},{"step":6,"title":"Verify Journal","instructions":["Confirm the exact EA version and build hash","Confirm the active Decision Mode","Confirm license and indicator readiness","Confirm there is no older EA attached to another XAUUSD chart"],"tip":"The file name alone does not prove the running version."},{"step":7,"title":"Enable on Demo","instructions":["Enable Allow Algo Trading","Turn the MT5 Algo Trading button on","Watch heartbeat and Command Center status","Verify broker send/modify/close behavior on demo"],"tip":"Move to live only after owner approval and broker-specific evidence."}],"important_notes":["No profit is guaranteed.","The configured 10% risk is high and can produce large losses.","Keep MT5 and connectivity monitored.","Never share your PIN.","Mac and VPS must use the same approved artifact and intentional Decision Mode."]}

@api_router.get("/docs/video-guide")
async def get_video_guide():
    version = (_current_ea_release() or {}).get("version", "current release")
    return {"title":"Verified EX5 Installation Walkthrough","subtitle":f"Screen-by-screen {version} deployment checks","scenes":[{"scene":1,"title":"DOWNLOAD","duration":"2 min","frames":[{"action":"SIGN IN","detail":"Open Command Center and link the active license","visual":"Licensed download panel"},{"action":"DOWNLOAD EX5","detail":f"Download the compiled {version} artifact","visual":"Version and checksum shown together"},{"action":"VERIFY","detail":"Compare the artifact checksum with the release manifest","visual":"Matching SHA-256 values"}]},{"scene":2,"title":"INSTALL","duration":"2 min","frames":[{"action":"DATA FOLDER","detail":"MT5: File > Open Data Folder","visual":"Terminal data directory"},{"action":"COPY","detail":"Place the EX5 in MQL5 > Experts","visual":"Compiled artifact in Experts"},{"action":"REFRESH","detail":"Refresh Expert Advisors in Navigator","visual":"EA appears without customer-side compilation"}]},{"scene":3,"title":"CHART AND INPUTS","duration":"3 min","frames":[{"action":"OPEN GOLD","detail":"Open the broker's XAUUSD symbol on M10","visual":"Completed M10 candles"},{"action":"ATTACH","detail":"Attach XAUUSD AI Sniper","visual":"EA input dialog"},{"action":"LICENSE","detail":"Enter PIN and verify account binding","visual":"License input"},{"action":"MODE","detail":"Confirm the published release's active Decision Mode","visual":"M10 legacy decision mode confirmation"}]},{"scene":4,"title":"PROVE THE RUNTIME","duration":"2 min","frames":[{"action":"JOURNAL","detail":f"Confirm {version}, build hash, source/input hashes, and active Decision Mode","visual":"MT5 journal startup evidence"},{"action":"COMMAND CENTER","detail":"Confirm fresh heartbeat and matching mode/evidence","visual":"Online monitored instance"},{"action":"DEMO FIRST","detail":"Verify signal, broker execution, SL/TP, and exits on demo before live approval","visual":"Audited demo lifecycle"}]}]}

# -------------------------------------------------------------------
# ADMIN ROUTES (Protected)
# -------------------------------------------------------------------

@api_router.get("/admin/settings")
async def get_admin_settings(admin: dict = Depends(get_current_admin)):
    s = await get_settings()
    # Mask sensitive keys
    pk = s.get("paystack_secret_key", "")
    sp = s.get("smtp_password", "")
    osk = s.get("onesignal_api_key", "")
    return {
        "paystack_configured": bool(pk),
        "paystack_key_preview": f"{pk[:8]}...{pk[-4:]}" if len(pk) > 12 else ("set" if pk else "not set"),
        "pin_price_kobo": s.get("pin_price_kobo", 30000000),
        "pin_price_naira": s.get("pin_price_kobo", 30000000) / 100,
        "smtp_email": s.get("smtp_email", ""),
        "smtp_configured": bool(sp),
        "onesignal_app_id": s.get("onesignal_app_id", ""),
        "onesignal_api_key_configured": bool(osk),
        "onesignal_api_key_preview": f"{osk[:6]}...{osk[-4:]}" if len(osk) > 10 else ("set" if osk else "not set"),
    }

@api_router.get("/admin/notifications/health")
async def admin_notifications_health(admin: dict = Depends(get_current_admin)):
    """v6.25.3 owner directive 2026-07-17 -- real, live visibility into
    OneSignal push notification health, in the admin dashboard, instead of
    requiring a manual API check. Delivery now goes through OneSignal's
    REST API (plain HTTPS POST via `requests`, already installed and
    working) instead of self-hosted Web Push, which was permanently broken
    by a missing Python package (pywebpush) that only a full backend
    rebuild could fix -- see git history for that implementation. The only
    thing that can now be "not configured" is the admin actually entering a
    real OneSignal App ID + REST API Key in Settings, which the
    onesignal.remediation field below states plainly when missing."""
    import notifications as _notif
    onesignal_status = await _notif.get_onesignal_status()
    device_count = await db.cloud_push_subscriptions.count_documents({"opted_in": True})
    last_sent = await db.cloud_notification_log.find_one(
        {"delivery_status": "SENT"}, {"_id": 0, "scheduled_time": 1, "user_id": 1}, sort=[("scheduled_time", -1)])
    last_failed = await db.cloud_notification_log.find_one(
        {"delivery_status": {"$ne": "SENT"}}, {"_id": 0, "scheduled_time": 1, "delivery_status": 1, "failure_reason": 1},
        sort=[("scheduled_time", -1)])
    remediation = (
        "Not configured. Create a free OneSignal account at onesignal.com, add a Web Push app, copy its "
        "App ID and REST API Key from Settings -> Keys & IDs, and paste both into Settings on this admin "
        "dashboard."
        if not onesignal_status.get("configured") else
        "Configured. If sends are still failing, check the failure reason on the last failed send below -- "
        "AUTHENTICATION_FAILED means the REST API Key is wrong, NO_DEVICE_REGISTERED means no user has "
        "granted browser permission yet."
    )
    return {
        "onesignal": {**onesignal_status, "remediation": remediation},
        "subscribed_devices": device_count,
        "last_successful_send": last_sent,
        "last_failed_send": last_failed,
    }

@api_router.put("/admin/settings")
async def update_admin_settings(req: AdminSettingsUpdate, admin: dict = Depends(get_current_admin)):
    updates = {}
    if req.paystack_secret_key is not None: updates["paystack_secret_key"] = req.paystack_secret_key
    if req.pin_price_kobo is not None: updates["pin_price_kobo"] = req.pin_price_kobo
    if req.smtp_email is not None: updates["smtp_email"] = req.smtp_email
    if req.smtp_password is not None: updates["smtp_password"] = req.smtp_password
    if req.onesignal_app_id is not None: updates["onesignal_app_id"] = req.onesignal_app_id.strip()
    if req.onesignal_api_key is not None: updates["onesignal_api_key"] = req.onesignal_api_key.strip()
    if updates:
        await db.admin_settings.update_one({"key": "main"}, {"$set": updates}, upsert=True)
    return {"updated": True}


# -------------------------------------------------------------------
# NOMBA PAYMENT CONFIG (Admin Dashboard -> Settings -> Payments -> Nomba)
# -------------------------------------------------------------------

def _nomba_env_view(env_block: dict) -> dict:
    import payment_crypto as _pc
    def preview(key):
        enc = env_block.get(key)
        if not enc:
            return {"configured": False, "preview": ""}
        try:
            plain = _pc.decrypt_secret(enc)
        except Exception:
            return {"configured": True, "preview": "‹decrypt error›"}
        return {"configured": bool(plain), "preview": _pc.mask_preview(plain)}
    return {
        "client_id": preview("client_id_enc"),
        "client_secret": preview("client_secret_enc"),
        "account_id": preview("account_id_enc"),
        "webhook_signature_key": preview("webhook_signature_key_enc"),
        "last_validated_at": env_block.get("last_validated_at"),
        "last_validation_ok": env_block.get("last_validation_ok"),
        "last_validation_error": env_block.get("last_validation_error"),
    }


@api_router.get("/admin/settings/nomba")
async def get_nomba_settings(admin: dict = Depends(get_current_admin)):
    import payment_crypto as _pc
    cfg = await get_nomba_config()
    return {
        "enabled": cfg.get("enabled", False),
        "environment": cfg.get("environment", "sandbox"),
        "sandbox": _nomba_env_view(cfg.get("sandbox") or {}),
        "production": _nomba_env_view(cfg.get("production") or {}),
        "allowed_payment_methods": cfg.get("allowed_payment_methods", _NOMBA_CONFIG_DEFAULT_METHODS),
        "currency": cfg.get("currency", "NGN"),
        "payment_description": cfg.get("payment_description", ""),
        "callback_url": f"{PUBLIC_SITE_URL}/purchase/success",
        "webhook_url": f"{PUBLIC_SITE_URL}/api/webhook/nomba",
        "encryption_configured": _pc.is_configured(),
    }


@api_router.put("/admin/settings/nomba")
async def update_nomba_settings(req: NombaConfigUpdate, admin: dict = Depends(get_current_admin)):
    import payment_crypto as _pc
    if not _pc.is_configured():
        raise HTTPException(
            status_code=503,
            detail="PAYMENT_CONFIG_ENCRYPTION_KEY is not set on the server -- Nomba credentials cannot be "
                   "saved until it is. See audits/nomba_migration/ for setup instructions.",
        )

    cfg = await get_nomba_config()
    changed_fields: List[str] = []
    updates: Dict[str, Any] = {}

    production_touched = any([
        req.production_client_id is not None, req.production_client_secret is not None,
        req.production_account_id is not None, req.production_webhook_signature_key is not None,
        (req.environment == "production" and cfg.get("environment") != "production"),
    ])
    if production_touched:
        # Fresh-auth requirement for production credential changes, same
        # pattern as update_admin_account()'s current_password check.
        if not req.current_password:
            raise HTTPException(status_code=401, detail="Current admin password required to change production settings.")
        full = await db.users.find_one({"email": admin["email"]})
        if not full or not verify_password(req.current_password, full.get("password_hash", "")):
            raise HTTPException(status_code=401, detail="Incorrect password.")

    if req.enabled is not None:
        updates["enabled"] = req.enabled
        changed_fields.append("enabled")
    if req.environment is not None:
        if req.environment not in ("sandbox", "production"):
            raise HTTPException(status_code=400, detail="environment must be 'sandbox' or 'production'")
        updates["environment"] = req.environment
        changed_fields.append("environment")
    if req.allowed_payment_methods is not None:
        updates["allowed_payment_methods"] = req.allowed_payment_methods
        changed_fields.append("allowed_payment_methods")
    if req.currency is not None:
        updates["currency"] = req.currency
        changed_fields.append("currency")
    if req.payment_description is not None:
        updates["payment_description"] = req.payment_description
        changed_fields.append("payment_description")

    def _apply_env_field(env_name: str, field_attr: str, sub_key: str, label: str):
        val = getattr(req, field_attr)
        if val is not None:
            updates[f"{env_name}.{sub_key}"] = _pc.encrypt_secret(val)
            changed_fields.append(f"{env_name}.{label}")

    _apply_env_field("sandbox", "sandbox_client_id", "client_id_enc", "client_id")
    _apply_env_field("sandbox", "sandbox_client_secret", "client_secret_enc", "client_secret")
    _apply_env_field("sandbox", "sandbox_account_id", "account_id_enc", "account_id")
    _apply_env_field("sandbox", "sandbox_webhook_signature_key", "webhook_signature_key_enc", "webhook_signature_key")
    _apply_env_field("production", "production_client_id", "client_id_enc", "client_id")
    _apply_env_field("production", "production_client_secret", "client_secret_enc", "client_secret")
    _apply_env_field("production", "production_account_id", "account_id_enc", "account_id")
    _apply_env_field("production", "production_webhook_signature_key", "webhook_signature_key_enc", "webhook_signature_key")

    if updates:
        await db.payment_nomba_config.update_one({"key": "main"}, {"$set": updates}, upsert=True)
        await _log_nomba_config_audit(admin["email"], changed_fields, req.environment or cfg.get("environment", "sandbox"), test_passed=None)
    return {"updated": True, "changed_fields": changed_fields}


@api_router.post("/admin/settings/nomba/test-connection")
async def test_nomba_connection(admin: dict = Depends(get_current_admin)):
    """Validates the ACTIVE environment's credentials by attempting real
    OAuth token issuance only -- never a checkout order, never a charge.
    Records the result (pass/fail + redacted error) on the env block so
    the admin UI can show 'last successful validation time' without a
    second round-trip."""
    cfg = await get_nomba_config()
    environment = cfg.get("environment", "sandbox")
    env_block = cfg.get(environment) or {}
    creds = _decrypt_nomba_env_block(env_block, environment)
    if not creds:
        raise HTTPException(status_code=400, detail=f"{environment} credentials are not fully configured (client ID, client secret, and account ID are all required).")

    import nomba_service as _nomba
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        await _nomba.get_access_token(creds, force_refresh=True)
        ok, error_msg = True, None
    except _nomba.NombaError as exc:
        ok, error_msg = False, str(exc)

    await db.payment_nomba_config.update_one(
        {"key": "main"},
        {"$set": {
            f"{environment}.last_validated_at": now_iso,
            f"{environment}.last_validation_ok": ok,
            f"{environment}.last_validation_error": error_msg,
        }},
    )
    await _log_nomba_config_audit(admin["email"], ["test_connection"], environment, test_passed=ok)
    if not ok:
        return {"success": False, "environment": environment, "message": f"Connection failed: {error_msg}"}
    return {"success": True, "environment": environment, "message": "Successfully authenticated with Nomba.", "validated_at": now_iso}


@api_router.get("/admin/settings/nomba/audit-log")
async def get_nomba_audit_log(admin: dict = Depends(get_current_admin), limit: int = 50):
    entries = await db.payment_config_audit_log.find(
        {"provider": "NOMBA"}, {"_id": 0}
    ).sort("at", -1).to_list(length=min(limit, 200))
    return {"entries": entries}


# v6.6.0 — global Gold/Index Mode platform switches (architecture phase).
# These gate what the WEBSITE/DASHBOARD advertises and allows users to select
# — they do not themselves change EA behavior (the EA's own
# InpIndexModeLogOnly is the actual trading safety switch). platform_index_mode_enabled
# defaults false: the site should not offer Index Mode to customers until a
# real, tested index strategy exists.
class AdminMarketModeSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    platform_gold_mode_enabled: bool = True
    platform_index_mode_enabled: bool = False
    allowed_index_symbols: List[str] = Field(default_factory=list)
    default_trading_universe: str = "GOLD_ONLY"  # GOLD_ONLY | INDEX_ONLY | GOLD_AND_INDEX

@api_router.get("/admin/market-mode-settings")
async def get_admin_market_mode_settings(admin: dict = Depends(get_current_admin)):
    s = await db.admin_settings.find_one({"key": "main"}, {"_id": 0}) or {}
    return AdminMarketModeSettings(**{k: v for k, v in s.items() if k in AdminMarketModeSettings.model_fields}).model_dump()

@api_router.put("/admin/market-mode-settings")
async def update_admin_market_mode_settings(req: AdminMarketModeSettings, admin: dict = Depends(get_current_admin)):
    await db.admin_settings.update_one({"key": "main"}, {"$set": req.model_dump()}, upsert=True)
    return {"updated": True, "settings": req.model_dump()}

@api_router.get("/market-mode-status")
async def public_market_mode_status():
    """Public, unauthenticated — the website/download page reads this to know
    whether to advertise Index Mode as available yet."""
    s = await db.admin_settings.find_one({"key": "main"}, {"_id": 0}) or {}
    settings = AdminMarketModeSettings(**{k: v for k, v in s.items() if k in AdminMarketModeSettings.model_fields})
    return settings.model_dump()

@api_router.post("/admin/pins/generate", dependencies=[Depends(get_current_admin)])
async def admin_generate_pins(req: PinGenerateRequest):
    count = min(req.count, 50)
    pins = []
    for _ in range(count):
        pin = generate_unique_pin()
        while await db.pin_licenses.find_one({"pin": pin}): pin = generate_unique_pin()
        doc = PinLicense(pin=pin, buyer_name=req.buyer_name or "", buyer_email=req.buyer_email or "", notes=req.notes or "").model_dump()
        await db.pin_licenses.insert_one(doc)
        doc.pop('_id', None)
        pins.append(doc)
    return {"pins_created": len(pins), "pins": pins}

@api_router.get("/admin/pins", dependencies=[Depends(get_current_admin)])
async def admin_list_pins():
    pins = await db.pin_licenses.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"total": len(pins), "pins": pins}

@api_router.get("/admin/pins/stats", dependencies=[Depends(get_current_admin)])
async def admin_pin_stats():
    pipeline = [{"$facet": {
        "total": [{"$count": "c"}],
        "active": [{"$match": {"is_active": True}}, {"$count": "c"}],
        "used": [{"$match": {"is_used": True}}, {"$count": "c"}],
        "revoked": [{"$match": {"is_active": False}}, {"$count": "c"}],
    }}]
    result = await db.pin_licenses.aggregate(pipeline).to_list(1)
    r = result[0] if result else {}
    total = r.get("total", [{}])[0].get("c", 0) if r.get("total") else 0
    active = r.get("active", [{}])[0].get("c", 0) if r.get("active") else 0
    used = r.get("used", [{}])[0].get("c", 0) if r.get("used") else 0
    revoked = r.get("revoked", [{}])[0].get("c", 0) if r.get("revoked") else 0
    return {"total": total, "active": active, "used": used, "unused": active - used, "revoked": revoked}

@api_router.get("/admin/command-center/overview", dependencies=[Depends(get_current_admin)])
async def admin_command_center_overview():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=90)
    latest_hb = await db.cloud_bot_heartbeats.find_one({}, {"_id": 0}, sort=[("ts", -1)])
    hb_time = _dt_or_none((latest_hb or {}).get("ts"))
    online = bool(hb_time and hb_time > cutoff)
    total_licenses = await db.pin_licenses.count_documents({})
    active_licenses = await db.pin_licenses.count_documents({"is_active": True})
    activated_licenses = await db.pin_licenses.count_documents({"is_active": True, "is_used": True})
    revoked_licenses = await db.pin_licenses.count_documents({"is_active": False})
    linked_accounts = await db.pin_licenses.count_documents({"mt5_account": {"$nin": [None, ""]}})
    pending_commands = await db.cloud_bot_commands.count_documents({"status": "PENDING"})
    executed_commands = await db.cloud_bot_commands.count_documents({"status": "EXECUTED"})
    failed_commands = await db.cloud_bot_commands.count_documents({"status": "FAILED"})
    recent_events = await db.cloud_bot_activity.find({}, {"_id": 0}).sort("ts", -1).limit(30).to_list(30)
    recent_commands = await db.cloud_bot_commands.find({}, {"_id": 0}).sort("requested_at", -1).limit(20).to_list(20)
    return {
        "licenses": {
            "total": total_licenses,
            "active": active_licenses,
            "activated": activated_licenses,
            "revoked": revoked_licenses,
            "linked_accounts": linked_accounts,
        },
        "bot": {
            "online": online,
            "status": (latest_hb or {}).get("bot_state") or ("ONLINE" if online else "OFFLINE"),
            "last_heartbeat": (latest_hb or {}).get("ts") or "",
            "ea_version": (latest_hb or {}).get("ea_version") or "",
            "account_number": (latest_hb or {}).get("account_number") or "",
            "broker_server": (latest_hb or {}).get("broker_server") or "",
            "symbol": (latest_hb or {}).get("symbol") or "",
            "timeframe": (latest_hb or {}).get("timeframe") or "",
            "equity": (latest_hb or {}).get("equity") or 0,
            "balance": (latest_hb or {}).get("balance") or 0,
            "open_positions": (latest_hb or {}).get("open_positions") or 0,
            "algo_trading": bool((latest_hb or {}).get("algo_trading")),
            "trading_allowed": bool((latest_hb or {}).get("trading_allowed")),
            "mt5_connected": bool((latest_hb or {}).get("mt5_connected")),
        },
        "commands": {
            "pending": pending_commands,
            "executed": executed_commands,
            "failed": failed_commands,
            "recent": recent_commands,
        },
        "activity": recent_events,
    }

@api_router.put("/admin/pins/{pin}/revoke", dependencies=[Depends(get_current_admin)])
async def admin_revoke(pin: str):
    r = await db.pin_licenses.update_one({"pin": pin}, {"$set": {"is_active": False}})
    if r.matched_count == 0: raise HTTPException(404, "Not found")
    return {"revoked": True}

@api_router.put("/admin/pins/{pin}/activate", dependencies=[Depends(get_current_admin)])
async def admin_activate(pin: str):
    r = await db.pin_licenses.update_one({"pin": pin}, {"$set": {"is_active": True}})
    if r.matched_count == 0: raise HTTPException(404, "Not found")
    return {"activated": True}

@api_router.delete("/admin/pins/{pin}", dependencies=[Depends(get_current_admin)])
async def admin_delete(pin: str):
    r = await db.pin_licenses.delete_one({"pin": pin})
    if r.deleted_count == 0: raise HTTPException(404, "Not found")
    return {"deleted": True}


class AdminLicenseResetRequest(BaseModel):
    admin_password: str
    reason: str


@api_router.post("/admin/pins/{pin}/reset-account", dependencies=[Depends(get_current_admin)])
async def admin_reset_license_account(pin: str, req: AdminLicenseResetRequest, admin: dict = Depends(get_current_admin)):
    """v6.25.3 owner directive 2026-07-17 (Phase 4 P0) -- the only sanctioned
    way to move a license from one MT5 account to another (e.g. a customer's
    genuine broker/account change), since _resolve_monitor_license() fails
    closed on any account mismatch otherwise. Requires re-entering the
    CURRENT admin password (not just an already-valid session -- a
    destructive/security-sensitive action, same bar as changing the admin's
    own account) and a reason, and records a full audit entry (previous
    account, new account, admin, reason, timestamp) rather than just
    silently clearing the field."""
    user = await db.users.find_one({"email": admin["email"]})
    if not user or not verify_password(req.admin_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Admin password is incorrect")
    if not req.reason or not req.reason.strip():
        raise HTTPException(status_code=400, detail="A reason is required for a license account reset.")
    lic = await db.pin_licenses.find_one({"pin": pin}, {"_id": 0})
    if not lic:
        raise HTTPException(status_code=404, detail="License not found")
    previous_account = lic.get("mt5_account") or ""
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.pin_licenses.update_one(
        {"pin": pin},
        {"$set": {"mt5_account": None, "is_used": False, "activated_at": None}})
    audit_entry = {
        "id": str(uuid.uuid4()), "pin": pin, "previous_account": previous_account, "new_account": None,
        "reason": req.reason.strip(), "admin_email": admin["email"], "reset_at": now_iso,
    }
    await db.license_reset_audit_log.insert_one(audit_entry)
    # A reset account also invalidates any in-flight direction reservation
    # tied to the old binding -- a stale reservation under the old account
    # must not silently keep blocking/claiming after a reset.
    if previous_account:
        await db.cloud_direction_reservations.delete_many({"account": previous_account, "licenseId": lic.get("id", "")})
    logger.warning(f"LICENSE_ACCOUNT_RESET pin={pin} previous_account={previous_account} admin={admin['email']} reason={req.reason.strip()}")
    return {"reset": True, "pin": pin, "previous_account": previous_account}

@api_router.post("/admin/configs", response_model=EAConfig, dependencies=[Depends(get_current_admin)])
async def admin_create_config(data: EAConfigCreate):
    c = EAConfig(**data.model_dump())
    doc = c.model_dump()
    await db.ea_configs.insert_one(doc)
    doc.pop('_id', None)
    return c

@api_router.get("/admin/configs", dependencies=[Depends(get_current_admin)])
async def admin_list_configs():
    return await db.ea_configs.find({}, {"_id": 0}).to_list(100)

@api_router.post("/configs")
async def public_submit_config(data: EAConfigCreate):
    """Public (unauthenticated) config submission from the marketing-site
    Configurator (frontend/src/components/ConfiguratorSection.jsx). Audit
    fix: the frontend has always POSTed here, but no such route existed --
    every visitor submission silently 404'd while the UI still showed
    "Saved!" (caught, dev-only console.error). Reuses the same
    EAConfig/EAConfigCreate models as /admin/configs (same field vocabulary,
    same collection) so an admin can review submitted preferences; ea_configs
    already tolerates unknown/extra fields (model_config extra="ignore")."""
    c = EAConfig(**data.model_dump())
    doc = c.model_dump()
    doc["source"] = "public_configurator"
    doc["submitted_at"] = datetime.now(timezone.utc).isoformat()
    await db.ea_configs.insert_one(doc)
    return {"ok": True, "id": c.id}

@api_router.get("/admin/transactions", dependencies=[Depends(get_current_admin)])
async def admin_list_transactions():
    txs = await db.payment_transactions.find({}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return {"total": len(txs), "transactions": txs}

@api_router.get("/admin/dashboard", dependencies=[Depends(get_current_admin)])
async def admin_dashboard():
    """Main admin dashboard: bots sold, active, performance, revenue"""
    # PIN stats via aggregation
    pin_pipeline = [{"$facet": {
        "total": [{"$count": "c"}],
        "active_used": [{"$match": {"is_active": True, "is_used": True}}, {"$count": "c"}],
        "active_unused": [{"$match": {"is_active": True, "is_used": False}}, {"$count": "c"}],
        "revoked": [{"$match": {"is_active": False}}, {"$count": "c"}],
        "purchased": [{"$match": {"payment_ref": {"$ne": None}}}, {"$count": "c"}],
        "free_generated": [{"$match": {"payment_ref": None}}, {"$count": "c"}],
    }}]
    pin_result = (await db.pin_licenses.aggregate(pin_pipeline).to_list(1))
    pr = pin_result[0] if pin_result else {}
    total_pins = pr.get("total", [{}])[0].get("c", 0) if pr.get("total") else 0
    active_trading = pr.get("active_used", [{}])[0].get("c", 0) if pr.get("active_used") else 0
    active_unused = pr.get("active_unused", [{}])[0].get("c", 0) if pr.get("active_unused") else 0
    revoked = pr.get("revoked", [{}])[0].get("c", 0) if pr.get("revoked") else 0
    purchased = pr.get("purchased", [{}])[0].get("c", 0) if pr.get("purchased") else 0
    free_given = pr.get("free_generated", [{}])[0].get("c", 0) if pr.get("free_generated") else 0

    # Payment stats
    tx_pipeline = [{"$facet": {
        "total": [{"$count": "c"}],
        "paid": [{"$match": {"payment_status": "success"}}, {"$count": "c"}],
        "pending": [{"$match": {"payment_status": "pending"}}, {"$count": "c"}],
        "total_revenue": [{"$match": {"payment_status": "success"}}, {"$group": {"_id": None, "sum": {"$sum": "$amount_kobo"}}}],
    }}]
    tx_result = (await db.payment_transactions.aggregate(tx_pipeline).to_list(1))
    tr = tx_result[0] if tx_result else {}
    total_txs = tr.get("total", [{}])[0].get("c", 0) if tr.get("total") else 0
    paid_txs = tr.get("paid", [{}])[0].get("c", 0) if tr.get("paid") else 0
    pending_txs = tr.get("pending", [{}])[0].get("c", 0) if tr.get("pending") else 0
    revenue_kobo = tr.get("total_revenue", [{}])[0].get("sum", 0) if tr.get("total_revenue") else 0
    revenue_naira = revenue_kobo / 100

    # ML performance
    ml_total = await db.ml_patterns.count_documents({})
    ml_wins = await db.ml_patterns.count_documents({"was_winner": True})
    ml_losses = ml_total - ml_wins
    ml_win_rate = round(ml_wins / ml_total * 100, 1) if ml_total > 0 else 0
    contributors = len(await db.ml_patterns.distinct("pin")) if ml_total > 0 else 0

    # Total profit/loss pips from ML patterns
    pips_pipeline = [{"$group": {"_id": "$was_winner", "total_pips": {"$sum": "$profit_pips"}, "count": {"$sum": 1}}}]
    pips_result = await db.ml_patterns.aggregate(pips_pipeline).to_list(10)
    total_profit_pips = 0
    total_loss_pips = 0
    for p in pips_result:
        if p["_id"] == True:
            total_profit_pips = round(p["total_pips"], 1)
        else:
            total_loss_pips = round(abs(p["total_pips"]), 1)
    net_pips = round(total_profit_pips - total_loss_pips, 1)

    # Strategy performance
    strat_pipeline = [{"$group": {"_id": {"strategy": "$strategy", "winner": "$was_winner"}, "count": {"$sum": 1}, "pips": {"$sum": "$profit_pips"}}}]
    strat_results = await db.ml_patterns.aggregate(strat_pipeline).to_list(20)
    strategies = {}
    for r in strat_results:
        sid = r["_id"]["strategy"]
        sname = {0: "Trend", 1: "Range", 2: "Breakout"}.get(sid, f"S{sid}")
        if sname not in strategies:
            strategies[sname] = {"trades": 0, "wins": 0, "profit_pips": 0, "loss_pips": 0}
        strategies[sname]["trades"] += r["count"]
        if r["_id"]["winner"]:
            strategies[sname]["wins"] += r["count"]
            strategies[sname]["profit_pips"] += round(r["pips"], 1)
        else:
            strategies[sname]["loss_pips"] += round(abs(r["pips"]), 1)
    for s in strategies.values():
        s["win_rate"] = round(s["wins"] / s["trades"] * 100, 1) if s["trades"] > 0 else 0
        s["net_pips"] = round(s["profit_pips"] - s["loss_pips"], 1)

    # Recent activity (last 10 patterns)
    recent = await db.ml_patterns.find({}, {"_id": 0, "was_winner": 1, "profit_pips": 1, "strategy": 1, "confidence": 1, "created_at": 1}).sort("created_at", -1).limit(10).to_list(10)
    for r in recent:
        r["strategy_name"] = {0: "Trend", 1: "Range", 2: "Breakout"}.get(r.get("strategy", -1), "Unknown")

    return {
        "bots": {
            "total_sold": total_pins,
            "actively_trading": active_trading,
            "purchased_not_activated": active_unused,
            "revoked": revoked,
            "sold_via_payment": purchased,
            "free_generated": free_given,
        },
        "revenue": {
            "total_transactions": total_txs,
            "successful_payments": paid_txs,
            "pending_payments": pending_txs,
            "total_revenue_naira": revenue_naira,
            "formatted_revenue": f"\u20a6{revenue_naira:,.0f}",
        },
        "performance": {
            "total_trades": ml_total,
            "wins": ml_wins,
            "losses": ml_losses,
            "win_rate": ml_win_rate,
            "total_profit_pips": total_profit_pips,
            "total_loss_pips": total_loss_pips,
            "net_pips": net_pips,
            "active_traders": contributors,
            "profit_factor": round(total_profit_pips / total_loss_pips, 2) if total_loss_pips > 0 else 0,
        },
        "strategies": strategies,
        "recent_trades": recent,
    }

@api_router.put("/admin/account")
async def update_admin_account(req: AdminAccountUpdate, response: Response, admin: dict = Depends(get_current_admin)):
    """Change admin email and/or password"""
    user = await db.users.find_one({"email": admin["email"]})
    if not user:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if not verify_password(req.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    updates = {}
    if req.new_email and req.new_email.strip():
        new_email = req.new_email.strip().lower()
        if new_email != admin["email"]:
            existing = await db.users.find_one({"email": new_email})
            if existing:
                raise HTTPException(status_code=400, detail="Email already in use")
            updates["email"] = new_email
    if req.new_password and req.new_password.strip():
        if len(req.new_password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        updates["password_hash"] = hash_password(req.new_password)
    if not updates:
        return {"updated": False, "message": "No changes provided"}
    await db.users.update_one({"email": admin["email"]}, {"$set": updates})
    new_email = updates.get("email", admin["email"])
    new_token = create_access_token(str(user["_id"]), new_email)
    response.set_cookie(key="access_token", value=new_token, httponly=True,
                        secure=os.environ.get('COOKIE_SECURE', 'true').lower() != 'false',
                        samesite="strict", max_age=86400, path="/")
    return {"updated": True, "email": new_email, "message": "Account updated successfully"}

# -------------------------------------------------------------------
# CENTRALIZED ML ENGINE - Global Pattern Learning
# -------------------------------------------------------------------

class MLPatternSubmit(BaseModel):
    pin: str
    market_state: int  # 0=trend_up,1=trend_down,2=range,3=breakout_up,4=breakout_down
    strategy: int      # 0=trend,1=range,2=breakout
    ema_diff: float
    rsi_value: float
    atr_value: float
    bb_width: float
    hour_of_day: int
    day_of_week: int
    candle_body_ratio: float
    was_winner: bool
    profit_pips: float
    confidence: int

class MLConfidenceRequest(BaseModel):
    pin: str
    market_state: int
    strategy: int
    ema_diff: float
    rsi_value: float
    atr_value: float
    bb_width: float
    hour_of_day: int
    day_of_week: int

@api_router.post("/ml/submit-pattern")
async def ml_submit_pattern_retired():
    """v6.25.4 owner directive 2026-07-17 (URGENT P0 -- Phase 10 audit
    finding) -- retired. Not called by any EA version since at least
    v6.25.0 (grepped backend/ea_code/XAUUSD_AI_Sniper_EA.mq5 -- no caller),
    a dead active endpoint reachable over HTTP with no real product behind
    it. It also only ever required an active PIN (not the current caller's
    OWN bound account/ticket), so it was writable by any customer's PIN
    into a fully global, unsegmented db.ml_patterns collection -- the same
    class of issue closed on /journal/log and /ml/hive/score above."""
    raise HTTPException(status_code=410, detail="This endpoint is retired.")

@api_router.post("/ml/get-confidence")
async def ml_get_confidence_retired():
    """v6.25.4 -- retired, see ml_submit_pattern_retired(). No EA caller;
    formerly reachable by anyone holding any single active PIN."""
    raise HTTPException(status_code=410, detail="This endpoint is retired.")

@api_router.get("/ml/stats")
async def ml_stats_retired():
    """v6.25.4 -- retired, see ml_submit_pattern_retired() above. No EA
    caller; a dead active endpoint publicly exposing aggregate stats over
    the same unauthenticated global db.ml_patterns collection. The
    underlying computation is kept as _compute_ml_global_stats() for the
    still-live, admin-only /admin/ml/stats."""
    raise HTTPException(status_code=410, detail="This endpoint is retired.")

async def _compute_ml_global_stats():
    total = await db.ml_patterns.count_documents({})
    if total == 0:
        return {"total_patterns": 0, "global_win_rate": 0, "contributors": 0, "strategies": {}, "hourly_performance": [], "message": "No patterns yet. As users trade, the AI gets smarter."}

    wins = await db.ml_patterns.count_documents({"was_winner": True})
    contributors = len(await db.ml_patterns.distinct("pin"))

    # Strategy breakdown via aggregation
    strategies = {}
    strat_pipeline = [{"$group": {"_id": {"strategy": "$strategy", "was_winner": "$was_winner"}, "count": {"$sum": 1}}}]
    strat_results = await db.ml_patterns.aggregate(strat_pipeline).to_list(20)
    strat_data = {}
    for r in strat_results:
        sid = r["_id"]["strategy"]
        if sid not in strat_data:
            strat_data[sid] = {"total": 0, "wins": 0}
        strat_data[sid]["total"] += r["count"]
        if r["_id"]["was_winner"]:
            strat_data[sid]["wins"] += r["count"]
    for sid, sname in [(0, "Trend"), (1, "Range"), (2, "Breakout")]:
        if sid in strat_data and strat_data[sid]["total"] > 0:
            strategies[sname] = {"trades": strat_data[sid]["total"], "win_rate": round(strat_data[sid]["wins"] / strat_data[sid]["total"] * 100, 1)}

    # Hourly performance via aggregation
    hourly = []
    hour_pipeline = [{"$group": {"_id": {"hour": "$hour_of_day", "winner": "$was_winner"}, "count": {"$sum": 1}}}]
    hour_results = await db.ml_patterns.aggregate(hour_pipeline).to_list(100)
    hour_data = {}
    for r in hour_results:
        h = r["_id"]["hour"]
        if h not in hour_data:
            hour_data[h] = {"total": 0, "wins": 0}
        hour_data[h]["total"] += r["count"]
        if r["_id"]["winner"]:
            hour_data[h]["wins"] += r["count"]
    for h in sorted(hour_data.keys()):
        if hour_data[h]["total"] >= 3:
            hourly.append({"hour": h, "trades": hour_data[h]["total"], "win_rate": round(hour_data[h]["wins"] / hour_data[h]["total"] * 100, 1)})

    return {
        "total_patterns": total,
        "global_win_rate": round(wins / total * 100, 1) if total > 0 else 0,
        "contributors": contributors,
        "strategies": strategies,
        "hourly_performance": hourly,
    }

@api_router.get("/admin/ml/stats", dependencies=[Depends(get_current_admin)])
async def admin_ml_stats():
    """Detailed ML stats for admin"""
    stats = await _compute_ml_global_stats()
    # Add recent patterns
    recent = await db.ml_patterns.find({}, {"_id": 0, "market_state": 1, "strategy": 1, "was_winner": 1, "created_at": 1, "confidence": 1}).sort("created_at", -1).limit(20).to_list(20)
    stats["recent_patterns"] = recent
    return stats

async def _update_ml_stats():
    """Update cached ML stats periodically"""
    total = await db.ml_patterns.count_documents({})
    wins = await db.ml_patterns.count_documents({"was_winner": True})
    await db.ml_cache.update_one(
        {"key": "global_stats"},
        {"$set": {"total": total, "wins": wins, "win_rate": round(wins/total*100, 1) if total > 0 else 0, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )

# -------------------------------------------------------------------
# SMART FEATURES: News, DXY, Session, Recovery, Weekend, Reports
# -------------------------------------------------------------------

# Cache for economic calendar
_news_cache = []
_news_cache_time = 0

@api_router.get("/smart/news-events")
async def get_news_events():
    """Get upcoming high-impact economic events (for EA news filter)"""
    global _news_cache, _news_cache_time
    now = time.time()
    if now - _news_cache_time < 3600 and _news_cache:  # Cache 1 hour
        return {"events": _news_cache, "count": len(_news_cache)}

    events = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json")
            if resp.status_code == 200:
                data = resp.json()
                for ev in data:
                    impact = ev.get("impact", "").lower()
                    if impact in ["high", "medium"]:
                        events.append({
                            "title": ev.get("title", ""),
                            "country": ev.get("country", ""),
                            "date": ev.get("date", ""),
                            "impact": impact,
                            "forecast": ev.get("forecast", ""),
                            "previous": ev.get("previous", ""),
                        })
                # If we got events from external API, cache and return them
                if events:
                    _news_cache = events
                    _news_cache_time = now
                    return {"events": events, "count": len(events)}
    except Exception as e:
        logger.warning(f"News calendar fetch failed: {e}")

    # Fallback: hardcode known recurring high-impact events
    if not events:
        from datetime import date
        today = date.today()
        weekday = today.weekday()
        # NFP is first Friday of month
        events = [
            {"title": "NFP (if first Friday)", "country": "USD", "date": "", "impact": "high", "forecast": "", "previous": ""},
            {"title": "CPI (monthly)", "country": "USD", "date": "", "impact": "high", "forecast": "", "previous": ""},
            {"title": "FOMC (6-weekly)", "country": "USD", "date": "", "impact": "high", "forecast": "", "previous": ""},
        ]

    _news_cache = events
    _news_cache_time = now
    return {"events": events, "count": len(events)}

@api_router.get("/smart/dxy")
async def get_dxy_direction():
    """Get DXY (Dollar Index) direction for correlation filter"""
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    dxy_price = None
    dxy_change = None

    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            resp = await http.get("https://www.google.com/finance/quote/DXY:INDEXNYSEGIS", headers=headers, follow_redirects=True)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, 'lxml')
                pe = soup.find('div', class_='YMlKec fxKbKc')
                if pe:
                    try: dxy_price = float(pe.get_text(strip=True).replace(',', ''))
                    except: pass
                for el in soup.find_all('div', class_='JwB6zf'):
                    t = el.get_text(strip=True)
                    if '%' in t or any(c.isdigit() for c in t):
                        for p in t.replace(',', '').split():
                            c = p.replace('+', '').replace('%', '')
                            try:
                                v = float(c)
                                if '%' not in p and dxy_change is None:
                                    dxy_change = v
                            except: pass
                        break
    except Exception as e:
        logger.warning(f"DXY scrape failed: {e}")

    if dxy_price is None:
        dxy_price = 99.5
        dxy_change = 0.0
    if dxy_change is None:
        dxy_change = 0.0

    # DXY up = bearish for gold, DXY down = bullish for gold
    direction = "weakening" if dxy_change < 0 else "strengthening" if dxy_change > 0 else "neutral"
    gold_bias = "bullish" if dxy_change < 0 else "bearish" if dxy_change > 0 else "neutral"

    return {
        "dxy_price": round(dxy_price, 2),
        "dxy_change": round(dxy_change, 2),
        "dxy_direction": direction,
        "gold_bias": gold_bias,
        "recommendation": f"DXY {direction} -> Gold {gold_bias}. {'Favor BUY trades' if gold_bias == 'bullish' else 'Favor SELL trades' if gold_bias == 'bearish' else 'No bias'}.",
    }

@api_router.get("/smart/session-config")
async def get_session_config():
    """Session-specific strategy tuning recommendations"""
    return {
        "london": {
            "hours": "08:00-16:00 GMT",
            "preferred_strategies": ["trend", "breakout"],
            "confidence_threshold": 75,
            "description": "London = trend continuation. Best for directional trades.",
            "risk_multiplier": 1.0,
        },
        "new_york": {
            "hours": "13:00-21:00 GMT",
            "preferred_strategies": ["trend", "range"],
            "confidence_threshold": 80,
            "description": "NY = volatility + reversals. Higher confidence needed.",
            "risk_multiplier": 0.8,
        },
        "overlap": {
            "hours": "13:00-16:00 GMT",
            "preferred_strategies": ["breakout"],
            "confidence_threshold": 70,
            "description": "London-NY overlap = highest liquidity. Best breakout window.",
            "risk_multiplier": 1.2,
        },
        "asian": {
            "hours": "00:00-08:00 GMT",
            "preferred_strategies": ["range"],
            "confidence_threshold": 85,
            "description": "Asian = low volatility ranging. Very selective.",
            "risk_multiplier": 0.5,
        },
    }

@api_router.post("/smart/check-trade")
async def smart_check_trade_retired():
    """v6.25.4 -- retired, see ml_submit_pattern_retired() above. No EA
    caller; internally called the also-retired ml_get_confidence and the
    live /smart/dxy and weekend-gap checks, none of which are exercised
    by any current EA path (news/DXY/weekend gating is done independently
    in EA-local logic -- see NEWS_GATE_STARTED/COMPLETED in the EA
    source)."""
    raise HTTPException(status_code=410, detail="This endpoint is retired.")

@api_router.get("/admin/monthly-report", dependencies=[Depends(get_current_admin)])
async def admin_monthly_report():
    """Generate monthly performance report for admin"""
    total_patterns = await db.ml_patterns.count_documents({})
    wins = await db.ml_patterns.count_documents({"was_winner": True})
    total_txs = await db.payment_transactions.count_documents({})
    paid_txs = await db.payment_transactions.count_documents({"payment_status": "success"})
    total_pins = await db.pin_licenses.count_documents({})
    active_pins = await db.pin_licenses.count_documents({"is_active": True, "is_used": True})

    # Best/worst hours from ML data
    hour_pipeline = [{"$group": {"_id": {"hour": "$hour_of_day", "winner": "$was_winner"}, "count": {"$sum": 1}}}]
    hour_results = await db.ml_patterns.aggregate(hour_pipeline).to_list(100)
    hour_data = {}
    for r in hour_results:
        h = r["_id"]["hour"]
        if h not in hour_data: hour_data[h] = {"total": 0, "wins": 0}
        hour_data[h]["total"] += r["count"]
        if r["_id"]["winner"]: hour_data[h]["wins"] += r["count"]

    best_hours = sorted(
        [{"hour": h, "win_rate": round(d["wins"]/d["total"]*100, 1), "trades": d["total"]} for h, d in hour_data.items() if d["total"] >= 3],
        key=lambda x: x["win_rate"], reverse=True
    )[:5]

    worst_hours = sorted(
        [{"hour": h, "win_rate": round(d["wins"]/d["total"]*100, 1), "trades": d["total"]} for h, d in hour_data.items() if d["total"] >= 3],
        key=lambda x: x["win_rate"]
    )[:5]

    s = await get_settings()
    price_naira = s.get("pin_price_kobo", 30000000) / 100

    best_str = ', '.join([f'{h["hour"]}:00 ({h["win_rate"]}%)' for h in best_hours[:3]])
    worst_str = ', '.join([f'{h["hour"]}:00 ({h["win_rate"]}%)' for h in worst_hours[:3]])

    return {
        "ml_stats": {
            "total_patterns": total_patterns,
            "global_win_rate": round(wins / total_patterns * 100, 1) if total_patterns > 0 else 0,
        },
        "sales": {
            "total_transactions": total_txs,
            "successful_payments": paid_txs,
            "revenue_naira": paid_txs * price_naira,
            "total_pins": total_pins,
            "active_users": active_pins,
        },
        "best_trading_hours": best_hours,
        "worst_trading_hours": worst_hours,
        "recommendations": [
            f"Best trading hours: {best_str}",
            f"Avoid trading at: {worst_str}",
            f"Revenue so far: \u20a6{paid_txs * price_naira:,.0f} from {paid_txs} sales",
        ] if best_hours else ["Not enough data yet. As more users trade, insights will appear."]
    }

# -------------------------------------------------------------------
# STARTUP
# -------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@aisniper.com").lower()
    admin_password_env = os.environ.get("ADMIN_PASSWORD")
    # v6.5.0 (audit bug #9): a hardcoded fallback password ("Admin@2026!") sat
    # in this file on a public GitHub repo — anyone who ever read the source
    # knew the admin login for any deployment that hadn't set ADMIN_PASSWORD.
    # Admin access grants master-EA download, Paystack/SMTP settings, and
    # license operations, so no fallback should ever be a known constant.
    # If ADMIN_PASSWORD isn't set, generate a random one-time password and
    # log it (visible only in server logs) instead of a public default.
    generated_password = None
    if admin_password_env:
        admin_password = admin_password_env
    else:
        generated_password = secrets.token_urlsafe(18)
        admin_password = generated_password
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_password), "name": "Admin", "role": "admin", "created_at": datetime.now(timezone.utc).isoformat()})
        if generated_password:
            logger.warning(f"Admin seeded: {admin_email} — ADMIN_PASSWORD env var not set, generated one-time password: {generated_password} (set ADMIN_PASSWORD to avoid a new random password on next restart)")
        else:
            logger.info(f"Admin seeded: {admin_email}")
    elif admin_password_env and not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Admin password updated")
    await db.users.create_index("email", unique=True)
    # v6.25.3 owner directive 2026-07-17 (Phase 2 P0) -- exactly one PIN may
    # ever exist per payment reference, enforced at the database level (not
    # just by application logic, which the new atomic state machine in
    # _fulfill_payment() already makes the primary guard -- this is
    # defense-in-depth against any future code path that bypasses it).
    # reference is already unique per initialize_purchase (uuid4-derived),
    # but a unique index makes that guarantee real rather than assumed.
    try:
        await db.payment_transactions.create_index("reference", unique=True)
    except Exception as e:
        logger.warning(f"[payments] could not create payment_transactions.reference index: {e}")
    try:
        await db.pin_licenses.create_index(
            "payment_ref", unique=True,
            partialFilterExpression={"payment_ref": {"$type": "string"}})
    except Exception as e:
        logger.warning(f"[payments] could not create pin_licenses.payment_ref index: {e}")
    # Audit fix: cloud_notification_log's idempotency check was check-then-
    # insert with no DB-level guard -- safe today only because a single
    # backend process drives the outlook notification loops sequentially
    # (never concurrently). A unique index makes the guarantee real
    # regardless of process count: a duplicate insert now raises inside
    # send_outlook_notification's existing blanket try/except (notifications.py),
    # which logs and leaves the persisted event retryable rather than
    # propagating -- so this
    # closes the race without needing new error-handling code.
    try:
        await db.cloud_notification_log.create_index("idempotency_key", unique=True)
    except Exception as e:
        logger.warning(f"[outlook-notifications] could not create idempotency_key index: {e}")
    try:
        from local_ai.remote_relay import ensure_indexes as _ensure_local_ai_remote_indexes
        await _ensure_local_ai_remote_indexes(db)
    except Exception as e:
        logger.warning(f"[local-ai-remote] could not create queue indexes: {e}")
    try:
        # Signal Outlook hot paths: tenant history/current lookups, the open
        # lifecycle scan, restart quote replay, and one authoritative outcome
        # row per outlook. These indexes affect monitoring latency only; they
        # do not alter any trading or classification rule.
        await db.cloud_market_outlooks.create_index([("account", 1), ("generated_at", -1)])
        await db.cloud_market_outlooks.create_index([("monitoring_closed", 1), ("primary_direction", 1), ("account", 1)])
        await db.cloud_market_outlook_outcomes.create_index("outlook_id", unique=True)
        await db.cloud_bot_activity.create_index([("account", 1), ("ts", 1)])
        await db.cloud_notification_prefs.create_index("user_id", unique=True)
        await db.cloud_push_subscriptions.create_index([("user_id", 1), ("opted_in", 1)])
        await db.cloud_outlook_signal_events.create_index(
            [("account", 1), ("candidate_id", 1), ("event_type", 1), ("event_version", 1)],
            unique=True,
        )
        await db.cloud_outlook_signal_events.create_index(
            [("account", 1), ("symbol", 1), ("signal_bar_time", -1), ("event_time", -1)]
        )
    except Exception as e:
        logger.warning(f"[signal-outlook] could not create lifecycle indexes: {e}")

    # v6.25.6 XAU-027 (Codex handover) -- tenant-scoped remote-command
    # idempotency. dedupe_key is "{user_id}:{action}:{client_key}"; the
    # unique index is what makes cloud_command_request's DuplicateKeyError
    # handling a real guarantee rather than a best-effort race. Sparse
    # because every command queued before this release has no dedupe_key
    # field at all -- a plain unique index would treat all of those missing
    # values as a single duplicate "null" and fail to build against real
    # existing production data.
    try:
        await db.cloud_bot_commands.create_index("dedupe_key", unique=True, sparse=True)
    except Exception as e:
        logger.warning(f"[remote-command] could not create dedupe_key index: {e}")

    # v6.25.3 owner directive 2026-07-17 (Phase 6 P0 -- DB index audit) --
    # these two were real gaps, not just missing hardening:
    #   - cloud_signup() already catches DuplicateKeyError to close a
    #     concurrent-signup race, but with no unique index on
    #     cloud_users.email that exception could never actually be raised --
    #     the race this code claims to close was still open.
    #   - pin_licenses.pin is the license key itself; nothing in the
    #     codebase previously enforced at the DB level that two documents
    #     couldn't exist for the same PIN.
    # Startup migration/index report: logged once per boot so an operator
    # can see index state without querying MongoDB directly.
    _index_report = []
    try:
        await db.cloud_users.create_index("email", unique=True)
        _index_report.append("cloud_users.email: unique OK")
    except Exception as e:
        _index_report.append(f"cloud_users.email: FAILED ({e})")
    try:
        await db.pin_licenses.create_index("pin", unique=True)
        _index_report.append("pin_licenses.pin: unique OK")
    except Exception as e:
        _index_report.append(f"pin_licenses.pin: FAILED ({e})")
    try:
        # login_audit_log grows unbounded otherwise -- 180-day retention is
        # long enough for real abuse investigation, short enough not to
        # become an unbounded collection.
        await db.login_audit_log.create_index("ts", expireAfterSeconds=180 * 86400)
        _index_report.append("login_audit_log.ts: TTL(180d) OK")
    except Exception as e:
        _index_report.append(f"login_audit_log.ts: FAILED ({e})")
    try:
        # Backs the password-reset single-use enforcement in
        # cloud_reset_password(); TTL matches the token's own 30-minute
        # expiry plus a safety buffer, so this collection never grows
        # unbounded either.
        await db.used_password_reset_tokens.create_index("jti", unique=True)
        await db.used_password_reset_tokens.create_index("used_at", expireAfterSeconds=3600)
        _index_report.append("used_password_reset_tokens: unique+TTL OK")
    except Exception as e:
        _index_report.append(f"used_password_reset_tokens: FAILED ({e})")
    logger.info("[startup] index report: " + " | ".join(_index_report))
    # v6.25.3 owner directive 2026-07-17 -- push notifications now go through
    # OneSignal's REST API (backend/notifications.py), which reads its
    # App ID/REST API Key live from db.admin_settings on every send -- no
    # startup initialization needed (unlike the retired self-hosted VAPID
    # keypair system, which required this exact startup step and was
    # permanently blocked by a missing Python package that only a full
    # backend rebuild could fix).
    # v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired the one-time
    # cloud_shadow_trades -> cloud_signals backfill migration; both
    # collections belong to the deleted copy-trading subsystem (see
    # backend/migrations/0001_delete_copy_trading.py).
    if os.environ.get("WRITE_TEST_CREDENTIALS") == "1":
        creds_path = Path("/app/memory/test_credentials.md")
        creds_path.parent.mkdir(exist_ok=True)
        creds_path.write_text(f"# Test Credentials\n\n## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n## Endpoints\n- Login: POST /api/auth/login\n- Admin Portal: /admin\n")

    # v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired
    # _decay_stale_workers() (copy-trading VPS worker online/offline decay
    # loop, cloud_workers collection). See
    # backend/migrations/0001_delete_copy_trading.py.

    # AI Market Outlook background loops -- advisory-only, see
    # market_outlook.py's own module docstring for the strict-separation
    # guarantee. Both loops are entirely independent of every other
    # background task here; a failure in either never touches trading state.
    async def _outlook_hourly_loop():
        # Audit fix: the import used to sit OUTSIDE the try/except below --
        # harmless today (market_outlook.py has no execution-time risk at
        # import), but a future edit that broke it at import time would have
        # killed this task permanently on its very first run (asyncio never
        # retries a task that raises before its first await), with no signal
        # beyond a buried "Task exception was never retrieved" warning.
        # Moved inside the loop's own try/except so an import failure is
        # logged and retried every hour like any other tick failure.
        #
        # v6.24.18 owner directive 2026-07-16 -- root-cause fix. The OLD loop
        # slept a flat 3600s from whenever it last ran, which is anchored to
        # SERVER START TIME, not the wall clock: a server that started at
        # :51 past the hour ticks forever at :51, never at :00. Combined with
        # hourly_generation_tick's OLD 55-minute rolling-window dedup check,
        # this is exactly what produced "Last Outlook: 6:51 PM, Next Outlook
        # skipped 7:00 PM". The loop now sleeps only until the next real
        # UTC hour boundary (plus a small buffer so the boundary has fully
        # elapsed), so under normal operation it fires at :00 every hour
        # regardless of when the server started. hourly_generation_tick's
        # own exact-slot-key check (see its docstring) is the second,
        # independent layer that also tolerates a delayed/retried tick
        # without skipping or duplicating a slot.
        from datetime import datetime, timezone, timedelta as _timedelta
        while True:
            try:
                import market_outlook as _mo
                published = await _mo.hourly_generation_tick()
                if published:
                    logger.info(f"[outlook-hourly] published {published} outlook(s)")
            except Exception as e:
                logger.warning(f"[outlook-hourly] {e}")
            now = datetime.now(timezone.utc)
            next_hour = (now.replace(minute=0, second=0, microsecond=0) + _timedelta(hours=1))
            sleep_seconds = max(30.0, (next_hour - now).total_seconds() + 15.0)
            await asyncio.sleep(sleep_seconds)

    async def _outlook_lifecycle_loop():
        while True:
            try:
                import market_outlook as _mo
                await _mo.track_outlook_lifecycle_tick()
            except Exception as e:
                logger.warning(f"[outlook-lifecycle] {e}")
            await asyncio.sleep(60)

    async def _outlook_history_repair_once():
        # Idempotent v2 migration: actionable legacy records are rebuilt only
        # from persisted broker quotes. Missing/sparse history is explicitly
        # excluded rather than fabricated as a timeout loss.
        try:
            import market_outlook as _mo
            report = await _mo.backfill_signal_outlook_history()
            logger.info(f"[outlook-history-repair] {report}")
        except Exception as e:
            logger.warning(f"[outlook-history-repair] {e}")

    asyncio.create_task(_outlook_hourly_loop())
    asyncio.create_task(_outlook_lifecycle_loop())
    asyncio.create_task(_outlook_history_repair_once())

########################################
# CLAUDE AI POSITION MANAGER (Active Trade Reasoning)
########################################
class PositionCheckRequest(BaseModel):
    pin: str = ""
    account_id: str = ""  # multi-instance fix: per-account AI budget/throttle (falls back to a shared bucket when omitted by older EA builds)
    symbol: str = "XAUUSD"
    direction: str = ""
    entry_price: float = 0
    current_price: float = 0
    profit: float = 0
    lots: float = 0
    rsi: float = 0
    ema_fast: float = 0
    ema_slow: float = 0
    atr: float = 0
    minutes_open: int = 0
    sl: float = 0
    tp: float = 0
    # v4.5.0: mid-trade thesis audit fields
    thesis: str = ""            # original entry thesis
    invalidation: str = ""      # condition that invalidates the trade
    confidence: int = 0         # original entry confidence (0-100)
    # v4.7.0: richer context for AI veto on rule-based close attempts
    peak_profit: float = 0      # highest profit reached on this trade
    pending_exit_reason: str = "" # "MOMENTUM_FADE" / "TIME_EXPIRED" / "STALE_DRIFT" / "" (regular audit)
    regime: str = ""            # current market regime (TRENDING_UP, RANGING, etc.)
    # v6.3.5: enriched exit context
    r_mult: float = 0.0         # current profit in R-multiples (e.g. 2.3R)
    htf_consensus: str = "NEUTRAL"  # BULL / BEAR / NEUTRAL — structural trend alignment
    session: str = ""           # current session name
    setup_name: str = ""        # original setup type that triggered entry
    daily_pct: float = 0.0      # account daily P&L %
    open_positions: int = 1     # total open positions in basket

@api_router.post("/ai/manage-position")
async def ai_manage_position(req: PositionCheckRequest, request: Request):
    if not req.account_id:
        raise HTTPException(status_code=400, detail="account_id is required")
    await _resolve_monitor_license(req.pin, req.account_id, request)
    try:
        if not LLM_KEY:
            return {"action": "HOLD", "reason": "AI not configured", "consensus_source": "local_only_cost_guard"}

        payload = req.model_dump(exclude={"pin"})
        cache_key = _ai_cost_state_hash("exit", payload)
        cached = _ai_cache_get(cache_key)
        if cached:
            return cached
        high_impact = bool(req.pending_exit_reason) or abs(req.profit) >= 75 or req.peak_profit >= 150
        allowed, budget_reason = _ai_budget_allows("exit", cache_key, high_impact=high_impact, account_id=req.account_id)
        if not allowed:
            logger.info("%s purpose=exit key=%s", budget_reason, cache_key)
            return {
                "action": "HOLD",
                "reason": budget_reason,
                "consensus_source": "local_only_cost_guard",
                "ai_cost": {**_ai_cost_snapshot(), "cache_key": cache_key, "reason": budget_reason},
            }

        # v4.7.0 — AI exit brain with action expansion.
        # Returns one of: HOLD, CLOSE, LOCK (with lock_usd $ amount)
        # When pending_exit_reason is set, the EA is asking AI to VETO a rule-based close.
        is_veto = bool(req.pending_exit_reason)
        has_thesis = bool(req.thesis and len(req.thesis) > 20)

        if is_veto:
            system_msg = f"""You are a XAUUSD M10 trade auditor. The bot's rule-based logic wants to CLOSE this position because of: {req.pending_exit_reason}.

Your job: VETO the close if the original thesis is still intact, OR confirm if the rule is right.

RESPOND IN EXACTLY THIS JSON (no markdown fences):
{{"action":"HOLD","reason":"short reason"}}

Rules:
- action: HOLD (veto the close — let trade run) or CLOSE (confirm rule was right) or LOCK (close half OR move SL into profit by lock_usd amount).
- If action is LOCK include "lock_usd": <number> — the $ profit you want SL to bank as floor (the EA will move SL there).
- reason: max 30 words — reference whether the original thesis is still true.
- BIAS toward HOLD/LOCK over CLOSE — give winners room. Only CLOSE if the original thesis is invalidated or trend has clearly flipped against position.
- LOCK is your friend: if the trade is up but momentum is uncertain, LOCK $X (a fraction of current profit) to bank the win without giving up the runner."""
        else:
            system_msg = """You are a XAUUSD M10 trade auditor for an open position. Decide HOLD, CLOSE, or LOCK.

RESPOND IN EXACTLY THIS JSON (no markdown fences):
{"action":"HOLD","reason":"short reason"}

Rules:
- action: HOLD, CLOSE, or LOCK.
- If action is LOCK include "lock_usd": <number> — the $ profit you want SL to bank.
- reason: max 30 words.
- HOLD is the default — give trades time to work. Only CLOSE if the original thesis is invalidated or trend has clearly flipped against position.
- Use LOCK when profit is meaningful but you want to bank a floor without exiting. Example: profit $700 peak, now $600 with momentum slowing → LOCK $300."""

        chat = LlmChat(
            api_key=LLM_KEY,
            session_id=f"manage-{uuid.uuid4().hex[:8]}",
            system_message=system_msg
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")

        pnl_str = f"+${req.profit:.2f}" if req.profit > 0 else f"-${abs(req.profit):.2f}"
        peak_str = f"+${req.peak_profit:.2f}" if req.peak_profit > 0 else "n/a"
        giveback = req.peak_profit - req.profit if req.peak_profit > req.profit else 0
        thesis_block = ""
        if has_thesis:
            thesis_block = f"""
ORIGINAL ENTRY THESIS:
"{req.thesis[:400]}"

ORIGINAL INVALIDATION: "{req.invalidation[:200] if req.invalidation else 'not specified'}"
ORIGINAL CONFIDENCE: {req.confidence}/100
"""
        veto_block = f"\n⚠️  RULE WANTS TO CLOSE: '{req.pending_exit_reason}'. Veto this if thesis is still intact." if is_veto else ""
        # v6.3.5: richer structured exit prompt
        htf_line = f"HTF Consensus: {req.htf_consensus} | Regime: {req.regime or 'unknown'} | Session: {req.session or 'unknown'}"
        perf_line = f"R-Multiple: {req.r_mult:.1f}R | Giveback from peak: ${giveback:.0f} | Daily P/L: {req.daily_pct:+.1f}% | Positions: {req.open_positions}"
        prompt = f"""OPEN {req.direction} POSITION — XAUUSD M10

POSITION STATE
- Entry: {req.entry_price} | Now: {req.current_price} | Lots: {req.lots}
- P/L: {pnl_str} | Peak: {peak_str} | {perf_line}
- Open: {req.minutes_open} min | SL: {req.sl} | TP: {req.tp}
- Setup: {req.setup_name or 'unknown'}

MARKET STATE
- {htf_line}
- EMA Fast: {req.ema_fast:.2f} | EMA Slow: {req.ema_slow:.2f} ({"BULL" if req.ema_fast > req.ema_slow else "BEAR"})
- RSI: {req.rsi:.1f} | ATR: {req.atr:.2f}{veto_block}
{thesis_block}
Decision (HOLD / CLOSE / LOCK)? JSON only."""

        msg = UserMessage(text=prompt)
        response = await chat.send_message(msg)
        cost_meta = _record_ai_cost("anthropic", "claude-sonnet-4-5-20250929",
                                    system_msg + "\n" + prompt, response,
                                    "exit", cache_key,
                                    "exit conflict/news/profit-management audit",
                                    account_id=req.account_id)

        import json, re
        cleaned = response.strip()
        fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
        if fence:
            cleaned = fence.group(1).strip()
        if not cleaned.startswith("{"):
            m = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if m:
                cleaned = m.group(0)
        try:
            result = json.loads(cleaned)
            result["action"] = str(result.get("action", "HOLD")).upper()
            if result["action"] not in ["HOLD", "CLOSE", "LOCK"]:
                result["action"] = "HOLD"
            result["reason"] = str(result.get("reason", ""))[:200]
            # Coerce lock_usd into float if present
            if result["action"] == "LOCK":
                try:
                    result["lock_usd"] = float(result.get("lock_usd", 0) or 0)
                except (TypeError, ValueError):
                    result["lock_usd"] = 0.0
                if result["lock_usd"] <= 0:
                    # No valid lock amount → degrade to HOLD
                    result["action"] = "HOLD"
                    result["reason"] = "LOCK requested but no lock_usd → HOLD"
            result["ai_cost"] = cost_meta
            _ai_cache_put(cache_key, result, "exit", cost_meta["tokens"])
            return result
        except json.JSONDecodeError:
            up = response.upper()
            if '"CLOSE"' in up or "ACTION:CLOSE" in up.replace(" ", ""):
                result = {"action": "CLOSE", "reason": "parser fallback", "ai_cost": cost_meta}
                _ai_cache_put(cache_key, result, "exit", cost_meta["tokens"])
                return result
            result = {"action": "HOLD", "reason": "AI response unclear", "ai_cost": cost_meta}
            _ai_cache_put(cache_key, result, "exit", cost_meta["tokens"])
            return result
    except Exception as e:
        logger.error(f"Position manager error: {e}")
        return {"action": "HOLD", "reason": f"Error: {str(e)[:50]}"}

########################################
# AI MARKET ANALYSIS (GPT-5.2)
########################################
class AIAnalysisRequest(BaseModel):
    pin: str = ""
    account_id: str = ""  # multi-instance fix: per-account AI budget/throttle (falls back to a shared bucket when omitted by older EA builds)
    symbol: str = "XAUUSD"
    ema_fast: float = 0
    ema_slow: float = 0
    rsi: float = 0
    stoch: float = 50.0
    mom: float = 0.0
    atr: float = 0
    price: float = 0
    h1_trend: str = "FLAT"
    spread: float = 0
    recent_candles: str = ""
    setup: str = ""
    regime: str = ""
    signature: str = ""
    # v6.3.0: AI Director rich context fields
    htf_consensus: str = "NEUTRAL"
    session: str = ""
    session_quality: float = 1.0
    open_positions: int = 0
    basket_float_pl: float = 0.0
    recent_wins: int = 0
    recent_losses: int = 0
    account_equity: float = 0.0
    daily_pct: float = 0.0
    grade: str = ""
    setup_score: float = 0.0
    combined_score: float = 0.0

class TradeMemoryRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    event: str = "CLOSE"
    pin: str = ""
    time: str = ""
    account: str = ""
    broker: str = ""
    ea_version: str = ""
    build_hash: str = ""
    input_hash: str = ""
    symbol: str = "XAUUSD"
    timeframe: str = "M10"
    magic_number: int = 0
    session: str = ""
    strategy: str = ""
    direction: str = ""
    entry_price: float = 0.0
    exit_price: float = 0.0
    lot_size: float = 0.0
    grade: str = ""
    confidence: int = 0
    market_regime: str = ""
    news_state: str = ""
    spread_state: str = ""
    spread_points: float = 0.0
    htf_trend: str = ""
    m1_confirm: str = ""
    m5_confirm: str = ""
    m15_confirm: str = ""
    m30_confirm: str = ""
    h1_confirm: str = ""
    entry_reason: str = ""
    exit_reason: str = ""
    max_floating_profit: float = 0.0
    max_floating_loss: float = 0.0
    profit_at_close: float = 0.0
    profit_left_after_exit: float = 0.0
    risk_avoided_after_exit: float = 0.0
    entry_quality: str = ""
    exit_quality: str = ""
    lot_quality: str = ""
    should_hold_longer: bool = False
    should_close_earlier: bool = False
    what_ai_should_remember: str = ""
    block_reason: str = ""
    checkpoint_min: int = 0
    would_trade_have_won: bool = False
    would_trade_have_lost: bool = False

class TradeMemoryQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")
    symbol: str = "XAUUSD"
    account: str = ""
    broker: str = ""
    strategy: str = ""
    direction: str = ""
    session: str = ""
    volatility: str = ""
    spread_state: str = ""
    htf_trend: str = ""
    news_state: str = ""
    fast_confirmation: str = ""
    exhaustion: str = ""
    liquidity: str = ""
    grade: str = ""
    limit: int = 250

def _trade_memory_state_hash(data: dict) -> str:
    fields = {
        "symbol": str(data.get("symbol", "")).upper(),
        "account": str(data.get("account", "")),
        "broker": str(data.get("broker", "")).upper(),
        "strategy": str(data.get("strategy", "")).upper(),
        "direction": str(data.get("direction", "")).upper(),
        "session": str(data.get("session", "")).upper(),
        "grade": str(data.get("grade", "")).upper(),
        "regime": str(data.get("market_regime") or data.get("volatility") or "").upper(),
        "spread_state": str(data.get("spread_state", "")).upper(),
        "htf_trend": str(data.get("htf_trend", "")).upper(),
        "news_state": str(data.get("news_state", "")).upper(),
    }
    return hashlib.sha256(_json.dumps(fields, sort_keys=True).encode("utf-8")).hexdigest()[:24]

def _load_trade_memory(limit: int = 5000) -> list[dict]:
    if not TRADE_MEMORY_PATH.exists():
        return []
    rows: list[dict] = []
    with open(TRADE_MEMORY_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(_json.loads(line))
            except Exception:
                continue
    return rows[-limit:]

def _score_memory_similarity(query: dict, row: dict) -> float:
    score = 0.0
    checks = [
        ("symbol", 3.0),
        ("strategy", 4.0),
        ("direction", 3.0),
        ("session", 1.5),
        ("spread_state", 1.5),
        ("htf_trend", 2.0),
        ("news_state", 1.0),
        ("grade", 2.0),
    ]
    for field, weight in checks:
        qv = str(query.get(field, "")).upper()
        rv = str(row.get(field, "")).upper()
        if qv and rv and qv == rv:
            score += weight
    q_regime = str(query.get("volatility") or query.get("market_regime") or "").upper()
    r_regime = str(row.get("market_regime") or "").upper()
    if q_regime and r_regime and q_regime == r_regime:
        score += 2.0
    if str(query.get("broker", "")).upper() and str(query.get("broker", "")).upper() == str(row.get("broker", "")).upper():
        score += 0.75
    return score

def _memory_confidence_weight(samples: int) -> str:
    # Aggregate-only rule:
    # 1 similar memory = information only
    # 5 similar memories = weak influence
    # 20+ similar memories = strong influence
    # 50+ similar memories = trusted pattern
    if samples >= 50:
        return "trusted pattern"
    if samples >= 20:
        return "strong influence"
    if samples >= 5:
        return "weak influence"
    return "information only"

def _build_memory_recommendation(query: dict, matches: list[dict]) -> dict:
    samples = len(matches)
    wins = sum(1 for r in matches if float(r.get("profit_at_close", 0) or 0) > 0)
    losses = sum(1 for r in matches if float(r.get("profit_at_close", 0) or 0) < 0)
    wr = round((wins / samples) * 100.0, 1) if samples else 0.0
    avg_mfe = round(sum(float(r.get("max_floating_profit", 0) or 0) for r in matches) / samples, 2) if samples else 0.0
    avg_mae = round(sum(float(r.get("max_floating_loss", 0) or 0) for r in matches) / samples, 2) if samples else 0.0
    avg_left = round(sum(float(r.get("profit_left_after_exit", 0) or 0) for r in matches) / samples, 2) if samples else 0.0
    early = sum(1 for r in matches if bool(r.get("should_hold_longer")) or str(r.get("exit_quality", "")).upper().find("EARLY") >= 0)
    early_rate = round((early / samples) * 100.0, 1) if samples else 0.0
    influence = _memory_confidence_weight(samples)

    recommendation = "record only; not enough aggregate evidence"
    if samples >= 5:
        if early_rate >= 60.0 and avg_left > 0:
            recommendation = "reduce early-exit pressure; similar trades often left profit after close"
        elif wr <= 35.0 and losses > wins:
            recommendation = "reduce lot or require stronger confirmation; similar setups have weak expectancy"
        elif wr >= 62.0 and avg_mfe > abs(avg_mae):
            recommendation = "allow normal trade management; similar setups show positive follow-through"
        else:
            recommendation = "neutral memory influence; keep local rules in control"

    text = (
        f"AI-MEMORY: Found {samples} similar {query.get('strategy','UNKNOWN')} "
        f"{query.get('direction','')} setups. Win rate: {wr}%. Avg MFE: {avg_mfe}. "
        f"Avg MAE: {avg_mae}. Early-exit rate: {early_rate}%. "
        f"Confidence: {influence}. Recommendation: {recommendation}."
    )
    return {
        "similar_memories": samples,
        "wins": wins,
        "losses": losses,
        "win_rate": wr,
        "avg_mfe": avg_mfe,
        "avg_mae": avg_mae,
        "avg_profit_left_after_exit": avg_left,
        "early_exit_rate": early_rate,
        "confidence_weight": influence,
        "recommendation": recommendation,
        "text": text,
    }

# ------- shared helpers -------
# v6.4.21: AI Director persona — advisor/score input; local EA Trade Mode owns veto strictness
_ENTRY_SYSTEM_PROMPT = """You are the AI Director for an XAUUSD M10 evidence system with an optional three-snapshot M30 execution authority. You are an advisory probability scorer. The local EA rule engine and selected Decision Mode own final execution authority. You review full market context and recommend ALLOW, BLOCK, or ADJUST, but only true danger should be treated as a hard veto.

You receive complete context: price, indicators, H1/HTF trend, session, open positions, basket P/L, account state, recent win/loss streak, trade grade, and setup scores. Use ALL of it.

You MUST respond in EXACTLY this JSON format (NO markdown fences, NO extra fields):
{"action":"BUY","confidence":75,"reason":"short reason","thesis":"detailed trader narrative","bearish_case":"counter-argument","skip_if":"cancel condition pre-entry","invalidation":"what proves thesis wrong post-entry","target":"realistic price target","claude":{"action":"BUY","confidence":75},"gpt":{"action":"BUY","confidence":72},"sl_adjust":0,"tp_adjust":0}

Rules:
- action: BUY, SELL, or SKIP (only these 3). This is the FINAL decision — the EA will execute or block based on it.
- confidence: 0-100. BE HONEST:
    • 90-100: textbook setup, every confluent factor aligned, HTF agrees, session right — full size
    • 75-89: strong, 4/5 factors — normal size
    • 60-74: decent but something's off — reduced size
    • 50-59: marginal — flag as low confidence, EA will reduce size further
    • <50: SKIP — do not send to execution
  Do NOT inflate. A downstream gate blocks trades below the configured minimum.
- reason: max 30 words
- thesis: 50-90 words — explain SETUP, HTF CONTEXT, SESSION TIMING, and WHY this edge exists NOW
- bearish_case: 30-60 words — genuine counter-argument. What would make this fail? What are you ignoring? MANDATORY even for 90%+ confidence.
- skip_if: 15-25 words — specific pre-entry cancellation condition
- invalidation: 15-25 words — post-entry thesis failure signal
- target: realistic target price or level grounded in the supplied completed M10 evidence
- claude: your own vote as Claude (action + confidence)
- gpt: simulate a GPT-style second opinion (action + confidence) — independent, can disagree
- sl_adjust: -1 to 1 (negative=tighter, positive=wider, 0=default)
- tp_adjust: -1 to 1 (negative=tighter, positive=wider, 0=default)

Key decision factors (in order of importance):
1. HTF consensus (H1+HTF both agree?) — strongest filter. Counter-consensus trades need 80%+ confidence.
2. Market regime — RANGING/LOW_VOL need HTF support. TRENDING allows more setups.
3. Session — London/NY overlap setups carry much higher weight.
4. Account state — if basket_float_pl is deeply negative, tighten standards. If on a loss streak, require 75%+ confidence.
5. Grade/score — A+ grade from the rule engine is a precondition, not a guarantee.
6. Spread — if spread > 2.5× ATR fraction, SKIP.

Be a professional. If the market is choppy with no consensus and you're on a 3-loss streak, SKIP. If HTF is clearly bullish and price is pulling back with RSI < 50, BUY with conviction. Think like the best human trader who never chases and never freezes."""

def _build_entry_prompt(req: AIAnalysisRequest) -> str:
    basket_sign = "+" if req.basket_float_pl >= 0 else ""
    htf_line = f"H1: {req.h1_trend} | HTF Consensus: {req.htf_consensus}"
    account_line = (f"Account Equity: ${req.account_equity:,.0f} | Daily P/L: {req.daily_pct:+.1f}% | "
                    f"Basket Float: {basket_sign}{req.basket_float_pl:.0f} USD")
    # v6.3.7: recent_wins/recent_losses are now last-10-trade sliding window (fixed from all-time totals)
    streak_line = f"Last 10 trades: {req.recent_wins}W / {req.recent_losses}L | Open Positions: {req.open_positions}"
    score_line = (f"Grade: {req.grade or 'N/A'} | Setup Score: {req.setup_score:.1f} | "
                  f"Combined Score: {req.combined_score:.1f}")
    # v6.3.7: render recent_candles when populated (format: "O/H/L/C O/H/L/C ..." oldest-first, 5 bars)
    # EA sends bars oldest-first: index 0 = bar[5], index 4 = bar[1] (most recent closed)
    candles_section = ""
    if req.recent_candles and req.recent_candles.strip():
        candle_entries = req.recent_candles.strip().split()
        labeled = []
        total = min(len(candle_entries), 5)
        for idx, c in enumerate(candle_entries[-total:]):
            bar_offset = total - idx  # bar[5]=5, bar[4]=4, ... bar[1]=1
            parts = c.split("/")
            if len(parts) == 4:
                o, h, l, cl = parts
                body = float(cl) - float(o)
                direction = "bull" if body >= 0 else "bear"
                label = "most recent closed" if bar_offset == 1 else f"{bar_offset} bars ago"
                labeled.append(f"  [{label}]: O={o} H={h} L={l} C={cl} ({direction})")
        if labeled:
            candles_section = "\nRECENT PRICE ACTION (completed M10 bars, oldest→newest)\n" + "\n".join(labeled)
    return f"""XAUUSD M10 — AI DIRECTOR REVIEW

PRICE & INDICATORS
- Price: {req.price} | ATR(14): {req.atr} | Spread: {req.spread:.0f} pts
- EMA Fast: {req.ema_fast:.2f} | EMA Slow: {req.ema_slow:.2f} ({"ABOVE" if req.ema_fast > req.ema_slow else "BELOW"})
- RSI(14): {req.rsi:.1f} | Stoch: {req.stoch:.1f} | Momentum: {req.mom:+.2f}
{candles_section}
TREND & CONTEXT
- {htf_line}
- Regime: {req.regime or "unknown"} | Session: {req.session or "unknown"} (quality: {req.session_quality:.0%})

SETUP
- Strategy: {req.setup or "unknown"} | Signature: {req.signature}
- {score_line}

ACCOUNT & RISK STATE
- {account_line}
- {streak_line}

Your decision as AI Director (JSON only):"""

def _parse_entry_json(response: str) -> dict:
    import json, re
    cleaned = (response or "").strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    if not cleaned.startswith("{"):
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            cleaned = m.group(0)
    try:
        r = json.loads(cleaned)
        action = str(r.get("action", "SKIP")).upper()
        if action not in ["BUY", "SELL", "SKIP"]:
            action = "SKIP"
        confidence = max(0, min(100, int(r.get("confidence", 50))))
        return {
            "action": action,
            "confidence": confidence,
            "reason": str(r.get("reason", ""))[:200],
            "thesis": str(r.get("thesis", ""))[:500],
            "bearish_case": str(r.get("bearish_case", ""))[:400],
            "skip_if": str(r.get("skip_if", ""))[:200],
            "invalidation": str(r.get("invalidation", ""))[:200],
            "target": str(r.get("target", ""))[:200],
            "sl_adjust": float(r.get("sl_adjust", 0) or 0),
            "tp_adjust": float(r.get("tp_adjust", 0) or 0),
        }
    except (json.JSONDecodeError, ValueError, TypeError):
        up = (response or "").upper()
        if '"BUY"' in up:  return {"action": "BUY",  "confidence": 55, "reason": "parser fallback", "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "", "sl_adjust": 0, "tp_adjust": 0, "ai_status": "Invalid AI Response"}
        if '"SELL"' in up: return {"action": "SELL", "confidence": 55, "reason": "parser fallback", "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "", "sl_adjust": 0, "tp_adjust": 0, "ai_status": "Invalid AI Response"}
        return {"action": "SKIP", "confidence": 0, "reason": "Invalid AI Response", "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "", "sl_adjust": 0, "tp_adjust": 0, "ai_status": "Invalid AI Response", "available": False}

def _provider_label(provider: str) -> str:
    return "Claude" if provider == "anthropic" else "GPT"

async def _ask_entry_ai(provider: str, model: str, req: AIAnalysisRequest) -> dict:
    t0 = time.time()
    try:
        chat = LlmChat(
            api_key=LLM_KEY,
            session_id=f"entry-{provider}-{uuid.uuid4().hex[:8]}",
            system_message=_ENTRY_SYSTEM_PROMPT,
        ).with_model(provider, model)
        msg = UserMessage(text=_build_entry_prompt(req))
        # 8s hard timeout — advisory calls must not add an entry timing layer
        response = await asyncio.wait_for(chat.send_message(msg), timeout=8.0)
        latency = time.time() - t0
        result = _parse_entry_json(response)
        if result.get("ai_status") == "Invalid AI Response":
            result["available"] = False
        else:
            result["available"] = True
            result["ai_status"] = "AI Decision"
        # v6.3.8 Upgrade 4: per-provider logging with latency
        if provider == "anthropic":
            logger.info(f"AI_CALL provider=claude model={model} status=ok latency={latency:.2f}s action={result.get('action','?')} conf={result.get('confidence',0)}")
        else:
            logger.info(f"AI_CALL provider=openai model={model} status=ok latency={latency:.2f}s action={result.get('action','?')} conf={result.get('confidence',0)}")
        return result
    except asyncio.TimeoutError:
        latency = time.time() - t0
        logger.warning(f"AI_CALL provider={provider} model={model} status=TIMEOUT latency={latency:.2f}s fallback=skip")
        status = f"{_provider_label(provider)} Timeout"
        return {"action": "SKIP", "confidence": 0, "reason": f"{provider} timeout",
                "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "",
                "sl_adjust": 0, "tp_adjust": 0, "available": False, "ai_status": status}
    except Exception as e:
        latency = time.time() - t0
        fallback = "claude_only" if provider == "openai" else "gpt_only"
        logger.warning(f"AI_CALL provider={provider} model={model} status=FAILED error={str(e)[:120]} latency={latency:.2f}s fallback={fallback}")
        status = f"{_provider_label(provider)} Error"
        return {"action": "SKIP", "confidence": 0, "reason": f"{provider} error",
                "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "",
                "sl_adjust": 0, "tp_adjust": 0, "available": False, "ai_status": status}

def _should_call_dual_ai(req: AIAnalysisRequest, primary: Optional[dict] = None) -> bool:
    """Spend on a second LLM only for important, ambiguous decisions."""
    grade = (req.grade or "").upper()
    high_grade = grade in ("A", "A+", "B+")
    high_score = req.combined_score >= 6.0 or req.setup_score >= 5.0
    ambiguous_primary = False
    if primary:
        conf = int(primary.get("confidence", 0) or 0)
        ambiguous_primary = (
            primary.get("action") in ("BUY", "SELL") and
            abs(conf - int(req.combined_score * 10)) >= AI_COST_DUAL_AI_CONFIDENCE_GAP
        ) or (55 <= conf <= 70)
    account_pressure = req.basket_float_pl < -75 or req.daily_pct < -1.5 or req.open_positions >= 2
    return bool(high_grade and (high_score or account_pressure or ambiguous_primary))

def _entry_local_only_response(reason: str, cache_key: str) -> dict:
    status = "Provider Unavailable" if "key not configured" in reason.lower() else "Local Decision (Budget Guard)"
    return {
        "action": "SKIP",
        "confidence": 0,
        "reason": reason[:240],
        "thesis": "",
        "bearish_case": "",
        "skip_if": "",
        "invalidation": "",
        "target": "",
        "claude": None,
        "gpt": None,
        "sl_adjust": 0,
        "tp_adjust": 0,
        "consensus_source": "local_only_cost_guard",
        "ai_status": status,
        "provider_status": {"claude": status, "gpt": status},
        "ai_cost": {**_ai_cost_snapshot(), "cache_key": cache_key, "reason": reason},
    }

def _combined_entry_ai_status(claude: dict, gpt: dict, action: str, consensus_source: str) -> str:
    c_status = claude.get("ai_status", "AI Decision")
    g_status = gpt.get("ai_status", "AI Decision")
    c_ok = claude.get("available", True)
    g_ok = gpt.get("available", True)
    if consensus_source == "local_only_cost_guard":
        return "Local Decision (Budget Guard)"
    if action in ("BUY", "SELL"):
        if not c_ok and c_status != "Local Decision (Budget Guard)":
            return f"AI Decision ({c_status})"
        if not g_ok and g_status != "Local Decision (Budget Guard)":
            return f"AI Decision ({g_status})"
        return "AI Decision"
    if not c_ok and c_status != "Local Decision (Budget Guard)":
        return c_status
    if not g_ok and g_status != "Local Decision (Budget Guard)":
        return g_status
    return "AI Decision"

@api_router.post("/ai/analyze")
async def ai_analyze_market(req: AIAnalysisRequest, request: Request):
    if not req.account_id:
        raise HTTPException(status_code=400, detail="account_id is required")
    """Dual-AI entry analysis: Claude 4.5 + GPT-4o vote in parallel.

    Consensus rules (revised to NOT punish availability):
      - Both agree (BUY=BUY or SELL=SELL)        -> action, avg conf +5 (synergy bonus)
      - Direct disagreement (BUY vs SELL)        -> SKIP (safety)
      - One agrees, other SKIPs (both available) -> that side at 0.80x its confidence
      - One agrees, other UNAVAILABLE (error)    -> that side at 1.00x (no penalty)
      - Both SKIP or both unavailable            -> SKIP
    """
    await _resolve_monitor_license(req.pin, req.account_id, request)
    try:
        payload = req.model_dump(exclude={"pin"})
        cache_key = _ai_cost_state_hash("entry", payload)
        cached = _ai_cache_get(cache_key)
        if cached:
            return cached

        if not LLM_KEY:
            return _entry_local_only_response("AI key not configured", cache_key)

        grade = (req.grade or "").upper()
        high_impact = grade in ("A", "A+") or req.combined_score >= 6.0 or req.basket_float_pl < -100
        if grade in ("", "SKIP") or (req.combined_score > 0 and req.combined_score < 3.0):
            reason = "AI_COST_SKIP low-quality/no-trade state handled locally"
            _ai_cost_stats["skipped"] += 1
            logger.info("%s key=%s grade=%s score=%.2f", reason, cache_key, req.grade, req.combined_score)
            return _entry_local_only_response(reason, cache_key)

        allowed, budget_reason = _ai_budget_allows("entry", cache_key, high_impact=high_impact, account_id=req.account_id)
        if not allowed:
            logger.info("%s purpose=entry key=%s", budget_reason, cache_key)
            return _entry_local_only_response(budget_reason, cache_key)

        prompt_for_cost = _ENTRY_SYSTEM_PROMPT + "\n" + _build_entry_prompt(req)
        claude = await _ask_entry_ai("anthropic", "claude-sonnet-4-5-20250929", req)
        cost_entries = [
            _record_ai_cost("anthropic", "claude-sonnet-4-5-20250929",
                            prompt_for_cost, _json.dumps(claude, separators=(",", ":")),
                            "entry", cache_key, "primary entry confirmation",
                            account_id=req.account_id)
        ]

        if _should_call_dual_ai(req, claude):
            second_allowed, second_reason = _ai_budget_allows("entry_dual", cache_key, high_impact=True, account_id=req.account_id)
            if second_allowed:
                gpt = await _ask_entry_ai("openai", "gpt-4o", req)
                cost_entries.append(
                    _record_ai_cost("openai", "gpt-4o",
                                    prompt_for_cost, _json.dumps(gpt, separators=(",", ":")),
                                    "entry_dual", cache_key, "high-impact/ambiguous dual check",
                                    account_id=req.account_id)
                )
            else:
                gpt = {"action": "SKIP", "confidence": 0, "reason": second_reason,
                       "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "",
                       "target": "", "sl_adjust": 0, "tp_adjust": 0, "available": False,
                       "ai_status": "Local Decision (Budget Guard)"}
        else:
            gpt = {"action": "SKIP", "confidence": 0, "reason": "dual AI skipped to save cost",
                   "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "",
                   "target": "", "sl_adjust": 0, "tp_adjust": 0, "available": False,
                   "ai_status": "Local Decision (Budget Guard)"}

        c_act, g_act = claude["action"], gpt["action"]
        c_conf, g_conf = claude["confidence"], gpt["confidence"]
        c_ok, g_ok = claude.get("available", True), gpt.get("available", True)

        if c_ok and g_ok and c_act == g_act and c_act in ("BUY", "SELL"):
            action = c_act
            confidence = min(100, int((c_conf + g_conf) / 2) + 5)
            reason = f"Both AIs agree: {claude['reason'][:60]} / {gpt['reason'][:60]}"
            # Prefer the longer/fuller thesis
            thesis = claude.get("thesis") if len(claude.get("thesis","")) >= len(gpt.get("thesis","")) else gpt.get("thesis")
            # Combine both bearish cases — we want ALL the red flags on the table
            bearish_case = (claude.get("bearish_case","") + " | " + gpt.get("bearish_case","")).strip(" |")[:500]
            skip_if = claude.get("skip_if") or gpt.get("skip_if")
            invalidation = claude.get("invalidation") or gpt.get("invalidation")
            target = claude.get("target") or gpt.get("target")
            sl_adj = (claude["sl_adjust"] + gpt["sl_adjust"]) / 2
            tp_adj = (claude["tp_adjust"] + gpt["tp_adjust"]) / 2
        elif c_ok and g_ok and c_act in ("BUY","SELL") and g_act in ("BUY","SELL") and c_act != g_act:
            action, confidence = "SKIP", 50
            reason = f"Disagreement: Claude={c_act}({c_conf}) GPT={g_act}({g_conf}) — safety SKIP"
            thesis = f"Claude wanted {c_act}: {claude.get('thesis','')[:120]}. GPT wanted {g_act}: {gpt.get('thesis','')[:120]}. Conflicting reads — staying flat."
            bearish_case = ""; skip_if = ""; invalidation = ""; target = ""
            sl_adj, tp_adj = 0, 0
        elif c_ok and c_act in ("BUY", "SELL") and (not g_ok or g_act == "SKIP"):
            penalty = 1.00 if not g_ok else 0.80
            action = c_act
            confidence = max(0, min(100, int(c_conf * penalty)))
            reason = (f"Claude says {c_act} ({c_conf}%), "
                      f"{'GPT unavailable' if not g_ok else 'GPT SKIP'}: {claude['reason'][:80]}")
            thesis = claude.get("thesis", "")
            bearish_case = claude.get("bearish_case", "")
            skip_if = claude.get("skip_if", "")
            invalidation = claude.get("invalidation", "")
            target = claude.get("target", "")
            sl_adj, tp_adj = claude["sl_adjust"], claude["tp_adjust"]
        elif g_ok and g_act in ("BUY", "SELL") and (not c_ok or c_act == "SKIP"):
            penalty = 1.00 if not c_ok else 0.80
            action = g_act
            confidence = max(0, min(100, int(g_conf * penalty)))
            reason = (f"GPT says {g_act} ({g_conf}%), "
                      f"{'Claude unavailable' if not c_ok else 'Claude SKIP'}: {gpt['reason'][:80]}")
            thesis = gpt.get("thesis", "")
            bearish_case = gpt.get("bearish_case", "")
            skip_if = gpt.get("skip_if", "")
            invalidation = gpt.get("invalidation", "")
            target = gpt.get("target", "")
            sl_adj, tp_adj = gpt["sl_adjust"], gpt["tp_adjust"]
        else:
            action = "SKIP"
            if c_ok and g_ok:
                # v6.5.0 (audit bug #8): both providers genuinely answered and
                # both independently said SKIP — a real (if unenthusiastic)
                # joint judgment, worth a real confidence value.
                confidence = 50
                reason = f"Both AIs genuinely say SKIP (claude={c_conf}%, gpt={g_conf}%)"
            else:
                # At least one provider never actually answered (unavailable
                # or errored) — this is NOT a judgment, it's a fallback. The
                # old code gave this the same confidence=50 as a real dual-SKIP
                # verdict, making it indistinguishable downstream: 88 hard
                # entry vetoes fired in one day (2026-06-30) off this constant,
                # not an actual AI opinion. confidence=0 lets the EA tell
                # "AI said no" from "AI didn't answer."
                confidence = 0
                reason = f"Both SKIP/unavailable (claude_ok={c_ok}, gpt_ok={g_ok}) — no real AI judgment made"
            thesis = (claude.get("thesis","") or gpt.get("thesis","") or "")[:400]
            bearish_case = ""; skip_if = ""; invalidation = ""; target = ""
            sl_adj, tp_adj = 0, 0

        # v6.3.8 Upgrade 4: consensus_source field — EA must know which providers answered
        if c_ok and g_ok and c_act == g_act and c_act in ("BUY", "SELL"):
            consensus_source = "dual_consensus"
        elif c_ok and c_act in ("BUY", "SELL") and (not g_ok or g_act == "SKIP"):
            consensus_source = "claude_only"
        elif g_ok and g_act in ("BUY", "SELL") and (not c_ok or c_act == "SKIP"):
            consensus_source = "gpt_only"
        else:
            consensus_source = "none"

        ai_status = _combined_entry_ai_status(claude, gpt, action, consensus_source)
        provider_status = {
            "claude": claude.get("ai_status", "AI Decision"),
            "gpt": gpt.get("ai_status", "AI Decision"),
        }

        result = {
            "action": action,
            "confidence": confidence,
            "reason": reason[:240],
            "ai_status": ai_status,
            "provider_status": provider_status,
            "thesis": (thesis or "")[:500],
            "bearish_case": (bearish_case or "")[:500],
            "skip_if": (skip_if or "")[:200],
            "invalidation": (invalidation or "")[:200],
            "target": (target or "")[:200],
            "sl_adjust": sl_adj,
            "tp_adjust": tp_adj,
            "consensus_source": consensus_source,
            "claude": {"action": c_act, "confidence": c_conf, "reason": claude["reason"], "available": c_ok},
            "gpt":    {"action": g_act, "confidence": g_conf, "reason": gpt["reason"],    "available": g_ok},
            "ai_cost": {
                **_ai_cost_snapshot(),
                "cache_hit": False,
                "cache_key": cache_key,
                "call_reasons": cost_entries,
            },
        }
        if ai_status not in ("Claude Timeout", "GPT Timeout", "Claude Error", "GPT Error",
                             "Invalid AI Response", "Provider Unavailable"):
            _ai_cache_put(cache_key, result, "entry", sum(int(x.get("tokens", 0) or 0) for x in cost_entries))
        try:
            await db.ai_analyses.insert_one({
                "symbol": req.symbol, "account": req.account_id,
                "request": req.model_dump(exclude={"pin"}), "response": result,
                "signature": req.signature, "created_at": datetime.now(timezone.utc).isoformat()
            })
        except Exception:
            pass
        return result
    except Exception as e:
        logger.error(f"AI analyze dual error: {e}")
        # v6.5.0 (audit bug #8): a hard exception means NO provider answered at
        # all — confidence=0, not 50, so this can never be mistaken for a real
        # (if low-confidence) AI opinion downstream.
        return {"action": "SKIP", "confidence": 0, "reason": f"AI error: {str(e)[:60]} — no real AI judgment made",
                "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "",
                "claude": None, "gpt": None, "sl_adjust": 0, "tp_adjust": 0,
                "consensus_source": "none", "ai_status": "Provider Unavailable",
                "provider_status": {"claude": "Provider Unavailable", "gpt": "Provider Unavailable"}}

@api_router.get("/ai/cost/stats")
async def ai_cost_stats():
    return _ai_cost_snapshot()

@api_router.post("/ai/memory/record")
async def ai_memory_record(record: TradeMemoryRecord, request: Request):
    if not record.account:
        raise HTTPException(status_code=400, detail="account is required")
    lic = await _resolve_monitor_license(record.pin, record.account, request)
    try:
        data = record.model_dump()
        data.pop("pin", None)
        data["license_id"] = lic.get("id", "")
        data["recorded_at"] = datetime.now(timezone.utc).isoformat()
        data["memory_hash"] = _trade_memory_state_hash(data)
        data["bad_data_ignored"] = False
        if not data.get("symbol") or not data.get("strategy") or data.get("lot_size", 0) < 0:
            data["bad_data_ignored"] = True
            return {"status": "ignored", "reason": "bad memory data"}
        with open(TRADE_MEMORY_PATH, "a", encoding="utf-8") as f:
            f.write(_json.dumps(data, separators=(",", ":")) + "\n")
        try:
            await db.ai_trade_memory.insert_one(data)
        except Exception:
            pass
        return {"status": "ok", "memory_hash": data["memory_hash"]}
    except Exception as e:
        logger.error("AI memory record error: %s", e)
        return {"status": "error", "detail": str(e)}

@api_router.post("/ai/memory/query")
async def ai_memory_query_retired():
    """v6.25.4 owner directive 2026-07-17 (Phase 10 audit finding) --
    retired. No EA caller (grepped backend/ea_code/XAUUSD_AI_Sniper_EA.mq5
    -- only ai/memory/record is ever called, never this). Also
    unauthenticated with no per-account scoping -- would have blended
    every account's trade memory into one global similarity match. The
    active write and report routes now authenticate the EA license and
    store/query by the resolved non-secret license ID."""
    raise HTTPException(status_code=410, detail="This endpoint is retired.")

@api_router.get("/ai/memory/report")
async def ai_memory_report(request: Request, pin: str = "", account: str = "", limit: int = 2000):
    lic = await _resolve_monitor_license(pin, account, request)
    try:
        rows = _load_trade_memory(limit=max(100, min(limit, 10000)))
        rows = [row for row in rows if row.get("license_id") == lic.get("id", "") or
                _normalize_license_key(row.get("pin", "")) == _normalize_license_key(pin)]
        buckets: dict[str, list[dict]] = {}
        for row in rows:
            key = "|".join([
                str(row.get("strategy", "UNKNOWN")),
                str(row.get("direction", "NA")),
                str(row.get("session", "NA")),
                str(row.get("grade", "NA")),
            ])
            buckets.setdefault(key, []).append(row)
        lines = [
            "# XauCloud Conscious Memory Report",
            "",
            f"Generated: {datetime.now(timezone.utc).isoformat()}",
            f"Records: {len(rows)}",
            "",
            "Memory influence tiers: 1 similar memory = information only; 5 similar memories = weak influence; 20+ similar memories = strong influence; 50+ similar memories = trusted pattern.",
            "",
        ]
        summaries = []
        for key, vals in buckets.items():
            rec = _build_memory_recommendation({"strategy": key.split("|")[0], "direction": key.split("|")[1]}, vals)
            summaries.append((rec["similar_memories"], rec["win_rate"], key, rec))
        summaries.sort(reverse=True)
        for _, _, key, rec in summaries[:30]:
            lines += [
                f"## {key}",
                f"- Samples: {rec['similar_memories']} ({rec['confidence_weight']})",
                f"- Win rate: {rec['win_rate']}%",
                f"- Avg MFE/MAE: {rec['avg_mfe']} / {rec['avg_mae']}",
                f"- Early-exit rate: {rec['early_exit_rate']}%",
                f"- Recommendation: {rec['recommendation']}",
                "",
            ]
        report = "\n".join(lines)
        TRADE_MEMORY_REPORT_PATH.write_text(report, encoding="utf-8")
        return {"status": "ok", "records": len(rows), "report_path": str(TRADE_MEMORY_REPORT_PATH), "report": report}
    except Exception as e:
        logger.error("AI memory report error: %s", e)
        return {"status": "error", "detail": str(e)}

########################################
# v6.3.8 UPGRADE 5 — AI Outcome Feedback Loop
########################################

@api_router.post("/ai/feedback")
async def ai_feedback(data: dict, request: Request):
    """Record AI verdict outcome after every trade closes."""
    pin = str(data.get("pin") or "")
    account = str(data.get("account_id") or data.get("account") or "")
    if not account:
        raise HTTPException(status_code=400, detail="account_id is required")
    lic = await _resolve_monitor_license(pin, account, request)
    try:
        feedback_path = ROOT_DIR / "ai_feedback_log.jsonl"
        record = {**data, "license_id": lic.get("id", ""), "account_id": account,
                  "recorded_at": datetime.now(timezone.utc).isoformat()}
        record.pop("pin", None)
        with open(feedback_path, "a") as f:
            f.write(_json.dumps(record) + "\n")
        # Also persist to MongoDB for dashboard queries
        try:
            await db.ai_feedback.insert_one(record)
        except Exception:
            pass
        logger.info(f"AI_FEEDBACK recorded: verdict={data.get('ai_verdict','?')} outcome={data.get('outcome','?')} rMult={data.get('r_multiple','?')}")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"AI feedback error: {e}")
        return {"status": "error", "detail": str(e)}

@api_router.get("/ai/feedback/stats")
async def ai_feedback_stats(request: Request, pin: str = "", account: str = ""):
    """Compute accuracy by confidence band, strategy, session, direction from feedback log."""
    lic = await _resolve_monitor_license(pin, account, request)
    try:
        feedback_path = ROOT_DIR / "ai_feedback_log.jsonl"
        if not feedback_path.exists():
            return {"total": 0, "message": "no feedback recorded yet"}

        records = []
        with open(feedback_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try: records.append(_json.loads(line))
                    except Exception: pass

        records = [r for r in records if r.get("license_id") == lic.get("id", "") or
                   _normalize_license_key(r.get("pin", "")) == _normalize_license_key(pin)]
        total = len(records)
        if total == 0:
            return {"total": 0, "message": "no feedback recorded yet"}

        correct = sum(1 for r in records if r.get("outcome") in ("CORRECT", "CONSERVATIVE_CORRECT"))
        accuracy = correct / total if total > 0 else 0.0

        # By confidence band (0-49, 50-64, 65-79, 80-100)
        bands = {"0-49": {"total":0,"correct":0}, "50-64": {"total":0,"correct":0},
                 "65-79": {"total":0,"correct":0}, "80-100": {"total":0,"correct":0}}
        by_strategy = {}
        by_session   = {}
        by_direction = {}
        for r in records:
            c = int(r.get("ai_confidence", 0))
            band = "0-49" if c < 50 else "50-64" if c < 65 else "65-79" if c < 80 else "80-100"
            bands[band]["total"] += 1
            is_correct = r.get("outcome") in ("CORRECT", "CONSERVATIVE_CORRECT")
            if is_correct:
                bands[band]["correct"] += 1
            strat = r.get("strategy", "UNKNOWN")
            sess  = r.get("session",  "UNKNOWN")
            dirn  = r.get("direction","UNKNOWN")
            by_strategy.setdefault(strat, {"total":0,"correct":0})
            by_session.setdefault(sess,   {"total":0,"correct":0})
            by_direction.setdefault(dirn, {"total":0,"correct":0})
            by_strategy[strat]["total"] += 1
            by_session[sess]["total"]   += 1
            by_direction[dirn]["total"] += 1
            if is_correct:
                by_strategy[strat]["correct"] += 1
                by_session[sess]["correct"]   += 1
                by_direction[dirn]["correct"] += 1

        def add_accuracy(d):
            for k in d:
                n = d[k]["total"]
                d[k]["accuracy"] = round(d[k]["correct"] / n, 4) if n > 0 else 0.0
        add_accuracy(bands)
        add_accuracy(by_strategy)
        add_accuracy(by_session)
        add_accuracy(by_direction)

        return {
            "total": total,
            "correct": correct,
            "accuracy": round(accuracy, 4),
            "by_confidence": bands,
            "by_strategy": by_strategy,
            "by_session": by_session,
            "by_direction": by_direction
        }
    except Exception as e:
        logger.error(f"AI feedback stats error: {e}")
        return {"error": str(e)}

########################################
# v6.4.0 — CONFIDENCE CALIBRATION ENDPOINT
########################################
@api_router.get("/ai/calibration")
async def ai_calibration():
    """Compute calibration curve from ai_feedback_log.jsonl.
    Returns a multiplier per confidence band so the EA can adjust its threshold.
    Minimum 10 samples per band required for a non-unity multiplier."""
    import json as _cjson
    feedback_path = ROOT_DIR / "ai_feedback_log.jsonl"
    if not feedback_path.exists():
        return {"calibrated": False, "multipliers": {}, "sample_counts": {}, "message": "insufficient data"}

    bands = {"0-49": [], "50-64": [], "65-79": [], "80-100": []}
    try:
        with open(feedback_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = _cjson.loads(line)
                    conf = int(r.get("ai_confidence", 0))
                    correct = r.get("outcome") in ["CORRECT", "CONSERVATIVE_CORRECT"]
                    if conf < 50:   bands["0-49"].append(correct)
                    elif conf < 65: bands["50-64"].append(correct)
                    elif conf < 80: bands["65-79"].append(correct)
                    else:           bands["80-100"].append(correct)
                except Exception:
                    continue
    except Exception as e:
        logger.error(f"Calibration read error: {e}")
        return {"calibrated": False, "multipliers": {}, "sample_counts": {}, "message": str(e)}

    mid_map = {"0-49": 25, "50-64": 57, "65-79": 72, "80-100": 88}
    result = {"calibrated": True, "multipliers": {}, "sample_counts": {}}
    any_calibrated = False
    for band, outcomes in bands.items():
        n = len(outcomes)
        result["sample_counts"][band] = n
        if n >= 10:
            actual_wr = sum(outcomes) / n
            claimed_wr = mid_map[band] / 100.0
            calibration_ratio = actual_wr / claimed_wr if claimed_wr > 0 else 1.0
            # Cap adjustment: max 30% correction either direction
            calibration_ratio = max(0.70, min(1.30, calibration_ratio))
            result["multipliers"][band] = round(calibration_ratio, 3)
            any_calibrated = True
        else:
            result["multipliers"][band] = 1.0  # not enough data, no adjustment

    if not any_calibrated:
        result["calibrated"] = False
        result["message"] = "insufficient data (need >= 10 samples per band)"
    else:
        result["message"] = "ok"

    logger.info(f"AI_CALIBRATION served: {result['multipliers']}")
    return result

########################################
# NEWS AVOIDANCE
########################################
@api_router.get("/news/check")
async def check_news_events():
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json")
            if r.status_code != 200:
                return {
                    "safe_to_trade": None,
                    "reason": "Calendar provider unavailable; state is unknown, not safe",
                    "status": "DEGRADED_UNKNOWN",
                    "retryable": True,
                    "global_block": False,
                }
            events = r.json()
            now = datetime.now(timezone.utc)
            high_impact_soon = []
            for ev in events:
                if ev.get("impact", "").lower() not in ["high", "medium"]: continue
                try:
                    ev_time = datetime.fromisoformat(ev["date"].replace("Z", "+00:00"))
                    diff_mins = (ev_time - now).total_seconds() / 60
                    if -15 <= diff_mins <= 30:
                        high_impact_soon.append({"title": ev.get("title", "Unknown"), "impact": ev.get("impact", ""), "currency": ev.get("country", ""), "minutes": int(diff_mins)})
                except: continue
            if high_impact_soon:
                return {"safe_to_trade": False, "reason": f"High impact: {high_impact_soon[0]['title']} in {high_impact_soon[0]['minutes']}min", "status": "CURRENT_RISK", "events": high_impact_soon}
            return {"safe_to_trade": True, "reason": "No high-impact events nearby", "status": "AVAILABLE"}
    except Exception as e:
        logger.error(f"News check error: {e}")
        return {
            "safe_to_trade": None,
            "reason": "Calendar check failed; state is unknown, not safe",
            "status": "DEGRADED_UNKNOWN",
            "retryable": True,
            "global_block": False,
        }

########################################
# TRADE JOURNAL
########################################
class TradeJournalEntry(BaseModel):
    pin: str = ""
    symbol: str = "XAUUSD"
    direction: str = ""
    result: str = ""
    price: float = 0
    profit: float = 0
    lots: float = 0
    hour: int = 0
    day_of_week: int = 0
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    balance: float = 0
    signature: str = ""
    setup: str = ""
    regime: str = ""
    # v6.25.3 owner directive 2026-07-17 (Phase 7A) -- rich, verified trade-
    # ledger fields. All Optional/defaulted so EA installs older than
    # v6.25.3 (which only ever send the fields above) keep working
    # unchanged against this same endpoint -- this is an additive schema
    # change, not a breaking one. A record with ticket==0 is from a
    # pre-v6.25.3 EA and is excluded from ledger-derived analytics (real
    # risk/R/MFE/MAE data was never sent for it, so computing those fields
    # would mean inventing numbers -- exactly what this phase forbids).
    ticket: int = 0
    entry_price: float = 0
    opened_at: int = 0          # unix seconds, broker deal time
    closed_at: int = 0          # unix seconds, broker deal time
    commission: float = 0
    swap: float = 0
    original_risk_usd: float = 0
    final_r: float = 0
    mae_r: float = 0
    mfe_r: float = 0
    campaign_id: str = ""
    ea_version: str = ""
    account_login: str = ""
    exit_reason: str = ""
    exit_owner: str = ""
    family: str = ""            # NORMAL / COUNTER_EXCURSION / LEGACY_EXHAUSTION_COUNTER

@api_router.post("/journal/log")
async def log_trade_journal(entry: TradeJournalEntry, request: Request):
    # v6.25.4 owner directive 2026-07-17 (URGENT P0 -- Phase 10 audit
    # finding) -- this endpoint previously accepted ANY caller's win/loss
    # report with no authentication at all, and fed it straight into
    # db.hive_signatures, which /ml/hive/score's verdict (BOOST/VETO) uses
    # to hard-block or favor trades for EVERY user sharing that setup
    # signature -- a real, exploitable "anyone with no license at all can
    # fabricate losses to VETO other customers' live trades, or fabricate
    # wins to force BOOST and induce over-trading" vulnerability. Now
    # requires the pin to resolve to a real active license (the same
    # canonical, atomic, fail-closed check every other EA-facing endpoint
    # already uses) before anything is written. Rate-limited per pin to
    # bound abuse even from a genuinely licensed but compromised install.
    # v6.25.6 fix -- restore the graceful {"status": "error"} response
    # contract this endpoint has always used for a rejected caller (see the
    # v6.25.4 comment above): the account_login requirement added on top of
    # that must not bypass it with a raw, uncaught HTTPException, or every
    # existing caller expecting a JSON error body instead of a bare 400/403
    # regresses silently.
    if not entry.account_login:
        return {"status": "error", "detail": "account_login is required"}
    try:
        lic = await _resolve_monitor_license(entry.pin, entry.account_login, request)
    except HTTPException:
        return {"status": "error", "detail": "Invalid or inactive license."}
    _rate_limit(f"journal_log_pin:{entry.pin}", max_requests=60, window_seconds=300)
    try:
        doc = entry.dict()
        doc.pop("pin", None)
        doc["license_id"] = lic.get("id", "")
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        doc["created_ts"] = time.time()
        doc["win_rate"] = round(entry.wins / entry.total_trades * 100, 1) if entry.total_trades > 0 else 0
        doc["has_rich_ledger_data"] = entry.ticket > 0  # true only for v6.25.3+ EA reports
        await db.trade_journal.insert_one(doc)
        # Also index into hive_signatures for fast aggregate lookup
        if entry.signature:
            try:
                await db.hive_signatures.insert_one({
                    "signature": entry.signature,
                    "license_id": lic.get("id", ""),
                    "symbol": entry.symbol,
                    "result": entry.result,   # WIN / LOSS
                    "profit": entry.profit,
                    "created_ts": time.time(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                logger.error(f"Hive index error: {e}")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Journal log error: {e}")
        return {"status": "error"}

########################################
# HIVE-MIND — 7-day global signature stats
########################################
class HiveScoreRequest(BaseModel):
    signature: str = ""
    window_days: int = 7

@api_router.post("/ml/hive/score")
async def ml_hive_score(req: HiveScoreRequest):
    """Aggregate WR across ALL users in last N days, HIERARCHICAL rollup.

    Signature format: regime|setup|dir|session|rsi_bucket|stoch_bucket|mom_bucket

    Falls back in order when exact match has n<5:
      level 0: exact (all 7 fields)                                  — most specific
      level 1: drop mom_bucket      (regime|setup|dir|session|rsi|stoch)
      level 2: drop stoch_bucket    (regime|setup|dir|session|rsi)
      level 3: drop rsi_bucket      (regime|setup|dir|session)
      level 4: drop session         (regime|setup|dir)               — broadest

    Verdicts (asymmetric, stricter on the veto side to protect cold start):
      BOOST:  n >= 5  AND wr >= 0.60
      VETO:   n >= 10 AND wr <= 0.25
      else NEUTRAL
    """
    try:
        if not req.signature:
            return {"wins": 0, "losses": 0, "total": 0, "wr": 0.5,
                    "verdict": "NONE", "level": -1, "matched_signature": ""}
        window = max(1, int(req.window_days))
        cutoff = time.time() - (window * 86400)

        parts = req.signature.split("|")
        # Must have 7 fields to be valid
        if len(parts) != 7:
            return {"wins": 0, "losses": 0, "total": 0, "wr": 0.5,
                    "verdict": "NONE", "level": -1, "matched_signature": req.signature}

        # Build hierarchy of signatures (exact + rollup prefixes)
        rollups = [
            (0, req.signature,                                         "exact"),
            (1, "|".join(parts[:6]),                                   "drop_mom"),
            (2, "|".join(parts[:5]),                                   "drop_stoch"),
            (3, "|".join(parts[:4]),                                   "drop_rsi"),
            (4, "|".join(parts[:3]),                                   "drop_session"),
        ]

        for level, sig, label in rollups:
            if level == 0:
                filt = {"signature": sig, "created_ts": {"$gte": cutoff}}
            else:
                # Escape regex specials in the prefix (especially the "|" alternation operator!)
                # then anchor with a trailing pipe so "RANGE" doesn't match "RANGE_REV"
                escaped = re.escape(sig)
                filt = {"signature": {"$regex": f"^{escaped}\\|"}, "created_ts": {"$gte": cutoff}}
            wins = await db.hive_signatures.count_documents({**filt, "result": "WIN"})
            losses = await db.hive_signatures.count_documents({**filt, "result": "LOSS"})
            total = wins + losses
            # Need at least 5 trades at this level to be informative
            if total >= 5:
                wr = wins / total
                if wr >= 0.60:
                    verdict = "BOOST"
                elif total >= 10 and wr <= 0.25:
                    verdict = "VETO"
                else:
                    verdict = "NEUTRAL"
                return {"wins": wins, "losses": losses, "total": total,
                        "wr": round(wr, 3), "verdict": verdict,
                        "level": level, "label": label,
                        "matched_signature": sig, "window_days": window}

        # No level had >= 5 trades — true cold start
        return {"wins": 0, "losses": 0, "total": 0, "wr": 0.5,
                "verdict": "COLD_START", "level": -1,
                "matched_signature": req.signature, "window_days": window}
    except Exception as e:
        logger.error(f"Hive score error: {e}")
        return {"wins": 0, "losses": 0, "total": 0, "wr": 0.5,
                "verdict": "NONE", "level": -1, "matched_signature": ""}

@api_router.get("/journal/trades")
async def get_trade_journal(request: Request, pin: str = "", limit: int = 50):
    lic = await _resolve_monitor_license(pin, "", request)
    try:
        query = {"$or": [{"license_id": lic.get("id", "")}, {"pin": _normalize_license_key(pin)}]}
        cursor = db.trade_journal.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        trades = await cursor.to_list(length=limit)
        total = await db.trade_journal.count_documents(query)
        win_trades = await db.trade_journal.count_documents({**query, "result": "WIN"})
        loss_trades = await db.trade_journal.count_documents({**query, "result": "LOSS"})
        total_profit = sum(t.get("profit", 0) for t in trades)

        # Best/worst hours
        hour_stats = {}
        all_trades = await db.trade_journal.find(query, {"_id": 0, "hour": 1, "profit": 1, "result": 1}).to_list(length=500)
        for t in all_trades:
            h = t.get("hour", 0)
            if h not in hour_stats: hour_stats[h] = {"wins": 0, "losses": 0, "profit": 0}
            hour_stats[h]["profit"] += t.get("profit", 0)
            if t.get("result") == "WIN": hour_stats[h]["wins"] += 1
            else: hour_stats[h]["losses"] += 1

        best_hour = max(hour_stats, key=lambda h: hour_stats[h]["profit"]) if hour_stats else 0
        worst_hour = min(hour_stats, key=lambda h: hour_stats[h]["profit"]) if hour_stats else 0

        return {
            "trades": trades,
            "total": total,
            "wins": win_trades,
            "losses": loss_trades,
            "win_rate": round(win_trades / total * 100, 1) if total > 0 else 0,
            "total_profit": round(total_profit, 2),
            "best_hour": best_hour,
            "worst_hour": worst_hour,
            "hour_stats": hour_stats,
        }
    except Exception as e:
        logger.error(f"Journal fetch error: {e}")
        return {"trades": [], "total": 0, "wins": 0, "losses": 0}

class WeeklyReportEntry(BaseModel):
    pin: str = ""
    account_id: str = ""
    symbol: str = "XAUUSD"
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0
    weekly_pnl: float = 0
    weekly_pct: float = 0
    balance: float = 0
    patterns: int = 0
    best_hour: int = -1
    worst_hour: int = -1
    best_hour_profit: float = 0
    worst_hour_profit: float = 0

@api_router.post("/journal/weekly-report")
async def save_weekly_report(entry: WeeklyReportEntry, request: Request):
    if not entry.account_id:
        raise HTTPException(status_code=400, detail="account_id is required")
    lic = await _resolve_monitor_license(entry.pin, entry.account_id, request)
    try:
        doc = entry.dict()
        doc.pop("pin", None)
        doc["license_id"] = lic.get("id", "")
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        doc["week"] = datetime.now(timezone.utc).strftime("%Y-W%W")
        await db.weekly_reports.insert_one(doc)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Weekly report error: {e}")
        return {"status": "error"}

@api_router.get("/journal/weekly-reports")
async def get_weekly_reports(request: Request, pin: str = "", limit: int = 12):
    lic = await _resolve_monitor_license(pin, "", request)
    try:
        query = {"$or": [{"license_id": lic.get("id", "")}, {"pin": _normalize_license_key(pin)}]}
        cursor = db.weekly_reports.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        reports = await cursor.to_list(length=limit)
        return {"reports": reports}
    except Exception as e:
        logger.error(f"Weekly reports fetch error: {e}")
        return {"reports": []}

########################################
# ML PATTERN CLOUD STORAGE
########################################
class PatternData(BaseModel):
    pin: str = ""
    account_id: str = ""
    symbol: str = "XAUUSD"
    patterns: list = []

@api_router.post("/ml/patterns/save")
async def save_patterns_cloud(req: PatternData, request: Request):
    if not req.account_id:
        raise HTTPException(status_code=400, detail="account_id is required")
    lic = await _resolve_monitor_license(req.pin, req.account_id, request)
    try:
        owner_id = lic.get("id", "")
        key = f"{owner_id}_{req.symbol}"
        await db.ml_cloud_patterns.update_one(
            {"key": key},
            {"$set": {"key": key, "license_id": owner_id, "symbol": req.symbol, "patterns": req.patterns, "count": len(req.patterns), "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        return {"status": "ok", "saved": len(req.patterns)}
    except Exception as e:
        logger.error(f"Pattern save error: {e}")
        return {"status": "error", "saved": 0}

@api_router.post("/ml/patterns/load")
async def load_patterns_cloud(req: PatternData, request: Request):
    if not req.account_id:
        raise HTTPException(status_code=400, detail="account_id is required")
    lic = await _resolve_monitor_license(req.pin, req.account_id, request)
    try:
        key = f"{lic.get('id', '')}_{req.symbol}"
        doc = await db.ml_cloud_patterns.find_one({"key": key}, {"_id": 0})
        if doc and doc.get("patterns"):
            return {"status": "ok", "patterns": doc["patterns"], "count": len(doc["patterns"])}
        return {"status": "ok", "patterns": [], "count": 0}
    except Exception as e:
        logger.error(f"Pattern load error: {e}")
        return {"status": "ok", "patterns": [], "count": 0}

# ===================================================================
# XauAi CLOUD — Centralized trade-execution service (v1.0)
# ===================================================================
#  Users sign up, subscribe, connect their MT5 account. Bot signals
#  generated on our master run through per-user executors that place
#  proportionally-sized trades on each user's broker account.
#
#  This module adds:
#   - Cloud user auth (separate namespace from admin)
#   - MT5 credential storage (Fernet-encrypted at rest)
#   - Subscription model + 7-day free trial
#   - Payment requests (crypto / fiat / bank — admin approves)
#   - User dashboard APIs
#   - Admin cloud-management APIs
# ===================================================================
from cryptography.fernet import Fernet
import base64 as _b64, hashlib as _hashlib

# Derive a stable Fernet key from JWT_SECRET (reuses existing secret infra).
# Each install gets a unique key because JWT_SECRET is unique per install.
_FERNET_KEY = _b64.urlsafe_b64encode(_hashlib.sha256(JWT_SECRET.encode()).digest())
_fernet = Fernet(_FERNET_KEY)

def _cloud_encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")

def _cloud_decrypt(ciphertext: str) -> str:
    try: return _fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except Exception: return ""

def _cloud_token(user_id: str, email: str) -> str:
    return jwt.encode(
        {"sub": user_id, "email": email, "type": "cloud",
         "exp": datetime.now(timezone.utc) + timedelta(days=30)},
        JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_cloud_user(request: Request) -> dict:
    token = request.cookies.get("cloud_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "): token = auth[7:]
    if not token: raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "cloud": raise HTTPException(status_code=401, detail="Wrong token type")
        u = await db.cloud_users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
        if not u: raise HTTPException(status_code=401, detail="User not found")
        return u
    except jwt.ExpiredSignatureError: raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:     raise HTTPException(status_code=401, detail="Invalid token")

# -------- Models --------
class CloudSignupReq(BaseModel):
    email: str; password: str; full_name: Optional[str] = ""; country: Optional[str] = ""

class CloudLoginReq(BaseModel):
    email: str; password: str

class TradingUniverseSettings(BaseModel):
    """v6.6.0 — architecture-phase storage for Command Center trading-universe
    controls. NOTE: the EA does not currently poll/consume these settings —
    there is no remote-settings-sync channel for market selection yet (only
    the existing pause/stop commands are consumed live). This model exists so
    the dashboard UI and backend schema are ready; wiring the EA to actually
    read these settings is future work, same as the Index strategy itself."""
    model_config = ConfigDict(extra="ignore")
    enable_gold: bool = True
    enable_index: bool = False   # stays false until a real index strategy exists
    selected_index_symbols: List[str] = Field(default_factory=list)
    max_open_trades_gold: int = 0     # 0 = no override, use EA input default
    max_open_trades_index: int = 0
    max_total_exposure_usd: float = 0.0
    gold_risk_mode: str = "BALANCED"      # SAFE | BALANCED | AGGRESSIVE_GROWTH
    index_risk_mode: str = "BALANCED"     # SAFE | BALANCED | AGGRESSIVE_GROWTH
    index_aggression: str = "INDEX_BALANCED"
    updated_at: Optional[str] = None

class CloudCommandReq(BaseModel):
    action: str
    pin: str
    confirm: bool = False
    payload: Optional[Dict] = None
    # v6.25.6 XAU-027 (Codex handover) -- client-generated, stable across
    # retries of the SAME user action (e.g. one confirm-dialog click), so a
    # network retry or double-click returns the already-queued command
    # instead of creating a duplicate. Optional for backward compatibility
    # with older frontend builds; when omitted, this request gets its own
    # unique dedupe key and therefore no real duplicate protection -- a
    # disclosed limitation for un-updated clients, not a silent gap.
    idempotency_key: Optional[str] = None

class CloudLicenseLinkReq(BaseModel):
    license_key: str

class CloudCommandAckReq(BaseModel):
    command_id: str
    status: str
    message: Optional[str] = ""
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    account: Optional[str] = ""
    details: Optional[Dict] = None

# v6.25.6 XAU-027 (Codex handover) -- explicit command state machine.
# Terminal statuses are immutable: once a command reaches one of these, no
# further acknowledgement may change it, regardless of what a late/replayed/
# cross-terminal EA request claims. The allowed-source map is the single
# source of truth for which transitions may ever be attempted; anything not
# listed here is rejected by cloud_command_ack's atomic conditional update.
_COMMAND_TERMINAL_STATUSES = {"EXECUTED", "FAILED", "SKIPPED", "EXPIRED"}
_COMMAND_ALLOWED_SOURCE_STATUSES = {
    "ACKED": {"PENDING"},
    # A direct PENDING -> terminal transition is permitted (the EA may
    # legitimately report a terminal result in one request, e.g. an
    # immediate FAILED for an invalid force-open) alongside the normal
    # ACKED -> terminal path.
    "EXECUTED": {"PENDING", "ACKED"},
    "FAILED": {"PENDING", "ACKED"},
    "SKIPPED": {"PENDING", "ACKED"},
}

SAFE_REMOTE_COMMANDS = {
    "PAUSE_NEW_TRADES": "Pause new trades",
    "RESUME_TRADING": "Resume trading",
    "STOP_TRADING": "Stop trading",
    "CLOSE_ALL_TRADES": "Close all trades",
    "FORCE_CLOSE_TRADE": "Force-close one exact ticket",
    "FORCE_SYNC": "Force startup intelligence sync",
    "FORCE_REPORT_UPLOAD": "Force report upload marker",
    "UPDATE_PROP_FIRM_CONFIG": "Update prop firm protection",
    "FORCE_OPEN_TRADE": "Manually force-open a blocked candidate",
    "MANUAL_OPEN_NOW": "Manually open a fresh trade immediately (owner override, no candidate required)",
}

REMOTE_COMMAND_EXPIRY_MINUTES = {
    "FORCE_OPEN_TRADE": 15,
    "FORCE_CLOSE_TRADE": 5,
    "CLOSE_ALL_TRADES": 5,
    "PAUSE_NEW_TRADES": 15,
    "STOP_TRADING": 15,
    "RESUME_TRADING": 15,
    "FORCE_SYNC": 30,
    "FORCE_REPORT_UPLOAD": 30,
    "UPDATE_PROP_FIRM_CONFIG": 60,
    # Short expiry on purpose: this command carries no candidate/price
    # snapshot of its own (that is the entire point -- it is never rejected
    # for being "stale"), so the EA must pick it up while the owner's intent
    # is still fresh, or not execute it as a surprise minutes later.
    "MANUAL_OPEN_NOW": 3,
}

async def _expire_stale_pending_commands(now: Optional[datetime] = None) -> int:
    """Never serve stale manual commands to the EA command poller.

    The EA validates force-open market context, but the queue itself also has to
    be time-aware. Otherwise an old pending force-close/close-all/pause command
    can be delivered much later after the trader's intent and market state have
    changed.
    """
    now = now or datetime.now(timezone.utc)
    expired_total = 0
    for action, minutes in REMOTE_COMMAND_EXPIRY_MINUTES.items():
        cutoff = (now - timedelta(minutes=minutes)).isoformat()
        res = await db.cloud_bot_commands.update_many(
            {
                "status": "PENDING",
                "action": action,
                "requested_at": {"$lt": cutoff},
            },
            {"$set": {
                "status": "EXPIRED",
                "ack_status": "EXPIRED",
                "ack_at": now.isoformat(),
                "ack_message": f"Command expired before EA acknowledgement after {minutes} minutes.",
            }},
        )
        expired_total += int(getattr(res, "modified_count", 0) or 0)
    return expired_total

def _normalize_force_open_payload(payload: Optional[Dict]) -> dict:
    raw = payload or {}
    direction = str(raw.get("direction", "")).strip().upper()
    if direction not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="Force-open requires a valid BUY or SELL direction.")
    setup = str(raw.get("setup", "")).strip()
    if not setup:
        raise HTTPException(status_code=400, detail="Force-open requires the original setup name.")
    grade = str(raw.get("grade", "")).strip().upper() or "B"
    original_blocker = str(raw.get("original_blocker", "")).strip() or "UNKNOWN"
    try:
        candle_time = float(raw.get("candle_time", 0))
    except (TypeError, ValueError):
        candle_time = 0.0
    if candle_time <= 0:
        raise HTTPException(status_code=400, detail="Force-open requires the original candle timestamp.")
    # EA-side staleness check also enforces this, but reject obviously stale
    # requests here too rather than queueing a command doomed to fail.
    age_seconds = datetime.now(timezone.utc).timestamp() - candle_time
    if age_seconds > 15 * 60:
        raise HTTPException(status_code=400, detail="This blocked signal is too old to force-open (over 15 minutes). It may no longer reflect current market conditions.")
    try:
        signal_price = float(raw.get("signal_price", 0) or 0)
    except (TypeError, ValueError):
        signal_price = 0.0
    try:
        score = float(raw.get("score", 0) or 0)
    except (TypeError, ValueError):
        score = 0.0
    symbol = str(raw.get("symbol", "")).strip().upper()
    if symbol and len(symbol) > 24:
        raise HTTPException(status_code=400, detail="Force-open symbol is too long.")
    return {
        "direction": direction,
        "symbol": symbol,
        "setup": setup,
        "grade": grade,
        "original_blocker": original_blocker,
        "candle_time": candle_time,
        "signal_price": signal_price,
        "score": score,
        "event_time": str(raw.get("event_time", "")).strip()[:40],
        "signal_id": str(raw.get("signal_id", "")).strip(),
    }

def _normalize_manual_open_now_payload(payload: Optional[Dict]) -> dict:
    """MANUAL_OPEN_NOW deliberately has almost no fields, unlike
    _normalize_force_open_payload: no candle_time/signal_price/setup/grade,
    because it must never be rejectable for reusing a stale blocked
    candidate. It only needs an explicit direction from the owner."""
    raw = payload or {}
    direction = str(raw.get("direction", "")).strip().upper()
    if direction not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="Manual open requires an explicit BUY or SELL direction.")
    return {"direction": direction}

def _normalize_force_close_payload(payload: Optional[Dict]) -> dict:
    raw = payload or {}
    ticket = str(raw.get("ticket", "")).strip()
    if not ticket or not ticket.isdigit():
        raise HTTPException(status_code=400, detail="Force-close requires the exact open MT5 ticket id.")
    symbol = str(raw.get("symbol", "")).strip().upper()
    if symbol and len(symbol) > 24:
        raise HTTPException(status_code=400, detail="Force-close symbol is too long.")
    return {
        "ticket": ticket,
        "symbol": symbol,
        "reason": str(raw.get("reason", "USER_FORCE_CLOSE_TRADE")).strip()[:120] or "USER_FORCE_CLOSE_TRADE",
    }

def _normalize_prop_firm_config(payload: Optional[Dict]) -> dict:
    raw = payload or {}
    def as_bool(value, default: bool) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return value != 0
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def number(name: str, default: float) -> float:
        try:
            return float(raw.get(name, default) if raw.get(name) is not None else default)
        except (TypeError, ValueError):
            return default

    enabled = as_bool(raw.get("enabled"), False)
    starting_balance = max(0.0, number("starting_balance", 0.0))
    daily_loss = min(20.0, max(0.5, number("daily_loss_pct", 4.0)))
    max_loss = min(30.0, max(daily_loss, number("max_loss_pct", 8.0)))
    buffer_pct = min(max(0.0, daily_loss - 0.10),
                     max(0.0, number("safety_buffer_pct", 0.50)))
    risk_trade = min(2.0, max(0.01, number("risk_per_trade_pct", 0.15)))
    basket_risk = min(4.0, max(risk_trade, number("max_basket_risk_pct", 0.75)))
    retest_multi = min(0.50, max(0.05, number("retest_add_lot_multi", 0.25)))
    return {
        "enabled": enabled,
        "starting_balance": round(starting_balance, 2),
        "daily_loss_pct": round(daily_loss, 2),
        "max_loss_pct": round(max_loss, 2),
        "safety_buffer_pct": round(buffer_pct, 2),
        "risk_per_trade_pct": round(risk_trade, 2),
        "max_basket_risk_pct": round(basket_risk, 2),
        "allow_retest_add": as_bool(raw.get("allow_retest_add"), True),
        "retest_add_lot_multi": round(retest_multi, 2),
    }

def _normalize_license_key(value: str) -> str:
    return str(value or "").strip().upper().replace(" ", "")

async def _get_user_license(user: dict) -> Optional[dict]:
    linked = _normalize_license_key(user.get("license_key") or user.get("command_license_key") or "")
    query = None
    if linked:
        query = {"pin": linked, "is_active": True}
    elif user.get("email"):
        query = {"buyer_email": user["email"], "is_active": True}
    if not query:
        return None
    return await db.pin_licenses.find_one(query, {"_id": 0})

# v6.25.3 owner directive 2026-07-17 (Phase 7A P0) -- Command Center
# Analytics page truthfulness. Replaces the frontend's synthetic 5-point
# "equity curve" (literally `[base-d*1.4, base-d, base-d*0.55, base-d*0.2,
# equity]` -- a made-up interpolation, not real history) with real
# aggregates computed from actual closed-trade records reported by the EA
# at close (see TradeJournalEntry's rich fields, v6.25.3+ EA only).
# MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS: below this count, the numbers are
# too noisy/sparse to present as real analytics -- return sufficient_data
# = false and let the frontend show "Not enough verified data" rather than
# a misleadingly precise win-rate/profit-factor off of 1-2 trades.
MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS = 5

@api_router.get("/cloud/performance/analytics")
async def cloud_performance_analytics(user: dict = Depends(get_cloud_user)):
    lic = await _get_user_license(user)
    if not lic or not lic.get("pin"):
        raise HTTPException(status_code=404, detail="No active license linked to this account.")
    license_id = lic.get("id", "")

    # Only records with real per-trade data (ticket>0, sent by v6.25.3+ EA)
    # feed analytics -- older thin records (result/profit/price only) have
    # no risk/R/MFE/MAE/campaign data and would force fabricating it.
    #
    # v6.25.6 fix -- this was querying by "pin", a field log_trade_journal()
    # has deliberately never stored since the v6.25.4 P0 security fix (the
    # raw PIN is popped before storage; only the resolved license_id is
    # kept). That mismatch meant this endpoint had returned
    # sufficient_data=false for every account since that fix landed,
    # regardless of real trade volume -- a real, silent production
    # regression, not a display nuance. Query by license_id, matching what
    # is actually persisted.
    query = {"license_id": license_id, "has_rich_ledger_data": True}
    trades = await db.trade_journal.find(query, {"_id": 0}).sort("closed_at", 1).to_list(length=5000)
    total = len(trades)

    if total < MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS:
        return {
            "sufficient_data": False,
            "verified_trade_count": total,
            "minimum_required": MINIMUM_VERIFIED_TRADES_FOR_ANALYTICS,
            "message": "NOT ENOUGH VERIFIED DATA",
        }

    closed_wins = [t for t in trades if t.get("result") == "WIN"]
    closed_losses = [t for t in trades if t.get("result") == "LOSS"]
    profits = [float(t.get("profit") or 0) for t in trades]
    gross_profit = sum(p for p in profits if p > 0)
    gross_loss = abs(sum(p for p in profits if p < 0))

    # Real equity curve: running cumulative realized profit ordered by the
    # actual broker close time of each trade -- not an interpolation.
    equity_curve = []
    running = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for t in trades:
        running += float(t.get("profit") or 0)
        peak = max(peak, running)
        max_drawdown = max(max_drawdown, peak - running)
        equity_curve.append({
            "closed_at": t.get("closed_at", 0),
            "ticket": t.get("ticket", 0),
            "cumulative_profit": round(running, 2),
        })

    r_values = [float(t.get("final_r") or 0) for t in trades if float(t.get("original_risk_usd") or 0) > 0]
    mae_values = [float(t.get("mae_r") or 0) for t in trades if t.get("mae_r")]
    mfe_values = [float(t.get("mfe_r") or 0) for t in trades if t.get("mfe_r")]

    def _breakdown(key: str) -> dict:
        buckets: Dict[str, Dict[str, float]] = {}
        for t in trades:
            k = str(t.get(key) or "UNKNOWN")
            b = buckets.setdefault(k, {"trades": 0, "wins": 0, "profit": 0.0})
            b["trades"] += 1
            if t.get("result") == "WIN": b["wins"] += 1
            b["profit"] += float(t.get("profit") or 0)
        for b in buckets.values():
            b["profit"] = round(b["profit"], 2)
            b["win_rate"] = round(b["wins"] / b["trades"] * 100, 1) if b["trades"] else 0
        return buckets

    def _session_tag(hour: int) -> str:
        if 0 <= hour < 8: return "ASIAN"
        if 8 <= hour < 13: return "LONDON"
        if 13 <= hour < 17: return "LONDON_NY_OVERLAP"
        if 17 <= hour < 21: return "NEW_YORK"
        return "LATE_NY"

    session_buckets: Dict[str, Dict[str, float]] = {}
    for t in trades:
        tag = _session_tag(int(t.get("hour") or 0))
        b = session_buckets.setdefault(tag, {"trades": 0, "wins": 0, "profit": 0.0})
        b["trades"] += 1
        if t.get("result") == "WIN": b["wins"] += 1
        b["profit"] += float(t.get("profit") or 0)
    for b in session_buckets.values():
        b["profit"] = round(b["profit"], 2)
        b["win_rate"] = round(b["wins"] / b["trades"] * 100, 1) if b["trades"] else 0

    winning_profits = [p for p in profits if p > 0]
    losing_profits = [p for p in profits if p < 0]

    return {
        "sufficient_data": True,
        "verified_trade_count": total,
        "realized_pnl": round(sum(profits), 2),
        "win_rate": round(len(closed_wins) / total * 100, 1),
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else (round(gross_profit, 2) if gross_profit > 0 else 0),
        "avg_r": round(sum(r_values) / len(r_values), 3) if r_values else None,
        "avg_mae_r": round(sum(mae_values) / len(mae_values), 3) if mae_values else None,
        "avg_mfe_r": round(sum(mfe_values) / len(mfe_values), 3) if mfe_values else None,
        "max_drawdown": round(max_drawdown, 2),
        "avg_win": round(sum(winning_profits) / len(winning_profits), 2) if winning_profits else 0,
        "avg_loss": round(sum(losing_profits) / len(losing_profits), 2) if losing_profits else 0,
        "equity_curve": equity_curve,
        "setup_breakdown": _breakdown("setup"),
        "family_breakdown": _breakdown("family"),
        "machine_breakdown": _breakdown("account_login"),
        "session_breakdown": session_buckets,
    }


@api_router.post("/download/request-token")
async def request_ea_download_token(user: dict = Depends(get_cloud_user)):
    """Authenticated Command Center user + an active license belonging to
    them -> a short-lived, single-purpose signed token for the compiled
    EX5. Revoked/inactive/unowned licenses cannot obtain a token at all."""
    lic = await _get_user_license(user)
    if not lic:
        raise HTTPException(status_code=403, detail="No active license linked to this account.")
    release = _current_ea_release()
    if not release:
        raise HTTPException(status_code=503, detail="No release currently published.")
    token = jwt.encode({
        "sub": "ea_download", "user_id": user["id"], "license_id": lic.get("id", ""),
        "version": release["version"],
        "exp": datetime.now(timezone.utc) + timedelta(seconds=DOWNLOAD_TOKEN_TTL_SECONDS),
    }, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"download_token": token, "expires_in": DOWNLOAD_TOKEN_TTL_SECONDS,
            "download_url": f"/api/download/ea-release?token={token}"}


async def _verify_command_license(user: dict, key: str) -> dict:
    raw = _normalize_license_key(key)
    if not raw.startswith("ASE-") or len(raw) < 10:
        raise HTTPException(status_code=400, detail="Enter your XauCloud license key, for example ASE-D4Q9-SUFW.")
    lic = await db.pin_licenses.find_one({"pin": raw, "is_active": True}, {"_id": 0})
    if not lic:
        raise HTTPException(status_code=403, detail="License key not found or inactive.")
    owner = str(lic.get("buyer_email") or "").lower().strip()
    user_email = str(user.get("email") or "").lower().strip()
    linked = _normalize_license_key(user.get("license_key") or user.get("command_license_key") or "")
    if owner and owner != user_email and linked != raw:
        raise HTTPException(status_code=403, detail="This license is linked to another Command Center account.")
    await db.cloud_users.update_one({"id": user["id"]}, {"$set": {
        "license_key": raw,
        "command_license_key": raw,
        "license_linked_at": datetime.now(timezone.utc).isoformat(),
    }})
    if not owner and user_email:
        await db.pin_licenses.update_one({"pin": raw}, {"$set": {"buyer_email": user_email}})
    return lic

async def _resolve_monitor_license(pin: str = "", account: str = "", request: Optional[Request] = None) -> dict:
    """THE canonical license authentication + binding service -- every EA-
    facing or license-gated endpoint must call this, not roll its own check
    (v6.25.3 owner directive 2026-07-17, Phase 4 P0: unifies
    /pins/validate, heartbeat, activity, thesis status, direction
    reservation, command polling, Outlook evidence, and download
    authorization onto one implementation, closing a real gap where
    /pins/validate had its own separate, incomplete logic that only bound
    on first use and never re-checked the account on every later call --
    meaning a PIN could be replayed on an unlimited number of MT5 accounts
    after its first activation).

    Rules: unbound license -> the first valid MT5 account to present it
    claims it ATOMICALLY (the update's filter re-checks mt5_account is
    still empty at write time, so two different accounts racing to
    first-claim the same never-used PIN cannot both win -- exactly one
    does, the other gets a real mismatch rejection against the winner's
    account, not a silent overwrite). Bound license -> every future request
    must match the bound account exactly, or fails closed with
    LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT."""
    raw = _normalize_license_key(pin)
    account = str(account or "").strip()
    if raw:
        lic = await db.pin_licenses.find_one({"pin": raw, "is_active": True}, {"_id": 0})
        if not lic:
            logger.warning("[monitor-auth] reject invalid/inactive pin=%s account=%s", raw, account)
            raise HTTPException(status_code=403, detail={
                "ok": False,
                "reason": "INVALID_OR_INACTIVE_LICENSE_PIN",
                "message": "License PIN was not found or is inactive.",
                "license_pin": raw,
                "account": account,
            })
        bound = str(lic.get("mt5_account") or "").strip()
        if not bound and account:
            # Atomic first-claim: the filter requires mt5_account to STILL
            # be empty/missing at the moment of this write -- if another
            # request already won the race (even microseconds earlier),
            # this update matches zero documents and we fall through to
            # reread + re-validate against whatever actually got bound.
            now_iso = datetime.now(timezone.utc).isoformat()
            claim_result = await db.pin_licenses.update_one(
                {"pin": raw, "is_active": True, "mt5_account": {"$in": [None, ""]}},
                {"$set": {"mt5_account": account, "is_used": True, "activated_at": now_iso}},
            )
            if claim_result.modified_count == 1:
                lic["mt5_account"] = account
                lic["is_used"] = True
                lic["activated_at"] = now_iso
                bound = account
                logger.info("[monitor-auth] FIRST_CLAIM pin=%s account=%s", raw, account)
            else:
                reread = await db.pin_licenses.find_one({"pin": raw, "is_active": True}, {"_id": 0})
                lic = reread or lic
                bound = str(lic.get("mt5_account") or "").strip()
                logger.warning("[monitor-auth] FIRST_CLAIM_RACE_LOST pin=%s our_account=%s winner_account=%s",
                               raw, account, bound)
        if bound and account and bound != account:
            logger.warning("[monitor-auth] reject account mismatch pin=%s bound=%s account=%s", raw, bound, account)
            raise HTTPException(status_code=403, detail={
                "ok": False,
                "reason": "LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT",
                "message": f"License is already bound to MT5 account {bound}.",
                "license_pin": raw,
                "bound_account": bound,
                "account": account,
            })
        logger.info("[monitor-auth] accepted pin=%s license_id=%s account=%s user=%s",
                    raw, lic.get("id", ""), account, lic.get("buyer_email", ""))
        return lic

    # v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- the agent-token
    # fallback here used to authenticate copy-trading VPS workers
    # (_require_agent_async, X-Agent-Token), which is retired along with
    # the rest of the worker-agent subsystem. The licensed local EA always
    # sends a real license_pin (InpLicensePIN is a required EA input across
    # this entire codebase) -- fail closed on a missing PIN rather than
    # falling back to a mechanism that no longer exists.
    raise HTTPException(status_code=403, detail={
        "ok": False,
        "reason": "MISSING_LICENSE_PIN",
        "message": "EA monitor requests must include license_pin/pin. Put your ASE license key in InpLicensePIN.",
        "account": account,
    })

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# -------- Signup / Login / Me --------
@api_router.post("/cloud/auth/signup")
async def cloud_signup(req: CloudSignupReq, response: Response, request: Request):
    _rate_limit(f"cloud_signup_ip:{_client_ip(request)}", max_requests=10, window_seconds=600)
    req.email = req.email.lower().strip()
    # basic email format check (no regex lib dependency — simple sanity)
    if "@" not in req.email or "." not in req.email.split("@")[-1] or len(req.email) < 5:
        raise HTTPException(status_code=400, detail="Invalid email format")
    if await db.cloud_users.find_one({"email": req.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    # v6.25.3 owner directive 2026-07-17 (Phase 6 P0) -- require stronger
    # passwords: length alone (the old 8-char-minimum) doesn't stop
    # "password1"/"12345678". Require at least one letter AND one digit,
    # in addition to the length floor.
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be 8+ characters")
    if not any(c.isalpha() for c in req.password) or not any(c.isdigit() for c in req.password):
        raise HTTPException(status_code=400, detail="Password must include at least one letter and one number")
    uid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {"id": uid, "email": req.email, "password_hash": hash_password(req.password),
           "full_name": (req.full_name or "").strip(), "country": (req.country or "").strip(),
           "created_at": now.isoformat(), "last_login_at": now.isoformat()}
    try:
        await db.cloud_users.insert_one(doc.copy())
    except DuplicateKeyError:
        # The unique index (created at startup) caught a genuine race
        # between two concurrent signups for the same email that the
        # find_one check above couldn't see yet.
        raise HTTPException(status_code=400, detail="Email already registered")
    token = _cloud_token(uid, req.email)
    response.set_cookie("cloud_token", token, httponly=True,
                        secure=os.environ.get('COOKIE_SECURE', 'true').lower() != 'false',
                        samesite="strict", max_age=60*60*24*30, path="/")
    return {"ok": True, "user": {k: v for k, v in doc.items() if k != "password_hash"}}

@api_router.post("/cloud/auth/login")
async def cloud_login(req: CloudLoginReq, response: Response, request: Request):
    ip = _client_ip(request)
    req.email = req.email.lower().strip()
    _rate_limit(f"cloud_login_ip:{ip}", max_requests=10, window_seconds=300)
    _rate_limit(f"cloud_login_email:{req.email}", max_requests=5, window_seconds=300)
    u = await db.cloud_users.find_one({"email": req.email})
    if not u or not verify_password(req.password, u.get("password_hash", "")):
        await db.login_audit_log.insert_one({
            "id": str(uuid.uuid4()), "email": req.email, "ip": ip, "ok": False,
            "role": "cloud_user", "ts": datetime.now(timezone.utc),
        })
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_audit_log.insert_one({
        "id": str(uuid.uuid4()), "email": u["email"], "ip": ip, "ok": True,
        "role": "cloud_user", "ts": datetime.now(timezone.utc),
    })
    await db.cloud_users.update_one({"id": u["id"]}, {"$set": {"last_login_at": datetime.now(timezone.utc).isoformat()}})
    token = _cloud_token(u["id"], u["email"])
    response.set_cookie("cloud_token", token, httponly=True,
                        secure=os.environ.get('COOKIE_SECURE', 'true').lower() != 'false',
                        samesite="strict", max_age=60*60*24*30, path="/")
    u.pop("_id", None); u.pop("password_hash", None)
    return {"ok": True, "user": u}

@api_router.post("/cloud/auth/logout")
async def cloud_logout(response: Response):
    response.delete_cookie("cloud_token", path="/")
    return {"ok": True}

@api_router.get("/cloud/auth/me")
async def cloud_me(user: dict = Depends(get_cloud_user)):
    u = dict(user)
    u.pop("_id", None)
    # compute subscription status live
    ends = u.get("subscription_ends_at")
    if ends:
        try:
            end_dt = datetime.fromisoformat(ends.replace("Z", "+00:00"))
            remaining = end_dt - datetime.now(timezone.utc)
            u["subscription_active"] = remaining.total_seconds() > 0
            u["days_remaining"] = max(0, int((remaining.total_seconds() + 86399) // 86400))
        except Exception:
            u["days_remaining"] = 0; u["subscription_active"] = False
    return u

# ---------------------------------------------------------------------
# v6.25.3 owner directive 2026-07-17 (Phase 6 P0) -- Cloud user password
# reset, account deletion, and data export.
# ---------------------------------------------------------------------

class CloudForgotPasswordReq(BaseModel):
    email: str

class CloudResetPasswordReq(BaseModel):
    token: str
    new_password: str

class CloudDeleteAccountReq(BaseModel):
    password: str
    confirm: bool = False

def _password_reset_token(user_id: str, jti: str) -> str:
    return jwt.encode(
        {"sub": user_id, "type": "password_reset", "jti": jti,
         "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
        JWT_SECRET, algorithm=JWT_ALGORITHM)

@api_router.post("/cloud/auth/forgot-password")
async def cloud_forgot_password(req: CloudForgotPasswordReq, request: Request):
    ip = _client_ip(request)
    email = req.email.lower().strip()
    _rate_limit(f"forgot_password_ip:{ip}", max_requests=5, window_seconds=600)
    _rate_limit(f"forgot_password_email:{email}", max_requests=3, window_seconds=600)
    user = await db.cloud_users.find_one({"email": email})
    # Always return the same generic response whether or not the account
    # exists -- a different response here would let an attacker enumerate
    # registered emails.
    if user:
        jti = str(uuid.uuid4())
        token = _password_reset_token(user["id"], jti)
        reset_url = f"{PUBLIC_SITE_URL}/command/reset-password?token={token}"
        html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#B8860B;">Reset your XauCloud Command Center password</h2>
<p>Click the link below to set a new password. This link expires in 30 minutes and can only be used once.</p>
<p><a href="{reset_url}" style="display:inline-block;background:#B8860B;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">Reset password</a></p>
<p style="color:#888;font-size:12px;">If you didn't request this, you can safely ignore this email -- your password will not be changed.</p>
</div>"""
        await _send_email(email, "Reset your XauCloud password", html)
    return {"ok": True, "message": "If an account exists for that email, a reset link has been sent."}

@api_router.post("/cloud/auth/reset-password")
async def cloud_reset_password(req: CloudResetPasswordReq, request: Request):
    ip = _client_ip(request)
    _rate_limit(f"reset_password_ip:{ip}", max_requests=10, window_seconds=600)
    try:
        payload = jwt.decode(req.token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="Reset link has expired. Request a new one.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Invalid reset link.")
    if payload.get("type") != "password_reset":
        raise HTTPException(status_code=400, detail="Invalid reset link.")
    jti = payload.get("jti", "")
    # Single-use enforcement: a JWT alone stays valid until it expires even
    # after use, so a leaked/logged link could be replayed. A unique index
    # on jti (created at startup) makes the second insert_one for the same
    # token raise DuplicateKeyError, closing that window.
    try:
        await db.used_password_reset_tokens.insert_one({"jti": jti, "used_at": datetime.now(timezone.utc)})
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="This reset link has already been used.")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be 8+ characters")
    if not any(c.isalpha() for c in req.new_password) or not any(c.isdigit() for c in req.new_password):
        raise HTTPException(status_code=400, detail="Password must include at least one letter and one number")
    result = await db.cloud_users.update_one(
        {"id": payload["sub"]}, {"$set": {"password_hash": hash_password(req.new_password)}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Account no longer exists.")
    return {"ok": True, "message": "Password updated. You can now log in with your new password."}

@api_router.get("/cloud/account/export")
async def cloud_account_export(user: dict = Depends(get_cloud_user)):
    """Real, non-fabricated data-export: everything this account's identity
    actually touches, as it exists right now -- not a synthetic sample."""
    u = dict(user); u.pop("_id", None); u.pop("password_hash", None)
    lic = await _get_user_license(user)
    if lic: lic.pop("_id", None)
    login_history = await db.login_audit_log.find(
        {"email": user["email"], "role": "cloud_user"}, {"_id": 0}
    ).sort("ts", -1).limit(200).to_list(length=200)
    for entry in login_history:
        if isinstance(entry.get("ts"), datetime):
            entry["ts"] = entry["ts"].isoformat()
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": u,
        "linked_license": lic,
        "login_history": login_history,
    }

@api_router.post("/cloud/account/delete")
async def cloud_account_delete(req: CloudDeleteAccountReq, response: Response, user: dict = Depends(get_cloud_user)):
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required to delete your account.")
    if not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    # Hard-deletes the Command Center account identity only -- the
    # underlying purchased PIN license and its trade history are NOT
    # deleted (they're the product the owner sold and real financial/
    # trading records, not this account's personal data), matching the
    # scope of every other real "delete my account" flow: your login stops
    # working, your purchase/trade history doesn't get destroyed.
    await db.account_deletion_audit_log.insert_one({
        "id": str(uuid.uuid4()), "user_id": user["id"], "email": user["email"],
        "deleted_at": datetime.now(timezone.utc),
    })
    await db.cloud_users.delete_one({"id": user["id"]})
    response.delete_cookie("cloud_token")
    return {"ok": True, "message": "Account deleted."}

@api_router.post("/cloud/license/link")
async def cloud_license_link(req: CloudLicenseLinkReq, user: dict = Depends(get_cloud_user)):
    # Rate-limited by the authenticated user id -- prevents a compromised/
    # malicious Command Center session from brute-forcing license keys.
    _rate_limit(f"license_link_user:{user['id']}", max_requests=10, window_seconds=300)
    lic = await _verify_command_license(user, req.license_key)
    return {"ok": True, "license": {
        "license_id": lic.get("id", ""),
        "activation_key": lic.get("pin", ""),
        "status": "active" if lic.get("is_active") else "inactive",
        "is_used": bool(lic.get("is_used")),
        "activated_at": lic.get("activated_at") or "",
        "mt5_account": lic.get("mt5_account") or "",
        "buyer_email": lic.get("buyer_email") or user.get("email", ""),
        "created_at": lic.get("created_at") or "",
        "expiry": lic.get("expires_at") or lic.get("subscription_ends_at") or "",
    }}

@api_router.get("/cloud/license/status")
async def cloud_license_status(user: dict = Depends(get_cloud_user)):
    lic = await _get_user_license(user)
    if not lic:
        return {
            "linked": False,
            "license": None,
            "message": "No license linked. Add your ASE activation key to connect this Command Center to your EA.",
        }
    return {"linked": True, "license": {
        "license_id": lic.get("id", ""),
        "activation_key": lic.get("pin", ""),
        "status": "active" if lic.get("is_active") else "inactive",
        "is_used": bool(lic.get("is_used")),
        "activated_at": lic.get("activated_at") or "",
        "mt5_account": lic.get("mt5_account") or "",
        "account_binding": lic.get("mt5_account") or "Not bound yet",
        "vps_binding": lic.get("vps_binding") or "Not bound yet",
        "ea_version": lic.get("ea_version") or "",
        "buyer_email": lic.get("buyer_email") or user.get("email", ""),
        "created_at": lic.get("created_at") or "",
        "expiry": lic.get("expires_at") or lic.get("subscription_ends_at") or "Lifetime / manual",
    }}

# v6.25.3 owner directive 2026-07-17 (Phase 5 P0, final pre-launch hardening)
# -- DELETE RETIRED CLOUD COPY-TRADING. The MT5-connect/broker-list/pause/
# dashboard block that used to live here (cloud_connect_mt5, CLOUD_BROKER_SERVERS,
# _broker_profile_for_server, _broker_error_hint, _log_broker_event,
# cloud_list_brokers, cloud_mt5_compatibility, cloud_mt5_test_connection,
# cloud_mt5_logs, cloud_refresh_balance, cloud_disconnect_mt5, cloud_pause,
# cloud_dashboard) is removed entirely -- this product is a licensed local EA
# + remote monitor/control, not a master/slave copy-trading service. See
# backend/migrations/0001_delete_copy_trading.py for the data-side backup
# + deletion of the encrypted MT5 credentials and copy-trading collections
# this code used to read/write.

# -------- Trading Universe settings (v6.6.0 — architecture phase) --------
@api_router.get("/cloud/trading-universe")
async def get_trading_universe(user: dict = Depends(get_cloud_user)):
    doc = await db.trading_universe_settings.find_one({"user_id": user["id"]}, {"_id": 0})
    settings = TradingUniverseSettings(**(doc or {}))
    return settings.model_dump()

@api_router.post("/cloud/trading-universe")
async def set_trading_universe(req: TradingUniverseSettings, user: dict = Depends(get_cloud_user)):
    if req.enable_index:
        # v6.6.0 hard safety: reporting/UI can show Index as "enabled" for
        # planning purposes, but no index strategy exists yet — the EA's own
        # InpIndexModeLogOnly is what actually blocks trades, independent of
        # this dashboard setting. This flag does not yet do anything live.
        pass
    doc = req.model_dump()
    doc["user_id"] = user["id"]
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.trading_universe_settings.update_one(
        {"user_id": user["id"]}, {"$set": doc}, upsert=True)
    return {"ok": True, "settings": doc}

# -------- Payments (user submits proof; admin approves) --------
# v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired copy-trading
# billing/worker-infrastructure/agent-pairing block removed (payments,
# admin cloud users/stats, admin cloud settings CRUD, worker registration,
# agent-token rotation, pair-code exchange, shadow-mode toggle, test-signal
# fanout). See backend/migrations/0001_delete_copy_trading.py for the
# data-side backup+deletion this code used to serve.

# v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired copy-trading
# bot-mode presets (master EA trading-mode control) + master reasoning feed
# model removed. See backend/migrations/0001_delete_copy_trading.py.

class BotHeartbeatReq(BaseModel):
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    bot_online: Optional[bool] = True
    ea_version: Optional[str] = ""
    account_number: Optional[str] = ""
    broker_server: Optional[str] = ""
    symbol: Optional[str] = ""
    timeframe: Optional[str] = ""
    market_mode: Optional[str] = "GOLD_MODE"  # v6.6.0: GOLD_MODE or INDEX_MODE, as resolved by the EA's XAU_DetectMarketMode()
    index_profile: Optional[str] = ""          # v6.6.0: diagnostic only until a real index strategy ships
    spread: Optional[float] = 0.0
    equity: Optional[float] = 0.0
    balance: Optional[float] = 0.0
    daily_pnl: Optional[float] = 0.0
    drawdown: Optional[float] = 0.0
    open_positions: Optional[int] = 0
    algo_trading: Optional[bool] = False
    trading_allowed: Optional[bool] = False
    mt5_connected: Optional[bool] = False
    account_connected: Optional[bool] = False
    ea_active: Optional[bool] = True
    bot_state: Optional[str] = "UNKNOWN"
    last_action: Optional[str] = ""
    last_tick_time: Optional[str] = ""
    last_decision_time: Optional[str] = ""
    last_error: Optional[str] = ""
    epf_state: Optional[str] = ""
    sync_state: Optional[str] = ""
    prop_firm_mode: Optional[bool] = False
    prop_daily_loss_pct: Optional[float] = 0.0
    prop_max_loss_pct: Optional[float] = 0.0
    prop_safety_buffer_pct: Optional[float] = 0.0
    prop_risk_per_trade_pct: Optional[float] = 0.0
    prop_max_basket_risk_pct: Optional[float] = 0.0

class BotActivityReq(BaseModel):
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    event_type: str = "INFO"
    severity: str = "INFO"
    account: Optional[str] = ""
    symbol: Optional[str] = ""
    message: str = ""
    details: Optional[Dict[str, Any]] = None
    timeframe: Optional[str] = ""
    mode: Optional[str] = ""
    market_bias: Optional[str] = ""
    signal_direction: Optional[str] = ""
    ai_confidence: Optional[float] = None
    score: Optional[float] = None
    trade_allowed: Optional[bool] = None
    allowed: Optional[bool] = None
    decision: Optional[str] = ""
    reason: Optional[str] = ""
    blocked_by: Optional[str] = ""
    current_trade_status: Optional[str] = ""
    exit_decision: Optional[str] = ""
    risk_lot_decision: Optional[str] = ""
    module: Optional[str] = ""
    ticket: Optional[str] = ""
    profit: Optional[float] = None
    price: Optional[float] = None
    close_reason_exact: Optional[str] = ""
    closed_by_module: Optional[str] = ""
    was_broker_sl: Optional[bool] = None
    was_manual: Optional[bool] = None
    was_emergency_margin: Optional[bool] = None
    was_ea_forced_close: Optional[bool] = None
    position_direction: Optional[str] = ""
    candidate_allowed: Optional[bool] = None
    final_execution_allowed: Optional[bool] = None
    final_decision: Optional[str] = ""
    final_blocker: Optional[str] = ""
    open_trade_called: Optional[bool] = None
    trade_buy_called: Optional[bool] = None
    trade_sell_called: Optional[bool] = None
    broker_retcode: Optional[int] = None
    broker_error: Optional[int] = None
    pipeline_stage: Optional[str] = ""
    # v6.24.17 (AI Market Outlook) — the EA has posted these three JSON
    # objects since v6.24.11-15 (market_thesis, post_trade_state,
    # entry_readiness) but this model had no fields to receive them, so
    # Pydantic silently dropped them on every request. Adding them here is
    # what actually unlocks real evidence for the outlook feature; nothing
    # about the existing decision-feed/bot-status behavior changes.
    market_thesis: Optional[Dict[str, Any]] = None
    post_trade_state: Optional[Dict[str, Any]] = None
    entry_readiness: Optional[Dict[str, Any]] = None
    # v6.25.0 — M10 Intelligent Signal Engine evidence/decision block. Same
    # "add the field or Pydantic silently drops it" lesson as the three
    # above — this is what lets the Command Center show the EA's own real
    # M10 buy/sell case scores instead of nothing.
    m10_signal: Optional[Dict[str, Any]] = None
    # v6.25.5 — M30 three-M10-evidence consensus mode transparency (mode_active,
    # decision_mode, the three most recent stored M10 evidence records, and the
    # current slot's consensus decision). Same "add the field or Pydantic
    # silently drops it" lesson as m10_signal/market_thesis above.
    m30_consensus: Optional[Dict[str, Any]] = None

# v6.9.0 — purpose-built payload for XAU_LogTradeThesisStatus's cloud post.
# Kept separate from BotActivityReq's generic event schema since this is a
# per-position live-state snapshot (upserted, not appended) rather than a
# discrete event.
class TradeThesisStatusReq(BaseModel):
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    account: Optional[str] = ""
    symbol: Optional[str] = ""
    ticket: str = ""
    direction: Optional[str] = ""
    lots: Optional[float] = None
    trade_age_minutes: Optional[int] = None
    setup_type: Optional[str] = ""
    grade: Optional[str] = ""
    ai_confidence: Optional[int] = None
    thesis_score: Optional[float] = None
    hold_probability: Optional[float] = None
    exit_probability: Optional[float] = None
    state: Optional[str] = ""
    expected_type: Optional[str] = ""
    peak_profit: Optional[float] = None
    current_profit: Optional[float] = None
    protected_profit: Optional[float] = None
    hold_reason: Optional[str] = ""
    protect_reason: Optional[str] = ""
    exit_reason: Optional[str] = ""
    next_action: Optional[str] = ""
    entry_reason: Optional[str] = ""
    recovery_mode: Optional[str] = ""
    recovery_worst_pct: Optional[float] = None
    recovery_classification: Optional[str] = ""
    is_buy: Optional[bool] = None
    open_price: Optional[float] = None
    current_price: Optional[float] = None
    sl: Optional[float] = None
    tp: Optional[float] = None
    dist_to_sl: Optional[float] = None
    dist_to_tp: Optional[float] = None

def _dt_or_none(iso: str):
    if not iso:
        return None
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:
        return None

async def _store_bot_activity(event_type: str, severity: str, message: str,
                              account: str = "", symbol: str = "", details: dict = None):
    now = datetime.now(timezone.utc)
    sev = (severity or "INFO").upper()
    details = details or {}
    license_key = _normalize_license_key(details.get("license_key", ""))
    ev = (event_type or "INFO").upper()
    reason = str(details.get("reason") or message or "")[:300]
    module = str(details.get("module") or "")[:80]
    decision = str(details.get("decision") or "")[:160]
    blocked_by = str(details.get("blocked_by") or "")[:120]
    ticket = str(details.get("ticket") or "")
    text = f"{ev} {sev} {module} {decision} {reason} {blocked_by}".upper()
    if sev in {"OVERRIDE"} or any(k in text for k in ("OVERRIDE", "IGNORED", "LOSS_CLOSE_BLOCKED")):
        category = "overrides"
    elif sev in {"ENTRY", "TRADE"} or any(k in text for k in ("TRADE_EXECUTED", "FIRE", "PYR", "ENTRY")):
        category = "entries"
    elif sev in {"EXIT"} or any(k in text for k in ("EXIT", "CLOSE", "CLOSED")):
        category = "exits"
    elif sev in {"BLOCK"} or any(k in text for k in ("BLOCK", "VETO")):
        category = "blocks"
    elif sev in {"ERROR", "CRITICAL"} or any(k in text for k in ("ERROR", "FAILED")):
        category = "errors"
    elif any(k in text for k in ("RISK", "LOT", "GROWTH", "LOCK", "DRAWDOWN", "MARGIN")):
        category = "risk"
    elif any(k in text for k in ("AI", "DIRECTOR", "CONFIDENCE", "ML", "BRAIN")):
        category = "ai"
    else:
        category = "info"

    dedupe_source = "|".join([
        license_key,
        str(account or ""),
        str(symbol or ""),
        ev,
        sev,
        module,
        decision,
        reason,
        blocked_by,
        ticket,
    ])
    dedupe_key = hashlib.sha256(dedupe_source.encode("utf-8")).hexdigest()
    window_start = (now - timedelta(minutes=15)).isoformat()
    existing = await db.cloud_bot_activity.find_one(
        {"dedupe_key": dedupe_key, "ts": {"$gte": window_start}},
        {"_id": 0},
        sort=[("ts", -1)]
    )
    if existing:
        repeat_count = int(existing.get("repeat_count") or 1) + 1
        await db.cloud_bot_activity.update_one(
            {"id": existing["id"]},
            {"$set": {
                "ts": now.isoformat(),
                "last_repeat_at": now.isoformat(),
                "repeat_count": repeat_count,
                "message": str(message or "")[:600],
                "details": details,
            }}
        )
        existing.update({
            "ts": now.isoformat(),
            "last_repeat_at": now.isoformat(),
            "repeat_count": repeat_count,
            "message": str(message or "")[:600],
            "details": details,
        })
        return existing

    doc = {
        "id": str(uuid.uuid4()),
        "ts": now.isoformat(),
        "first_seen_at": now.isoformat(),
        "last_repeat_at": now.isoformat(),
        "repeat_count": 1,
        "dedupe_key": dedupe_key,
        "event_type": ev,
        "severity": sev,
        "event_category": category,
        "license_key": license_key,
        "account": str(account or ""),
        "symbol": str(symbol or ""),
        "message": str(message or "")[:600],
        "details": details,
        "module": module,
        "decision": decision,
        "reason": reason,
        "blocked_by": blocked_by,
        "ticket": ticket,
        "allowed": details.get("allowed", details.get("trade_allowed")),
        "mode": str(details.get("mode") or ""),
        "market_bias": str(details.get("market_bias") or ""),
        "signal_direction": str(details.get("signal_direction") or ""),
        "ai_confidence": details.get("ai_confidence"),
        "score": details.get("score"),
        "candidate_allowed": details.get("candidate_allowed"),
        "final_execution_allowed": details.get("final_execution_allowed"),
        "final_decision": str(details.get("final_decision") or ""),
        "final_blocker": str(details.get("final_blocker") or ""),
        "open_trade_called": details.get("open_trade_called"),
        "trade_buy_called": details.get("trade_buy_called"),
        "trade_sell_called": details.get("trade_sell_called"),
        "broker_retcode": details.get("broker_retcode"),
        "broker_error": details.get("broker_error"),
        "pipeline_stage": str(details.get("pipeline_stage") or ""),
    }
    await db.cloud_bot_activity.insert_one(doc.copy())
    total = await db.cloud_bot_activity.estimated_document_count()
    if total > 2500:
        oldest = await db.cloud_bot_activity.find({}, {"_id": 1, "ts": 1}).sort("ts", 1).to_list(total - 2000)
        if oldest:
            await db.cloud_bot_activity.delete_many({"_id": {"$in": [o["_id"] for o in oldest]}})
    return doc

def _monitor_severity(event_type: str, reason: str = "") -> str:
    text = f"{event_type} {reason}".upper()
    if any(k in text for k in ("ERROR", "FAILED", "DISABLED", "DISCONNECTED", "LOCK", "OFFLINE")):
        return "ERROR"
    if any(k in text for k in ("BLOCK", "VETO", "SPREAD", "NEWS", "SYNC")):
        return "BLOCK" if "BLOCK" in text or "VETO" in text else "WARNING"
    if any(k in text for k in ("FIRE", "TRADE", "PYR")):
        return "TRADE"
    if "EXIT" in text or "CLOSE" in text:
        return "EXIT"
    return "INFO"

# =====================================================================
# AI THOUGHT ENGINE — translates raw engine telemetry (event_type,
# regime codes, ATR-derived scores, etc.) into the plain-English
# "watching the AI think" narrative the Trading page shows by default.
#
# Deliberately template-based, not a live LLM call: the EA already sends
# near-natural-language fields (`reason`, `decision`, `grade`, and — when
# the AI Director was actually consulted — `thesis`/`bearish_case` inside
# `details`). This layer composes those into short bullets and a headline
# rather than generating new wording, so it costs nothing and adds no
# latency on every tick of an open trade. Numbers here (exit/hold/reversal
# probability) are heuristic estimates derived from confidence + regime,
# not literal ML model outputs — labeled as such wherever they're exposed.
# =====================================================================

_REGIME_PHRASES = {
    "STRONG_TREND":   "the trend is strong",
    "WEAK_TREND":     "a trend is present but weak",
    "RANGE":          "the market is ranging",
    "COMPRESSION":    "volatility is compressing",
    "EXPANSION":      "volatility is expanding",
    "MOMENTUM_CONT":  "momentum continuation is in play",
    "REVERSAL_ENV":   "conditions favor a possible reversal",
    "HIGH_VOLATILITY":"volatility is elevated",
    "BULL_TREND":     "the trend is bullish",
    "BEAR_TREND":     "the trend is bearish",
}
_SESSION_PHRASES = {
    "LONDON": "London session", "NEW_YORK": "New York session", "NY": "New York session",
    "ASIA": "Asian session", "ASIAN": "Asian session", "OVERLAP": "the London/NY overlap",
}
_GRADE_PHRASES = {"A+": "highest-quality setup", "A": "high-quality setup",
                  "B": "moderate-quality setup", "B+": "moderate-quality setup"}


def _ai_bias_word(direction) -> str:
    d = str(direction or "").upper().strip()
    if d in ("1", "+1", "BUY", "BULL", "BULLISH", "LONG"):
        return "Bullish"
    if d in ("-1", "SELL", "BEAR", "BEARISH", "SHORT"):
        return "Bearish"
    return ""


def _ai_split_reason_clauses(*texts) -> List[str]:
    """Break AI-written reason/thesis text into short bullet fragments."""
    clauses: List[str] = []
    seen = set()
    for t in texts:
        t = str(t or "").strip()
        if not t:
            continue
        parts = re.split(r"\s*(?:;|\||\.\s+|\n)\s*", t)
        for p in parts:
            p = p.strip(" .")
            if len(p) < 4:
                continue
            key = p.lower()
            if key in seen:
                continue
            seen.add(key)
            clauses.append(p[0].upper() + p[1:] if p else p)
    return clauses[:6]


def _ai_classify_card_type(ev: dict) -> str:
    category = str(ev.get("event_category") or "").lower()
    event_type = str(ev.get("event_type") or "").upper()
    decision = str(ev.get("decision") or "").upper()
    final_decision = str(ev.get("final_decision") or (ev.get("details") or {}).get("final_decision") or "").upper()
    final_allowed = ev.get("final_execution_allowed")
    allowed = ev.get("allowed")
    ticket = str(ev.get("ticket") or "").strip()
    # v6.25.1 owner directive 2026-07-17 -- renamed from "M5_DECISION" on the
    # EA side (timeframe identity must not live inside the event name;
    # primary_timeframe is a separate field now). Both names are accepted
    # here so already-queued/cached legacy events still classify correctly.
    if event_type in ("PRIMARY_DECISION", "M5_DECISION"):
        if final_decision in {"EXECUTED", "FILLED"} or final_allowed is True:
            return "TRADE_EXECUTED"
        if final_decision == "BLOCKED" or final_allowed is False and str(ev.get("candidate_allowed") or "").lower() != "true":
            return "TRADE_BLOCKED"
        return "MARKET_ANALYSIS"
    if event_type == "EXECUTION_FUNNEL":
        if final_decision == "EXECUTED" or final_allowed is True:
            return "TRADE_EXECUTED"
        if final_decision in {"BLOCKED", "ERROR"} or final_allowed is False:
            return "TRADE_BLOCKED"
        return "MARKET_ANALYSIS"
    if category == "entries" or "TRADE_EXECUTED" in event_type or "FIRE" in event_type or "PYR" in event_type:
        return "TRADE_EXECUTED"
    if category == "exits" or "EXIT" in event_type or "CLOSE" in event_type:
        return "TRADE_CLOSED"
    if category == "blocks" or allowed is False or "BLOCK" in event_type or "VETO" in decision:
        return "TRADE_BLOCKED"
    if not ticket and (category == "ai" or "DIRECTOR" in event_type or "SIGNAL" in event_type or "SETUP" in event_type):
        return "MARKET_ANALYSIS"
    if ticket:
        return "LIVE_THOUGHT"
    return "INFO"


def _ai_build_thought_card(ev: dict, prev_conf_by_ticket: dict) -> dict:
    """Turn one raw cloud_bot_activity document into a conversational card."""
    details = ev.get("details") or {}
    ticket = str(ev.get("ticket") or "").strip()
    grade = str(ev.get("grade") or details.get("grade") or "").strip()
    regime = str(details.get("regime") or ev.get("mode") or "").strip().upper()
    session = str(details.get("session") or "").strip().upper()
    confidence = ev.get("ai_confidence")
    confidence = int(confidence) if isinstance(confidence, (int, float)) else None
    bias = _ai_bias_word(ev.get("market_bias") or ev.get("signal_direction"))
    reason_raw = ev.get("reason") or ""
    final_decision = str(ev.get("final_decision") or details.get("final_decision") or "").strip()
    final_blocker = str(ev.get("final_blocker") or details.get("final_blocker") or "").strip()
    thesis = str(details.get("thesis") or "")
    bearish_case = str(details.get("bearish_case") or "")

    card_type = _ai_classify_card_type(ev)

    prev_conf = prev_conf_by_ticket.get(ticket) if ticket else None
    confidence_delta = None
    if confidence is not None and prev_conf is not None and confidence != prev_conf:
        confidence_delta = confidence - prev_conf
    if ticket and confidence is not None:
        prev_conf_by_ticket[ticket] = confidence

    bullets = _ai_split_reason_clauses(reason_raw, thesis)
    if regime and _REGIME_PHRASES.get(regime) and not any(regime.lower() in b.lower() for b in bullets):
        bullets.append(_REGIME_PHRASES[regime].capitalize())
    if session and _SESSION_PHRASES.get(session) and not any("session" in b.lower() for b in bullets):
        bullets.append(f"{_SESSION_PHRASES[session]} conditions")
    bullets = bullets[:6]

    tone = "neutral"
    headline = "AI Update"
    decision_text = str(ev.get("decision") or ev.get("message") or "").strip()
    action_text = ""
    result_usd = None

    if card_type == "MARKET_ANALYSIS":
        headline = "AI Market Analysis"
        tone = "bullish" if bias == "Bullish" else "bearish" if bias == "Bearish" else "neutral"
        # Always compose "Preparing BUY/SELL" from bias here — raw EA message
        # text (e.g. "AI Director verdict") is an internal label, not the
        # user-facing decision line; it still flows into reason_bullets above.
        action_word = "BUY" if bias == "Bullish" else "SELL" if bias == "Bearish" else ""
        decision_text = f"Preparing {action_word}" if action_word else "Analyzing setup"
        action_text = "Waiting for confirmation..."
    elif card_type == "TRADE_EXECUTED":
        headline = "Trade Executed"
        tone = "success"
        # "BUY executed" / "SELL executed" reads clearer here than the raw
        # decision label (e.g. "Entry allowed") the engine logs internally.
        direction = ev.get("position_direction") or bias
        decision_text = f"{direction} executed" if direction else (decision_text or "Trade executed")
        if confidence_delta:
            bullets.insert(0, f"Confidence {'increased' if confidence_delta > 0 else 'decreased'} "
                               f"{'to' if prev_conf is None else 'from ' + str(prev_conf) + '% to'} {confidence}%")
    elif card_type == "LIVE_THOUGHT":
        # A normal pullback (e.g. 93% -> 81%) should still read as calm — only
        # flag Warning once confidence itself is genuinely low, or the drop is
        # sharp enough to be more than routine noise.
        weakening = confidence is not None and confidence < 65
        dropping = confidence_delta is not None and confidence_delta <= -20
        if weakening or dropping:
            headline = "Warning"
            tone = "warning"
            decision_text = decision_text or "Watching carefully"
            action_text = "Not exiting yet — need confirmation."
        else:
            headline = "Live Thoughts"
            tone = "neutral"
            decision_text = decision_text or "Holding position"
            action_text = "No exit signal yet."
    elif card_type == "TRADE_CLOSED":
        headline = "Trade Closed"
        profit = ev.get("profit")
        if isinstance(profit, (int, float)):
            result_usd = round(float(profit), 2)
            tone = "success" if result_usd >= 0 else "danger"
        decision_text = ev.get("close_reason_exact") or decision_text or "Position closed"
        if not bullets:
            bullets = _ai_split_reason_clauses(ev.get("message") or "")
    elif card_type == "TRADE_BLOCKED":
        headline = "Trade Blocked"
        tone = "danger"
        # v6.9.0: this used to always say "Waiting for higher quality setup"
        # regardless of the actual reason — the real, specific block reason
        # (blocked_by, or the first reason bullet) is now the headline
        # decision line itself, not buried in the bullets underneath a
        # generic phrase. "Waiting for higher quality setup" is now only
        # the last-resort fallback when no specific reason is available.
        blocked_by = final_blocker or str(ev.get("blocked_by") or "").strip()
        if blocked_by and not any(blocked_by.lower() in b.lower() for b in bullets):
            bullets.insert(0, blocked_by)
        decision_text = _ai_humanize_block_reason(blocked_by) or (bullets[0] if bullets else "") or "Waiting for higher quality setup"
    elif card_type == "MARKET_ANALYSIS" and final_decision:
        decision_text = final_decision if final_decision != "WAITING" else "Waiting for execution gates"

    if grade:
        grade_phrase = _GRADE_PHRASES.get(grade.upper(), "")
        if grade_phrase and not any(grade_phrase in b.lower() for b in bullets):
            pass  # grade is surfaced as its own field, not duplicated into bullets

    simple_parts = [headline]
    if bias:
        simple_parts.append(f"{bias} bias")
    if confidence is not None:
        simple_parts.append(f"{confidence}% confidence")
    if decision_text:
        simple_parts.append(decision_text)
    simple_text = " — ".join(simple_parts)

    return {
        "id": ev.get("id"),
        "ticket": ticket,
        "ts": ev.get("ts"),
        "type": card_type,
        "tone": tone,
        "headline": headline,
        "bias": bias,
        "confidence": confidence,
        "confidence_delta": confidence_delta,
        "decision_text": decision_text,
        "reason_bullets": bullets,
        "action_text": action_text,
        "grade": grade or None,
        "result_usd": result_usd,
        "simple_text": simple_text,
        "advanced": {
            "event_type": ev.get("event_type"),
            "severity": ev.get("severity"),
            "module": ev.get("module"),
            "score": ev.get("score"),
            "regime": regime or None,
            "session": session or None,
            "market_bias": ev.get("market_bias"),
            "signal_direction": ev.get("signal_direction"),
            "symbol": ev.get("symbol"),
            "message": ev.get("message"),
            "close_reason_exact": ev.get("close_reason_exact"),
            "candidate_allowed": ev.get("candidate_allowed") if ev.get("candidate_allowed") is not None else details.get("candidate_allowed"),
            "final_execution_allowed": ev.get("final_execution_allowed") if ev.get("final_execution_allowed") is not None else details.get("final_execution_allowed"),
            "final_decision": final_decision or None,
            "final_blocker": final_blocker or None,
            "open_trade_called": ev.get("open_trade_called") if ev.get("open_trade_called") is not None else details.get("open_trade_called"),
            "broker_retcode": ev.get("broker_retcode") if ev.get("broker_retcode") is not None else details.get("broker_retcode"),
            "details": details,
        },
    }


# v6.9.0 — maps the EA's actual block-reason codes to the specific,
# human-readable phrasing the Command Center should show instead of a
# generic "waiting for higher quality setup." Matched by substring so new
# codes degrade gracefully (falls through to a cleaned-up version of the
# raw code) rather than ever going blank.
_BLOCK_REASON_PHRASES = [
    ("GROWTH_RR_BLOCK", "Blocked because the reward-to-risk ratio is too low for this setup"),
    ("SMC_HARD_CONFLICT", "Blocked because market structure (order blocks / BOS) strongly disagrees with this direction"),
    ("B-CONFIDENT-SKIP", "Blocked because AI confidence is weak on this setup"),
    ("AI-CONFIDENT-SKIP", "Blocked because AI confidence is weak on this setup"),
    ("HTF-CONSENSUS-OVERRIDE", "Blocked because the higher timeframe trend disagrees with this entry"),
    ("HTF_OVERRIDE", "Blocked because the higher timeframe trend disagrees with this entry"),
    ("WEAK-DISAGREE", "Blocked because AI disagrees with this setup, even if only mildly"),
    ("LOW-CONF-SKIP", "Blocked because AI confidence was too low to confirm this setup"),
    ("NO-CONF-SKIP", "Blocked because AI could not confirm this setup with any real confidence"),
    ("PERSONALITY", "Blocked because this setup type doesn't fit current market conditions"),
    ("TRI_REENTRY_WATCH", "Blocked because this direction recently bailed out of a weak recovery — waiting for a fresh, better-quality entry instead of repeating the same read"),
    ("POST_NEWS_AVOID", "Blocked because price is still reacting to recent news — waiting for it to settle"),
    ("SPREAD", "Blocked because the spread is too wide right now"),
    ("NEWS", "Blocked because a high-impact news event is near"),
    ("REGIME_DEAD", "Blocked because the market is too quiet/directionless right now"),
    ("STRETCHED", "Blocked because price is already extended after a strong move — entry would be late"),
    ("OVEREXTENDED", "Blocked because price is already extended after a strong move — entry would be late"),
    ("RESISTANCE", "Blocked because price is too close to resistance"),
    ("SUPPORT", "Blocked because price is too close to support"),
    ("ANTI-TREND", "Blocked because this direction is fighting the higher timeframe trend"),
    ("ANTI_TREND", "Blocked because this direction is fighting the higher timeframe trend"),
]


def _ai_humanize_block_reason(code: str) -> str:
    c = str(code or "").upper()
    if not c:
        return ""
    for needle, phrase in _BLOCK_REASON_PHRASES:
        if needle in c:
            return phrase
    # Unrecognized code: still show something specific rather than a
    # generic phrase — clean the raw code into readable words.
    cleaned = re.sub(r"[_\-]+", " ", str(code)).strip()
    if not cleaned:
        return ""
    return f"Blocked: {cleaned.lower()}"


def _ai_would_enter_again(latest_card: dict) -> dict:
    """Heuristic 'would I take this trade again right now' verdict — derived
    from current confidence + tone, not a separate ML call. Three-way
    (YES/NO/WAIT), matching the Command Center spec: a clearly weak read
    says NO, a clearly healthy one says YES, and a genuinely ambiguous one
    says WAIT rather than forcing a binary guess either way."""
    conf = latest_card.get("confidence")
    tone = latest_card.get("tone")
    delta = latest_card.get("confidence_delta") or 0
    if conf is None:
        return {"answer": "WAIT", "reason": "No live confidence reading yet — wait for the next evaluation."}
    if tone == "danger" or conf < 45:
        return {"answer": "NO", "reason": "Confidence is too weak to justify entering here."}
    if tone == "warning" or conf < 65:
        why = "Confidence has dropped and hasn't recovered yet" if delta < 0 else \
              "Confidence is in a borderline zone — not clearly good or bad"
        return {"answer": "WAIT", "reason": why + "; wait for a clearer read before acting."}
    return {"answer": "YES", "reason": "Thesis still holds at current confidence."}

# v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired /cloud/master/reasoning
# (copy-trading master EA "why blocked/fired" feed, cloud_reasoning collection).
# See backend/migrations/0001_delete_copy_trading.py.

@api_router.post("/cloud/monitor/heartbeat")
async def cloud_monitor_heartbeat(req: BotHeartbeatReq, request: Request):
    """Remote monitoring only; this endpoint never executes trades or changes strategy."""
    now = datetime.now(timezone.utc)
    doc = req.model_dump()
    license_key = _normalize_license_key(req.license_key or req.pin or "")
    account = str(req.account_number or "")
    lic = await _resolve_monitor_license(license_key, account, request)
    license_id = lic.get("id", "") if lic else ""
    if license_key:
        doc["license_key"] = license_key
        doc["pin"] = license_key
    if license_id:
        doc["license_id"] = license_id
    doc["id"] = str(uuid.uuid4())
    doc["ts"] = now.isoformat()
    doc["last_heartbeat"] = now.isoformat()
    if license_key:
        update_result = await db.pin_licenses.update_one(
            {"pin": license_key, "is_active": True},
            {"$set": {
                "is_used": True,
                "activated_at": now.isoformat(),
                "mt5_account": account,
                "ea_version": req.ea_version or "",
                "broker_server": req.broker_server or "",
                "last_heartbeat": now.isoformat(),
                "last_symbol": req.symbol or "",
                "last_timeframe": req.timeframe or "",
            }},
            upsert=False,
        )
        doc["license_update_matched"] = update_result.matched_count
        doc["license_update_modified"] = update_result.modified_count
    await db.cloud_bot_heartbeats.insert_one(doc.copy())
    await db.cloud_settings.update_one({"key": "main"}, {"$set": {
        "master_last_heartbeat": now.isoformat(),
        "master_ea_status": "online",
        "monitor_last_heartbeat": now.isoformat(),
        "monitor_last_status": doc,
    }}, upsert=True)
    noisy_stale_error = str(req.last_error or "").strip().upper() in {"MQL ERROR 5035"}
    if req.last_error and not noisy_stale_error:
        await _store_bot_activity("ERROR", "ERROR", req.last_error, account, req.symbol or "", doc)
    if req.algo_trading is False:
        await _store_bot_activity("ALGO_DISABLED", "CRITICAL", "Algo Trading disabled", account, req.symbol or "", doc)
    if req.mt5_connected is False:
        await _store_bot_activity("MT5_DISCONNECTED", "CRITICAL", "MT5 disconnected", account, req.symbol or "", doc)
    total = await db.cloud_bot_heartbeats.estimated_document_count()
    if total > 1500:
        oldest = await db.cloud_bot_heartbeats.find({}, {"_id": 1, "ts": 1}).sort("ts", 1).to_list(total - 1000)
        if oldest:
            await db.cloud_bot_heartbeats.delete_many({"_id": {"$in": [o["_id"] for o in oldest]}})
    response = {
        "ok": True,
        "status": "received",
        "auth": "license_pin" if license_key else "agent_token",
        "license_pin": license_key,
        "license_id": license_id,
        "account": account,
        "heartbeat_id": doc["id"],
        "bound": bool(account),
    }
    logger.info("[monitor-heartbeat] response=%s", response)
    return response

@api_router.post("/cloud/monitor/activity")
async def cloud_monitor_activity(req: BotActivityReq, request: Request):
    """Remote monitoring only; this endpoint never executes trades."""
    license_key = _normalize_license_key(req.license_key or req.pin or "")
    lic = await _resolve_monitor_license(license_key, req.account or "", request)
    details = dict(req.details or {})
    for field in (
        "timeframe", "mode", "market_bias", "signal_direction", "ai_confidence",
        "score", "trade_allowed", "allowed", "decision", "reason", "blocked_by",
        "current_trade_status", "exit_decision", "risk_lot_decision", "module",
        "ticket", "profit", "price", "close_reason_exact", "closed_by_module",
        "was_broker_sl", "was_manual", "was_emergency_margin", "was_ea_forced_close",
        "position_direction", "candidate_allowed", "final_execution_allowed",
        "final_decision", "final_blocker", "open_trade_called", "trade_buy_called",
        "trade_sell_called", "broker_retcode", "broker_error", "pipeline_stage",
        "market_thesis", "post_trade_state", "entry_readiness", "m10_signal",
        "m30_consensus",
    ):
        value = getattr(req, field, None)
        if value is not None and value != "":
            details[field] = value
    if license_key:
        details = dict(details)
        details["license_key"] = license_key
        details["license_id"] = lic.get("id", "") if lic else ""
    doc = await _store_bot_activity(req.event_type, req.severity, req.message,
                                    req.account or "", req.symbol or "", details)
    await db.cloud_settings.update_one({"key": "main"}, {"$set": {
        "monitor_last_activity_at": doc["ts"],
        "monitor_last_activity": doc,
    }}, upsert=True)
    # Push dispatch is observational and isolated from the EA response. Only
    # broker-confirmed trade lifecycle events pass the notification classifier.
    async def _dispatch_activity_push_event():
        try:
            from notifications import send_trade_activity_notification
            await send_trade_activity_notification(doc)
        except Exception as exc:
            logger.warning(f"[activity-push] account={req.account} event={req.event_type} error={exc}")
    asyncio.create_task(_dispatch_activity_push_event())

    # Signal Outlook monitoring consumes the same immutable broker Bid/Ask
    # snapshot already posted by the EA. A fresh explicit M10 candidate is
    # published immediately with a deterministic bar-level key; the ordinary
    # hourly informational publisher remains as the fallback cadence.
    import market_outlook as _outlook_quote_mapper
    normalized_quote = _outlook_quote_mapper.extract_evidence_quote_from_details(details, doc["ts"])
    quote_bid = float(normalized_quote.get("bid") or 0.0)
    quote_ask = float(normalized_quote.get("ask") or 0.0)
    if quote_bid > 0.0 and quote_ask >= quote_bid and (req.account or ""):
        async def _monitor_outlook_quote_event():
            try:
                import market_outlook as _mo
                await _mo.track_outlook_lifecycle_tick(
                    account=req.account or "", bid=quote_bid, ask=quote_ask, quote_at=doc["ts"])
                m10_signal = details.get("m10_signal") or {}
                m10_decision = str(m10_signal.get("decision") or m10_signal.get("final_decision") or "").upper()
                if m10_decision in {"BUY_CANDIDATE", "SELL_CANDIDATE", "ALLOW_CORE"}:
                    await _mo.publish_m10_signal_from_activity(
                        license_key=license_key,
                        account=req.account or "",
                        source_event_id=doc["id"],
                    )
                await _mo.hourly_generation_tick(account=req.account or "")
            except Exception as exc:
                logger.warning(f"[outlook-event-monitor] account={req.account} error={exc}")
        asyncio.create_task(_monitor_outlook_quote_event())
    return {"ok": True, "event_id": doc["id"]}

# v6.25.1 owner directive 2026-07-17 -- CROSS-INSTANCE ATOMIC DIRECTION
# RESERVATION. The EA's own GlobalVariableSetOnCondition-based lock
# (XAU_TryClaimEntryLock) only protects two chart instances WITHIN THE SAME
# terminal -- MT5 global variables are per-terminal, not shared across
# machines. Mac and VPS are two entirely separate terminal installations
# with no shared memory, so that lock cannot prevent them from racing each
# other. This is the real shared coordination point: both terminals already
# call this backend for heartbeat/activity, so it is the only place true
# cross-machine atomicity is possible. Atomicity is enforced by MongoDB's
# unique _id constraint on the reservation key (broker_server:account:symbol)
# -- see the DuplicateKeyError handling below, not a read-then-write race.
class DirectionReservationClaimReq(BaseModel):
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    broker_server: str = ""
    account: str = ""
    symbol: str = ""
    direction: int = 0  # 1=BUY, -1=SELL
    requesting_family: str = ""
    # Immutable identity of the exact execution opportunity. Even a repeat
    # request for the same key is blocked while the first claim is live:
    # otherwise two terminals evaluating one candidate can both send it.
    execution_key: str = ""
    terminal_identity: str = ""
    ttl_seconds: Optional[int] = 30

class DirectionReservationReleaseReq(BaseModel):
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    broker_server: str = ""
    account: str = ""
    symbol: str = ""
    reservation_id: str = ""

def _reservation_key(broker_server: str, account: str, symbol: str) -> str:
    return f"{(broker_server or '').strip()}:{(account or '').strip()}:{(symbol or '').strip()}"

_RESERVATION_VALID_SYMBOLS = {"XAUUSD", "XAUUSDm", "XAUUSD.", "GOLD"}

@api_router.post("/cloud/reservation/claim")
async def cloud_reservation_claim(req: DirectionReservationClaimReq, request: Request):
    """Atomically claim the requested direction for this broker_server+account+
    symbol. Succeeds only if no reservation exists or the prior reservation
    has expired. Every unexpired claim blocks every subsequent claimant,
    including the same direction and the same execution key. There is no
    claim renewal operation: a second success could authorize a second
    terminal to send the same real-money order.

    v6.25.2 owner directive 2026-07-17 -- SECURITY FIX. This endpoint used to
    accept pin/license_key/broker_server/account/symbol WITHOUT ever
    validating them: any unauthenticated caller who could guess or observe a
    real broker_server+account+symbol combination (not secret -- it appears
    in Command Center URLs and log lines) could claim a direction and block
    the real bot from trading, indefinitely, just by renewing before TTL
    expiry. Now authenticated the exact same way every other EA-facing
    endpoint in this file is (_resolve_monitor_license -- the existing
    canonical helper, no second auth system): the PIN must resolve to an
    active license, and if that license is already bound to an MT5 account,
    the requested account must match it. An outsider without a valid,
    active, correctly-bound license PIN can no longer claim or block
    anything here."""
    if req.direction not in (1, -1):
        raise HTTPException(status_code=400, detail="direction must be 1 or -1")
    key = _reservation_key(req.broker_server, req.account, req.symbol)
    if not req.broker_server or not req.account or not req.symbol:
        raise HTTPException(status_code=400, detail="broker_server, account, and symbol are required")
    if req.symbol.upper() not in {s.upper() for s in _RESERVATION_VALID_SYMBOLS}:
        logger.warning("[reservation-claim] reject invalid symbol=%s account=%s", req.symbol, req.account)
        raise HTTPException(status_code=400, detail={"ok": False, "reason": "INVALID_SYMBOL", "symbol": req.symbol})
    lic = await _resolve_monitor_license(req.pin or req.license_key, req.account, request)
    execution_key = (req.execution_key or "").strip()
    if not execution_key or len(execution_key) > 240:
        raise HTTPException(status_code=400, detail="execution_key is required and must be at most 240 characters")
    now = datetime.now(timezone.utc)
    ttl = max(5, min(int(req.ttl_seconds or 30), 120))
    expires_at = now + timedelta(seconds=ttl)
    reservation_id = str(uuid.uuid4())
    try:
        await db.cloud_direction_reservations.find_one_and_update(
            {"_id": key, "expiresAt": {"$lte": now.isoformat()}},
            {"$set": {
                "direction": req.direction,
                "requestingFamily": req.requesting_family,
                "executionKey": execution_key,
                "reservationId": reservation_id,
                "createdAt": now.isoformat(),
                "expiresAt": expires_at.isoformat(),
                "terminalIdentity": req.terminal_identity,
                "brokerServer": req.broker_server,
                "account": req.account,
                "symbol": req.symbol,
                # v6.25.2 owner directive -- ownership identity, so release
                # can verify the releasing caller's license genuinely owns
                # this reservation, not just knows the right reservationId.
                "licenseId": lic.get("id", ""),
            }},
            upsert=True,
        )
        logger.info("[reservation-claim] key=%s direction=%s family=%s reservationId=%s CLAIMED",
                    key, req.direction, req.requesting_family, reservation_id)
        return {"claimed": True, "reservationId": reservation_id, "expiresAt": expires_at.isoformat()}
    except DuplicateKeyError:
        existing = await db.cloud_direction_reservations.find_one({"_id": key}, {"_id": 0})
        logger.info("[reservation-claim] key=%s direction=%s family=%s BLOCKED existing=%s",
                    key, req.direction, req.requesting_family, existing)
        return {
            "claimed": False,
            "reason": "ACTIVE_EXECUTION_RESERVED",
            "existingDirection": existing.get("direction") if existing else None,
            "existingFamily": existing.get("requestingFamily") if existing else None,
            "existingTerminal": existing.get("terminalIdentity") if existing else None,
            "sameExecution": bool(existing and existing.get("executionKey") == execution_key),
        }

@api_router.post("/cloud/reservation/release")
async def cloud_reservation_release(req: DirectionReservationReleaseReq, request: Request):
    """Release (or let expire) a reservation this exact call claimed. Only
    releases if reservation_id matches -- a stale/foreign release request can
    never clear another instance's active claim.

    v6.25.2 owner directive 2026-07-17 -- SECURITY FIX, same as claim: an
    unauthenticated caller who merely observed a reservationId (not secret
    -- it is returned in the claim response and appears in logs) could
    previously release someone else's active reservation outright, clearing
    the real bot's direction lock. Now requires the same authenticated,
    account-bound license as claim, AND the resolved license must be the
    SAME one (licenseId) that originally claimed this reservation -- a
    correctly-authenticated but foreign license cannot clear another
    license's reservation just by knowing its reservationId."""
    lic = await _resolve_monitor_license(req.pin or req.license_key, req.account, request)
    key = _reservation_key(req.broker_server, req.account, req.symbol)
    result = await db.cloud_direction_reservations.delete_one(
        {"_id": key, "reservationId": req.reservation_id, "licenseId": lic.get("id", "")})
    released = result.deleted_count > 0
    if not released:
        # Distinguish "nothing to release" (already expired/never existed)
        # from "a real reservation exists here but this caller doesn't own
        # it" -- the latter must never silently succeed.
        foreign = await db.cloud_direction_reservations.find_one(
            {"_id": key, "reservationId": req.reservation_id}, {"_id": 0, "licenseId": 1})
        if foreign is not None:
            logger.warning("[reservation-release] key=%s reservationId=%s REJECTED foreign release attempt by licenseId=%s (owner=%s)",
                            key, req.reservation_id, lic.get("id", ""), foreign.get("licenseId", ""))
    logger.info("[reservation-release] key=%s reservationId=%s licenseId=%s released=%s", key, req.reservation_id, lic.get("id", ""), released)
    return {"released": released}

########################################
# BOUNDED OFFLINE TRADING LEASE
########################################
# See audits/offline_lease/ for the full design. This does not replace
# the reservation system above -- it is a fallback used by the EA only
# when a genuine temporary connectivity failure prevents reaching
# /cloud/reservation/claim at all (never on an explicit deny/auth/
# validation failure). The backend remains the sole authoritative
# cross-device duplicate-prevention system whenever it is reachable.

class LeaseRequestReq(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pin: str = ""
    license_key: Optional[str] = ""
    account: str = ""
    broker_server: str = ""
    symbol: str = ""
    installation_id: str = ""
    terminal_instance_id: str = ""
    allowed_directions: List[int] = [1, -1]
    allowed_entry_families: List[str] = ["CORE"]

class LeaseSurrenderReq(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pin: str = ""
    license_key: Optional[str] = ""
    account: str = ""
    broker_server: str = ""
    symbol: str = ""
    installation_id: str = ""
    terminal_instance_id: str = ""
    lease_id: str = ""

class LeaseReconcileEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    execution_key: str
    lease_id: str
    lease_sequence: int
    candidate_evidence_id: str = ""
    opportunity_id: str = ""
    direction: int
    entry_family: str = "CORE"
    broker_order_id: str = ""
    broker_deal_id: str = ""
    broker_position_id: str = ""
    broker_ticket: int = 0
    result: str = "CONFIRMED"  # CONFIRMED | AMBIGUOUS | REJECTED
    executed_at: str = ""

class LeaseReconcileReq(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pin: str = ""
    license_key: Optional[str] = ""
    account: str = ""
    broker_server: str = ""
    symbol: str = ""
    installation_id: str = ""
    terminal_instance_id: str = ""
    events: List[LeaseReconcileEvent] = []


def _lease_authority_key(license_id: str, account: str, broker_server: str, symbol: str) -> str:
    return f"{license_id}:{(broker_server or '').strip()}:{(account or '').strip()}:{(symbol or '').strip().upper()}"


def get_lease_config() -> dict:
    return {
        "validity_seconds": int(os.environ.get("XAUCLOUD_LEASE_VALIDITY_SECONDS", "900")),
        "renewal_seconds_before_expiry": int(os.environ.get("XAUCLOUD_LEASE_RENEWAL_SECONDS", "300")),
        "max_offline_campaigns": int(os.environ.get("XAUCLOUD_LEASE_MAX_OFFLINE_CAMPAIGNS", "1")),
    }


async def _issue_lease(lic: dict, req_account: str, req_broker_server: str, req_symbol: str,
                        installation_id: str, terminal_instance_id: str,
                        allowed_directions: List[int], allowed_entry_families: List[str],
                        is_renewal: bool) -> dict:
    """Shared atomic issue/renew logic for /lease/request and /lease/renew.
    Enforces: only one non-expired, non-surrendered primary terminal per
    (license, account, server, symbol) at a time. A different terminal
    cannot receive a new lease for the same key until the current one has
    expired or been explicitly surrendered -- enforced by the MongoDB
    filter itself (the compare-and-swap), never only checked in Python
    after a plain read."""
    if not installation_id or not terminal_instance_id:
        raise HTTPException(status_code=400, detail="installation_id and terminal_instance_id are required")
    symbol_norm = (req_symbol or "").strip().upper()
    if symbol_norm not in {s.upper() for s in _RESERVATION_VALID_SYMBOLS}:
        raise HTTPException(status_code=400, detail={"ok": False, "reason": "INVALID_SYMBOL", "symbol": req_symbol})

    cfg = get_lease_config()
    key = _lease_authority_key(lic.get("id", ""), req_account, req_broker_server, symbol_norm)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    existing = await db.lease_terminal_authority.find_one({"_id": key})
    if existing:
        holder_terminal = existing.get("holder_terminal_id", "")
        holder_expired = existing.get("lease_expires_at", "") <= now_iso
        surrendered = existing.get("surrendered", False)
        if holder_terminal != terminal_instance_id and not holder_expired and not surrendered:
            raise HTTPException(status_code=403, detail={
                "ok": False,
                "reason": "PRIMARY_TERMINAL_ALREADY_ASSIGNED",
                "message": "Another terminal already holds an active offline lease for this account/symbol.",
                "holder_terminal_id": holder_terminal,
                "lease_expires_at": existing.get("lease_expires_at"),
            })
        if is_renewal and holder_terminal != terminal_instance_id:
            raise HTTPException(status_code=403, detail={
                "ok": False,
                "reason": "NOT_CURRENT_HOLDER",
                "message": "Only the current primary terminal may renew this lease.",
            })

    try:
        signing_key = lease_service.load_signing_key()
    except lease_service.LeaseCryptoNotConfigured as e:
        logger.error(f"[lease] signing key not configured: {e}")
        raise HTTPException(status_code=503, detail="Lease signing is not configured on this server.")

    next_sequence = int((existing or {}).get("lease_sequence", 0)) + 1
    revocation_epoch = int((existing or {}).get("revocation_epoch", 1))
    lease_id = str(uuid.uuid4())
    expires_at = now + timedelta(seconds=cfg["validity_seconds"])
    renewal_after = expires_at - timedelta(seconds=cfg["renewal_seconds_before_expiry"])

    lease_fields = {
        "schema_version": lease_service.LEASE_SCHEMA_VERSION,
        "lease_id": lease_id,
        "key_id": signing_key.key_id,
        "tenant_id": lic.get("id", ""),
        "license_id": lic.get("id", ""),
        "account_login": req_account,
        "account_server": req_broker_server,
        "installation_id": installation_id,
        "terminal_instance_id": terminal_instance_id,
        "normalized_symbol": symbol_norm,
        "allowed_directions": allowed_directions,
        "allowed_entry_families": allowed_entry_families,
        "issued_at_unix": int(now.timestamp()),
        "not_before_unix": int(now.timestamp()),
        "expires_at_unix": int(expires_at.timestamp()),
        "renewal_after_unix": int(renewal_after.timestamp()),
        "maximum_offline_new_campaigns": cfg["max_offline_campaigns"],
        "remaining_offline_new_campaigns": cfg["max_offline_campaigns"],
        "lease_sequence": next_sequence,
        "revocation_epoch": revocation_epoch,
        "nonce": lease_service.new_nonce(),
    }
    signature_hex = lease_service.sign_lease(signing_key, lease_fields)

    # Atomic compare-and-swap: the filter re-requires the same holder
    # condition checked above, at write time, so two concurrent requests
    # from two different terminals can never both win this update.
    filter_query = {
        "_id": key,
        "$or": [
            {"holder_terminal_id": {"$exists": False}},
            {"holder_terminal_id": terminal_instance_id},
            {"lease_expires_at": {"$lte": now_iso}},
            {"surrendered": True},
        ],
    }
    update_result = await db.lease_terminal_authority.find_one_and_update(
        filter_query,
        {"$set": {
            "holder_terminal_id": terminal_instance_id,
            "holder_installation_id": installation_id,
            "lease_sequence": next_sequence,
            "revocation_epoch": revocation_epoch,
            "current_lease_id": lease_id,
            "lease_expires_at": expires_at.isoformat(),
            "surrendered": False,
            "updated_at": now_iso,
        }},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if update_result is None or update_result.get("current_lease_id") != lease_id:
        # Lost a genuine race against another concurrent request -- fail
        # closed rather than hand out a lease that isn't actually authoritative.
        raise HTTPException(status_code=409, detail={"ok": False, "reason": "CONCURRENT_LEASE_ASSIGNMENT", "message": "Lease assignment raced with another request; retry."})

    lease_doc = dict(lease_fields)
    lease_doc["signature_algorithm"] = lease_service.LEASE_ALGORITHM_ID
    lease_doc["detached_signature"] = signature_hex
    lease_doc["_history_id"] = str(uuid.uuid4())
    lease_doc["recorded_at"] = now_iso
    # Display-only ISO strings for the admin UI -- NOT part of the signed
    # canonical payload (that uses the *_unix integer fields above, which
    # MQL5 can parse unambiguously). Never used by the EA's own logic.
    lease_doc["issued_at_iso"] = now_iso
    lease_doc["expires_at_iso"] = expires_at.isoformat()
    lease_doc["renewal_after_iso"] = renewal_after.isoformat()
    await db.lease_documents.insert_one(dict(lease_doc))
    lease_doc.pop("_id", None)
    logger.info(f"LEASE_ISSUED key={key} lease_id={lease_id} sequence={next_sequence} terminal={terminal_instance_id} renewal={is_renewal}")
    return lease_doc


@api_router.post("/cloud/lease/request")
async def cloud_lease_request(req: LeaseRequestReq, request: Request):
    lic = await _resolve_monitor_license(req.pin or req.license_key, req.account, request)
    lease_doc = await _issue_lease(lic, req.account, req.broker_server, req.symbol,
                                    req.installation_id, req.terminal_instance_id,
                                    req.allowed_directions, req.allowed_entry_families, is_renewal=False)
    return {"issued": True, "lease": lease_doc}


@api_router.post("/cloud/lease/renew")
async def cloud_lease_renew(req: LeaseRequestReq, request: Request):
    lic = await _resolve_monitor_license(req.pin or req.license_key, req.account, request)
    lease_doc = await _issue_lease(lic, req.account, req.broker_server, req.symbol,
                                    req.installation_id, req.terminal_instance_id,
                                    req.allowed_directions, req.allowed_entry_families, is_renewal=True)
    return {"issued": True, "lease": lease_doc}


@api_router.post("/cloud/lease/surrender")
async def cloud_lease_surrender(req: LeaseSurrenderReq, request: Request):
    lic = await _resolve_monitor_license(req.pin or req.license_key, req.account, request)
    key = _lease_authority_key(lic.get("id", ""), req.account, req.broker_server, req.symbol)
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.lease_terminal_authority.update_one(
        {"_id": key, "holder_terminal_id": req.terminal_instance_id, "current_lease_id": req.lease_id},
        {"$set": {"surrendered": True, "updated_at": now_iso}},
    )
    surrendered = result.modified_count > 0
    logger.info(f"LEASE_SURRENDER key={key} lease_id={req.lease_id} terminal={req.terminal_instance_id} surrendered={surrendered}")
    return {"surrendered": surrendered}


@api_router.get("/cloud/lease/status")
async def cloud_lease_status(pin: str = "", account: str = "", broker_server: str = "", symbol: str = "", request: Request = None):
    lic = await _resolve_monitor_license(pin, account, request)
    key = _lease_authority_key(lic.get("id", ""), account, broker_server, symbol)
    authority = await db.lease_terminal_authority.find_one({"_id": key}, {"_id": 0})
    if not authority:
        return {"has_authority_record": False}
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "has_authority_record": True,
        "holder_terminal_id": authority.get("holder_terminal_id"),
        "lease_sequence": authority.get("lease_sequence"),
        "lease_expires_at": authority.get("lease_expires_at"),
        "is_expired": authority.get("lease_expires_at", "") <= now_iso,
        "surrendered": authority.get("surrendered", False),
        "revocation_epoch": authority.get("revocation_epoch"),
    }


@api_router.post("/cloud/lease/reconcile")
async def cloud_lease_reconcile(req: LeaseReconcileReq, request: Request):
    """Idempotent -- each event's execution_key is unique-indexed in
    lease_offline_events; reconciling the same event twice (retry, two
    terminals, replayed upload) is a no-op on the second+ attempt, never a
    second position/duplicate record. Never creates a trade -- this only
    records that an offline execution already happened (or may have
    happened) so the backend's own view of history is complete; the real
    trade record comes from the EA's normal /journal/log path."""
    lic = await _resolve_monitor_license(req.pin or req.license_key, req.account, request)
    now_iso = datetime.now(timezone.utc).isoformat()
    results = []
    for ev in req.events:
        doc = ev.model_dump()
        doc["_id"] = ev.execution_key
        doc["license_id"] = lic.get("id", "")
        doc["account"] = req.account
        doc["broker_server"] = req.broker_server
        doc["symbol"] = req.symbol
        doc["installation_id"] = req.installation_id
        doc["terminal_instance_id"] = req.terminal_instance_id
        doc["reconciled_at"] = now_iso
        try:
            await db.lease_offline_events.insert_one(doc)
            results.append({"execution_key": ev.execution_key, "status": "reconciled"})
            logger.info(f"LEASE_RECONCILE_NEW execution_key={ev.execution_key} lease_id={ev.lease_id} result={ev.result}")
        except DuplicateKeyError:
            results.append({"execution_key": ev.execution_key, "status": "already_reconciled"})
    return {"reconciled": True, "events": results}


@api_router.post("/cloud/monitor/thesis-status")
async def cloud_monitor_thesis_status(req: TradeThesisStatusReq, request: Request):
    """Live per-position state from XAU_LogTradeThesisStatus — upserted (one
    current doc per ticket), not appended, since only the latest state
    matters for the Command Center's Open Trade Thinking panel."""
    license_key = _normalize_license_key(req.license_key or req.pin or "")
    lic = await _resolve_monitor_license(license_key, req.account or "", request)
    if not req.ticket:
        raise HTTPException(status_code=400, detail="ticket is required")
    doc = req.model_dump()
    doc["license_key"] = license_key
    doc["license_id"] = lic.get("id", "") if lic else ""
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.cloud_trade_thesis_status.update_one(
        {"license_key": license_key, "ticket": req.ticket},
        {"$set": doc}, upsert=True)
    return {"ok": True}

@api_router.post("/cloud/command/request")
async def cloud_command_request(req: CloudCommandReq, user: dict = Depends(get_cloud_user)):
    # Rate-limited per user -- a compromised/malicious Command Center session
    # should not be able to flood the EA's command queue (e.g. FORCE_CLOSE_TRADE
    # spam) or brute-force the license PIN check inside _verify_command_license.
    _rate_limit(f"command_request_user:{user['id']}", max_requests=20, window_seconds=300)
    action = str(req.action or "").upper().strip()
    if action not in SAFE_REMOTE_COMMANDS:
        raise HTTPException(status_code=400, detail="Unsupported Command Center action.")
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required before queueing a remote command.")
    lic = await _verify_command_license(user, req.pin)
    now = datetime.now(timezone.utc)
    command_id = str(uuid.uuid4())
    payload = req.payload or {}
    if action == "UPDATE_PROP_FIRM_CONFIG":
        payload = _normalize_prop_firm_config(payload)
    elif action == "FORCE_OPEN_TRADE":
        payload = _normalize_force_open_payload(payload)
    elif action == "MANUAL_OPEN_NOW":
        payload = _normalize_manual_open_now_payload(payload)
    elif action == "FORCE_CLOSE_TRADE":
        payload = _normalize_force_close_payload(payload)

    # v6.25.6 XAU-027 -- tenant-scoped idempotency. dedupe_key is unique per
    # (user, action, client-supplied key); a client retry of the exact same
    # confirm-click reuses the same idempotency_key and therefore hits the
    # DuplicateKeyError branch below instead of queuing a second command.
    # When the client omits idempotency_key (older build), command_id itself
    # is used so the key is still always unique -- this preserves current
    # behavior (no dedup) for un-updated clients rather than erroring them
    # out, a disclosed limitation rather than a silent one.
    client_key = (req.idempotency_key or "").strip()[:120] or command_id
    dedupe_key = f"{user['id']}:{action}:{client_key}"
    doc = {
        "id": command_id,
        "user_id": user["id"],
        "user_email": user.get("email", ""),
        "license_key": lic.get("pin", ""),
        "mt5_account": lic.get("mt5_account", ""),
        "action": action,
        "label": SAFE_REMOTE_COMMANDS[action],
        "status": "PENDING",
        "requested_at": now.isoformat(),
        "payload": payload,
        "ack_at": "",
        "ack_status": "",
        "ack_message": "",
        "ack_details": {},
        "dedupe_key": dedupe_key,
    }
    try:
        await db.cloud_bot_commands.insert_one(doc.copy())
    except DuplicateKeyError:
        existing = await db.cloud_bot_commands.find_one({"dedupe_key": dedupe_key}, {"_id": 0})
        if existing:
            logger.info("[command-request] dedupe_key=%s DUPLICATE existing_command_id=%s",
                        dedupe_key, existing.get("id"))
            return {"ok": True, "command_id": existing.get("id"), "status": existing.get("status"),
                    "action": existing.get("action"), "duplicate": True}
        # Genuinely impossible under normal operation (the unique index
        # guarantees a matching doc exists), but fail closed rather than
        # silently swallow an inconsistent state.
        raise HTTPException(status_code=409, detail="Duplicate command request could not be reconciled.")

    if action == "UPDATE_PROP_FIRM_CONFIG":
        await db.pin_licenses.update_one(
            {"pin": lic.get("pin", ""), "is_active": True},
            {"$set": {
                "prop_firm_requested": payload,
                "prop_firm_requested_at": now.isoformat(),
                "prop_firm_command_id": command_id,
                "prop_firm_apply_status": "PENDING",
                "prop_firm_apply_message": "Waiting for EA acknowledgement.",
            }},
        )
    await _store_bot_activity("REMOTE_COMMAND_QUEUED", "COMMAND",
                              f"{SAFE_REMOTE_COMMANDS[action]} queued for EA acknowledgement",
                              account=lic.get("mt5_account", ""),
                              details={"command_id": command_id, "action": action, "user": user.get("email", ""), "license_key": lic.get("pin", "")})
    return {"ok": True, "command_id": command_id, "status": "PENDING", "action": action, "duplicate": False}

@api_router.get("/cloud/command/pending")
async def cloud_command_pending(request: Request, limit: int = 5,
                                pin: str = "", license_key: str = "", account: str = ""):
    raw = _normalize_license_key(license_key or pin or "")
    lic = await _resolve_monitor_license(raw, account, request)
    expired = await _expire_stale_pending_commands()
    n = max(1, min(int(limit), 10))
    query = {"status": "PENDING"}
    if lic and lic.get("pin"):
        query["license_key"] = lic["pin"]
    if account:
        query["$or"] = [{"mt5_account": str(account)}, {"account": str(account)}, {"mt5_account": ""}, {"mt5_account": {"$exists": False}}]
    rows = await db.cloud_bot_commands.find(query, {"_id": 0}).sort("requested_at", 1).to_list(n)
    return {"ok": True, "commands": rows, "next": rows[0] if rows else None,
            "count": len(rows), "expired": expired}

@api_router.post("/cloud/command/ack")
async def cloud_command_ack(req: CloudCommandAckReq, request: Request):
    raw = _normalize_license_key(req.license_key or req.pin or "")
    lic = await _resolve_monitor_license(raw, req.account or "", request)
    status = str(req.status or "").upper().strip()
    if status not in {"ACKED", "EXECUTED", "FAILED", "SKIPPED"}:
        raise HTTPException(status_code=400, detail="Invalid command acknowledgement status.")
    now = datetime.now(timezone.utc)
    command = await db.cloud_bot_commands.find_one({"id": req.command_id}, {"_id": 0})
    if not command:
        raise HTTPException(status_code=404, detail="Command not found.")
    if lic and command.get("license_key") and command.get("license_key") != lic.get("pin"):
        raise HTTPException(status_code=403, detail={
            "ok": False,
            "reason": "COMMAND_LICENSE_MISMATCH",
            "message": "This command belongs to a different license.",
            "command_id": req.command_id,
        })

    # v6.25.6 XAU-027 -- atomic conditional transition. The filter requires
    # the command's CURRENT status (at the moment MongoDB applies this exact
    # operation) to be in the allowed-source set for the requested target
    # status; terminal statuses (EXECUTED/FAILED/SKIPPED/EXPIRED) are never
    # in any allowed-source set, so they can never be overwritten -- by a
    # late/replayed ack, a second EA instance racing the first, or an
    # already-expired command's owner finally responding. Two concurrent
    # requests attempting the same transition can both reach this line, but
    # MongoDB applies find_one_and_update atomically per-document: only the
    # first to actually commit sees its filter still match; the loser's
    # filter no longer matches (status already changed) and it correctly
    # falls into the "not applied" branch below instead of double-applying.
    allowed_from = _COMMAND_ALLOWED_SOURCE_STATUSES.get(status, set())
    updated = await db.cloud_bot_commands.find_one_and_update(
        {"id": req.command_id, "status": {"$in": list(allowed_from)}},
        {"$set": {
            "status": status,
            "ack_at": now.isoformat(),
            "ack_status": status,
            "ack_message": str(req.message or "")[:400],
            "ack_details": req.details or {},
        }},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if updated is None:
        # Either the status transition is disallowed from wherever the
        # command currently sits (most commonly: already terminal), or a
        # concurrent request already won this exact transition. Report the
        # real current status honestly rather than pretending this request
        # applied -- the owner's explicit rule: an ack must never silently
        # overwrite a terminal truth.
        current = await db.cloud_bot_commands.find_one({"id": req.command_id}, {"_id": 0})
        current_status = current.get("status") if current else "UNKNOWN"
        reason = "TERMINAL_STATE_IMMUTABLE" if current_status in _COMMAND_TERMINAL_STATUSES else "INVALID_TRANSITION"
        logger.info("[command-ack] command_id=%s requested_status=%s REJECTED reason=%s current_status=%s",
                    req.command_id, status, reason, current_status)
        return {"ok": True, "command_id": req.command_id, "status": current_status,
                "applied": False, "reason": reason}

    if command.get("action") == "UPDATE_PROP_FIRM_CONFIG":
        prop_update = {
            "prop_firm_apply_status": status,
            "prop_firm_apply_message": str(req.message or "")[:400],
            "prop_firm_apply_at": now.isoformat(),
        }
        if status == "EXECUTED":
            prop_update["prop_firm_applied"] = _normalize_prop_firm_config(command.get("payload") or {})
            prop_update["prop_firm_applied_at"] = now.isoformat()
        await db.pin_licenses.update_one(
            {"pin": command.get("license_key", ""), "is_active": True},
            {"$set": prop_update},
        )
    severity = "COMMAND" if status in {"ACKED", "EXECUTED"} else "ERROR"
    label = command.get("label") or command.get("action") or "Remote command"
    await _store_bot_activity("REMOTE_COMMAND_" + status, severity,
                              f"{label}: {req.message or status}",
                              account=command.get("mt5_account", "") or req.account or "",
                              details={"command_id": req.command_id, "action": command.get("action"), "status": status, "license_key": command.get("license_key", "")})
    return {"ok": True, "command_id": req.command_id, "status": status, "applied": True}

@api_router.get("/cloud/command/recent")
async def cloud_command_recent(limit: int = 20, user: dict = Depends(get_cloud_user)):
    n = max(1, min(int(limit), 50))
    rows = await db.cloud_bot_commands.find({"user_id": user["id"]}, {"_id": 0}).sort("requested_at", -1).to_list(n)
    return {"commands": rows, "count": len(rows)}

@api_router.get("/cloud/prop-firm/config")
async def cloud_prop_firm_config(user: dict = Depends(get_cloud_user)):
    lic = await _get_user_license(user)
    defaults = _normalize_prop_firm_config({})
    if not lic:
        return {
            "linked": False,
            "defaults": defaults,
            "requested": defaults,
            "applied": defaults,
            "apply_status": "NOT_LINKED",
            "apply_message": "Link an active license before configuring Prop Firm Mode.",
        }

    license_key = _normalize_license_key(lic.get("pin", ""))
    account = str(lic.get("mt5_account") or "")
    hb_filters = [{"license_key": license_key}, {"pin": license_key}]
    if account:
        hb_filters.append({"account_number": account})
    hb = await db.cloud_bot_heartbeats.find_one(
        {"$or": hb_filters}, {"_id": 0}, sort=[("ts", -1)]
    )
    heartbeat_applied = {}
    heartbeat_fields = {
        "enabled": "prop_firm_mode",
        "daily_loss_pct": "prop_daily_loss_pct",
        "max_loss_pct": "prop_max_loss_pct",
        "safety_buffer_pct": "prop_safety_buffer_pct",
        "risk_per_trade_pct": "prop_risk_per_trade_pct",
        "max_basket_risk_pct": "prop_max_basket_risk_pct",
    }
    for config_key, heartbeat_key in heartbeat_fields.items():
        if hb and heartbeat_key in hb:
            heartbeat_applied[config_key] = hb[heartbeat_key]
    requested = _normalize_prop_firm_config(lic.get("prop_firm_requested") or defaults)
    stored_applied = lic.get("prop_firm_applied") or {}
    applied = _normalize_prop_firm_config({**requested, **stored_applied, **heartbeat_applied})
    return {
        "linked": True,
        "license_key": license_key,
        "defaults": defaults,
        "requested": requested,
        "requested_at": lic.get("prop_firm_requested_at", ""),
        "applied": applied,
        "applied_at": lic.get("prop_firm_applied_at", ""),
        "apply_status": lic.get("prop_firm_apply_status", "NOT_CONFIGURED"),
        "apply_message": lic.get("prop_firm_apply_message", ""),
        "heartbeat_at": (hb or {}).get("ts", ""),
        "ea_version": (hb or {}).get("ea_version", ""),
    }

@api_router.get("/cloud/monitor/status")
async def cloud_monitor_status(user: dict = Depends(get_cloud_user)):
    lic = await _get_user_license(user)
    license_key = _normalize_license_key((lic or {}).get("pin", ""))
    account_filter = str((lic or {}).get("mt5_account") or "").strip()
    hb_filters = []
    if license_key:
        hb_filters.append({"license_key": license_key})
        hb_filters.append({"pin": license_key})
    if account_filter:
        hb_filters.append({"account_number": account_filter})
    hb_query = {"$or": hb_filters} if hb_filters else None
    hb = await db.cloud_bot_heartbeats.find_one(hb_query, {"_id": 0}, sort=[("ts", -1)]) if hb_query else None
    if hb and not account_filter and hb.get("account_number") and license_key:
        account_filter = str(hb.get("account_number") or "")
        await db.pin_licenses.update_one(
            {"pin": license_key, "is_active": True},
            {"$set": {
                "mt5_account": account_filter,
                "ea_version": hb.get("ea_version", ""),
                "broker_server": hb.get("broker_server", ""),
                "last_heartbeat": hb.get("ts", ""),
            }},
        )
    now = datetime.now(timezone.utc)
    hb_time = _dt_or_none((hb or {}).get("ts"))
    age_sec = int((now - hb_time).total_seconds()) if hb_time else None
    offline = age_sec is None or age_sec > 90
    status_label = "BOT OFFLINE / NO HEARTBEAT" if offline else (hb or {}).get("bot_state", "ONLINE")
    hb_last_error = str((hb or {}).get("last_error") or "").strip()
    noisy_stale_error = hb_last_error.upper() in {"MQL ERROR 5035"}
    alerts = []
    if offline:
        msg = "BOT OFFLINE / NO HEARTBEAT"
        if lic and not hb:
            msg = "License linked, but no EA heartbeat has reached this server yet. Check InpLicensePIN, InpCloudURL, MT5 WebRequest allowed URL, and that the new EA version is attached."
        alerts.append({"severity": "CRITICAL", "type": "BOT_OFFLINE_NO_HEARTBEAT", "message": msg})
    if hb:
        if hb.get("algo_trading") is False:
            alerts.append({"severity": "CRITICAL", "type": "ALGO_DISABLED", "message": "Algo Trading disabled"})
        if hb.get("mt5_connected") is False:
            alerts.append({"severity": "CRITICAL", "type": "MT5_DISCONNECTED", "message": "MT5 disconnected"})
        if hb.get("trading_allowed") is False:
            alerts.append({"severity": "ERROR", "type": "TRADING_DISABLED", "message": "Trading not allowed"})
        if hb_last_error and not noisy_stale_error:
            alerts.append({"severity": "ERROR", "type": "LAST_ERROR", "message": hb_last_error})
    setup_checks = [
        {
            "key": "license",
            "label": "License linked",
            "ok": bool(lic and (lic or {}).get("is_active")),
            "detail": (lic or {}).get("pin", "") if lic else "Add your ASE activation key.",
        },
        {
            "key": "heartbeat",
            "label": "EA heartbeat",
            "ok": bool(hb and not offline),
            "detail": f"{age_sec}s ago" if age_sec is not None else "No heartbeat received yet.",
        },
        {
            "key": "mt5_account",
            "label": "MT5 account bound",
            "ok": bool((lic or {}).get("mt5_account") or (hb or {}).get("account_number")),
            "detail": str((lic or {}).get("mt5_account") or (hb or {}).get("account_number") or "Waiting for EA."),
        },
        {
            "key": "ea_version",
            "label": "EA version reporting",
            "ok": bool((hb or {}).get("ea_version") or (lic or {}).get("ea_version")),
            "detail": (hb or {}).get("ea_version") or (lic or {}).get("ea_version") or "Attach latest EA.",
        },
        {
            "key": "algo",
            "label": "Algo trading allowed",
            "ok": bool(hb and hb.get("algo_trading") is not False and hb.get("trading_allowed") is not False),
            "detail": "Allowed" if hb and hb.get("algo_trading") is not False and hb.get("trading_allowed") is not False else "Enable Algo Trading and allow live trading.",
        },
    ]
    activity_scope = {}
    if account_filter:
        activity_scope = {"account": account_filter}
    elif license_key:
        activity_scope = {"license_key": license_key}
    elif hb and hb.get("account_number"):
        activity_scope = {"account": str(hb.get("account_number"))}
    last_signal = await db.cloud_bot_activity.find_one(
        {**activity_scope, "event_type": {"$regex": "SIGNAL|FIRE|SETUP|FIRST_SIGNAL"}},
        {"_id": 0}, sort=[("ts", -1)]) if activity_scope else None
    last_trade = await db.cloud_bot_activity.find_one(
        {**activity_scope, "severity": {"$in": ["TRADE", "EXIT"]}},
        {"_id": 0}, sort=[("ts", -1)]) if activity_scope else None
    last_block = await db.cloud_bot_activity.find_one(
        {**activity_scope, "$or": [{"severity": "BLOCK"}, {"event_type": {"$regex": "BLOCK|VETO"}}]},
        {"_id": 0}, sort=[("ts", -1)]) if activity_scope else None
    last_error = await db.cloud_bot_activity.find_one(
        {**activity_scope, "severity": {"$in": ["ERROR", "CRITICAL"]}}, {"_id": 0}, sort=[("ts", -1)]) if activity_scope else None
    release_display = build_public_release_display((hb or {}).get("ea_version", ""))
    production_status = reconcile_production_timeframe(
        (hb or {}).get("timeframe", ""), release_display["reported_build_recognized"],
    )
    return {
        "status": status_label,
        "offline": offline,
        "heartbeat_age_sec": age_sec,
        "heartbeat": hb or {},
        # Customer-facing identity -- always use these, never heartbeat.ea_version
        # /heartbeat.timeframe directly, which are raw unvalidated EA telemetry.
        "release": release_display,
        "production_status": production_status,
        "license": {
            "linked": bool(lic),
            "activation_key": (lic or {}).get("pin", ""),
            "status": "active" if (lic or {}).get("is_active") else ("not_linked" if not lic else "inactive"),
            "mt5_account": (lic or {}).get("mt5_account", ""),
            "expiry": (lic or {}).get("expires_at") or (lic or {}).get("subscription_ends_at") or "",
        },
        "alerts": alerts,
        "setup_checks": setup_checks,
        "open_trades": (hb or {}).get("open_positions", 0) if not offline else 0,
        "last_trade": last_trade,
        "last_blocked_trade": last_block,
        "last_signal": last_signal,
        "last_error": last_error,
        "intelligence_sync_state": (hb or {}).get("sync_state") or "",
        "equity_protection_state": (hb or {}).get("epf_state") or "",
    }

@api_router.get("/cloud/monitor/activity")
async def cloud_monitor_activity_feed(kind: str = "all", limit: int = 80, search: str = "",
                                      user: dict = Depends(get_cloud_user)):
    n = max(1, min(int(limit), 200))
    k = (kind or "all").lower()
    lic = await _get_user_license(user)
    license_key = _normalize_license_key((lic or {}).get("pin", ""))
    account_filter = str((lic or {}).get("mt5_account") or "").strip()
    if not account_filter and not license_key:
        return {"events": [], "count": 0, "kind": k, "reason": "license_not_linked"}
    query = {}
    if k in {"entries", "trades", "entry"}:
        query = {"$or": [{"event_category": "entries"}, {"severity": {"$in": ["ENTRY", "TRADE"]}}, {"event_type": {"$regex": "TRADE_EXECUTED|FIRE|PYR|ENTRY"}}]}
    elif k == "blocks":
        query = {"$or": [{"event_category": "blocks"}, {"severity": "BLOCK"}, {"event_type": {"$regex": "BLOCK|VETO"}}]}
    elif k == "errors":
        query = {"$or": [{"event_category": "errors"}, {"severity": {"$in": ["ERROR", "CRITICAL"]}}]}
    elif k == "sync":
        query = {"$or": [{"severity": "SYNC"}, {"event_type": {"$regex": "SYNC"}}]}
    elif k in {"exit", "exits"}:
        query = {"$or": [{"event_category": "exits"}, {"severity": "EXIT"}, {"event_type": {"$regex": "EXIT|CLOSE"}}]}
    elif k == "shadow":
        query = {"event_type": {"$regex": "SHADOW|BLOCK_CHECK"}}
    elif k == "risk":
        query = {"$or": [{"event_category": "risk"}, {"event_type": {"$regex": "EPF|DRAWDOWN|RISK|LOCK|LOT|MARGIN"}}]}
    elif k == "ai":
        query = {"$or": [{"event_category": "ai"}, {"event_type": {"$regex": "AI|DIRECTOR|ML|BRAIN|CONFIDENCE"}}, {"message": {"$regex": "AI|DIRECTOR|ML|BRAIN|CONFIDENCE", "$options": "i"}}]}
    elif k == "overrides":
        query = {"$or": [{"event_category": "overrides"}, {"severity": "OVERRIDE"}, {"event_type": {"$regex": "OVERRIDE|LOSS_CLOSE_BLOCKED|IGNORED"}}]}
    scope = {"$or": [{"account": account_filter}, {"license_key": license_key}]} if account_filter and license_key else ({"account": account_filter} if account_filter else {"license_key": license_key})
    query = {"$and": [scope, query]} if query else scope
    q = str(search or "").strip()
    if q:
        safe = re.escape(q[:80])
        search_query = {"$or": [
            {"event_type": {"$regex": safe, "$options": "i"}},
            {"severity": {"$regex": safe, "$options": "i"}},
            {"event_category": {"$regex": safe, "$options": "i"}},
            {"message": {"$regex": safe, "$options": "i"}},
            {"symbol": {"$regex": safe, "$options": "i"}},
            {"module": {"$regex": safe, "$options": "i"}},
            {"decision": {"$regex": safe, "$options": "i"}},
            {"reason": {"$regex": safe, "$options": "i"}},
            {"blocked_by": {"$regex": safe, "$options": "i"}},
            {"ticket": {"$regex": safe, "$options": "i"}},
            {"ts": {"$regex": safe, "$options": "i"}},
            {"details.ticket": {"$regex": safe, "$options": "i"}},
            {"details.reason": {"$regex": safe, "$options": "i"}},
            {"details.module": {"$regex": safe, "$options": "i"}},
        ]}
        query = {"$and": [query, search_query]}
    rows = await db.cloud_bot_activity.find(query, {"_id": 0}).sort("ts", -1).to_list(n)
    return {"events": rows, "count": len(rows), "kind": k}

# v6.9.0 — BOT_STATUS_HEARTBEAT posts every 60s unconditionally (the
# staleness-fix heartbeat); it belongs in the dedicated Current Bot Decision
# panel (/cloud/monitor/bot-status), not spamming the conversational feed
# with a near-identical "still scanning" card every minute.
_DECISION_FEED_EXCLUDED_EVENT_TYPES = ["BOT_STATUS_HEARTBEAT"]


def _ai_group_repeated_cards(cards: list) -> list:
    """Collapse consecutive cards with the same headline/decision/reason
    into one card with a `repeated_at` timestamp list, so 10 identical
    "waiting for higher quality setup" cards become one card that says
    when it was last repeated — per the 'less noise' requirement. Cards
    are expected newest-first; grouping only merges ADJACENT duplicates
    (a genuinely new decision in between breaks the group)."""
    grouped: list = []
    for card in cards:
        key = (card.get("type"), card.get("headline"), card.get("decision_text"))
        if grouped:
            prev = grouped[-1]
            prev_key = (prev.get("type"), prev.get("headline"), prev.get("decision_text"))
            if key == prev_key:
                prev.setdefault("repeated_at", []).append(card.get("ts"))
                prev["repeat_count"] = prev.get("repeat_count", 1) + 1
                continue
        card["repeated_at"] = []
        card["repeat_count"] = 1
        grouped.append(card)
    return grouped


@api_router.get("/cloud/monitor/decision-feed")
async def cloud_monitor_decision_feed(limit: int = 60, ticket: str = "",
                                      user: dict = Depends(get_cloud_user)):
    """The Trading-page conversational AI feed. Returns the same underlying
    events as /cloud/monitor/activity, translated into plain-English
    'thought cards' plus a short timeline — no raw engine variables in the
    default payload (those still ride along under each card's `advanced`
    key for the Developer Details view). Consecutive identical decisions are
    grouped into one card (repeat_count/repeated_at fields — the UI decides
    how to word it); the periodic status heartbeat lives in its own
    /cloud/monitor/bot-status endpoint instead of spamming this feed."""
    n = max(1, min(int(limit), 20))
    empty_message = "No fresh AI decision yet. Waiting for the next completed M10 evaluation."
    fresh_cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    lic = await _get_user_license(user)
    license_key = _normalize_license_key((lic or {}).get("pin", ""))
    account_filter = str((lic or {}).get("mt5_account") or "").strip()
    if not account_filter and not license_key:
        return {"cards": [], "timeline": [], "reason": "license_not_linked", "empty_message": empty_message}
    scope = {"$or": [{"account": account_filter}, {"license_key": license_key}]} if account_filter and license_key \
        else ({"account": account_filter} if account_filter else {"license_key": license_key})
    freshness = {"ts": {"$gte": fresh_cutoff_iso}}
    query = {"$and": [scope, {"event_type": {"$nin": _DECISION_FEED_EXCLUDED_EVENT_TYPES}}, freshness]}
    t = str(ticket or "").strip()
    if t:
        query = {"$and": [scope, {"ticket": t}, {"event_type": {"$nin": _DECISION_FEED_EXCLUDED_EVENT_TYPES}}, freshness]}
    rows = await db.cloud_bot_activity.find(query, {"_id": 0}).sort("ts", 1).to_list(n * 3)
    rows = rows[-n:]
    prev_conf_by_ticket: dict = {}
    cards = [_ai_build_thought_card(ev, prev_conf_by_ticket) for ev in rows]
    cards = list(reversed(cards))
    cards = _ai_group_repeated_cards(cards)
    timeline = [{"ts": c["ts"], "label": c["decision_text"] or c["headline"], "tone": c["tone"]} for c in cards]
    return {
        "cards": cards,
        "timeline": timeline,
        "count": len(cards),
        "fresh_since": fresh_cutoff_iso,
        "max_age_hours": 24,
        "source_priority": [
            "latest EA heartbeat/live decision JSON",
            "latest M10 decision cycle",
            "latest open trade thinking",
            "recent decision history fallback",
        ],
        "empty_message": empty_message,
    }


@api_router.get("/cloud/monitor/bot-status")
async def cloud_monitor_bot_status(user: dict = Depends(get_cloud_user)):
    """The 'Current Bot Decision' panel: the latest BOT_STATUS_HEARTBEAT,
    posted every 60s unconditionally (regardless of any gate that might
    otherwise suppress the EA's other cloud posts for extended periods —
    see v6.9.0's OnTick() heartbeat). Category is one of SCANNING/WAITING/
    BLOCKED/MANAGING_TRADE/PROTECTING_PROFIT/HOLDING/PREPARING_EXIT;
    ENTERING/EXITING are momentary and come from the trade-event cards
    themselves rather than this periodic snapshot."""
    lic = await _get_user_license(user)
    license_key = _normalize_license_key((lic or {}).get("pin", ""))
    account_filter = str((lic or {}).get("mt5_account") or "").strip()
    if not account_filter and not license_key:
        return {"available": False, "reason": "license_not_linked"}
    scope = {"$or": [{"account": account_filter}, {"license_key": license_key}]} if account_filter and license_key \
        else ({"account": account_filter} if account_filter else {"license_key": license_key})
    query = {"$and": [scope, {"event_type": "BOT_STATUS_HEARTBEAT"}]}
    latest = await db.cloud_bot_activity.find_one(query, {"_id": 0}, sort=[("ts", -1)])
    if not latest:
        return {"available": False, "reason": "no_heartbeat_yet"}
    category = str(latest.get("blocked_by") or latest.get("mode") or "SCANNING").upper()
    age_sec = None
    ts = _dt_or_none(latest.get("ts"))
    if ts:
        age_sec = int((datetime.now(timezone.utc) - ts).total_seconds())
    return {
        "available": True,
        "category": category,
        "status_text": latest.get("decision") or latest.get("message"),
        "reason": latest.get("reason"),
        "ts": latest.get("ts"),
        "age_sec": age_sec,
        "stale": age_sec is not None and age_sec > 360,  # heartbeat is every 60s; >6min means something's actually wrong
    }

@api_router.get("/cloud/monitor/current-opinion")
async def cloud_monitor_current_opinion(ticket: str = "", user: dict = Depends(get_cloud_user)):
    """The Current Trade panel: the AI's live read on whatever position is
    open right now (or a specific ticket), including the heuristic
    'would I enter this again' verdict. All probability figures here are
    confidence-derived estimates, not literal ML model outputs."""
    lic = await _get_user_license(user)
    license_key = _normalize_license_key((lic or {}).get("pin", ""))
    account_filter = str((lic or {}).get("mt5_account") or "").strip()
    if not account_filter and not license_key:
        return {"open": False, "reason": "license_not_linked"}
    scope = {"$or": [{"account": account_filter}, {"license_key": license_key}]} if account_filter and license_key \
        else ({"account": account_filter} if account_filter else {"license_key": license_key})
    t = str(ticket or "").strip()
    fresh_cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    thesis_scope = scope
    thesis_filters = [thesis_scope, {"updated_at": {"$gte": fresh_cutoff_iso}}]
    if t:
        thesis_filters.append({"ticket": t})
    thesis = await db.cloud_trade_thesis_status.find_one(
        {"$and": thesis_filters}, {"_id": 0}, sort=[("updated_at", -1)])

    active_ticket = str((thesis or {}).get("ticket") or t or "")
    if active_ticket:
        activity_query = {"$and": [scope, {"ticket": active_ticket}]}
    else:
        activity_query = {"$and": [scope, {"ticket": {"$ne": ""}}, {"ts": {"$gte": fresh_cutoff_iso}}]}
    rows = await db.cloud_bot_activity.find(activity_query, {"_id": 0}).sort("ts", 1).to_list(400)

    if not thesis and not rows:
        hb_filters = []
        if license_key:
            hb_filters.append({"license_key": license_key})
            hb_filters.append({"pin": license_key})
        if account_filter:
            hb_filters.append({"account_number": account_filter})
        hb = await db.cloud_bot_heartbeats.find_one(
            {"$or": hb_filters}, {"_id": 0}, sort=[("ts", -1)]) if hb_filters else None
        if int((hb or {}).get("open_positions") or 0) > 0:
            return {
                "open": True,
                "source": "heartbeat_pending",
                "reason": "open_trade_thesis_pending",
                "message": "Open trade detected. Waiting for EA trade thesis status.",
                "current_bot_decision": "WAIT",
                "thesis_health": "WARNING",
                "what_would_close": "Waiting for the EA to send the live thesis snapshot.",
            }
        return {"open": False, "reason": "no_open_trade"}

    if not thesis:
        by_ticket: dict = {}
        for r in rows:
            by_ticket.setdefault(str(r.get("ticket") or ""), []).append(r)
        active_ticket = t
        if not active_ticket:
            for candidate, candidate_rows in reversed(list(by_ticket.items())):
                if candidate and _ai_classify_card_type(candidate_rows[-1]) != "TRADE_CLOSED":
                    active_ticket = candidate
                    break
        ticket_rows = by_ticket.get(active_ticket, [])
        if not ticket_rows or any(_ai_classify_card_type(r) == "TRADE_CLOSED" for r in ticket_rows[-1:]):
            return {"open": False, "reason": "trade_already_closed"}
    else:
        ticket_rows = rows

    prev_conf_by_ticket: dict = {}
    cards = [_ai_build_thought_card(ev, prev_conf_by_ticket) for ev in ticket_rows]
    latest = cards[-1] if cards else {}
    entry_card = next((c for c in cards if c.get("type") == "TRADE_EXECUTED"), cards[0] if cards else {})

    thesis_conf = (thesis or {}).get("ai_confidence")
    conf = thesis_conf if thesis_conf is not None else latest.get("confidence")
    hold_probability = (thesis or {}).get("hold_probability")
    if hold_probability is None:
        hold_probability = conf if conf is not None else None
    exit_probability = (thesis or {}).get("exit_probability")
    if exit_probability is None:
        exit_probability = (100 - conf) if conf is not None else None
    reversal_probability = max(0, 100 - conf - 20) if conf is not None else None
    verdict = _ai_would_enter_again(latest) if latest else {"answer": "WAIT", "reason": "Waiting for live confidence reading."}

    direction = str((thesis or {}).get("direction") or ("BUY" if (thesis or {}).get("is_buy") is True else "SELL" if (thesis or {}).get("is_buy") is False else "")).upper()
    entry_reason = (thesis or {}).get("entry_reason") or ". ".join(entry_card.get("reason_bullets") or []) or entry_card.get("decision_text")
    current_bot_decision = (thesis or {}).get("next_action") or latest.get("decision_text") or "WAIT"
    what_would_close = (thesis or {}).get("exit_reason") or "Broker SL/TP, manual close, emergency margin protection, or confirmed thesis invalidation."
    current_reason = (thesis or {}).get("hold_reason") or (thesis or {}).get("protect_reason") or latest.get("decision_text") or "Waiting for the next M10 decision cycle."

    return {
        "open": True,
        "source": "thesis_status" if thesis else "activity_fallback",
        "ticket": active_ticket,
        "symbol": (thesis or {}).get("symbol") or latest.get("advanced", {}).get("symbol"),
        "direction": direction,
        "lot_size": (thesis or {}).get("lots"),
        "entry_price": (thesis or {}).get("open_price"),
        "current_price": (thesis or {}).get("current_price"),
        "sl": (thesis or {}).get("sl"),
        "tp": (thesis or {}).get("tp"),
        "floating_pl": (thesis or {}).get("current_profit"),
        "peak_profit": (thesis or {}).get("peak_profit"),
        "protected_profit": (thesis or {}).get("protected_profit"),
        "distance_to_sl": (thesis or {}).get("dist_to_sl"),
        "distance_to_tp": (thesis or {}).get("dist_to_tp"),
        "trade_age_minutes": (thesis or {}).get("trade_age_minutes"),
        "entry_reason": entry_reason,
        "setup_type": (thesis or {}).get("setup_type") or (thesis or {}).get("expected_type"),
        "grade": (thesis or {}).get("grade"),
        "ai_confidence": conf,
        "current_bias": latest.get("bias") or direction,
        "confidence": conf,
        "current_risk": latest.get("advanced", {}).get("regime"),
        "hold_probability": hold_probability,
        "exit_probability": exit_probability,
        "reversal_probability": reversal_probability,
        "thesis_health": str((thesis or {}).get("state") or "WARNING").upper(),
        "current_bot_decision": current_bot_decision,
        "current_reason": current_reason,
        "what_would_close": what_would_close,
        "what_would_keep_holding": (thesis or {}).get("hold_reason") or "Trend thesis remains valid with acceptable risk.",
        "would_enter_again": verdict["answer"],
        "would_enter_again_reason": verdict["reason"],
        "latest_card": latest,
        "hold_reason": (thesis or {}).get("hold_reason"),
        "protect_reason": (thesis or {}).get("protect_reason"),
        "exit_trigger_reason": what_would_close,
        "next_action": (thesis or {}).get("next_action"),
        "recovery_mode": (thesis or {}).get("recovery_mode", "NONE"),
        "recovery_worst_pct": (thesis or {}).get("recovery_worst_pct"),
        "recovery_classification": (thesis or {}).get("recovery_classification"),
        "updated_at": (thesis or {}).get("updated_at"),
    }

# v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired /cloud/me/reasoning
# (copy-trading master EA feed reader). See backend/migrations/0001_delete_copy_trading.py.

AGENT_TOKEN = os.environ.get("CLOUD_AGENT_TOKEN", "")  # kept for backward compat

# v6.25.3 owner directive 2026-07-17 (Phase 5 P0) -- retired the entire
# worker-agent (VPS executor) endpoint block: pending-users/pending-signals
# (decrypted MT5 credential handout), verify-queue/verify-credentials,
# signal-status reconciler, force-close queue/ack, account-status,
# refresh-queue, trade-close/trade-partial/trade-open reporting,
# fanout-logs, diagnostics, equity-snapshot, orphan detector, and worker
# heartbeat. This backend no longer executes trades on any account other
# than through the licensed local EA the customer runs themselves. See
# backend/migrations/0001_delete_copy_trading.py for the data-side
# backup+deletion this code used to serve.

# ===================================================================
# END XauAi CLOUD
# ===================================================================

# ===================================================================
# AI MARKET OUTLOOK — advisory-only, strictly separate from live trading.
# Wired here (not at top-of-file) so market_outlook_routes.build_router()
# can bind to this module's own get_cloud_user/db/LLM_KEY/etc. without any
# circular import — by this point in the file every symbol it needs
# already exists.
# ===================================================================
import market_outlook_routes as _mo_routes
api_router.include_router(_mo_routes.build_router())

# Customer EAs use this authenticated HTTPS relay.  The owner VPS claims
# jobs outbound-only and keeps llama.cpp plus its gateway on loopback.
from local_ai import remote_relay as _local_ai_remote
api_router.include_router(_local_ai_remote.build_router(
    db=db,
    resolve_license=_resolve_monitor_license,
    rate_limit=_rate_limit,
    client_ip=_client_ip,
))

app.include_router(api_router)

# Root-level health check for load balancers and Cloud Run (hits /health, not /api/health)
@app.get("/health")
async def root_health():
    return {"status": "ok"}

# v6.5.0 (audit bug #9): allow_credentials=True with a wildcard '*' origin
# (the default when CORS_ORIGINS is unset) is a browser-rejected but still
# risky combination to declare server-side. Only allow credentialed CORS
# once specific origins are actually configured.
_cors_origins = os.environ.get('CORS_ORIGINS', '*').split(',')
app.add_middleware(CORSMiddleware, allow_credentials=(_cors_origins != ['*']),
                   allow_origins=_cors_origins, allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
