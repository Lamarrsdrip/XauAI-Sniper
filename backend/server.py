from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, io, zipfile, random, string, time, uuid, secrets, smtplib, bcrypt, jwt, httpx, asyncio, re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict
from datetime import datetime, timezone, timedelta
try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
except ImportError:
    LlmChat = None
    UserMessage = None

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

JWT_SECRET = os.environ.get('JWT_SECRET', secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
PAYSTACK_BASE_URL = "https://api.paystack.co"
LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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
    weekly_drawdown_limit: float = 10.0
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
    weekly_drawdown_limit: Optional[float] = 10.0
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

class AdminAccountUpdate(BaseModel):
    new_email: Optional[str] = None
    new_password: Optional[str] = None
    current_password: str

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
    if price is None:
        if _gold_cache and _gold_cache.get('bid'): return _gold_cache
        price, change, change_pct = 4957.0, 0.0, 0.0
    if change is None: change = 0.0
    if change_pct is None: change_pct = round(change/price*100, 3) if price else 0.0
    sp = round(secrets.randbelow(500) / 1000 + 0.3, 2)
    result = {"symbol":"XAUUSD","bid":round(price,2),"ask":round(price+sp,2),"spread":sp,"change":round(change,2),"change_pct":round(change_pct,3),"timestamp":datetime.now(timezone.utc).isoformat(),"source":"live"}
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

async def send_pin_email(to_email: str, buyer_name: str, pin: str):
    settings = await get_settings()
    smtp_email = settings.get("smtp_email", "")
    smtp_password = settings.get("smtp_password", "")
    if not smtp_email or not smtp_password:
        logger.info(f"Email not configured. PIN {pin} for {to_email} not sent.")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Your XauAI Sniper EA License PIN"
        msg["From"] = smtp_email
        msg["To"] = to_email
        html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#B8860B;">XauAI Sniper EA - License PIN</h2>
<p>Hello {buyer_name or 'Trader'},</p>
<p>Thank you for your purchase! Here is your unique license PIN:</p>
<div style="background:#f5f5f5;border:2px solid #B8860B;padding:20px;text-align:center;margin:20px 0;">
<span style="font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:3px;">{pin}</span>
</div>
<p><strong>How to use:</strong></p>
<ol><li>Download the EA from our website</li><li>Install on MetaTrader 5 (follow our Setup Guide)</li><li>Enter this PIN in the EA settings</li><li>Enable Auto Trading and start!</li></ol>
<p style="color:#888;font-size:12px;">Keep this PIN private. Each PIN works on one MT5 account.</p>
</div>"""
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(smtp_email, smtp_password)
            server.sendmail(smtp_email, to_email, msg.as_string())
        logger.info(f"PIN email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False

# -------------------------------------------------------------------
# PUBLIC ROUTES
# -------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "XauAI Sniper EA API v2.0"}

@api_router.get("/health")
async def health():
    return {"status": "ok"}

@api_router.get("/gold/price")
async def get_gold_price():
    return await fetch_live_gold_price()

# --- Auth ---
@api_router.post("/auth/login")
async def login(req: LoginRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(str(user["_id"]), user["email"])
    response = JSONResponse(content={"email": user["email"], "name": user.get("name","Admin"), "role": user.get("role","admin"), "token": token})
    response.set_cookie(key="access_token", value=token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    return response

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
    pin_doc = await db.pin_licenses.find_one({"pin": req.pin}, {"_id": 0})
    if not pin_doc: return {"valid": False, "reason": "PIN not found"}
    if not pin_doc.get("is_active"): return {"valid": False, "reason": "PIN revoked"}
    if not pin_doc.get("is_used"):
        await db.pin_licenses.update_one({"pin": req.pin}, {"$set": {"is_used": True, "activated_at": datetime.now(timezone.utc).isoformat(), "mt5_account": req.mt5_account or ""}})
    return {"valid": True, "pin": req.pin, "message": "License verified"}

# --- Purchase (public) ---
@api_router.get("/purchase/price")
async def get_pin_price():
    s = await get_settings()
    kobo = s.get("pin_price_kobo", 30000000)
    naira = kobo / 100
    return {"price_kobo": kobo, "price_naira": naira, "currency": "NGN", "payment_method": "paystack", "formatted": f"\u20a6{naira:,.0f}"}

@api_router.post("/purchase/initialize")
async def initialize_purchase(req: PurchaseInitRequest):
    s = await get_settings()
    pk = s.get("paystack_secret_key", "")
    if not pk: raise HTTPException(status_code=503, detail="Payment system not configured yet.")
    kobo = s.get("pin_price_kobo", 30000000)
    ref = f"ASE-{uuid.uuid4().hex[:12].upper()}"
    callback_url = f"{req.origin_url}/purchase/success?reference={ref}"
    tx = {"id": str(uuid.uuid4()), "reference": ref, "amount_kobo": kobo, "currency": "NGN", "buyer_name": req.buyer_name, "buyer_email": req.buyer_email, "payment_status": "pending", "pin_generated": None, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.payment_transactions.insert_one(tx)
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.post(f"{PAYSTACK_BASE_URL}/transaction/initialize", headers={"Authorization": f"Bearer {pk}", "Content-Type": "application/json"}, json={"email": req.buyer_email, "amount": kobo, "reference": ref, "callback_url": callback_url, "metadata": {"buyer_name": req.buyer_name}, "currency": "NGN"})
    if resp.status_code != 200: raise HTTPException(status_code=502, detail="Payment init failed")
    data = resp.json()
    if not data.get("status"): raise HTTPException(status_code=502, detail=data.get("message", "Failed"))
    return {"authorization_url": data["data"]["authorization_url"], "reference": ref}

@api_router.get("/purchase/verify/{reference}")
async def verify_purchase(reference: str):
    tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
    if not tx: raise HTTPException(status_code=404, detail="Not found")
    if tx.get("pin_generated") and tx.get("payment_status") == "success":
        return {"status": "success", "payment_status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}
    s = await get_settings()
    pk = s.get("paystack_secret_key", "")
    if pk:
        try:
            async with httpx.AsyncClient(timeout=15.0) as http:
                resp = await http.get(f"{PAYSTACK_BASE_URL}/transaction/verify/{reference}", headers={"Authorization": f"Bearer {pk}"})
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") and data["data"].get("status") == "success" and not tx.get("pin_generated"):
                    pin = generate_unique_pin()
                    while await db.pin_licenses.find_one({"pin": pin}): pin = generate_unique_pin()
                    doc = PinLicense(pin=pin, buyer_name=tx.get("buyer_name",""), buyer_email=tx.get("buyer_email",""), notes=f"Paystack - {reference}", payment_ref=reference).model_dump()
                    await db.pin_licenses.insert_one(doc)
                    await db.payment_transactions.update_one({"reference": reference}, {"$set": {"pin_generated": pin, "payment_status": "success"}})
                    await send_pin_email(tx.get("buyer_email",""), tx.get("buyer_name",""), pin)
                    return {"status": "success", "payment_status": "success", "pin": pin, "buyer_name": tx.get("buyer_name","")}
                if data.get("status") and data["data"].get("status") == "success" and tx.get("pin_generated"):
                    return {"status": "success", "payment_status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name","")}
        except Exception as e: logger.error(f"Verify err: {e}")
    return {"status": "pending", "payment_status": "pending", "pin": None}

@api_router.post("/webhook/paystack")
async def paystack_webhook(request: Request):
    body = await request.json()
    if body.get("event") == "charge.success":
        ref = body.get("data",{}).get("reference","")
        tx = await db.payment_transactions.find_one({"reference": ref}, {"_id": 0})
        if tx and not tx.get("pin_generated"):
            pin = generate_unique_pin()
            doc = PinLicense(pin=pin, buyer_name=tx.get("buyer_name",""), buyer_email=tx.get("buyer_email",""), notes=f"Webhook - {ref}", payment_ref=ref).model_dump()
            await db.pin_licenses.insert_one(doc)
            await db.payment_transactions.update_one({"reference": ref}, {"$set": {"pin_generated": pin, "payment_status": "success"}})
            await send_pin_email(tx.get("buyer_email",""), tx.get("buyer_name",""), pin)
    return {"status": "ok"}

# --- Public Docs ---
def _sanitize_ea_for_customer(src: str) -> str:
    """Strip master-only secrets from the EA source so a customer can use it
    on their own MT5 WITHOUT accidentally posting their trades into our cloud.
    Disables CloudFanout by default and clears the agent token. Customers can
    still re-enable everything if they have their own cloud setup."""
    import re
    out = src
    # Flip cloud fanout default OFF
    out = re.sub(
        r'(input\s+bool\s+InpCloudFanout\s*=\s*)true(\s*;)',
        r'\1false\2',
        out, count=1)
    # Clear the agent token default (don't ship our secret)
    out = re.sub(
        r'(input\s+string\s+InpCloudAgentToken\s*=\s*)"[^"]*"(\s*;)',
        r'\1""\2',
        out, count=1)
    # Add a clear customer banner at the top so it's obvious what version they have
    banner = ("// =====================================================================\n"
              "// CUSTOMER EDITION — cloud master uplink DISABLED.\n"
              "// This EA runs standalone on your MT5 and trades on YOUR account only.\n"
              "// It does NOT mirror trades to or from the XauAi Cloud master.\n"
              "// =====================================================================\n")
    return banner + out

@api_router.get("/download/ea")
async def download_ea():
    """PUBLIC customer download — sanitized (no master token, fanout OFF)."""
    p = ROOT_DIR / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
    if not p.exists(): raise HTTPException(status_code=404)
    src = p.read_text(encoding="utf-8", errors="ignore")
    sanitized = _sanitize_ea_for_customer(src)
    return Response(
        content=sanitized,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="XAUUSD_AI_Sniper_EA_v5.8.47_COMMAND_CENTER_PIN_AUTH.mq5"'},
    )

# Admin-only: serves the FULL master EA with your agent token + cloud fanout
# baked in. NEVER expose this URL publicly.
@api_router.get("/admin/download/ea-master", dependencies=[Depends(get_current_admin)])
async def admin_download_ea_master():
    p = ROOT_DIR / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
    if not p.exists(): raise HTTPException(status_code=404)
    return FileResponse(
        path=str(p),
        filename="XAUUSD_AI_Sniper_EA_MASTER_v5.8.47_COMMAND_CENTER_PIN_AUTH.mq5",
        media_type="application/octet-stream",
    )

@api_router.get("/download/package")
async def download_package():
    """PUBLIC customer package — uses sanitized EA."""
    d = ROOT_DIR / "ea_code"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in d.rglob("*"):
            if not f.is_file(): continue
            rel = f.relative_to(d)
            # Sanitize the EA inside the zip too.
            if f.name == "XAUUSD_AI_Sniper_EA.mq5":
                z.writestr(str(rel), _sanitize_ea_for_customer(
                    f.read_text(encoding="utf-8", errors="ignore")))
            else:
                z.write(f, rel)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=AI_Sniper_EA_Package.zip"})

@api_router.get("/performance/summary")
async def get_performance_summary():
    try:
        trades = await db.trade_journal.find({}, {"_id": 0}).sort("created_ts", 1).to_list(length=5000)
    except Exception as e:
        logger.error(f"Performance summary error: {e}")
        trades = []

    closed = [t for t in trades if str(t.get("result", "")).upper() in {"WIN", "LOSS", "BE"}]
    total = len(closed)
    wins = sum(1 for t in closed if str(t.get("result", "")).upper() == "WIN")
    losses = sum(1 for t in closed if str(t.get("result", "")).upper() == "LOSS")
    profits = [float(t.get("profit") or 0) for t in closed]
    gross_profit = sum(p for p in profits if p > 0)
    gross_loss = abs(sum(p for p in profits if p < 0))
    net_profit = sum(profits)
    winning_profits = [p for p in profits if p > 0]
    losing_profits = [p for p in profits if p < 0]
    avg_win = sum(winning_profits) / len(winning_profits) if winning_profits else 0
    avg_loss = sum(losing_profits) / len(losing_profits) if losing_profits else 0
    largest_win = max(winning_profits) if winning_profits else 0
    largest_loss = min(losing_profits) if losing_profits else 0

    summary = {
        "source": "live_journal",
        "sample": False,
        "total_trades": total,
        "win_rate": round(wins / total * 100, 1) if total else 0,
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else (round(gross_profit, 2) if gross_profit > 0 else 0),
        "net_profit": round(net_profit, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "largest_win": round(largest_win, 2),
        "largest_loss": round(largest_loss, 2),
        "loss_to_avg_win": round(abs(avg_loss) / avg_win, 2) if avg_win > 0 and avg_loss < 0 else 0,
        "max_drawdown": 0,
        "avg_rr_ratio": 0,
        "weekly_return_avg": 0,
        "sharpe_ratio": 0,
        "best_week": 0,
        "worst_week": 0,
        "avg_trade_duration": "n/a",
        "longest_winning_streak": 0,
        "longest_losing_streak": 0,
        "monthly_returns": [],
        "strategy_breakdown": [],
        "weekly_data": [],
        "equity_curve": [],
        "ai_features": {
            "market_classification_accuracy": 0,
            "avg_confidence_on_wins": 0,
            "avg_confidence_on_losses": 0,
            "pattern_memory_size": total,
            "adaptation_cycles": total,
            "learning_rate_current": 0,
            "win_rate_after_learning": round(wins / total * 100, 1) if total else 0,
            "loss_avoidance_rate": round((total - losses) / total * 100, 1) if total else 0,
        },
    }
    if not total:
        return summary

    running_equity = 0.0
    peak_equity = 0.0
    max_dd = 0.0
    week_stats = {}
    month_stats = {}
    setup_stats = {}
    current_win_streak = current_loss_streak = 0

    for idx, trade in enumerate(closed, start=1):
        profit = float(trade.get("profit") or 0)
        running_equity += profit
        peak_equity = max(peak_equity, running_equity)
        max_dd = max(max_dd, peak_equity - running_equity)
        balance = float(trade.get("balance") or 0)
        summary["equity_curve"].append({"day": idx, "equity": round(balance if balance > 0 else running_equity, 2)})

        raw_dt = trade.get("created_at")
        try:
            dt = datetime.fromisoformat(str(raw_dt).replace("Z", "+00:00")) if raw_dt else datetime.fromtimestamp(float(trade.get("created_ts") or 0), timezone.utc)
        except Exception:
            dt = datetime.now(timezone.utc)
        week_key = f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}"
        month_key = dt.strftime("%b %Y")

        if week_key not in week_stats:
            week_stats[week_key] = {"profit": 0.0, "trades": 0, "peak": 0.0, "equity": 0.0, "drawdown": 0.0}
        week_stats[week_key]["profit"] += profit
        week_stats[week_key]["trades"] += 1
        week_stats[week_key]["equity"] += profit
        week_stats[week_key]["peak"] = max(week_stats[week_key]["peak"], week_stats[week_key]["equity"])
        week_stats[week_key]["drawdown"] = max(week_stats[week_key]["drawdown"], week_stats[week_key]["peak"] - week_stats[week_key]["equity"])

        if month_key not in month_stats:
            month_stats[month_key] = {"profit": 0.0, "trades": 0}
        month_stats[month_key]["profit"] += profit
        month_stats[month_key]["trades"] += 1

        setup = str(trade.get("setup") or trade.get("signature") or "Unknown").split("|")[0] or "Unknown"
        if setup not in setup_stats:
            setup_stats[setup] = {"trades": 0, "wins": 0, "profit": 0.0}
        setup_stats[setup]["trades"] += 1
        setup_stats[setup]["profit"] += profit

        result = str(trade.get("result", "")).upper()
        if result == "WIN":
            setup_stats[setup]["wins"] += 1
            current_win_streak += 1
            current_loss_streak = 0
        elif result == "LOSS":
            current_loss_streak += 1
            current_win_streak = 0
        summary["longest_winning_streak"] = max(summary["longest_winning_streak"], current_win_streak)
        summary["longest_losing_streak"] = max(summary["longest_losing_streak"], current_loss_streak)

    summary["max_drawdown"] = round(max_dd, 2)
    weekly_profits = [v["profit"] for v in week_stats.values()]
    summary["best_week"] = round(max(weekly_profits), 2) if weekly_profits else 0
    summary["worst_week"] = round(min(weekly_profits), 2) if weekly_profits else 0
    summary["weekly_return_avg"] = round(sum(weekly_profits) / len(weekly_profits), 2) if weekly_profits else 0
    summary["weekly_data"] = [
        {"week": k, "return": round(v["profit"], 2), "drawdown": round(v["drawdown"], 2), "trades": v["trades"]}
        for k, v in sorted(week_stats.items())[-12:]
    ]
    summary["monthly_returns"] = [
        {"month": k, "return": round(v["profit"], 2), "trades": v["trades"]}
        for k, v in month_stats.items()
    ][-12:]
    summary["strategy_breakdown"] = [
        {
            "strategy": k[:24],
            "trades": v["trades"],
            "win_rate": round(v["wins"] / v["trades"] * 100, 1) if v["trades"] else 0,
            "profit_share": round(v["profit"], 2),
        }
        for k, v in sorted(setup_stats.items(), key=lambda item: item[1]["profit"], reverse=True)[:3]
    ]
    return summary

@api_router.get("/architecture")
async def get_architecture():
    return {"modules":[{"name":"Market Analysis Engine","description":"Multi-layered analysis using EMA, RSI, ATR, BB across M5, H1, H4","components":["Trend Detection (EMA 50/200)","Market Structure (HH/LL)","Volatility Analysis (ATR)","Multi-Timeframe Confirmation"]},{"name":"AI Adaptive Decision Engine","description":"ML classifier targeting high-probability setups with self-improving confidence","components":["Market Classifier","Confidence Scoring (0-100)","Deep Pattern Memory","Self-Improving Engine"]},{"name":"Strategy Engine","description":"Three strategies with dynamic switching","components":["Trend Mode","Range Mode","Breakout Mode","Pattern Recognition"]},{"name":"Risk Management","description":"Institutional controls with account-aware exposure limits","components":["Dynamic Position Sizing","ATR-based SL/TP","Daily/Weekly Limits","Equity Protection"]},{"name":"Execution Engine","description":"Precision execution with PIN validation and cloud-safe synchronized exits","components":["Market/Limit Orders","Spread Filter","Structure Exit Logic","Trailing Stop"]},{"name":"Performance Tracking","description":"Logging + ML feedback loop","components":["Trade Journal","Win Rate Tracking","Drawdown Monitor","Pattern Learning"]}],"filters":[{"name":"Session Filter","description":"London & NY only"},{"name":"Spread Filter","description":"Avoids high spread"},{"name":"News Filter","description":"Avoids events"},{"name":"Volatility Filter","description":"Adapts to volatility"}]}

@api_router.get("/docs/installation")
async def get_installation_guide():
    return {"steps":[{"step":1,"title":"Download EA","description":"Download .mq5 from Download section."},{"step":2,"title":"Open MT5","description":"Launch MetaTrader 5."},{"step":3,"title":"Copy to Folder","description":"File > Open Data Folder > MQL5 > Experts. Paste file."},{"step":4,"title":"Compile","description":"Press F4 (MetaEditor), open file, press F7."},{"step":5,"title":"Open Chart","description":"Open XAUUSD M5 chart."},{"step":6,"title":"Attach EA","description":"Drag EA from Navigator onto chart."},{"step":7,"title":"Enter PIN","description":"Input your license PIN. Configure settings."},{"step":8,"title":"Enable","description":"Click Algo Trading (green). Bot starts!"}],"requirements":["MetaTrader 5","XAUUSD symbol","Valid PIN","Internet","$1000+ balance","Low-spread broker"],"warnings":["Start with demo","No guaranteed profits","Don't risk what you can't lose","Keep PIN private"]}

@api_router.get("/docs/how-it-works")
async def get_how_it_works():
    return {"sections":[{"title":"How XauAI Sniper Works","subtitle":"Your intelligent XAUUSD trading assistant","steps":[{"id":1,"title":"Market Scanning","description":"Scans XAUUSD across M5, H1, H4 every 5 minutes using EMA, RSI, ATR, Bollinger Bands.","detail":"Multi-timeframe filters false signals."},{"id":2,"title":"AI Classification","description":"Classifies market as TRENDING, RANGING, or BREAKOUT using weighted scoring.","detail":"Different strategy for each condition."},{"id":3,"title":"Confidence Scoring","description":"Scores each setup using market structure, momentum, volatility, session quality, and live journal memory.","detail":"Sniper approach = fewer, higher-quality trades."},{"id":4,"title":"Smart Execution","description":"ATR-based stop loss, wider structure-runner targets, synchronized SL/TP, and trailing logic.","detail":"Protects the account while giving valid gold moves room to breathe."},{"id":5,"title":"Risk Protection","description":"Per-trade risk limits, account exposure caps, drawdown checks, and cooldown after weak conditions.","detail":"Controls damage without blocking every pullback."},{"id":6,"title":"Global Learning","description":"Verified trade logs feed the global AI memory so repeated weak patterns can be avoided over time.","detail":"Cloud ML improves only from real outcomes, not fake sample stats."}]}],"faq":[{"q":"Do I need to keep my computer on?","a":"Yes. Use a VPS ($5-10/mo) for 24/7 trading."},{"q":"What account size?","a":"Min $500, recommended $1,000+. Bot auto-calculates lot sizes."},{"q":"Which broker?","a":"Any reliable MT5 broker with a low-spread XAUUSD symbol can work."},{"q":"Can I close trades manually?","a":"Yes, anytime. The bot won't interfere."},{"q":"What if I lose internet?","a":"Your SL/TP protect you. Bot resumes when reconnected."}]}

@api_router.get("/docs/setup-guide")
async def get_setup_guide():
    return {"title":"Setup Guide (Even a 10-Year-Old Can Follow This)","intro":"Follow these steps one by one. Each has exactly what to click.","steps":[{"step":1,"title":"Download MetaTrader 5","instructions":["Go to metatrader5.com/en/download","Click 'Download MetaTrader 5'","Install (click Next until done)","Open MT5"],"tip":"Like installing any app!"},{"step":2,"title":"Create Demo Account","instructions":["Click 'Open a demo account'","Pick MetaQuotes-Demo","Fill any name/email","Choose Forex, 1:100 leverage","Click Finish"],"tip":"Demo = fake money. Can't lose real money."},{"step":3,"title":"Download EA File","instructions":["On our site, go to Download section","Click 'DOWNLOAD .MQ5 FILE'","File saves to Downloads folder"],"tip":"One file = the bot's brain."},{"step":4,"title":"Put File in Right Folder","instructions":["MT5: File > Open Data Folder","Open MQL5 > Experts","Paste the .mq5 file here"],"tip":"Like putting a game in the right folder."},{"step":5,"title":"Compile the EA","instructions":["Press F4 (MetaEditor opens)","Find file on left, double-click","Press F7 to compile","Check: 0 errors","Close MetaEditor"],"tip":"Turns code into a working bot."},{"step":6,"title":"Open Gold Chart","instructions":["Left panel: Market Watch","Right-click > Show All","Find XAUUSD","Right-click > Chart Window","Set to M5 timeframe"],"tip":"XAUUSD = Gold in USD."},{"step":7,"title":"Attach Bot to Chart","instructions":["Press Ctrl+N (Navigator)","Expand Expert Advisors","Drag XAUUSD_AI_Sniper_EA onto chart","Settings popup appears"],"tip":"You're telling the bot to watch gold."},{"step":8,"title":"Enter PIN & Configure","instructions":["Inputs tab > License PIN > enter your PIN","Set Profit Mode: 1=20%, 2=35%, 3=50%","Common tab > check Allow Algo Trading","Click OK"],"tip":"PIN = car key. No PIN = no trading."},{"step":9,"title":"Enable Auto Trading","instructions":["Find Algo Trading button in toolbar","Click until GREEN","Green = ON, Red = OFF"],"tip":"The master ON/OFF switch."},{"step":10,"title":"You're Done!","instructions":["Dashboard appears on chart","Bot scans every 5 minutes","Trades appear in Trade tab","Let it run!"],"tip":"Leave it alone = better performance."}],"important_notes":["START WITH DEMO! Practice 1-2 weeks first.","Keep MT5 running 24/7. Use VPS if needed.","Some losses are normal. Don't panic.","If bot stops: check Algo Trading is green, check session hours."]}

@api_router.get("/docs/video-guide")
async def get_video_guide():
    return {"title":"Complete Visual Walkthrough","subtitle":"Screen-by-screen guide at your own pace","scenes":[{"scene":1,"title":"GETTING STARTED","duration":"2 min","frames":[{"action":"OPEN BROWSER","detail":"Go to metatrader5.com/en/download","visual":"Blue website with download button"},{"action":"CLICK DOWNLOAD","detail":"Click 'Download MetaTrader 5 for Windows'","visual":"mt5setup.exe starts downloading"},{"action":"INSTALL","detail":"Double-click file. Next > Next > Finish","visual":"Standard Windows installer"},{"action":"OPEN MT5","detail":"Click MetaTrader 5 on desktop","visual":"Trading terminal with charts"}]},{"scene":2,"title":"CREATING ACCOUNT","duration":"1 min","frames":[{"action":"DEMO","detail":"Click 'Open a demo account'","visual":"Account dialog"},{"action":"BROKER","detail":"Pick MetaQuotes-Demo, click Next","visual":"Broker list"},{"action":"DETAILS","detail":"Enter name, select Forex 1:100","visual":"Simple form"},{"action":"DONE","detail":"Click Finish. $10,000 demo money!","visual":"Balance shows $10,000"}]},{"scene":3,"title":"INSTALLING EA","duration":"3 min","frames":[{"action":"DOWNLOAD EA","detail":"Click gold DOWNLOAD button on site","visual":"Gold button"},{"action":"DATA FOLDER","detail":"MT5: File > Open Data Folder","visual":"Windows Explorer opens"},{"action":"NAVIGATE","detail":"MQL5 > Experts folder","visual":"Experts folder"},{"action":"PASTE","detail":"Copy .mq5 file here","visual":"File in folder"},{"action":"COMPILE","detail":"F4, find file, F7. 0 errors","visual":"MetaEditor success"},{"action":"BACK","detail":"Close MetaEditor","visual":"MT5 main window"}]},{"scene":4,"title":"CHART SETUP","duration":"1 min","frames":[{"action":"FIND GOLD","detail":"Market Watch > Show All > XAUUSD","visual":"Symbol list"},{"action":"OPEN CHART","detail":"Right-click > Chart Window","visual":"Candlestick chart"},{"action":"TIMEFRAME","detail":"Click M5 in toolbar","visual":"5-min candles"}]},{"scene":5,"title":"ACTIVATING BOT","duration":"2 min","frames":[{"action":"NAVIGATOR","detail":"Ctrl+N > Expert Advisors","visual":"EA list"},{"action":"DRAG","detail":"Drag EA onto XAUUSD chart","visual":"Settings popup"},{"action":"PIN","detail":"Inputs > License PIN > enter PIN","visual":"PIN input field"},{"action":"MODE","detail":"Set Profit Mode 1/2/3","visual":"Number input"},{"action":"ALGO","detail":"Common > Allow Algo Trading checked","visual":"Checkbox"},{"action":"GO","detail":"Click OK. Click Algo Trading GREEN","visual":"Green button = LIVE!"}]},{"scene":6,"title":"VPS SETUP","duration":"5 min","frames":[{"action":"WHAT IS VPS?","detail":"Cloud computer that runs 24/7","visual":"Computer that never sleeps"},{"action":"GET VPS","detail":"ForexVPS.net or Contabo ($5-10/mo)","visual":"VPS pricing pages"},{"action":"CONNECT","detail":"Remote Desktop > enter IP/password","visual":"RDP connection"},{"action":"INSTALL MT5","detail":"Same install process on VPS","visual":"MT5 on VPS"},{"action":"SETUP EA","detail":"Copy EA, attach, enter PIN, enable","visual":"Same setup, on VPS"},{"action":"DONE","detail":"Close RDP. Bot runs forever!","visual":"24/7 trading"}]}]}

# -------------------------------------------------------------------
# ADMIN ROUTES (Protected)
# -------------------------------------------------------------------

@api_router.get("/admin/settings")
async def get_admin_settings(admin: dict = Depends(get_current_admin)):
    s = await get_settings()
    # Mask sensitive keys
    pk = s.get("paystack_secret_key", "")
    sp = s.get("smtp_password", "")
    return {
        "paystack_configured": bool(pk),
        "paystack_key_preview": f"{pk[:8]}...{pk[-4:]}" if len(pk) > 12 else ("set" if pk else "not set"),
        "pin_price_kobo": s.get("pin_price_kobo", 30000000),
        "pin_price_naira": s.get("pin_price_kobo", 30000000) / 100,
        "smtp_email": s.get("smtp_email", ""),
        "smtp_configured": bool(sp),
    }

@api_router.put("/admin/settings")
async def update_admin_settings(req: AdminSettingsUpdate, admin: dict = Depends(get_current_admin)):
    updates = {}
    if req.paystack_secret_key is not None: updates["paystack_secret_key"] = req.paystack_secret_key
    if req.pin_price_kobo is not None: updates["pin_price_kobo"] = req.pin_price_kobo
    if req.smtp_email is not None: updates["smtp_email"] = req.smtp_email
    if req.smtp_password is not None: updates["smtp_password"] = req.smtp_password
    if updates:
        await db.admin_settings.update_one({"key": "main"}, {"$set": updates}, upsert=True)
    return {"updated": True}

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
async def update_admin_account(req: AdminAccountUpdate, admin: dict = Depends(get_current_admin)):
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
    return {"updated": True, "email": new_email, "token": new_token, "message": "Account updated successfully"}

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
async def ml_submit_pattern(req: MLPatternSubmit):
    """EA submits trade outcome for global learning"""
    # Verify PIN is valid
    pin_doc = await db.pin_licenses.find_one({"pin": req.pin, "is_active": True})
    if not pin_doc:
        raise HTTPException(status_code=403, detail="Invalid PIN")

    pattern = {
        "pin": req.pin,
        "market_state": req.market_state,
        "strategy": req.strategy,
        "ema_diff": req.ema_diff,
        "rsi_value": req.rsi_value,
        "atr_value": req.atr_value,
        "bb_width": req.bb_width,
        "hour_of_day": req.hour_of_day,
        "day_of_week": req.day_of_week,
        "candle_body_ratio": req.candle_body_ratio,
        "was_winner": req.was_winner,
        "profit_pips": req.profit_pips,
        "confidence": req.confidence,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ml_patterns.insert_one(pattern)

    # Update global stats cache
    await _update_ml_stats()

    return {"received": True, "total_patterns": await db.ml_patterns.count_documents({})}

@api_router.post("/ml/get-confidence")
async def ml_get_confidence(req: MLConfidenceRequest):
    """EA asks for ML confidence adjustment before trading"""
    # Verify PIN
    pin_doc = await db.pin_licenses.find_one({"pin": req.pin, "is_active": True})
    if not pin_doc:
        raise HTTPException(status_code=403, detail="Invalid PIN")

    total_patterns = await db.ml_patterns.count_documents({})
    if total_patterns < 20:
        return {"adjustment": 0, "total_patterns": total_patterns, "reason": "Not enough data yet"}

    # 1. Find similar patterns globally (same market + strategy)
    match_filter = {"market_state": req.market_state, "strategy": req.strategy}
    similar = await db.ml_patterns.find(match_filter, {"_id": 0, "was_winner": 1, "hour_of_day": 1, "day_of_week": 1, "rsi_value": 1, "profit_pips": 1}).limit(1000).to_list(1000)

    if len(similar) < 5:
        return {"adjustment": 0, "total_patterns": total_patterns, "reason": "Few similar patterns"}

    wins = sum(1 for p in similar if p["was_winner"])
    base_win_rate = wins / len(similar)

    # 2. Narrow down: same hour range (+/-1) and day of week
    time_matches = [p for p in similar if abs(p["hour_of_day"] - req.hour_of_day) <= 1 and p["day_of_week"] == req.day_of_week]
    time_win_rate = None
    if len(time_matches) >= 5:
        time_wins = sum(1 for p in time_matches if p["was_winner"])
        time_win_rate = time_wins / len(time_matches)

    # 3. RSI similarity check
    rsi_matches = [p for p in similar if abs(p["rsi_value"] - req.rsi_value) < 10]
    rsi_win_rate = None
    if len(rsi_matches) >= 5:
        rsi_wins = sum(1 for p in rsi_matches if p["was_winner"])
        rsi_win_rate = rsi_wins / len(rsi_matches)

    # 4. Calculate weighted confidence adjustment
    # Base: strategy+market win rate (weight 40%)
    # Time: hour+day win rate (weight 35%)
    # RSI: indicator similarity (weight 25%)
    weighted_wr = base_win_rate * 0.4
    if time_win_rate is not None:
        weighted_wr += time_win_rate * 0.35
    else:
        weighted_wr += base_win_rate * 0.35
    if rsi_win_rate is not None:
        weighted_wr += rsi_win_rate * 0.25
    else:
        weighted_wr += base_win_rate * 0.25

    # Convert to adjustment: 50% WR = 0, 80% = +24, 30% = -16
    adjustment = int((weighted_wr - 0.5) * 80)
    adjustment = max(-25, min(25, adjustment))

    # 5. Loss time slot check
    skip_trade = False
    if time_win_rate is not None and time_win_rate < 0.30 and len(time_matches) >= 8:
        skip_trade = True
        adjustment = -30  # Strong penalty

    return {
        "adjustment": adjustment,
        "skip_trade": skip_trade,
        "total_patterns": total_patterns,
        "similar_count": len(similar),
        "base_win_rate": round(base_win_rate * 100, 1),
        "time_win_rate": round(time_win_rate * 100, 1) if time_win_rate else None,
        "rsi_win_rate": round(rsi_win_rate * 100, 1) if rsi_win_rate else None,
        "weighted_win_rate": round(weighted_wr * 100, 1),
    }

@api_router.get("/ml/stats")
async def ml_global_stats():
    """Global ML statistics (public)"""
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
    stats = await ml_global_stats()
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
async def smart_check_trade(req: MLConfidenceRequest):
    """All-in-one smart trade check: ML + News + DXY + Session + Recovery"""
    result = {
        "allow_trade": True,
        "adjustments": [],
        "final_adjustment": 0,
        "warnings": [],
    }

    # 1. ML confidence (reuse existing logic)
    ml_data = await ml_get_confidence(req)
    ml_adj = ml_data.get("adjustment", 0)
    if ml_data.get("skip_trade"):
        result["allow_trade"] = False
        result["warnings"].append("BLOCKED: Global ML says this setup historically loses")
        return result
    result["adjustments"].append({"source": "global_ml", "value": ml_adj})

    # 2. DXY correlation
    try:
        dxy = await get_dxy_direction()
        gold_bias = dxy.get("gold_bias", "neutral")
        is_buy = req.market_state in [0, 3]  # trending up or breakout up

        if (is_buy and gold_bias == "bearish") or (not is_buy and gold_bias == "bullish"):
            result["adjustments"].append({"source": "dxy_conflict", "value": -10})
            result["warnings"].append(f"DXY conflict: Gold bias is {gold_bias} but trade is {'BUY' if is_buy else 'SELL'}")
        elif (is_buy and gold_bias == "bullish") or (not is_buy and gold_bias == "bearish"):
            result["adjustments"].append({"source": "dxy_confirm", "value": 5})
    except:
        pass

    # 3. Session tuning
    hour = req.hour_of_day
    if 13 <= hour < 16:  # overlap
        result["adjustments"].append({"source": "session_overlap_boost", "value": 3})
    elif 0 <= hour < 8:  # asian - be more selective
        result["adjustments"].append({"source": "session_asian_penalty", "value": -8})
        result["warnings"].append("Asian session: low liquidity, higher risk")

    # 4. Weekend protection (Friday after 20:00)
    dow = req.day_of_week
    if dow == 5 and hour >= 20:
        result["allow_trade"] = False
        result["warnings"].append("BLOCKED: Weekend gap protection - no new trades after Friday 20:00")
        return result

    # Calculate final
    total_adj = sum(a["value"] for a in result["adjustments"])
    result["final_adjustment"] = max(-30, min(30, total_adj))

    return result

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
    admin_password = admin_password_env or "Admin@2026!"
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_password), "name": "Admin", "role": "admin", "created_at": datetime.now(timezone.utc).isoformat()})
        logger.info(f"Admin seeded: {admin_email}")
    elif admin_password_env and not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Admin password updated")
    await db.users.create_index("email", unique=True)
    # v1.4.7 — one-time backfill: copy closed_at from cloud_shadow_trades back
    # into cloud_signals. Fixes legacy signals where master_close updated
    # shadow trades but not the parent signal record. Idempotent.
    try:
        legacy = await db.cloud_shadow_trades.aggregate([
            {"$match": {"status": "shadow_closed", "closed_at": {"$ne": None}}},
            {"$group": {"_id": "$signal_id", "closed_at": {"$min": "$closed_at"},
                        "exit_price": {"$first": "$exit_price"},
                        "reason": {"$first": "$reason"}}}
        ]).to_list(50000)
        bf = 0
        for r in legacy:
            sid = r.get("_id");
            if not sid: continue
            res = await db.cloud_signals.update_one(
                {"id": sid, "$or": [{"closed_at": None}, {"closed_at": {"$exists": False}}]},
                {"$set": {"closed_at": r.get("closed_at"),
                          "exit_price": float(r.get("exit_price") or 0),
                          "close_reason": r.get("reason", "")}}
            )
            if res.modified_count: bf += 1
        if bf:
            logger.info(f"[backfill] marked {bf} legacy cloud_signals as closed from shadow trades")
    except Exception as e:
        logger.warning(f"[backfill] cloud_signals.closed_at backfill failed: {e}")
    if os.environ.get("WRITE_TEST_CREDENTIALS") == "1":
        creds_path = Path("/app/memory/test_credentials.md")
        creds_path.parent.mkdir(exist_ok=True)
        creds_path.write_text(f"# Test Credentials\n\n## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n## Endpoints\n- Login: POST /api/auth/login\n- Admin Portal: /admin\n")

    # Background: auto-mark workers offline if heartbeat goes stale.
    # Without this the dashboard lies that cloud is "online" when the VPS process died.
    async def _decay_stale_workers():
        while True:
            try:
                cutoff = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
                res = await db.cloud_workers.update_many(
                    {"status": "online", "last_heartbeat": {"$lt": cutoff}},
                    {"$set": {"status": "offline"}})
                if res.modified_count:
                    logger.info(f"[worker-decay] flipped {res.modified_count} stale worker(s) offline")
            except Exception as e:
                logger.warning(f"[worker-decay] {e}")
            await asyncio.sleep(60)
    asyncio.create_task(_decay_stale_workers())

########################################
# CLAUDE AI POSITION MANAGER (Active Trade Reasoning)
########################################
class PositionCheckRequest(BaseModel):
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

@api_router.post("/ai/manage-position")
async def ai_manage_position(req: PositionCheckRequest):
    try:
        if not LLM_KEY:
            return {"action": "HOLD", "reason": "AI not configured"}

        # v4.7.0 — AI exit brain with action expansion.
        # Returns one of: HOLD, CLOSE, LOCK (with lock_usd $ amount)
        # When pending_exit_reason is set, the EA is asking AI to VETO a rule-based close.
        is_veto = bool(req.pending_exit_reason)
        has_thesis = bool(req.thesis and len(req.thesis) > 20)

        if is_veto:
            system_msg = f"""You are a XAUUSD M5 trade auditor. The bot's rule-based logic wants to CLOSE this position because of: {req.pending_exit_reason}.

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
            system_msg = """You are a XAUUSD M5 trade auditor for an open position. Decide HOLD, CLOSE, or LOCK.

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
        thesis_block = ""
        if has_thesis:
            thesis_block = f"""
ORIGINAL ENTRY THESIS:
"{req.thesis[:400]}"

ORIGINAL INVALIDATION CONDITION:
"{req.invalidation[:200] if req.invalidation else 'not specified'}"

ORIGINAL CONFIDENCE: {req.confidence}/100
"""
        veto_block = f"\n⚠️  RULE-BASED EXIT WANTS TO CLOSE: '{req.pending_exit_reason}'. Veto this if thesis is still intact." if is_veto else ""
        prompt = f"""OPEN {req.direction} POSITION on XAUUSD:
- Entry: {req.entry_price} | Current: {req.current_price}
- P/L: {pnl_str} | Peak: {peak_str} | ({req.lots} lots)
- Open for: {req.minutes_open} minutes
- SL: {req.sl} | TP: {req.tp}
- RSI: {req.rsi} | ATR: {req.atr}
- EMA50: {req.ema_fast} | EMA200: {req.ema_slow}
- Trend: {"BULLISH" if req.ema_fast > req.ema_slow else "BEARISH"} | Regime: {req.regime or 'unknown'}{veto_block}
{thesis_block}
HOLD, CLOSE, or LOCK? JSON only."""

        msg = UserMessage(text=prompt)
        response = await chat.send_message(msg)

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
            return result
        except json.JSONDecodeError:
            up = response.upper()
            if '"CLOSE"' in up or "ACTION:CLOSE" in up.replace(" ", ""):
                return {"action": "CLOSE", "reason": "parser fallback"}
            return {"action": "HOLD", "reason": "AI response unclear"}
    except Exception as e:
        logger.error(f"Position manager error: {e}")
        return {"action": "HOLD", "reason": f"Error: {str(e)[:50]}"}

########################################
# AI MARKET ANALYSIS (GPT-5.2)
########################################
class AIAnalysisRequest(BaseModel):
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

# ------- shared helpers -------
_ENTRY_SYSTEM_PROMPT = """You are an expert XAUUSD (Gold) M5 scalper with 10+ years experience. You analyze technical data and give ONE clear trading decision WITH a full trader-style thesis AND a devil's-advocate counter-argument. You MUST respond in EXACTLY this JSON format, nothing else (NO markdown fences):
{"action":"BUY","confidence":75,"reason":"short reason","thesis":"detailed trader narrative","bearish_case":"the counter-argument — why this trade could fail","skip_if":"specific price/condition that should cancel this trade BEFORE entry","invalidation":"what proves you wrong AFTER entry","target":"where you expect price to reach","sl_adjust":0,"tp_adjust":0}

Rules:
- action: BUY, SELL, or SKIP (only these 3)
- confidence: 0-100. USE THIS SCALE HONESTLY:
    • 90-100: textbook setup, 5/5 confluence, would bet big
    • 75-89: strong setup, 4/5 confluence, normal size
    • 60-74: decent setup but something's off, smaller size
    • <60: marginal, SKIP is better
  Do NOT inflate confidence. A bot downstream will skip trades below 60 and size up above 90.
- reason: max 30 words — one sentence summary
- thesis: 40-80 words — explain the SETUP, CONTEXT, and WHY this edge exists. Write like a real trader.
- bearish_case: 25-50 words — the honest counter-argument. What would make this trade fail? What are the RED FLAGS you're ignoring? If you can't think of one, confidence should drop.
- skip_if: 15-25 words — specific pre-entry condition that should CANCEL this trade. Example: "Skip if spread > 30 points OR if H1 RSI crosses 70 before entry bar closes."
- invalidation: 15-25 words — specific price/condition that PROVES thesis wrong AFTER entry. Example: "If price closes back below 4692 with volume, thesis dead — cut immediately."
- target: 10-20 words — realistic price target.
- sl_adjust: -1 to 1 (negative=tighter SL, positive=wider SL, 0=default)
- tp_adjust: -1 to 1 (negative=tighter TP, positive=wider TP, 0=default)

Be decisive. If unsure, SKIP. The bearish_case is MANDATORY — even for high-conviction trades, articulate the counter. A trader who can't see both sides is a gambler."""

def _build_entry_prompt(req: AIAnalysisRequest) -> str:
    return f"""XAUUSD M5 Market Data RIGHT NOW:
- Price: {req.price}
- EMA50: {req.ema_fast} | EMA200: {req.ema_slow} (sep: {abs(req.ema_fast-req.ema_slow):.2f})
- Trend: {"BULLISH" if req.ema_fast > req.ema_slow else "BEARISH"} | H1 Trend: {req.h1_trend}
- RSI(14): {req.rsi} | Stoch: {req.stoch:.1f} | Momentum: {req.mom:+.2f}
- ATR(14): {req.atr}
- Spread: {req.spread} points
- Regime: {req.regime or "unknown"} | Setup: {req.setup or "unknown"}
- Recent candles: {req.recent_candles}

What is your trade decision? JSON only."""

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
        if '"BUY"' in up:  return {"action": "BUY",  "confidence": 55, "reason": "parser fallback", "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "", "sl_adjust": 0, "tp_adjust": 0}
        if '"SELL"' in up: return {"action": "SELL", "confidence": 55, "reason": "parser fallback", "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "", "sl_adjust": 0, "tp_adjust": 0}
        return {"action": "SKIP", "confidence": 50, "reason": "AI response unclear", "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "", "sl_adjust": 0, "tp_adjust": 0}

async def _ask_entry_ai(provider: str, model: str, req: AIAnalysisRequest) -> dict:
    try:
        chat = LlmChat(
            api_key=LLM_KEY,
            session_id=f"entry-{provider}-{uuid.uuid4().hex[:8]}",
            system_message=_ENTRY_SYSTEM_PROMPT,
        ).with_model(provider, model)
        msg = UserMessage(text=_build_entry_prompt(req))
        # 8s hard timeout — M5 signals are time-sensitive
        response = await asyncio.wait_for(chat.send_message(msg), timeout=8.0)
        result = _parse_entry_json(response)
        result["available"] = True
        return result
    except asyncio.TimeoutError:
        logger.warning(f"Entry AI {provider}/{model} timed out")
        return {"action": "SKIP", "confidence": 0, "reason": f"{provider} timeout",
                "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "",
                "sl_adjust": 0, "tp_adjust": 0, "available": False}
    except Exception as e:
        logger.error(f"Entry AI {provider}/{model} error: {e}")
        return {"action": "SKIP", "confidence": 0, "reason": f"{provider} error",
                "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "",
                "sl_adjust": 0, "tp_adjust": 0, "available": False}

@api_router.post("/ai/analyze")
async def ai_analyze_market(req: AIAnalysisRequest):
    """Dual-AI entry analysis: Claude 4.5 + GPT-5.2 vote in parallel.

    Consensus rules (revised to NOT punish availability):
      - Both agree (BUY=BUY or SELL=SELL)        -> action, avg conf +5 (synergy bonus)
      - Direct disagreement (BUY vs SELL)        -> SKIP (safety)
      - One agrees, other SKIPs (both available) -> that side at 0.80x its confidence
      - One agrees, other UNAVAILABLE (error)    -> that side at 1.00x (no penalty)
      - Both SKIP or both unavailable            -> SKIP
    """
    try:
        if not LLM_KEY:
            return {"action": "SKIP", "confidence": 50, "reason": "AI key not configured",
                    "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "",
                    "claude": None, "gpt": None, "sl_adjust": 0, "tp_adjust": 0}

        claude_task = _ask_entry_ai("anthropic", "claude-sonnet-4-5-20250929", req)
        gpt_task    = _ask_entry_ai("openai",    "gpt-5.2",                    req)
        claude, gpt = await asyncio.gather(claude_task, gpt_task)

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
            action, confidence = "SKIP", 50
            reason = f"Both SKIP/unavailable (claude_ok={c_ok}, gpt_ok={g_ok})"
            thesis = (claude.get("thesis","") or gpt.get("thesis","") or "")[:400]
            bearish_case = ""; skip_if = ""; invalidation = ""; target = ""
            sl_adj, tp_adj = 0, 0

        result = {
            "action": action,
            "confidence": confidence,
            "reason": reason[:240],
            "thesis": (thesis or "")[:500],
            "bearish_case": (bearish_case or "")[:500],
            "skip_if": (skip_if or "")[:200],
            "invalidation": (invalidation or "")[:200],
            "target": (target or "")[:200],
            "sl_adjust": sl_adj,
            "tp_adjust": tp_adj,
            "claude": {"action": c_act, "confidence": c_conf, "reason": claude["reason"], "available": c_ok},
            "gpt":    {"action": g_act, "confidence": g_conf, "reason": gpt["reason"],    "available": g_ok},
        }
        try:
            await db.ai_analyses.insert_one({
                "symbol": req.symbol, "request": req.dict(), "response": result,
                "signature": req.signature, "created_at": datetime.now(timezone.utc).isoformat()
            })
        except Exception:
            pass
        return result
    except Exception as e:
        logger.error(f"AI analyze dual error: {e}")
        return {"action": "SKIP", "confidence": 50, "reason": f"AI error: {str(e)[:60]}",
                "thesis": "", "bearish_case": "", "skip_if": "", "invalidation": "", "target": "",
                "claude": None, "gpt": None, "sl_adjust": 0, "tp_adjust": 0}

########################################
# NEWS AVOIDANCE
########################################
@api_router.get("/news/check")
async def check_news_events():
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json")
            if r.status_code != 200:
                return {"safe_to_trade": True, "reason": "Calendar unavailable"}
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
                return {"safe_to_trade": False, "reason": f"High impact: {high_impact_soon[0]['title']} in {high_impact_soon[0]['minutes']}min", "events": high_impact_soon}
            return {"safe_to_trade": True, "reason": "No high-impact events nearby"}
    except Exception as e:
        logger.error(f"News check error: {e}")
        return {"safe_to_trade": True, "reason": "Calendar check failed"}

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

@api_router.post("/journal/log")
async def log_trade_journal(entry: TradeJournalEntry):
    try:
        doc = entry.dict()
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        doc["created_ts"] = time.time()
        doc["win_rate"] = round(entry.wins / entry.total_trades * 100, 1) if entry.total_trades > 0 else 0
        await db.trade_journal.insert_one(doc)
        # Also index into hive_signatures for fast aggregate lookup
        if entry.signature:
            try:
                await db.hive_signatures.insert_one({
                    "signature": entry.signature,
                    "pin": entry.pin,
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
async def get_trade_journal(pin: str = "", limit: int = 50):
    try:
        query = {"pin": pin} if pin else {}
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
async def save_weekly_report(entry: WeeklyReportEntry):
    try:
        doc = entry.dict()
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        doc["week"] = datetime.now(timezone.utc).strftime("%Y-W%W")
        await db.weekly_reports.insert_one(doc)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Weekly report error: {e}")
        return {"status": "error"}

@api_router.get("/journal/weekly-reports")
async def get_weekly_reports(pin: str = "", limit: int = 12):
    try:
        query = {"pin": pin} if pin else {}
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
    symbol: str = "XAUUSD"
    patterns: list = []

@api_router.post("/ml/patterns/save")
async def save_patterns_cloud(req: PatternData):
    try:
        key = f"{req.pin}_{req.symbol}" if req.pin else req.symbol
        await db.ml_cloud_patterns.update_one(
            {"key": key},
            {"$set": {"key": key, "pin": req.pin, "symbol": req.symbol, "patterns": req.patterns, "count": len(req.patterns), "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        return {"status": "ok", "saved": len(req.patterns)}
    except Exception as e:
        logger.error(f"Pattern save error: {e}")
        return {"status": "error", "saved": 0}

@api_router.post("/ml/patterns/load")
async def load_patterns_cloud(req: PatternData):
    try:
        key = f"{req.pin}_{req.symbol}" if req.pin else req.symbol
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

class MT5ConnectReq(BaseModel):
    broker_server: str
    mt5_login: str
    mt5_password: str
    risk_tier: Optional[str] = "balanced"   # conservative | balanced | aggressive

class MT5BrokerCheckReq(BaseModel):
    broker_server: Optional[str] = ""

class PaymentSubmitReq(BaseModel):
    plan: str                   # "starter" ($50) or "pro" ($100)
    method: str                 # "crypto" | "bank"
    amount_usd: float
    reference: Optional[str] = ""   # tx hash / bank ref
    notes: Optional[str] = ""
    proof_image: Optional[str] = ""  # base64 data URL of bank-transfer screenshot
    paid_currency: Optional[str] = "USD"      # currency user actually paid in (NGN, USD, etc.)
    paid_amount_local: Optional[float] = 0.0  # amount in that currency

class CloudPauseReq(BaseModel):
    paused: bool

class CloudCommandReq(BaseModel):
    action: str
    pin: str
    confirm: bool = False
    payload: Optional[Dict] = None

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

SAFE_REMOTE_COMMANDS = {
    "PAUSE_NEW_TRADES": "Pause new trades",
    "RESUME_TRADING": "Resume trading",
    "STOP_TRADING": "Stop trading",
    "CLOSE_ALL_TRADES": "Close all trades",
    "FORCE_SYNC": "Force startup intelligence sync",
    "FORCE_REPORT_UPLOAD": "Force report upload marker",
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

async def _verify_command_license(user: dict, key: str) -> dict:
    raw = _normalize_license_key(key)
    if not raw.startswith("ASE-") or len(raw) < 10:
        raise HTTPException(status_code=400, detail="Enter your XAU AI Sniper license key, for example ASE-D4Q9-SUFW.")
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
    """Authenticate EA monitor traffic by license PIN first; agent token remains only a fallback."""
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

    if request is not None:
        try:
            await _require_agent_async(request)
            logger.info("[monitor-auth] accepted fallback agent token account=%s", account)
            return {}
        except HTTPException as exc:
            logger.warning("[monitor-auth] reject missing pin/token account=%s detail=%s", account, exc.detail)

    raise HTTPException(status_code=403, detail={
        "ok": False,
        "reason": "MISSING_LICENSE_PIN",
        "message": "EA monitor requests must include license_pin/pin. Put your ASE license key in InpLicensePIN.",
        "account": account,
    })

# -------- Plans (admin-configurable via cloud_settings.plans; defaults below) --------
CLOUD_PLANS = {
    "starter": {"name": "Starter", "price_usd": 50.0, "max_balance_usd": 5000,
                "description": "For accounts up to $5,000. All features. Email support."},
    "pro":     {"name": "Pro",     "price_usd": 100.0, "max_balance_usd": 999999,
                "description": "For accounts $5,000+. Priority execution. Telegram alerts. Priority support."},
}
CLOUD_TRIAL_DAYS = 7

# Default FX rates (USD = 1.0). Admin can override via /admin/cloud/settings.
# Used for showing bank-transfer amounts in local currency on the billing page.
DEFAULT_FX_RATES = {
    "USD": 1.0,
    "NGN": 1650.0,    # Nigeria
    "KES": 130.0,     # Kenya
    "ZAR": 18.5,      # South Africa
    "GHS": 15.0,      # Ghana
    "EUR": 0.92,      # Europe
    "GBP": 0.79,      # UK
    "INR": 84.0,      # India
    "CAD": 1.40,      # Canada
    "AUD": 1.55,      # Australia
}

# Country → preferred currency mapping for IP-based detection.
COUNTRY_TO_CURRENCY = {
    "NG": "NGN", "KE": "KES", "ZA": "ZAR", "GH": "GHS",
    "GB": "GBP", "UK": "GBP", "IN": "INR", "CA": "CAD", "AU": "AUD",
    # default everything else to USD
}

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

async def _get_effective_plans():
    """Returns admin-overridden plans if set in cloud_settings.plans, else defaults."""
    s = await _get_cloud_settings()
    plans = s.get("plans") or {}
    if not plans:
        return CLOUD_PLANS
    # merge with defaults so missing keys still resolve
    merged = {k: dict(v) for k, v in CLOUD_PLANS.items()}
    for pid, override in plans.items():
        if pid not in merged: merged[pid] = {}
        merged[pid].update(override)
    return merged

async def _get_fx_rates():
    s = await _get_cloud_settings()
    rates = s.get("fx_rates") or {}
    out = dict(DEFAULT_FX_RATES); out.update({k: float(v) for k, v in rates.items() if isinstance(v, (int, float))})
    return out

def _detect_country_from_request(request: Request) -> str:
    """Best-effort country detection from common CDN headers."""
    for h in ("CF-IPCountry", "X-Vercel-IP-Country", "X-Country-Code"):
        v = request.headers.get(h, "").upper().strip()
        if v and len(v) == 2: return v
    al = request.headers.get("Accept-Language", "")
    if al:
        # 'en-NG,en;q=0.9' → 'NG'
        for piece in al.split(","):
            if "-" in piece:
                cc = piece.split("-")[1].split(";")[0].strip().upper()
                if len(cc) == 2: return cc
    return ""

# -------- Admin-configured Cloud settings (payment methods, etc.) --------
async def _get_cloud_settings():
    s = await db.cloud_settings.find_one({"key": "main"}, {"_id": 0})
    if not s:
        s = {"key": "main",
             "crypto_wallets": [],       # [{network,address,asset}]
             "bank_accounts": [],        # [{bank_name,account_name,account_number,swift,country}]
             "fiat_paystack_enabled": False,
             "telegram_alerts_enabled": False,
             "master_ea_status": "unknown",
             "master_last_heartbeat": None,
             "shadow_mode": True,        # v1.2 — default ON so admin can sell before VPS
             "agent_token": ""}
        await db.cloud_settings.insert_one(s)
        s.pop("_id", None)
    return s

# -------- Public config endpoint (users need payment instructions) --------
@api_router.get("/cloud/config")
async def cloud_public_config(request: Request):
    s = await _get_cloud_settings()
    plans = await _get_effective_plans()
    rates = await _get_fx_rates()
    country = _detect_country_from_request(request)
    user_currency = COUNTRY_TO_CURRENCY.get(country, "USD")
    # Worker (executor) status — how many VPS workers have heartbeat in last 3 min
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
    workers_online = await db.cloud_workers.count_documents(
        {"status": "online", "last_heartbeat": {"$gt": cutoff}})
    workers_total = await db.cloud_workers.count_documents({})
    return {"plans": plans, "trial_days": CLOUD_TRIAL_DAYS,
            "crypto_wallets": s.get("crypto_wallets", []),
            "bank_accounts":  s.get("bank_accounts", []),
            "fx_rates":       rates,
            "user_country":   country,
            "user_currency":  user_currency,
            "master_status":  s.get("master_ea_status", "online"),
            "executor_workers_online": workers_online,
            "executor_workers_total":  workers_total,
            "shadow_mode":    s.get("shadow_mode", True)}

# -------- Signup / Login / Me --------
@api_router.post("/cloud/auth/signup")
async def cloud_signup(req: CloudSignupReq, response: Response):
    req.email = req.email.lower().strip()
    # basic email format check (no regex lib dependency — simple sanity)
    if "@" not in req.email or "." not in req.email.split("@")[-1] or len(req.email) < 5:
        raise HTTPException(status_code=400, detail="Invalid email format")
    if await db.cloud_users.find_one({"email": req.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be 8+ characters")
    uid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    trial_ends = now + timedelta(days=CLOUD_TRIAL_DAYS)
    doc = {"id": uid, "email": req.email, "password_hash": hash_password(req.password),
           "full_name": (req.full_name or "").strip(), "country": (req.country or "").strip(),
           "created_at": now.isoformat(), "status": "trial",
           "plan": "starter", "subscription_ends_at": trial_ends.isoformat(),
           "trial_used": True, "paused": False,
           "mt5_connected": False, "last_login_at": now.isoformat()}
    await db.cloud_users.insert_one(doc.copy())
    token = _cloud_token(uid, req.email)
    response.set_cookie("cloud_token", token, httponly=True, secure=True, samesite="lax", max_age=60*60*24*30)
    return {"ok": True, "token": token, "user": {k: v for k, v in doc.items() if k != "password_hash"}}

@api_router.post("/cloud/auth/login")
async def cloud_login(req: CloudLoginReq, response: Response):
    req.email = req.email.lower().strip()
    u = await db.cloud_users.find_one({"email": req.email})
    if not u or not verify_password(req.password, u.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.cloud_users.update_one({"id": u["id"]}, {"$set": {"last_login_at": datetime.now(timezone.utc).isoformat()}})
    token = _cloud_token(u["id"], u["email"])
    response.set_cookie("cloud_token", token, httponly=True, secure=True, samesite="lax", max_age=60*60*24*30)
    u.pop("_id", None); u.pop("password_hash", None)
    return {"ok": True, "token": token, "user": u}

@api_router.post("/cloud/auth/logout")
async def cloud_logout(response: Response):
    response.delete_cookie("cloud_token")
    return {"ok": True}

@api_router.get("/cloud/auth/me")
async def cloud_me(user: dict = Depends(get_cloud_user)):
    # hide mt5 creds from self lookup too
    u = dict(user)
    u.pop("mt5_login_enc", None); u.pop("mt5_password_enc", None); u.pop("_id", None)
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

@api_router.post("/cloud/license/link")
async def cloud_license_link(req: CloudLicenseLinkReq, user: dict = Depends(get_cloud_user)):
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

# -------- MT5 Connection --------
@api_router.post("/cloud/mt5/connect")
async def cloud_connect_mt5(req: MT5ConnectReq, user: dict = Depends(get_cloud_user)):
    if req.risk_tier not in ("conservative", "balanced", "aggressive"):
        raise HTTPException(status_code=400, detail="Invalid risk tier")
    # ---- Shape validation (we cannot truly verify until a VPS executor is online) ----
    server = req.broker_server.strip()
    login_raw = req.mt5_login.strip()
    pwd = req.mt5_password
    # Server: "Broker-Live", "Broker-Demo", "Broker-Real", "Broker-Trial..." etc.
    # Allow alnum + dot/hyphen, must contain a hyphen.
    import re
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{2,40}-[A-Za-z0-9]{2,30}$", server):
        raise HTTPException(status_code=400,
            detail="Broker server must look like 'Broker-Live' or 'Broker-Demo' (e.g. Exness-MT5Real16).")
    if not login_raw.isdigit() or not (4 <= len(login_raw) <= 12):
        raise HTTPException(status_code=400,
            detail="MT5 login must be a 4–12 digit account number (no letters/spaces).")
    if len(pwd) < 4:
        raise HTTPException(status_code=400,
            detail="MT5 password must be at least 4 characters.")
    profile = _broker_profile_for_server(server)
    update = {
        "broker_server":     server,
        "broker_name":       profile.get("broker", ""),
        "broker_platform":   profile.get("platform", "MT5"),
        "broker_support_status": profile.get("support_status", "custom_review"),
        "mt5_login":         login_raw,
        "mt5_password_enc":  _cloud_encrypt(pwd),
        "risk_tier":         req.risk_tier,
        # NEW: never claim "connected" without a real broker login. Shape-valid creds
        # land in pending_verification until the VPS worker successfully logs in.
        "mt5_connected":          False,
        "mt5_verification_status":"pending",     # pending | verified | rejected
        "mt5_verification_error": "",
        "mt5_credentials_at":     datetime.now(timezone.utc).isoformat(),
        "broker_last_health":     {},
    }
    await db.cloud_users.update_one({"id": user["id"]}, {"$set": update})
    await _log_broker_event(user["id"], user.get("email", ""), "credentials_saved", True, server, {
        "broker": profile.get("broker"),
        "platform": profile.get("platform"),
        "support_status": profile.get("support_status"),
        "risk_tier": req.risk_tier,
    })
    # Auto-assign to a worker with capacity (silently no-ops if no workers yet → shadow mode picks up)
    wid = await _auto_assign_worker(user["id"])
    s = await _get_cloud_settings()
    workers_online = await db.cloud_workers.count_documents({"status": "online"})
    if workers_online == 0:
        msg = ("Credentials saved & encrypted. Verification will complete the moment our executor "
               "agent logs in to your broker — usually within 60 seconds of going live.")
        mode = "pending_executor"
    elif s.get("shadow_mode", True):
        msg = ("Credentials saved. SHADOW MODE is on — simulated trades will appear in your dashboard. "
               "Real-broker login verification will run when admin flips Shadow OFF.")
        mode = "shadow"
    else:
        msg = "Credentials saved. Worker agent will verify the broker login within 60 seconds."
        mode = "live_pending_verify"
    return {"ok": True, "message": msg, "mode": mode, "assigned_worker": wid,
            "verification_status": "pending"}

# -------- Curated broker server list (searchable on UI like MT5's broker picker) --------
# Sourced from each broker's published MT5 server list + the public TradeVPS broker
# directory (https://broker-servers.apis.tradevps.net/). "Custom..." path on the UI
# allows free-typed servers for unlisted brokers. Update this list as needed.
CLOUD_BROKER_SERVERS = [
    # MetaQuotes (the universal default-demo)
    {"broker": "MetaQuotes",       "server": "MetaQuotes-Demo",            "type": "demo"},
    # Exness
    {"broker": "Exness",           "server": "Exness-MT5Real",             "type": "live"},
    {"broker": "Exness",           "server": "Exness-MT5Real2",            "type": "live"},
    {"broker": "Exness",           "server": "Exness-MT5Real8",            "type": "live"},
    {"broker": "Exness",           "server": "Exness-MT5Real16",           "type": "live"},
    {"broker": "Exness",           "server": "Exness-MT5Real26",           "type": "live"},
    {"broker": "Exness",           "server": "Exness-MT5Trial",            "type": "demo"},
    {"broker": "Exness",           "server": "Exness-MT5Trial4",           "type": "demo"},
    {"broker": "Exness",           "server": "Exness-MT5Trial14",          "type": "demo"},
    # IC Markets (SC + EU)
    {"broker": "IC Markets",       "server": "ICMarketsSC-MT5",            "type": "live"},
    {"broker": "IC Markets",       "server": "ICMarketsSC-MT5-2",          "type": "live"},
    {"broker": "IC Markets",       "server": "ICMarketsSC-MT5-4",          "type": "live"},
    {"broker": "IC Markets",       "server": "ICMarketsSC-Demo",           "type": "demo"},
    {"broker": "IC Markets",       "server": "ICMarketsSC-Demo03",         "type": "demo"},
    {"broker": "IC Markets EU",    "server": "ICMarketsEU-MT5",            "type": "live"},
    {"broker": "IC Markets EU",    "server": "ICMarketsEU-MT5-2",          "type": "live"},
    {"broker": "IC Markets EU",    "server": "ICMarketsEU-Demo",           "type": "demo"},
    # Pepperstone
    {"broker": "Pepperstone",      "server": "Pepperstone-MT5-Live",       "type": "live"},
    {"broker": "Pepperstone",      "server": "Pepperstone-MT5-Live02",     "type": "live"},
    {"broker": "Pepperstone",      "server": "Pepperstone-Demo",           "type": "demo"},
    # FBS
    {"broker": "FBS",              "server": "FBS-Real",                   "type": "live"},
    {"broker": "FBS",              "server": "FBS-Demo",                   "type": "demo"},
    # XM
    {"broker": "XM",               "server": "XMGlobal-MT5",               "type": "live"},
    {"broker": "XM",               "server": "XMGlobal-MT5 2",             "type": "live"},
    {"broker": "XM",               "server": "XMGlobal-MT5 3",             "type": "live"},
    {"broker": "XM",               "server": "XMGlobal-Demo",              "type": "demo"},
    {"broker": "XM",               "server": "XMTrading-MT5",              "type": "live"},
    {"broker": "XM",               "server": "XMTrading-MT5 2",            "type": "live"},
    {"broker": "XM",               "server": "XMTrading-Demo",             "type": "demo"},
    # OctaFX / Octa
    {"broker": "OctaFX",           "server": "OctaFX-Real",                "type": "live"},
    {"broker": "OctaFX",           "server": "OctaFX-Demo",                "type": "demo"},
    {"broker": "Octa",             "server": "Octa-Real",                  "type": "live"},
    {"broker": "Octa",             "server": "Octa-Demo",                  "type": "demo"},
    # FxPro
    {"broker": "FxPro",            "server": "FxPro-MT5",                  "type": "live"},
    {"broker": "FxPro",            "server": "FxPro-MT5 Live02",           "type": "live"},
    {"broker": "FxPro",            "server": "FxPro-MT5 Demo",             "type": "demo"},
    # FTMO
    {"broker": "FTMO",             "server": "FTMO-Server",                "type": "live"},
    {"broker": "FTMO",             "server": "FTMO-Server2",               "type": "live"},
    {"broker": "FTMO",             "server": "FTMO-Demo",                  "type": "demo"},
    # FundedNext
    {"broker": "FundedNext",       "server": "FundedNext-Server",          "type": "live"},
    {"broker": "FundedNext",       "server": "FundedNext-Server 2",        "type": "live"},
    {"broker": "FundedNext",       "server": "FundedNext-Server 3",        "type": "live"},
    {"broker": "FundedNext",       "server": "FundedNext-Server 4",        "type": "live"},
    # FundingPips
    {"broker": "FundingPips",      "server": "FundingPips2-SIM",           "type": "live"},
    # RoboForex
    {"broker": "RoboForex",        "server": "RoboForex-ECN",              "type": "live"},
    {"broker": "RoboForex",        "server": "RoboForex-Pro",              "type": "live"},
    {"broker": "RoboForex",        "server": "RoboForex-Demo",             "type": "demo"},
    # Tickmill (UK + EU + global)
    {"broker": "Tickmill",         "server": "Tickmill-Demo",              "type": "demo"},
    {"broker": "Tickmill UK",      "server": "TickmillUK-Live",            "type": "live"},
    {"broker": "Tickmill UK",      "server": "TickmillUK-Demo",            "type": "demo"},
    {"broker": "Tickmill EU",      "server": "TickmillEU-Live",            "type": "live"},
    {"broker": "Tickmill EU",      "server": "TickmillEU-Demo",            "type": "demo"},
    # Admirals
    {"broker": "Admirals",         "server": "AdmiralsGroup-Live",         "type": "live"},
    {"broker": "Admirals",         "server": "AdmiralsGroup-Demo",         "type": "demo"},
    {"broker": "Admiral Markets",  "server": "AdmiralMarkets-Live",        "type": "live"},
    {"broker": "Admiral Markets",  "server": "AdmiralMarkets-Demo",        "type": "demo"},
    # HFM (HotForex)
    {"broker": "HFM",              "server": "HFMarketsGlobal-Live",       "type": "live"},
    {"broker": "HFM",              "server": "HFMarketsGlobal-Demo",       "type": "demo"},
    {"broker": "HFM",              "server": "HFMarketsSV-Live",           "type": "live"},
    {"broker": "HFM",              "server": "HFMarketsSV-Demo",           "type": "demo"},
    # ThinkMarkets
    {"broker": "ThinkMarkets",     "server": "ThinkMarkets-Live",          "type": "live"},
    {"broker": "ThinkMarkets",     "server": "ThinkMarkets-Demo",          "type": "demo"},
    # Vantage
    {"broker": "Vantage",          "server": "VantageInternational-Live",  "type": "live"},
    {"broker": "Vantage",          "server": "VantageInternational-Demo",  "type": "demo"},
    # Eightcap
    {"broker": "Eightcap",         "server": "Eightcap-Live",              "type": "live"},
    {"broker": "Eightcap",         "server": "Eightcap-Demo",              "type": "demo"},
    # Deriv
    {"broker": "Deriv",            "server": "Deriv-Server",               "type": "live"},
    {"broker": "Deriv",            "server": "Deriv-Demo",                 "type": "demo"},
    # BlackBull Markets
    {"broker": "BlackBull",        "server": "BlackBullMarkets-Live",      "type": "live"},
    {"broker": "BlackBull",        "server": "BlackBullMarkets-Demo",      "type": "demo"},
    # Trade.com / Leadcapital
    {"broker": "Trade.com",        "server": "Trade-Live",                 "type": "live"},
    {"broker": "Trade.com",        "server": "Trade-Demo",                 "type": "demo"},
    {"broker": "Trade.com",        "server": "LeadCapitalMarkets-Live",    "type": "live"},
    {"broker": "Trade.com",        "server": "LeadCapitalMarkets-Demo",    "type": "demo"},
    {"broker": "Trade.com",        "server": "TradeCapitalMarkets-Live",   "type": "live"},
    {"broker": "Trade.com",        "server": "TradeCapitalMarkets-Demo",   "type": "demo"},
    {"broker": "Trade.com / TCH",   "server": "TradeCapitalHolding-Live",  "type": "live"},
    {"broker": "Trade.com / TCH",   "server": "TradeCapitalHolding-Demo",  "type": "demo"},
    # OneRoyal
    {"broker": "OneRoyal",         "server": "OneRoyal-Live",              "type": "live"},
    {"broker": "OneRoyal",         "server": "OneRoyal-Demo",              "type": "demo"},
    {"broker": "OneRoyal",         "server": "RoyalMtPro-Live",            "type": "live"},
    {"broker": "OneRoyal",         "server": "RoyalMtPro-Live01",          "type": "live"},
    {"broker": "OneRoyal",         "server": "RoyalMtPro-Demo",            "type": "demo"},
    # 4XC / 4xCube
    {"broker": "4XC",              "server": "4XC-Live",                   "type": "live"},
    {"broker": "4XC",              "server": "4XC-Demo",                   "type": "demo"},
    {"broker": "4XC",              "server": "4xCube-Live",                "type": "live"},
    {"broker": "4XC",              "server": "4xCube-Demo",                "type": "demo"},
    # AvaTrade / ActivTrades
    {"broker": "AvaTrade",         "server": "AvaTrade-Real",              "type": "live"},
    {"broker": "AvaTrade",         "server": "AvaTrade-Demo",              "type": "demo"},
    {"broker": "ActivTrades",      "server": "ActivTrades-Server",         "type": "live"},
    {"broker": "ActivTrades",      "server": "ActivTrades-Demo",           "type": "demo"},
    # Just2Trade
    {"broker": "Just2Trade",       "server": "Just2Trade-MT5",             "type": "live"},
    {"broker": "Just2Trade",       "server": "Just2Trade-Demo",            "type": "demo"},
    # FXTM (ForexTime)
    {"broker": "FXTM",             "server": "ForexTime-Live01",           "type": "live"},
    {"broker": "FXTM",             "server": "ForexTime-Live02",           "type": "live"},
    {"broker": "FXTM",             "server": "ForexTime-Demo01",           "type": "demo"},
    {"broker": "FXTM",             "server": "ForexTime-Demo02",           "type": "demo"},
    {"broker": "FXTM",             "server": "ForexTimeFXTM-Live01",       "type": "live"},
    {"broker": "FXTM",             "server": "ForexTimeFXTM-Demo01",       "type": "demo"},
    # Alpari
    {"broker": "Alpari",           "server": "Alpari-MT5",                 "type": "live"},
    {"broker": "Alpari",           "server": "Alpari-MT5-Demo",            "type": "demo"},
    # AMarkets
    {"broker": "AMarkets",         "server": "AMarkets-Real",              "type": "live"},
    {"broker": "AMarkets",         "server": "AMarkets-Demo",              "type": "demo"},
    # FusionMarkets
    {"broker": "FusionMarkets",    "server": "FusionMarkets-Live",         "type": "live"},
    {"broker": "FusionMarkets",    "server": "FusionMarkets-Demo",         "type": "demo"},
    # LiteFinance
    {"broker": "LiteFinance",      "server": "LiteFinance-MT5-Live",       "type": "live"},
    {"broker": "LiteFinance",      "server": "LiteFinance-MT5-Demo",       "type": "demo"},
    # Errante
    {"broker": "Errante",          "server": "ErranteSC-Live",             "type": "live"},
    {"broker": "Errante",          "server": "ErranteSC-Demo",             "type": "demo"},
    {"broker": "Errante",          "server": "ErranteTrading-Live",        "type": "live"},
    {"broker": "Errante",          "server": "ErranteTrading-Demo",        "type": "demo"},
    # AronMarkets
    {"broker": "AronMarkets",      "server": "AronMarkets-MT5",            "type": "live"},
    {"broker": "AronMarkets",      "server": "AronMarkets-Demo",           "type": "demo"},
    # FIBO Group
    {"broker": "FIBO Group",       "server": "FIBOGroup-MT5 Server",       "type": "live"},
    # Orbex
    {"broker": "Orbex",            "server": "OrbexGlobal-Server",         "type": "live"},
    # Combat / Investment Castle / TspFxb / others (single-server brokers)
    {"broker": "Combat Capital",   "server": "CombatCapitalMarkets-Server","type": "live"},
    {"broker": "Investment Castle","server": "InvestmentCastle-Server",    "type": "live"},
    {"broker": "EpicPips",         "server": "EpicPips-Trade",             "type": "live"},
    {"broker": "ePlanet",          "server": "ePlanet-MT5",                "type": "live"},
    {"broker": "GTC Global",       "server": "GTCGlobalTrade-Server",      "type": "live"},
    {"broker": "Omega Finex",      "server": "OmegaFinex-Real",            "type": "live"},
    {"broker": "Pivot Broker",     "server": "PivotBroker-Live",           "type": "live"},
    {"broker": "Propridge",        "server": "PropridgeCapitalMarkets-Server", "type": "live"},
    {"broker": "RavexGlobal",      "server": "RavexGlobal-Live",           "type": "live"},
    {"broker": "MondTrades",       "server": "Mondtrades-Server",          "type": "live"},
    {"broker": "TspFxb",           "server": "TspFxb-Server",              "type": "live"},
    {"broker": "WM Markets",       "server": "WMMarkets-Real1",            "type": "live"},
    {"broker": "WM Markets",       "server": "WMMarkets-Demo",             "type": "demo"},
    {"broker": "UNFXB",            "server": "UNFXB-Real",                 "type": "live"},
    {"broker": "xChief",           "server": "xChief-MT5",                 "type": "live"},
    {"broker": "ZoraCapital",      "server": "ZoraCapital-Server",         "type": "live"},
]

def _broker_server_index() -> Dict[str, dict]:
    return {str(b.get("server", "")).lower(): b for b in CLOUD_BROKER_SERVERS}

def _broker_profile_for_server(server: str) -> dict:
    server = (server or "").strip()
    row = _broker_server_index().get(server.lower())
    if row:
        out = dict(row)
        out.update({
            "platform": "MT5",
            "support_status": "curated",
            "compatibility": "full_pending_login",
            "requires_exact_server": True,
            "notes": "Listed server. Final compatibility is confirmed by worker login, symbol, and trading-permission checks. If login fails, copy the exact server string from MT5/account email and use Custom server.",
        })
        return out
    return {
        "broker": "Custom / unlisted broker",
        "server": server,
        "type": "custom",
        "platform": "MT5",
        "support_status": "custom_review",
        "compatibility": "partial_until_verified",
        "requires_exact_server": True,
        "notes": "Custom MT5 server. This is often required for brokers like Trade.com/TCH where the live server shown in MT5 can differ by account. The worker must verify login, symbol mapping, and trading permissions before copying.",
    }

def _broker_error_hint(raw_error: str) -> str:
    text = str(raw_error or "").lower()
    if not text:
        return ""
    if "initialize" in text or "terminal" in text:
        return "MT5 terminal is not reachable on the executor VPS. Start MT5, install MetaTrader5 Python package, and confirm the terminal can log in."
    if "authorization" in text or "invalid account" in text or "invalid credentials" in text or "authentication" in text:
        return "Invalid MT5 login/password or broker server mismatch. Use the trading password, not investor/read-only password."
    if "server" in text and ("timeout" in text or "not found" in text or "unreachable" in text):
        return "MT5 server not reachable. Check exact live/demo server name and region restrictions."
    if "investor" in text or "read-only" in text or "trade disabled" in text or "trading disabled" in text:
        return "Account connected but trading permission is disabled. Use the master/trading password and enable Algo Trading in MT5."
    if "symbol" in text or "xau" in text or "gold" in text:
        return "Broker uses a different gold symbol or does not stream XAUUSD. Add/select the correct gold symbol in Market Watch."
    if "margin" in text or "money" in text:
        return "Broker/account rejected execution because margin or leverage is insufficient for the requested lot."
    return "Broker rejected the connection or execution. Check exact server, MT5/MT4 mismatch, password type, and account trading permission."

async def _log_broker_event(user_id: str, email: str, event: str, ok: bool,
                            server: str = "", details: Optional[dict] = None):
    try:
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "email": email,
            "event": event,
            "ok": bool(ok),
            "broker_server": server,
            "details": details or {},
            "ts": _utc_now_iso(),
        }
        await db.cloud_broker_logs.insert_one(doc.copy())
        await db.cloud_broker_logs.delete_many({
            "ts": {"$lt": (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()}
        })
    except Exception:
        logger.exception("[cloud-broker-log] failed")

@api_router.get("/cloud/mt5/brokers")
async def cloud_list_brokers():
    """Public: returns curated broker→servers list for the UI search dropdown."""
    servers = []
    seen = set()
    for b in CLOUD_BROKER_SERVERS:
        key = str(b.get("server", "")).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        row = dict(b)
        row.setdefault("platform", "MT5")
        row.setdefault("support_status", "curated")
        row.setdefault("compatibility", "full_pending_login")
        servers.append(row)
    brokers = sorted({b["broker"] for b in servers if b.get("broker")})
    return {"servers": servers, "brokers": brokers, "total": len(servers),
            "notes": "Only MT5-compatible servers are executable today. Broker server names change by account and region; if a listed server fails, use the exact server string from the user's MT5 login screen/account email via Custom server. MT4/cTrader/API brokers must use an MT5 account/server or are unsupported for cloud copy."}

@api_router.get("/cloud/mt5/compatibility")
async def cloud_mt5_compatibility(server: str = ""):
    profile = _broker_profile_for_server(server)
    return {"ok": True, "profile": profile,
            "checks": [
                "MT5 terminal reachable on executor VPS",
                "Exact server name accepted by mt5.login",
                "Trading password is valid, not investor/read-only password",
                "Account trade_allowed and terminal trade_allowed are true",
                "XAUUSD/gold symbol can be resolved and selected",
                "Broker reports lot step/min/max, filling mode, stop level, and live tick",
            ]}

@api_router.post("/cloud/mt5/test-connection")
async def cloud_mt5_test_connection(req: MT5BrokerCheckReq, user: dict = Depends(get_cloud_user)):
    server = (req.broker_server or user.get("broker_server") or "").strip()
    if not user.get("mt5_password_enc") or not user.get("mt5_login") or not server:
        raise HTTPException(status_code=400, detail="Save MT5 credentials before running a broker test.")
    now = _utc_now_iso()
    profile = _broker_profile_for_server(server)
    await db.cloud_users.update_one({"id": user["id"]}, {"$set": {
        "broker_server": server,
        "mt5_verification_status": "pending",
        "mt5_verification_error": "",
        "mt5_connected": False,
        "broker_support_status": profile.get("support_status"),
        "broker_platform": profile.get("platform"),
        "broker_last_check_requested_at": now,
    }})
    await _log_broker_event(user["id"], user.get("email", ""), "manual_test_requested", True, server, profile)
    return {"ok": True, "message": "Broker test queued. The worker will verify login, trading permission, symbol mapping, and latency.", "profile": profile}

@api_router.get("/cloud/mt5/logs")
async def cloud_mt5_logs(limit: int = 30, user: dict = Depends(get_cloud_user)):
    n = max(1, min(int(limit), 100))
    rows = await db.cloud_broker_logs.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("ts", -1).to_list(n)
    return {"logs": rows, "total": len(rows)}

@api_router.post("/cloud/mt5/refresh-balance")
async def cloud_refresh_balance(user: dict = Depends(get_cloud_user)):
    """User-initiated immediate balance refresh. Sets a flag the worker
       picks up on its next poll (≤10s) and pushes a fresh equity-snapshot."""
    if not user.get("mt5_connected") or user.get("mt5_verification_status") != "verified":
        raise HTTPException(status_code=400,
            detail="Connect & verify your MT5 account first — go to the MT5 tab and link your broker login.")

    # Verify a worker is actually alive — otherwise refresh request will sit forever.
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
    online_workers = await db.cloud_workers.count_documents(
        {"status": "online", "last_heartbeat": {"$gt": cutoff}})
    if online_workers == 0:
        raise HTTPException(status_code=503,
            detail="No cloud worker is currently online — your trades + balance updates will resume the moment a worker reconnects. We've been notified.")

    # Light cooldown — prevent spam-clicking from hammering the broker
    last = user.get("last_refresh_request_at")
    now = datetime.now(timezone.utc)
    if last:
        try:
            since = (now - datetime.fromisoformat(last)).total_seconds()
            if since < 10:
                raise HTTPException(status_code=429,
                    detail=f"Please wait {int(10 - since)}s before another refresh.")
        except (ValueError, TypeError): pass
    await db.cloud_users.update_one({"id": user["id"]},
        {"$set": {"force_equity_refresh": True,
                  "last_refresh_request_at": now.isoformat()}})
    return {"ok": True, "message": "Refresh requested. Your balance will update within 10 seconds."}

@api_router.post("/cloud/mt5/disconnect")
async def cloud_disconnect_mt5(user: dict = Depends(get_cloud_user)):
    await db.cloud_users.update_one({"id": user["id"]},
        {"$set": {"mt5_connected": False, "mt5_verification_status": "none"},
         "$unset": {"mt5_password_enc": "", "mt5_login": "", "broker_server": "",
                    "mt5_verification_error": "", "mt5_verified_at": "",
                    "force_equity_refresh": "", "last_refresh_request_at": "",
                    "last_balance": "", "last_equity": "", "last_balance_updated_at": "",
                    "last_equity_ts": "", "account_currency": ""}})
    return {"ok": True, "message": "MT5 credentials removed. Trade execution paused."}

@api_router.post("/cloud/pause")
async def cloud_pause(req: CloudPauseReq, user: dict = Depends(get_cloud_user)):
    await db.cloud_users.update_one({"id": user["id"]}, {"$set": {"paused": bool(req.paused)}})
    return {"ok": True, "paused": bool(req.paused)}

# -------- Dashboard Data --------
@api_router.get("/cloud/dashboard")
async def cloud_dashboard(user: dict = Depends(get_cloud_user)):
    trades_raw = await db.cloud_trades.find({"user_id": user["id"]}, {"_id": 0}).sort("opened_at", -1).limit(500).to_list(500)

    def _num(v, default=0.0):
        try:
            return float(v if v is not None else default)
        except (TypeError, ValueError):
            return float(default)

    def _trade_ts(t):
        return t.get("closed_at") or t.get("opened_at") or ""

    def _calc_profit(t):
        profit = _num(t.get("profit"), 0.0)
        if abs(profit) > 1e-9:
            return profit
        if not (t.get("status") == "closed" or t.get("closed_at")):
            return profit
        lots = _num(t.get("lots"), 0.0)
        entry = _num(t.get("entry"), 0.0)
        exit_px = _num(t.get("exit_price"), 0.0)
        side = str(t.get("side") or "").upper()
        if lots > 0 and entry > 0 and exit_px > 0 and side in ("BUY", "SELL"):
            direction = 1 if side == "BUY" else -1
            return (exit_px - entry) * lots * 100.0 * direction
        return profit

    trades = []
    for t in trades_raw:
        row = dict(t)
        row["lots"] = _num(row.get("lots"), 0.0)
        row["entry"] = _num(row.get("entry"), 0.0)
        row["exit_price"] = _num(row.get("exit_price"), 0.0)
        row["profit"] = _calc_profit(row)
        trades.append(row)
    trades.sort(key=_trade_ts, reverse=True)
    completed = [t for t in trades if t.get("status") == "closed" or t.get("closed_at")]
    totals = {"total_trades": len(trades),
              "completed_trades": len(completed),
              "wins": sum(1 for t in completed if float(t.get("profit") or 0) > 0),
              "losses": sum(1 for t in completed if float(t.get("profit") or 0) < 0),
              "net_pnl": sum(float(t.get("profit") or 0) for t in completed)}
    trades = trades[:50]
    # equity curve data (last 30 days aggregated daily)
    equity = []
    try:
        since = datetime.now(timezone.utc) - timedelta(days=30)
        cursor = db.cloud_equity_snapshots.find({"user_id": user["id"], "ts": {"$gte": since.isoformat()}}, {"_id": 0}).sort("ts", 1)
        equity = await cursor.to_list(2000)
    except Exception: pass
    # Live executor status — surface to user so they can SEE if cloud is reachable
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
    workers_online = await db.cloud_workers.count_documents(
        {"status": "online", "last_heartbeat": {"$gt": cutoff}})
    # When was this user's balance last actually pushed by a worker?
    last_eq_at = ""
    try:
        latest = await db.cloud_equity_snapshots.find_one(
            {"user_id": user["id"]}, {"_id": 0, "ts": 1}, sort=[("ts", -1)])
        if latest: last_eq_at = latest.get("ts", "")
    except Exception: pass

    return {"trades": trades, "totals": totals, "equity": equity,
            "mt5_connected": user.get("mt5_connected", False),
            "mt5_verification_status": user.get("mt5_verification_status", "none"),
            "mt5_verification_error":  user.get("mt5_verification_error", ""),
            "mt5_verified_at":         user.get("mt5_verified_at", ""),
            "broker_server": user.get("broker_server", ""),
            "mt5_login": user.get("mt5_login", ""),
            "risk_tier": user.get("risk_tier", "balanced"),
            "last_balance": user.get("last_balance", 0),
            "last_equity":  user.get("last_equity", 0),
            "last_balance_updated_at": last_eq_at,   # NEW
            "executor_online": workers_online > 0,    # NEW
            "executor_count":  workers_online,        # NEW
            "account_currency": user.get("account_currency", ""),
            "paused": user.get("paused", False),
            "plan": user.get("plan", "starter"),
            "status": user.get("status", "trial")}

# -------- Payments (user submits proof; admin approves) --------
@api_router.post("/cloud/payments/submit")
async def cloud_submit_payment(req: PaymentSubmitReq, user: dict = Depends(get_cloud_user)):
    plans = await _get_effective_plans()
    if req.plan not in plans:
        raise HTTPException(status_code=400, detail="Unknown plan")
    if req.method not in ("crypto", "bank"):
        raise HTTPException(status_code=400, detail="Invalid method (use crypto or bank)")
    ref = (req.reference or "").strip()
    if len(ref) < 4:
        raise HTTPException(status_code=400, detail="Transaction reference is required (min 4 chars)")
    # Bank-transfer payments must include an image proof
    if req.method == "bank":
        proof = (req.proof_image or "").strip()
        if not proof.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="Bank transfer requires a screenshot of your transfer (image upload).")
        # rough size limit ~5 MB after base64 (~6.7 MB string)
        if len(proof) > 7_000_000:
            raise HTTPException(status_code=400, detail="Proof image too large (max 5 MB).")
    # Expected price validation — prevent tampered low amounts (admin-overridable plans)
    expected_price = float(plans[req.plan].get("price_usd", 0))
    if abs(float(req.amount_usd) - expected_price) > 0.01:
        raise HTTPException(status_code=400, detail=f"Amount must be ${expected_price} for {req.plan} plan")
    # Block a second pending payment from the same user (prevent spam)
    existing_pending = await db.cloud_payments.find_one({"user_id": user["id"], "status": "pending"})
    if existing_pending:
        raise HTTPException(status_code=400, detail="You already have a payment pending review. Please wait or contact support.")
    doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "email": user["email"],
           "plan": req.plan, "method": req.method, "amount_usd": float(req.amount_usd),
           "paid_currency": (req.paid_currency or "USD").upper(),
           "paid_amount_local": float(req.paid_amount_local or 0.0),
           "reference": ref, "notes": (req.notes or "").strip(),
           "proof_image": req.proof_image or "",
           "status": "pending", "submitted_at": datetime.now(timezone.utc).isoformat(),
           "approved_at": None, "approved_by": None}
    await db.cloud_payments.insert_one(doc.copy())
    doc.pop("_id", None)
    return {"ok": True, "payment_id": doc["id"], "message": "Payment submitted. Admin will verify and activate your subscription within 24 hours."}

@api_router.get("/cloud/payments/my")
async def cloud_my_payments(user: dict = Depends(get_cloud_user)):
    rows = await db.cloud_payments.find({"user_id": user["id"]}, {"_id": 0}).sort("submitted_at", -1).to_list(50)
    return {"payments": rows}

# -------- Admin endpoints --------
@api_router.get("/admin/cloud/users", dependencies=[Depends(get_current_admin)])
async def admin_cloud_users():
    rows = await db.cloud_users.find(
        {}, {"_id": 0, "password_hash": 0, "mt5_password_enc": 0}
    ).sort("created_at", -1).limit(500).to_list(500)
    return {"users": rows, "total": len(rows)}

@api_router.get("/admin/cloud/stats", dependencies=[Depends(get_current_admin)])
async def admin_cloud_stats():
    plans = await _get_effective_plans()
    total = await db.cloud_users.count_documents({})
    trial = await db.cloud_users.count_documents({"status": "trial"})
    active = await db.cloud_users.count_documents({"status": "active"})
    connected = await db.cloud_users.count_documents({"mt5_connected": True})
    pending_pays = await db.cloud_payments.count_documents({"status": "pending"})
    # MRR estimate, honoring per-user custom_price_usd overrides
    active_users = await db.cloud_users.find({"status": "active"},
        {"_id": 0, "plan": 1, "custom_price_usd": 1}).to_list(10000)
    mrr = 0.0
    for u in active_users:
        cp = u.get("custom_price_usd")
        mrr += float(cp) if cp else float(plans.get(u.get("plan", "starter"), {}).get("price_usd", 0))
    return {"total_users": total, "trial_users": trial, "active_users": active,
            "mt5_connected": connected, "pending_payments": pending_pays, "mrr_usd": mrr}

@api_router.get("/admin/cloud/payments", dependencies=[Depends(get_current_admin)])
async def admin_cloud_payments(status: Optional[str] = None):
    q = {} if not status else {"status": status}
    rows = await db.cloud_payments.find(q, {"_id": 0}).sort("submitted_at", -1).limit(500).to_list(500)
    return {"payments": rows}

@api_router.post("/admin/cloud/payments/{payment_id}/approve")
async def admin_approve_payment(payment_id: str, admin: dict = Depends(get_current_admin)):
    pay = await db.cloud_payments.find_one({"id": payment_id}, {"_id": 0})
    if not pay: raise HTTPException(status_code=404, detail="Payment not found")
    if pay["status"] != "pending": raise HTTPException(status_code=400, detail=f"Already {pay['status']}")
    plan = pay["plan"]
    # extend subscription 30 days from NOW (or from current end if still active)
    user = await db.cloud_users.find_one({"id": pay["user_id"]}, {"_id": 0})
    if not user: raise HTTPException(status_code=404, detail="User not found")
    now = datetime.now(timezone.utc)
    curr_end = now
    try:
        ends = user.get("subscription_ends_at")
        if ends:
            ce = datetime.fromisoformat(ends.replace("Z", "+00:00"))
            if ce > now: curr_end = ce
    except Exception: pass
    new_end = curr_end + timedelta(days=30)
    await db.cloud_users.update_one({"id": pay["user_id"]},
        {"$set": {"status": "active", "plan": plan,
                  "subscription_ends_at": new_end.isoformat()}})
    await db.cloud_payments.update_one({"id": payment_id},
        {"$set": {"status": "approved", "approved_at": now.isoformat(), "approved_by": admin.get("email", "admin")}})
    return {"ok": True, "new_subscription_ends_at": new_end.isoformat()}

@api_router.post("/admin/cloud/payments/{payment_id}/reject")
async def admin_reject_payment(payment_id: str, admin: dict = Depends(get_current_admin)):
    r = await db.cloud_payments.update_one({"id": payment_id, "status": "pending"},
        {"$set": {"status": "rejected", "approved_at": datetime.now(timezone.utc).isoformat(),
                  "approved_by": admin.get("email", "admin")}})
    if not r.matched_count: raise HTTPException(status_code=404, detail="Not found or already processed")
    return {"ok": True}

@api_router.get("/admin/cloud/settings", dependencies=[Depends(get_current_admin)])
async def admin_cloud_get_settings():
    s = await _get_cloud_settings()
    # v5.1.4: always return MERGED effective plans + fx_rates so the admin form
    # auto-populates with real defaults instead of empty fields. Without this,
    # if a previous save partially overrode plans, the form shows blanks for
    # the un-saved keys and the admin accidentally clobbers them to $0 on next save.
    s["plans"] = await _get_effective_plans()
    s["fx_rates"] = await _get_fx_rates()
    return s

# v5.1.4: validate plan saves so admin can't accidentally write a $0 price.
def _validate_plans_payload(plans: dict):
    if not isinstance(plans, dict): return
    for pid, p in plans.items():
        if not isinstance(p, dict): continue
        price = p.get("price_usd")
        if price is None: continue  # admin partial-update is OK
        try: pf = float(price)
        except Exception:
            raise HTTPException(status_code=400, detail=f"{pid}: price_usd must be a number")
        if pf <= 0:
            raise HTTPException(status_code=400, detail=f"{pid} plan price must be > $0 (got ${pf}). Refusing to save.")
        name = p.get("name")
        if name is not None and not str(name).strip():
            raise HTTPException(status_code=400, detail=f"{pid} plan name cannot be empty.")

class CloudSettingsUpdate(BaseModel):
    crypto_wallets: Optional[list] = None
    bank_accounts: Optional[list] = None
    fiat_paystack_enabled: Optional[bool] = None
    telegram_alerts_enabled: Optional[bool] = None
    master_ea_status: Optional[str] = None
    plans: Optional[dict] = None        # {"starter":{"price_usd":50,...}, ...}
    fx_rates: Optional[dict] = None     # {"NGN":1650, "KES":130, ...}

@api_router.put("/admin/cloud/settings", dependencies=[Depends(get_current_admin)])
async def admin_cloud_update_settings(req: CloudSettingsUpdate):
    upd = {k: v for k, v in req.model_dump().items() if v is not None}
    if not upd: return {"ok": True, "unchanged": True}
    if "plans" in upd:
        _validate_plans_payload(upd["plans"])
    await db.cloud_settings.update_one({"key": "main"}, {"$set": upd}, upsert=True)
    return {"ok": True}

# -------- Admin: per-user pricing override --------
class UserPlanOverrideReq(BaseModel):
    user_id: str
    plan: Optional[str] = None          # change plan for this user
    custom_price_usd: Optional[float] = None  # 0 or null = use plan default
    extend_days: Optional[int] = None   # +N days onto subscription_ends_at

@api_router.post("/admin/cloud/users/override", dependencies=[Depends(get_current_admin)])
async def admin_user_override(req: UserPlanOverrideReq):
    user = await db.cloud_users.find_one({"id": req.user_id}, {"_id": 0})
    if not user: raise HTTPException(status_code=404, detail="User not found")
    set_doc: dict = {}
    if req.plan:
        plans = await _get_effective_plans()
        if req.plan not in plans:
            raise HTTPException(status_code=400, detail=f"Unknown plan '{req.plan}'")
        set_doc["plan"] = req.plan
    if req.custom_price_usd is not None:
        set_doc["custom_price_usd"] = float(req.custom_price_usd) if req.custom_price_usd > 0 else None
    if req.extend_days and req.extend_days > 0:
        now = datetime.now(timezone.utc)
        curr = now
        try:
            ends = user.get("subscription_ends_at")
            if ends:
                ce = datetime.fromisoformat(ends.replace("Z", "+00:00"))
                if ce > now: curr = ce
        except Exception: pass
        set_doc["subscription_ends_at"] = (curr + timedelta(days=int(req.extend_days))).isoformat()
        set_doc["status"] = "active"
    if not set_doc:
        return {"ok": True, "unchanged": True}
    await db.cloud_users.update_one({"id": req.user_id}, {"$set": set_doc})
    return {"ok": True, "set": set_doc}

# -------- Worker Agent Endpoints (used by VPS workers, protected by secret) --------
#  Workers poll /cloud/agent/pending-users to get credentials for users they should
#  manage, and push trade results to /cloud/agent/trade-close. Authenticated with
#  a shared secret stored in cloud_settings (admin can rotate via UI).
async def _get_agent_token():
    s = await _get_cloud_settings()
    # Fall back to env var for backwards compat
    return s.get("agent_token") or os.environ.get("CLOUD_AGENT_TOKEN", "")

async def _require_agent_async(request: Request):
    tok = await _get_agent_token()
    if not tok:
        raise HTTPException(status_code=503, detail="Agent token not configured. Admin must generate one in /admin → Cloud → Infrastructure.")
    hdr = request.headers.get("X-Agent-Token", "")
    if hdr != tok:
        raise HTTPException(status_code=403, detail="Bad agent token")

# Legacy sync wrapper (deprecated, kept for internal callers)
def _require_agent(request: Request):
    hdr = request.headers.get("X-Agent-Token", "")
    # This sync path only accepts env-configured token — async path is preferred
    env_tok = os.environ.get("CLOUD_AGENT_TOKEN", "")
    if env_tok and hdr == env_tok: return
    raise HTTPException(status_code=403, detail="Use async agent path")

# -------- Admin: Infrastructure (VPS workers) --------
class WorkerRegisterReq(BaseModel):
    name: str
    endpoint: Optional[str] = ""      # optional URL if worker runs a reachable HTTP server
    max_users: int = 1
    notes: Optional[str] = ""

@api_router.get("/admin/cloud/infrastructure", dependencies=[Depends(get_current_admin)])
async def admin_infra_list():
    workers = await db.cloud_workers.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    s = await _get_cloud_settings()
    # compute per-worker usage
    for w in workers:
        w["current_users"] = await db.cloud_users.count_documents({"assigned_worker_id": w["id"], "mt5_connected": True})
    total_capacity = sum(w.get("max_users", 30) for w in workers)
    assigned = await db.cloud_users.count_documents({"assigned_worker_id": {"$exists": True, "$ne": None}, "mt5_connected": True})
    unassigned = await db.cloud_users.count_documents({"mt5_connected": True, "assigned_worker_id": {"$in": [None, ""]}})
    return {"workers": workers, "total_capacity": total_capacity, "assigned_users": assigned,
            "unassigned_users": unassigned,
            "shadow_mode": s.get("shadow_mode", True),
            "agent_token_preview": (s.get("agent_token", "") or "")[:8] + "…" if s.get("agent_token") else "",
            "master_ea_status": s.get("master_ea_status", "unknown"),
            "master_last_heartbeat": s.get("master_last_heartbeat")}

@api_router.post("/admin/cloud/infrastructure/workers", dependencies=[Depends(get_current_admin)])
async def admin_infra_add_worker(req: WorkerRegisterReq):
    wid = str(uuid.uuid4())
    doc = {"id": wid, "name": req.name.strip(), "endpoint": (req.endpoint or "").strip(),
           "max_users": max(1, int(req.max_users)), "notes": req.notes or "",
           "status": "offline", "last_heartbeat": None,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.cloud_workers.insert_one(doc.copy())
    return {"ok": True, "worker_id": wid}

@api_router.delete("/admin/cloud/infrastructure/workers/{worker_id}", dependencies=[Depends(get_current_admin)])
async def admin_infra_remove_worker(worker_id: str):
    # Unassign any users on this worker
    await db.cloud_users.update_many({"assigned_worker_id": worker_id}, {"$unset": {"assigned_worker_id": ""}})
    r = await db.cloud_workers.delete_one({"id": worker_id})
    if not r.deleted_count: raise HTTPException(status_code=404, detail="Worker not found")
    return {"ok": True}

@api_router.post("/admin/cloud/infrastructure/rotate-token", dependencies=[Depends(get_current_admin)])
async def admin_rotate_agent_token():
    new_tok = secrets.token_hex(32)
    await db.cloud_settings.update_one({"key": "main"}, {"$set": {"agent_token": new_tok}}, upsert=True)
    return {"ok": True, "token": new_tok, "message": "New agent token generated. Paste into each VPS worker config."}

# --- One-shot pairing code: admin generates code → worker exchanges for full config ---
@api_router.post("/admin/cloud/infrastructure/pair-code", dependencies=[Depends(get_current_admin)])
async def admin_generate_pair_code(body: dict = None):
    """Generate a 6-digit pairing code (TTL 10 min). The worker enters this code
       on first run and auto-receives agent_token + a fresh worker_id."""
    body = body or {}
    name = (body.get("name") or "Auto-paired worker").strip()[:60]
    max_users = max(1, min(500, int(body.get("max_users") or 1)))
    code = "".join([str(secrets.randbelow(10)) for _ in range(6)])
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db.cloud_pair_codes.insert_one({
        "code": code,
        "expires_at": expires.isoformat(),
        "consumed": False,
        "worker_name": name,
        "max_users": max_users,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"code": code, "expires_at": expires.isoformat(),
            "ttl_minutes": 10,
            "message": f"Code: {code} (valid for 10 min). Run the installer and paste this code."}

class PairExchangeReq(BaseModel):
    code: str
    hostname: Optional[str] = ""

@api_router.post("/cloud/agent/pair")
async def cloud_agent_pair(req: PairExchangeReq):
    """Public — exchange a 6-digit pair code for full worker config.
       This is the ONLY agent endpoint that doesn't require X-Agent-Token."""
    code = (req.code or "").strip()
    if not code or not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="Code must be 6 digits.")
    rec = await db.cloud_pair_codes.find_one({"code": code, "consumed": False}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Invalid or already-used code.")
    try:
        exp = datetime.fromisoformat(rec["expires_at"])
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(status_code=410, detail="Code expired. Ask admin for a new one.")
    except (ValueError, KeyError):
        raise HTTPException(status_code=500, detail="Code metadata corrupt")
    # Make sure an agent_token exists (auto-rotate if missing)
    s = await _get_cloud_settings()
    agent_token = s.get("agent_token") or ""
    if not agent_token:
        agent_token = secrets.token_hex(32)
        await db.cloud_settings.update_one({"key": "main"},
            {"$set": {"agent_token": agent_token}}, upsert=True)
    # Auto-create a worker
    wid = str(uuid.uuid4())
    name = rec.get("worker_name") or "Auto-paired worker"
    if req.hostname:
        name = f"{name} ({req.hostname[:30]})"
    await db.cloud_workers.insert_one({
        "id": wid, "name": name[:80], "endpoint": "",
        "max_users": rec.get("max_users", 1), "notes": "Created via pair code",
        "status": "offline", "last_heartbeat": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # Mark the code consumed
    await db.cloud_pair_codes.update_one({"code": code},
        {"$set": {"consumed": True, "consumed_at": datetime.now(timezone.utc).isoformat(),
                  "consumed_worker_id": wid}})
    # Determine the canonical cloud URL — must be the actual public URL clients hit
    cloud_url = os.environ.get("CLOUD_PUBLIC_URL") or os.environ.get("REACT_APP_BACKEND_URL") or ""
    return {"ok": True,
            "cloud_url": cloud_url,
            "agent_token": agent_token,
            "worker_id": wid,
            "worker_name": name,
            "message": "Paired. Save the .env and start the worker."}

@api_router.post("/admin/cloud/infrastructure/shadow-mode", dependencies=[Depends(get_current_admin)])
async def admin_toggle_shadow(body: dict):
    enabled = bool(body.get("enabled", True))
    await db.cloud_settings.update_one({"key": "main"}, {"$set": {"shadow_mode": enabled}}, upsert=True)
    return {"ok": True, "shadow_mode": enabled,
            "message": ("SHADOW MODE ON — signals are simulated in dashboards, no real trades placed."
                        if enabled else "LIVE MODE — workers will execute real trades on connected accounts.")}

# --- Admin test: fire a synthetic signal and watch it fan out ---
class TestSignalReq(BaseModel):
    side: str = "BUY"
    slDistDollars: float = 4.0
    tpMultR: float = 4.0
    auto_close_seconds: int = 5
    exit_rMult: float = 3.0

@api_router.post("/admin/cloud/infrastructure/test-signal", dependencies=[Depends(get_current_admin)])
async def admin_test_signal(req: TestSignalReq):
    """Manually fire a signal as if master EA had fired it. Fans out per-user
       sized to THEIR balance + tier. Auto-closes after N seconds so admin can
       see the full lifecycle end-to-end in the user dashboard."""
    entry = 4567.50
    side = req.side.upper()
    if side not in ("BUY","SELL"):
        raise HTTPException(status_code=400, detail="side must be BUY or SELL")
    if req.slDistDollars <= 0:
        raise HTTPException(status_code=400, detail="slDistDollars must be > 0")
    sl = (entry - req.slDistDollars) if side == "BUY" else (entry + req.slDistDollars)
    tp = (entry + req.slDistDollars * req.tpMultR) if side == "BUY" else (entry - req.slDistDollars * req.tpMultR)
    now = datetime.now(timezone.utc)
    await db.cloud_settings.update_one({"key":"main"},
        {"$set":{"master_last_heartbeat": now.isoformat(), "master_ea_status": "online"}}, upsert=True)
    sig_id = str(uuid.uuid4())
    await db.cloud_signals.insert_one({"id": sig_id, "symbol":"XAUUSD","side":side,
        "entry":entry,"sl":sl,"tp":tp,"grade":"A+","ts": now.isoformat(), "test": True})
    users = await db.cloud_users.find(
        {"mt5_connected": True, "paused": False, "status": {"$in": ["trial","active"]}},
        {"_id": 0, "id": 1, "email": 1, "last_balance": 1, "risk_tier": 1}
    ).to_list(2000)
    risk_map = {"conservative": 0.6, "balanced": 1.2, "aggressive": 2.0}
    fanout = []
    for u in users:
        bal = float(u.get("last_balance") or 1000)
        rpct = risk_map.get(u.get("risk_tier","balanced"), 1.2)
        riskUSD = bal * rpct / 100
        lots = max(0.01, round(riskUSD / (req.slDistDollars * 100), 2))
        trade = {"id": str(uuid.uuid4()), "user_id": u["id"], "signal_id": sig_id,
                 "symbol":"XAUUSD","side":side,"lots":lots,"entry":entry,
                 "exit_price":0,"profit":0,"status":"shadow_open",
                 "opened_at":now.isoformat(),"closed_at":None,
                 "shadow":True,"grade":"A+","test":True}
        await db.cloud_shadow_trades.insert_one(trade.copy())
        fanout.append({"email": u["email"], "balance": bal,
                       "tier": u.get("risk_tier","balanced"),
                       "risk_usd": round(riskUSD, 2), "lots": lots})
    if req.auto_close_seconds > 0:
        import asyncio
        async def _auto_close():
            await asyncio.sleep(req.auto_close_seconds)
            move = req.slDistDollars * req.exit_rMult
            exit_price = (entry + move) if side == "BUY" else (entry - move)
            trades = await db.cloud_shadow_trades.find({"signal_id": sig_id, "status":"shadow_open"},
                                                       {"_id":0}).to_list(5000)
            t_now = datetime.now(timezone.utc)
            for t in trades:
                diff = (exit_price - t["entry"]) if side == "BUY" else (t["entry"] - exit_price)
                profit = round(diff * t["lots"] * 100, 2)
                await db.cloud_shadow_trades.update_one({"id": t["id"]},
                    {"$set":{"status":"shadow_closed","exit_price":exit_price,
                             "profit":profit,"closed_at":t_now.isoformat(),
                             "reason":f"TEST @{req.exit_rMult}R"}})
                doc = dict(t); doc["id"] = str(uuid.uuid4()); doc["exit_price"] = exit_price
                doc["profit"] = profit; doc["closed_at"] = t_now.isoformat()
                doc["reason"] = f"TEST @{req.exit_rMult}R"
                await db.cloud_trades.insert_one(doc)
        asyncio.create_task(_auto_close())
    return {"ok": True, "signal_id": sig_id, "fanout": fanout,
            "entry": entry, "sl": sl, "tp": tp,
            "message": f"Test signal fired — {len(fanout)} users received it, each sized to THEIR OWN balance + tier. Auto-close in {req.auto_close_seconds}s at +{req.exit_rMult}R."}


# Auto-assign a user to the first worker with free capacity
async def _auto_assign_worker(user_id: str):
    workers = await db.cloud_workers.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    for w in workers:
        count = await db.cloud_users.count_documents({"assigned_worker_id": w["id"], "mt5_connected": True})
        if count < w.get("max_users", 30):
            await db.cloud_users.update_one({"id": user_id}, {"$set": {"assigned_worker_id": w["id"]}})
            return w["id"]
    return None

# -------- SHADOW MODE: master signals fan out to all subscribers as simulated trades --------
class MasterSignalReq(BaseModel):
    symbol: str
    side: str                    # BUY | SELL
    entry: float
    sl: float
    tp: float
    grade: Optional[str] = ""    # A+ / A / B
    risk_hint_pct: Optional[float] = 1.2   # master-side risk %, bot-provided
    # v1.3 — STRICT MIRROR fields. The master EA now ships its own actual lots
    # + account balance so cloud users mirror the master 1:1, scaled only by
    # balance ratio. No independent risk math on the cloud side anymore.
    master_lots: Optional[float] = 0.0
    master_balance: Optional[float] = 0.0
    master_ticket: Optional[str] = ""   # optional future EA idempotency anchor

def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, str):
            value = value.replace(",", "").replace(" ", "").strip()
            if not value:
                return default
        return float(value)
    except Exception:
        return default

def _cloud_signal_dedupe_key(req: MasterSignalReq) -> str:
    symbol = (req.symbol or "XAUUSD").upper().strip()
    side = (req.side or "").upper().strip()
    ticket = str(req.master_ticket or "").strip()
    if ticket:
        return f"ticket:{symbol}:{ticket}"
    entry = round(_safe_float(req.entry), 1)
    sl = round(_safe_float(req.sl), 1)
    tp = round(_safe_float(req.tp), 1)
    lots = round(_safe_float(req.master_lots), 2)
    grade = (req.grade or "").upper().strip()
    return f"sig:{symbol}:{side}:e{entry}:sl{sl}:tp{tp}:l{lots}:g{grade}"

@api_router.post("/cloud/master/signal")
async def cloud_master_signal(req: MasterSignalReq, request: Request):
    """Called by the master EA (or bot) whenever a new signal fires.
       If shadow_mode is ON → create simulated trade rows for every active user.
       If OFF → also broadcast to workers for real execution (workers poll)."""
    await _require_agent_async(request)
    now = datetime.now(timezone.utc)
    try:
        s = await _get_cloud_settings()
        raw_shadow = s.get("shadow_mode", True)
        shadow = raw_shadow if isinstance(raw_shadow, bool) else str(raw_shadow).lower() not in ("0", "false", "off", "no")
        await db.cloud_settings.update_one({"key": "main"},
            {"$set": {"master_last_heartbeat": now.isoformat(), "master_ea_status": "online"}}, upsert=True)
        dedupe_key = _cloud_signal_dedupe_key(req)
        retry_cutoff = (now - timedelta(seconds=90)).isoformat()
        existing_signal = await db.cloud_signals.find_one(
            {"dedupe_key": dedupe_key, "ts": {"$gt": retry_cutoff}, "closed_at": {"$in": [None, ""]}},
            {"_id": 0}
        )
        if existing_signal:
            logger.warning("[cloud-master-signal] duplicate retry suppressed key=%s existing=%s",
                           dedupe_key, existing_signal.get("id"))
            return {"ok": True, "signal_id": existing_signal.get("id"), "shadow": shadow,
                    "fanout_users": 0, "deduped": True,
                    "message": "duplicate master signal suppressed"}
        sig_id = str(uuid.uuid4())
        signal_doc = {"id": sig_id, "symbol": req.symbol, "side": req.side, "entry": _safe_float(req.entry),
                      "sl": _safe_float(req.sl), "tp": _safe_float(req.tp), "grade": req.grade, "ts": now.isoformat(),
                      "dedupe_key": dedupe_key, "master_ticket": str(req.master_ticket or ""),
                      # v1.3 STRICT MIRROR — propagate master lots + balance so workers
                      # compute linkedLot = (userBalance / masterBalance) × masterLot.
                      "master_lots": _safe_float(req.master_lots),
                      "master_balance": _safe_float(req.master_balance)}
        await db.cloud_signals.insert_one(signal_doc.copy())
    except Exception as e:
        logger.exception("[cloud-master-signal] CRITICAL: failed before signal could be stored")
        raise HTTPException(status_code=500, detail=f"master signal store failed: {type(e).__name__}: {e}")

    fanout = 0
    fanout_errors = []
    if shadow:
        # For every active, non-paused, connected user: create a simulated trade
        try:
            users = await db.cloud_users.find(
                {"mt5_connected": True, "paused": False, "status": {"$in": ["trial","active"]}},
                {"_id": 0, "id": 1, "last_balance": 1, "risk_tier": 1}
            ).to_list(2000)
        except Exception as e:
            users = []
            fanout_errors.append(f"user query failed: {type(e).__name__}: {e}")
            logger.exception("[cloud-master-signal] shadow user query failed for signal %s", sig_id)
        master_lots = _safe_float(req.master_lots)
        master_bal  = _safe_float(req.master_balance)
        risk_map = {"conservative": 0.6, "balanced": 1.2, "aggressive": 2.0}
        for u in users:
            try:
                user_id = u.get("id")
                if not user_id:
                    fanout_errors.append("user row missing id")
                    continue
                bal = _safe_float(u.get("last_balance"), 1000.0)
                if master_lots > 0 and master_bal > 0:
                    # STRICT MIRROR — exact copy when balances match, scaled when they differ.
                    lots = max(0.01, round((bal / master_bal) * master_lots, 2))
                else:
                    # Legacy fallback for old EAs that don't ship master_lots.
                    rpct = risk_map.get(u.get("risk_tier","balanced"), 1.2)
                    slDist = abs(_safe_float(req.entry) - _safe_float(req.sl))
                    if slDist <= 0:
                        fanout_errors.append(f"{user_id}: zero SL distance")
                        continue
                    riskUSD = bal * rpct / 100
                    lots = max(0.01, round(riskUSD / (slDist * 100), 2))
                trade = {"id": str(uuid.uuid4()), "user_id": user_id, "signal_id": sig_id,
                         "symbol": req.symbol, "side": req.side, "lots": lots,
                         "entry": _safe_float(req.entry), "exit_price": 0, "profit": 0,
                         "status": "shadow_open",
                         "opened_at": now.isoformat(), "closed_at": None,
                         "shadow": True, "grade": req.grade}
                await db.cloud_shadow_trades.insert_one(trade.copy())
                fanout += 1
            except Exception as e:
                fanout_errors.append(f"{u.get('id','unknown')}: {type(e).__name__}: {e}")
                logger.exception("[cloud-master-signal] shadow fanout failed for signal %s user=%s", sig_id, u.get("id"))
    return {"ok": True, "signal_id": sig_id, "shadow": shadow, "fanout_users": fanout,
            "fanout_errors": fanout_errors[:10]}

class MasterSignalCloseReq(BaseModel):
    signal_id: str
    exit_price: float
    reason: Optional[str] = ""

class MasterSignalPartialReq(BaseModel):
    signal_id: str
    exit_price: float
    close_percent: float = 50.0
    reason: Optional[str] = ""

@api_router.post("/cloud/master/signal-close")
async def cloud_master_close(req: MasterSignalCloseReq, request: Request):
    await _require_agent_async(request)
    sig = await db.cloud_signals.find_one({"id": req.signal_id}, {"_id": 0})
    if not sig: raise HTTPException(status_code=404, detail="Signal not found")
    now = datetime.now(timezone.utc)
    # v1.4.7 — UPDATE cloud_signals FIRST. This is the single source of truth
    # for "is the master signal closed?". The worker's reconciler reads this,
    # the orphan-detector reads this, the closed-signals feed reads this.
    # Previously we only touched shadow_trades, which led to disappearing
    # closes if no shadow row existed (race A: close before fan-out).
    await db.cloud_signals.update_one(
        {"id": req.signal_id},
        {"$set": {"closed_at": now.isoformat(),
                  "exit_price": req.exit_price,
                  "close_reason": req.reason or ""}}
    )
    # Close all shadow trades attached to this signal
    trades = await db.cloud_shadow_trades.find({"signal_id": req.signal_id, "status": "shadow_open"},
                                               {"_id": 0}).to_list(5000)
    closed = 0
    for t in trades:
        # P&L math: (exit - entry) for buy, (entry - exit) for sell; $100/lot/pt (XAUUSD)
        diff = (req.exit_price - t["entry"]) if t["side"].upper() == "BUY" else (t["entry"] - req.exit_price)
        profit = round(diff * t["lots"] * 100, 2)
        await db.cloud_shadow_trades.update_one({"id": t["id"]},
            {"$set": {"status": "shadow_closed", "exit_price": req.exit_price,
                      "profit": profit, "closed_at": now.isoformat(), "reason": req.reason}})
        # ALSO write into cloud_trades so the user dashboard shows it
        doc = dict(t); doc["id"] = str(uuid.uuid4()); doc["exit_price"] = req.exit_price
        doc["profit"] = profit; doc["closed_at"] = now.isoformat(); doc["reason"] = req.reason or "Shadow close"
        await db.cloud_trades.insert_one(doc)
        closed += 1
    return {"ok": True, "closed": closed, "signal_marked_closed": True}

@api_router.post("/cloud/master/signal-partial")
async def cloud_master_partial(req: MasterSignalPartialReq, request: Request):
    await _require_agent_async(request)
    sig = await db.cloud_signals.find_one({"id": req.signal_id}, {"_id": 0})
    if not sig:
        raise HTTPException(status_code=404, detail="Signal not found")
    pct = max(1.0, min(float(req.close_percent or 0.0), 99.0))
    now = datetime.now(timezone.utc)
    event = {
        "id": str(uuid.uuid4()),
        "signal_id": req.signal_id,
        "exit_price": float(req.exit_price or 0.0),
        "close_percent": pct,
        "reason": req.reason or "master partial close",
        "ts": now.isoformat(),
    }
    await db.cloud_signal_partials.insert_one(event.copy())
    await db.cloud_signals.update_one(
        {"id": req.signal_id},
        {"$set": {"last_partial_at": now.isoformat(), "last_partial_percent": pct,
                  "last_partial_exit_price": float(req.exit_price or 0.0)}}
    )
    return {"ok": True, "partial_id": event["id"], "signal_id": req.signal_id, "close_percent": pct}

# Master heartbeat (so admin can see if the master EA is alive even without signals)
@api_router.post("/cloud/master/heartbeat")
async def cloud_master_heartbeat(request: Request):
    await _require_agent_async(request)
    await db.cloud_settings.update_one({"key": "main"},
        {"$set": {"master_last_heartbeat": datetime.now(timezone.utc).isoformat(),
                  "master_ea_status": "online"}}, upsert=True)
    return {"ok": True}

# v5.1.8 — Bot trading-mode preset (admin switcher).
# Master EA polls /cloud/master/config every minute; admin can change which mode
# is active from the admin panel without touching MT5 inputs.
BOT_MODE_PRESETS = {
    "conservative": {
        "label": "Conservative",
        "description": "Fewer but cleaner trades. Higher win-rate, smaller drawdowns. Best for quiet markets or after losses.",
        "gradeB": 3.0,
        "scoreFloor": 0.55,
        "contextTF": 16388,      # PERIOD_H4 (MQL5 enum value)
        "useHTFBias": True,
        "adaptiveTighten": True,
    },
    "balanced": {
        "label": "Balanced",
        "description": "Default mode. M30 trend alignment, mid-range score threshold. Today's v5.1.7 baseline.",
        "gradeB": 2.5,
        "scoreFloor": 0.65,
        "contextTF": 30,         # PERIOD_M30
        "useHTFBias": True,
        "adaptiveTighten": False,
    },
    "aggressive": {
        "label": "Aggressive",
        "description": "Trade more often. Lower threshold, no HTF alignment required. Best for trending sessions.",
        "gradeB": 2.0,
        "scoreFloor": 0.75,
        "contextTF": 30,
        "useHTFBias": False,
        "adaptiveTighten": False,
    },
}

class BotModeReq(BaseModel):
    mode: str  # conservative | balanced | aggressive

@api_router.get("/admin/cloud/bot-mode", dependencies=[Depends(get_current_admin)])
async def admin_get_bot_mode():
    s = await _get_cloud_settings()
    current = s.get("bot_mode", "balanced")
    return {"current": current, "presets": BOT_MODE_PRESETS,
            "set_at": s.get("bot_mode_set_at", "")}

@api_router.post("/admin/cloud/bot-mode", dependencies=[Depends(get_current_admin)])
async def admin_set_bot_mode(req: BotModeReq):
    if req.mode not in BOT_MODE_PRESETS:
        raise HTTPException(status_code=400, detail=f"Unknown mode '{req.mode}'. Valid: {list(BOT_MODE_PRESETS)}")
    await db.cloud_settings.update_one({"key": "main"},
        {"$set": {"bot_mode": req.mode,
                  "bot_mode_set_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"ok": True, "mode": req.mode, "preset": BOT_MODE_PRESETS[req.mode]}

# Master EA polls this every ~60s to pick up admin-changed mode without restart.
@api_router.get("/cloud/master/config")
async def cloud_master_config(request: Request):
    await _require_agent_async(request)
    s = await _get_cloud_settings()
    mode = s.get("bot_mode", "balanced")
    preset = BOT_MODE_PRESETS.get(mode, BOT_MODE_PRESETS["balanced"])
    return {"mode": mode, "preset": preset,
            "set_at": s.get("bot_mode_set_at", "")}

# v5.1.5 — Bot Reasoning feed: master EA pushes "TRADE BLOCKED BECAUSE …" /
# "FIRED BUY/SELL …" events here so cloud subscribers can see live why their
# copy account is or isn't trading. Capped at 500 rows (TTL-style trim on insert).
class MasterReasoningReq(BaseModel):
    event_type: str             # "BLOCK" | "FIRE"
    reason: str
    regime: Optional[str] = ""
    setup: Optional[str] = ""
    setup_score: Optional[float] = 0.0
    combined_score: Optional[float] = 0.0
    grade: Optional[str] = ""
    signal_dir: Optional[int] = 0
    severity: Optional[str] = ""

class BotHeartbeatReq(BaseModel):
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    bot_online: Optional[bool] = True
    ea_version: Optional[str] = ""
    account_number: Optional[str] = ""
    broker_server: Optional[str] = ""
    symbol: Optional[str] = ""
    timeframe: Optional[str] = ""
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

class BotActivityReq(BaseModel):
    pin: Optional[str] = ""
    license_key: Optional[str] = ""
    event_type: str = "INFO"
    severity: str = "INFO"
    account: Optional[str] = ""
    symbol: Optional[str] = ""
    message: str = ""
    details: Optional[Dict] = None

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
    doc = {
        "id": str(uuid.uuid4()),
        "ts": now.isoformat(),
        "event_type": (event_type or "INFO").upper(),
        "severity": sev,
        "license_key": license_key,
        "account": str(account or ""),
        "symbol": str(symbol or ""),
        "message": str(message or "")[:600],
        "details": details,
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

@api_router.post("/cloud/master/reasoning")
async def cloud_master_reasoning(req: MasterReasoningReq, request: Request):
    await _require_agent_async(request)
    try:
        doc = req.model_dump()
        doc["id"] = str(uuid.uuid4())
        doc["ts"] = datetime.now(timezone.utc).isoformat()
        await db.cloud_reasoning.insert_one(doc.copy())
        sev = (req.severity or _monitor_severity(req.event_type, req.reason)).upper()
        await _store_bot_activity(req.event_type, sev, req.reason,
                                  symbol="", details=doc)
        # keep only the most recent 500 events to bound storage
        total = await db.cloud_reasoning.estimated_document_count()
        if total > 600:
            oldest = await db.cloud_reasoning.find({}, {"_id": 1, "ts": 1}).sort("ts", 1).to_list(total - 500)
            if oldest:
                await db.cloud_reasoning.delete_many({"_id": {"$in": [o["_id"] for o in oldest]}})
        return {"ok": True}
    except Exception as e:
        logger.exception("[cloud-master-reasoning] failed")
        raise HTTPException(status_code=500, detail=f"reasoning store failed: {type(e).__name__}: {e}")

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
    details = req.details or {}
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
    return {"ok": True, "event_id": doc["id"]}

@api_router.post("/cloud/command/request")
async def cloud_command_request(req: CloudCommandReq, user: dict = Depends(get_cloud_user)):
    action = str(req.action or "").upper().strip()
    if action not in SAFE_REMOTE_COMMANDS:
        raise HTTPException(status_code=400, detail="Unsupported Command Center action.")
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required before queueing a remote command.")
    lic = await _verify_command_license(user, req.pin)
    now = datetime.now(timezone.utc)
    command_id = str(uuid.uuid4())
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
        "payload": req.payload or {},
        "ack_at": "",
        "ack_status": "",
        "ack_message": "",
        "ack_details": {},
    }
    await db.cloud_bot_commands.insert_one(doc.copy())
    await _store_bot_activity("REMOTE_COMMAND_QUEUED", "COMMAND",
                              f"{SAFE_REMOTE_COMMANDS[action]} queued for EA acknowledgement",
                              account=lic.get("mt5_account", ""),
                              details={"command_id": command_id, "action": action, "user": user.get("email", ""), "license_key": lic.get("pin", "")})
    return {"ok": True, "command_id": command_id, "status": "PENDING", "action": action}

@api_router.get("/cloud/command/pending")
async def cloud_command_pending(request: Request, limit: int = 5,
                                pin: str = "", license_key: str = "", account: str = ""):
    raw = _normalize_license_key(license_key or pin or "")
    lic = await _resolve_monitor_license(raw, account, request)
    n = max(1, min(int(limit), 10))
    query = {"status": "PENDING"}
    if lic and lic.get("pin"):
        query["license_key"] = lic["pin"]
    if account:
        query["$or"] = [{"mt5_account": str(account)}, {"account": str(account)}, {"mt5_account": ""}, {"mt5_account": {"$exists": False}}]
    rows = await db.cloud_bot_commands.find(query, {"_id": 0}).sort("requested_at", 1).to_list(n)
    return {"ok": True, "commands": rows, "next": rows[0] if rows else None, "count": len(rows)}

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
    await db.cloud_bot_commands.update_one({"id": req.command_id}, {"$set": {
        "status": status,
        "ack_at": now.isoformat(),
        "ack_status": status,
        "ack_message": str(req.message or "")[:400],
        "ack_details": req.details or {},
    }})
    severity = "COMMAND" if status in {"ACKED", "EXECUTED"} else "ERROR"
    label = command.get("label") or command.get("action") or "Remote command"
    await _store_bot_activity("REMOTE_COMMAND_" + status, severity,
                              f"{label}: {req.message or status}",
                              account=command.get("mt5_account", "") or req.account or "",
                              details={"command_id": req.command_id, "action": command.get("action"), "status": status, "license_key": command.get("license_key", "")})
    return {"ok": True, "command_id": req.command_id, "status": status}

@api_router.get("/cloud/command/recent")
async def cloud_command_recent(limit: int = 20, user: dict = Depends(get_cloud_user)):
    n = max(1, min(int(limit), 50))
    rows = await db.cloud_bot_commands.find({"user_id": user["id"]}, {"_id": 0}).sort("requested_at", -1).to_list(n)
    return {"commands": rows, "count": len(rows)}

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
    return {
        "status": status_label,
        "offline": offline,
        "heartbeat_age_sec": age_sec,
        "heartbeat": hb or {},
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
async def cloud_monitor_activity_feed(kind: str = "all", limit: int = 80,
                                      user: dict = Depends(get_cloud_user)):
    n = max(1, min(int(limit), 200))
    k = (kind or "all").lower()
    lic = await _get_user_license(user)
    license_key = _normalize_license_key((lic or {}).get("pin", ""))
    account_filter = str((lic or {}).get("mt5_account") or "").strip()
    if not account_filter and not license_key:
        return {"events": [], "count": 0, "kind": k, "reason": "license_not_linked"}
    query = {}
    if k == "trades":
        query = {"severity": "TRADE"}
    elif k == "blocks":
        query = {"$or": [{"severity": "BLOCK"}, {"event_type": {"$regex": "BLOCK|VETO"}}]}
    elif k == "errors":
        query = {"severity": {"$in": ["ERROR", "CRITICAL"]}}
    elif k == "sync":
        query = {"$or": [{"severity": "SYNC"}, {"event_type": {"$regex": "SYNC"}}]}
    elif k == "exit":
        query = {"$or": [{"severity": "EXIT"}, {"event_type": {"$regex": "EXIT|CLOSE"}}]}
    elif k == "shadow":
        query = {"event_type": {"$regex": "SHADOW|BLOCK_CHECK"}}
    elif k == "risk":
        query = {"event_type": {"$regex": "EPF|DRAWDOWN|RISK|LOCK"}}
    scope = {"$or": [{"account": account_filter}, {"license_key": license_key}]} if account_filter and license_key else ({"account": account_filter} if account_filter else {"license_key": license_key})
    query = {"$and": [scope, query]} if query else scope
    rows = await db.cloud_bot_activity.find(query, {"_id": 0}).sort("ts", -1).to_list(n)
    return {"events": rows, "count": len(rows), "kind": k}

@api_router.get("/cloud/me/reasoning")
async def cloud_me_reasoning(limit: int = 30, _user: dict = Depends(get_cloud_user)):
    """Public to ANY logged-in cloud user — they see the same master EA feed."""
    n = max(1, min(int(limit), 100))
    rows = await db.cloud_reasoning.find({}, {"_id": 0}).sort("ts", -1).to_list(n)
    return {"events": rows, "count": len(rows)}

AGENT_TOKEN = os.environ.get("CLOUD_AGENT_TOKEN", "")  # kept for backward compat

@api_router.get("/cloud/agent/pending-users")
async def cloud_agent_users(request: Request):
    await _require_agent_async(request)
    worker_id = (request.headers.get("X-Worker-Id") or "").strip()
    query = {"mt5_connected": True,
             "mt5_verification_status": "verified",
             "paused": False,
             "status": {"$in": ["trial", "active"]}}
    if worker_id:
        query["assigned_worker_id"] = worker_id
    rows = await db.cloud_users.find(
        query,
        {"_id": 0, "password_hash": 0}
    ).to_list(2000)
    # decrypt passwords in-memory ONLY for the worker response (TLS-only transport)
    for r in rows:
        enc = r.pop("mt5_password_enc", None)
        r["mt5_password"] = _cloud_decrypt(enc) if enc else ""
    return {"users": rows, "total": len(rows)}

# --- Worker feed: recent open + close events since a given ISO timestamp ---
# Used by the Python VPS worker agent to mirror master signals into each
# subscriber's MT5 terminal. Returns at most `limit` of each kind, newest first.
@api_router.get("/cloud/agent/pending-signals")
async def cloud_agent_pending_signals(request: Request, since: str = "", limit: int = 100):
    await _require_agent_async(request)
    q_open: dict = {}
    if since:
        q_open["ts"] = {"$gt": since}
    opens = await db.cloud_signals.find(q_open, {"_id": 0}).sort("ts", -1).to_list(limit)
    # v1.4.7 — closes come from cloud_signals.closed_at (TRUTH SOURCE).
    # Previously read from cloud_shadow_trades, which produced disappearing
    # closes when no shadow row existed (close-before-fanout race).
    q_close: dict = {"closed_at": {"$ne": None}}
    if since:
        q_close["closed_at"] = {"$gt": since, "$ne": None}
    closes_raw = await db.cloud_signals.find(
        q_close,
        {"_id": 0, "id": 1, "exit_price": 1, "closed_at": 1, "close_reason": 1}
    ).sort("closed_at", -1).to_list(limit)
    closes = [{"signal_id": c.get("id"), "exit_price": c.get("exit_price", 0),
               "closed_at": c.get("closed_at"), "reason": c.get("close_reason", "")}
              for c in closes_raw]
    q_partial: dict = {}
    if since:
        q_partial["ts"] = {"$gt": since}
    partials = await db.cloud_signal_partials.find(
        q_partial, {"_id": 0}
    ).sort("ts", -1).to_list(limit)
    return {"opens": opens, "partials": partials, "closes": closes,
            "server_time": datetime.now(timezone.utc).isoformat()}

# --- Worker feed: users awaiting credential verification ---
# Returns shape-valid creds that haven't been login-tested yet. The worker
# attempts mt5.login() and POSTs the result to /cloud/agent/verify-credentials.
@api_router.get("/cloud/agent/verify-queue")
async def cloud_agent_verify_queue(request: Request):
    await _require_agent_async(request)
    rows = await db.cloud_users.find(
        {"mt5_verification_status": "pending",
         "status": {"$in": ["trial", "active"]},
         "mt5_password_enc": {"$exists": True, "$ne": None}},
        {"_id": 0, "password_hash": 0}
    ).to_list(500)
    for r in rows:
        enc = r.pop("mt5_password_enc", None)
        r["mt5_password"] = _cloud_decrypt(enc) if enc else ""
    return {"users": rows, "total": len(rows)}

# v1.4.7 — reconciliation feed: signals that have been CLOSED in the last
# `hours` window. Workers use this to scan their MT5 terminal for orphan
# positions whose master signal already closed (e.g. due to a transient
# HTTP failure during the live close fan-out) and force-close them.
# Source of truth: cloud_signals.closed_at (NOT cloud_shadow_trades — that
# table is downstream and can race against close events).
@api_router.get("/cloud/agent/closed-signals")
async def cloud_agent_closed_signals(request: Request, hours: int = 6, limit: int = 200):
    await _require_agent_async(request)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max(1, min(24, int(hours))))).isoformat()
    rows = await db.cloud_signals.find(
        {"closed_at": {"$gt": cutoff, "$ne": None}},
        {"_id": 0, "id": 1, "exit_price": 1, "closed_at": 1, "close_reason": 1}
    ).sort("closed_at", -1).to_list(min(int(limit), 500))
    rows_out = [{"id": r.get("id"), "exit_price": r.get("exit_price", 0),
                 "closed_at": r.get("closed_at"),
                 "reason": r.get("close_reason", "")} for r in rows]
    return {"signals": rows_out, "total": len(rows_out)}

# v1.4.7 — Worker bullet-proof reconciler endpoint. The worker POSTs a list
# of signal_ids it currently has open positions for. Backend returns, for
# each ID: closed (true/false), exit_price, closed_at. The worker closes any
# position whose signal is reported closed. This catches EVERY race:
#  - close-before-fanout (no shadow row ever existed)
#  - fanout-after-close (worker opened a trade for a signal that closed seconds earlier)
#  - missed-close-event (worker was offline when the closed-signals feed served it)
class SignalStatusReq(BaseModel):
    signal_ids: List[str]

@api_router.post("/cloud/agent/signal-status")
async def cloud_agent_signal_status(req: SignalStatusReq, request: Request):
    await _require_agent_async(request)
    ids = [s for s in (req.signal_ids or []) if isinstance(s, str)][:2000]
    if not ids:
        return {"signals": {}}
    rows = await db.cloud_signals.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "closed_at": 1, "exit_price": 1, "close_reason": 1}
    ).to_list(len(ids))
    out = {}
    seen = set()
    for r in rows:
        sid = r.get("id")
        if not sid: continue
        seen.add(sid)
        is_closed = bool(r.get("closed_at"))
        out[sid] = {
            "closed": is_closed,
            "exit_price": float(r.get("exit_price") or 0),
            "closed_at": r.get("closed_at") or "",
            "reason": r.get("close_reason", ""),
        }
    # Any IDs the worker asked about that don't exist in cloud_signals at all
    # — treat as "unknown signal, close it" (safety: better to close than leave
    # an orphan worker-side trade with no master record).
    for sid in ids:
        if sid not in seen:
            out[sid] = {"closed": True, "exit_price": 0.0, "closed_at": "",
                        "reason": "signal not found in cloud_signals (orphan)"}
    return {"signals": out}

# v1.4.3 — Admin nuclear option: force-close ALL open positions for a specific
# user (or all users). Used when orphan trades from a pre-v1.4 worker need to
# be cleared without RDP'ing the user's MT5. The worker will receive this via
# the existing close-signal poll mechanism using a sentinel signal_id.
@api_router.post("/admin/cloud/force-close-user", dependencies=[Depends(get_current_admin)])
async def admin_force_close_user(payload: dict):
    user_id = (payload or {}).get("user_id", "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    # Insert a special "force-close-all" marker that the worker picks up on
    # its next poll. Workers see this and call mt5.positions_get() filtered by
    # magic=77007007 and close everything — regardless of signal_id mapping.
    marker = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": "force_close_all",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "consumed": False,
    }
    await db.cloud_force_close_queue.insert_one(marker.copy())
    return {"queued": True, "user_id": user_id, "marker_id": marker["id"]}

@api_router.get("/cloud/agent/force-close-queue")
async def cloud_agent_force_close_queue(request: Request):
    await _require_agent_async(request)
    items = await db.cloud_force_close_queue.find(
        {"consumed": False}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    return {"items": items}

@api_router.post("/cloud/agent/force-close-ack")
async def cloud_agent_force_close_ack(payload: dict, request: Request):
    await _require_agent_async(request)
    mid = (payload or {}).get("marker_id")
    if not mid: raise HTTPException(status_code=400, detail="marker_id required")
    await db.cloud_force_close_queue.update_one(
        {"id": mid}, {"$set": {"consumed": True,
                                "consumed_at": datetime.now(timezone.utc).isoformat(),
                                "result": (payload or {}).get("result", "")}})
    return {"ok": True}

class VerifyCredentialsReq(BaseModel):
    user_id: str
    ok: bool
    error: Optional[str] = ""        # broker error message if ok=False
    balance: Optional[float] = None
    equity: Optional[float] = None
    currency: Optional[str] = ""
    broker_name: Optional[str] = ""
    server: Optional[str] = ""
    account_type: Optional[str] = ""
    trade_allowed: Optional[bool] = None
    terminal_trade_allowed: Optional[bool] = None
    symbol: Optional[str] = ""
    symbol_mapping: Optional[str] = ""
    latency_ms: Optional[int] = None
    health: Optional[dict] = None

class AgentAccountStatusReq(BaseModel):
    user_id: str
    worker_id: Optional[str] = ""
    status: str = "CONNECTING"
    logged_in: bool = False
    algo_ok: bool = True
    retry_count: int = 0
    next_retry_at: Optional[str] = ""
    last_success_at: Optional[str] = ""
    last_error: Optional[str] = ""
    server: Optional[str] = ""
    login: Optional[int] = 0
    resolved_symbol: Optional[str] = ""

@api_router.post("/cloud/agent/account-status")
async def cloud_agent_account_status(req: AgentAccountStatusReq, request: Request):
    await _require_agent_async(request)
    now = datetime.now(timezone.utc).isoformat()
    status = (req.status or "CONNECTING").upper()
    error = req.last_error or ""
    set_doc = {
        "copy_status": status,
        "copy_logged_in": bool(req.logged_in),
        "copy_algo_ok": bool(req.algo_ok),
        "copy_retry_count": int(req.retry_count or 0),
        "copy_next_retry_at": req.next_retry_at or "",
        "copy_last_success_at": req.last_success_at or "",
        "copy_last_error": error,
        "copy_last_status_at": now,
        "copy_worker_id": req.worker_id or "",
        "broker_detected_server": req.server or "",
        "broker_symbol": req.resolved_symbol or "",
    }
    # Do not flip mt5_connected / mt5_verification_status here. Those fields
    # decide whether the worker keeps receiving this account from pending-users.
    # Runtime copy health belongs in copy_status so a bad login can cool down,
    # retry later, and remain visible without removing itself from the worker
    # feed or affecting other healthy accounts.
    r = await db.cloud_users.update_one({"id": req.user_id}, {"$set": set_doc})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Unknown user_id")
    await db.cloud_account_status_logs.insert_one({
        "id": str(uuid.uuid4()),
        "ts": now,
        **req.model_dump(),
        "status": status,
    })
    user = await db.cloud_users.find_one({"id": req.user_id}, {"_id": 0, "email": 1})
    await _log_broker_event(req.user_id, (user or {}).get("email", ""), "account_status",
                            status in {"ACTIVE", "COPYING"}, req.server or "", {
                                "status": status,
                                "logged_in": bool(req.logged_in),
                                "algo_ok": bool(req.algo_ok),
                                "retry_count": int(req.retry_count or 0),
                                "next_retry_at": req.next_retry_at or "",
                                "last_error": error,
                                "worker_id": req.worker_id or "",
                            })
    return {"ok": True, "status": status}

@api_router.post("/cloud/agent/verify-credentials")
async def cloud_agent_verify_credentials(req: VerifyCredentialsReq, request: Request):
    await _require_agent_async(request)
    now = datetime.now(timezone.utc).isoformat()
    hint = _broker_error_hint(req.error or "")
    health = req.health or {}
    if req.symbol:
        health.setdefault("resolved_symbol", req.symbol)
    if req.symbol_mapping:
        health.setdefault("symbol_mapping", req.symbol_mapping)
    if req.latency_ms is not None:
        health.setdefault("latency_ms", int(req.latency_ms))
    if req.trade_allowed is not None:
        health.setdefault("trade_allowed", bool(req.trade_allowed))
    if req.terminal_trade_allowed is not None:
        health.setdefault("terminal_trade_allowed", bool(req.terminal_trade_allowed))
    if req.broker_name:
        health.setdefault("broker_name", req.broker_name)
    if req.server:
        health.setdefault("server", req.server)
    set_doc = {
        "mt5_verification_status": "verified" if req.ok else "rejected",
        "mt5_verification_error":  "" if req.ok else (hint or req.error or "Login failed"),
        "mt5_raw_verification_error": "" if req.ok else (req.error or ""),
        "mt5_verified_at":         now,
        "mt5_connected":           bool(req.ok),
        "broker_last_health":      health,
        "broker_last_latency_ms":   int(req.latency_ms or 0),
        "broker_last_check_at":     now,
        "broker_detected_name":     req.broker_name or "",
        "broker_detected_server":   req.server or "",
        "broker_symbol":           req.symbol or "",
        "broker_symbol_mapping":   req.symbol_mapping or "",
    }
    if req.ok:
        if req.balance is not None: set_doc["last_balance"] = float(req.balance)
        if req.equity  is not None: set_doc["last_equity"]  = float(req.equity)
        if req.currency:            set_doc["account_currency"] = req.currency
    r = await db.cloud_users.update_one({"id": req.user_id}, {"$set": set_doc})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Unknown user_id")
    user = await db.cloud_users.find_one({"id": req.user_id}, {"_id": 0, "email": 1, "broker_server": 1})
    await _log_broker_event(req.user_id, (user or {}).get("email", ""), "verification_result", bool(req.ok),
                            req.server or (user or {}).get("broker_server", ""), {
                                "error": req.error or "",
                                "hint": hint,
                                "health": health,
                            })
    return {"ok": True, "verification_status": set_doc["mt5_verification_status"]}

# --- Worker feed: users that hit "Refresh balance" — return + clear in one shot ---
@api_router.get("/cloud/agent/refresh-queue")
async def cloud_agent_refresh_queue(request: Request):
    await _require_agent_async(request)
    rows = await db.cloud_users.find(
        {"force_equity_refresh": True,
         "mt5_connected": True,
         "mt5_verification_status": "verified"},
        {"_id": 0, "id": 1, "email": 1}
    ).to_list(500)
    user_ids = [r["id"] for r in rows]
    if user_ids:
        await db.cloud_users.update_many(
            {"id": {"$in": user_ids}},
            {"$unset": {"force_equity_refresh": ""}})
    return {"user_ids": user_ids, "total": len(user_ids)}

class AgentTradeLog(BaseModel):
    user_id: str; ticket: int; symbol: str; side: str
    lots: float; entry: float; exit_price: float; profit: float
    opened_at: str; closed_at: str; reason: Optional[str] = ""
    signal_id: Optional[str] = ""

class AgentTradePartialLog(BaseModel):
    user_id: str
    signal_id: str
    ticket: int
    symbol: str = "XAUUSD"
    side: str = ""
    closed_lots: float = 0.0
    remaining_lots: float = 0.0
    close_percent: float = 0.0
    entry: float = 0.0
    exit_price: float = 0.0
    profit: float = 0.0
    ok: bool = False
    error: Optional[str] = ""
    closed_at: str = ""
    reason: Optional[str] = ""

@api_router.post("/cloud/agent/trade-close")
async def cloud_agent_trade_close(req: AgentTradeLog, request: Request):
    await _require_agent_async(request)
    doc = req.model_dump()
    doc["status"] = "closed"
    existing = await db.cloud_trades.find_one(
        {"user_id": req.user_id, "ticket": req.ticket},
        {"_id": 0}
    )
    if not existing and req.signal_id:
        existing = await db.cloud_trades.find_one(
            {"user_id": req.user_id, "signal_id": req.signal_id, "status": "open"},
            {"_id": 0}
        )
    if not existing and req.signal_id:
        existing = await db.cloud_trades.find_one(
            {"user_id": req.user_id, "signal_id": req.signal_id},
            {"_id": 0},
            sort=[("opened_at", -1)]
        )

    def _num(v, default=0.0):
        try:
            return float(v if v is not None else default)
        except (TypeError, ValueError):
            return float(default)

    def _keep(existing_value, incoming_value):
        if incoming_value in ("", None):
            return existing_value
        if isinstance(incoming_value, (int, float)) and abs(float(incoming_value)) < 1e-12:
            return existing_value if existing_value not in ("", None, 0, 0.0) else incoming_value
        return incoming_value

    def _fallback_profit(row):
        profit = _num(row.get("profit"), 0.0)
        if abs(profit) > 1e-9:
            return profit
        lots = _num(row.get("lots"), 0.0)
        entry = _num(row.get("entry"), 0.0)
        exit_px = _num(row.get("exit_price"), 0.0)
        side = str(row.get("side") or "").upper()
        if lots > 0 and entry > 0 and exit_px > 0 and side in ("BUY", "SELL"):
            direction = 1 if side == "BUY" else -1
            return (exit_px - entry) * lots * 100.0 * direction
        return profit

    if existing:
        merged = dict(existing)
        for k, v in doc.items():
            merged[k] = _keep(existing.get(k), v)
        merged["status"] = "closed"
        merged["ticket"] = int(req.ticket or existing.get("ticket") or 0)
        merged["closed_at"] = req.closed_at or existing.get("closed_at") or datetime.now(timezone.utc).isoformat()
        merged["profit"] = _fallback_profit(merged)
        set_doc = {k: v for k, v in merged.items() if k != "_id"}
        await db.cloud_trades.update_one({"id": existing["id"]}, {"$set": set_doc})
    else:
        doc["profit"] = _fallback_profit(doc)
        doc["id"] = str(uuid.uuid4())
        await db.cloud_trades.insert_one(doc.copy())
    return {"ok": True}

@api_router.post("/cloud/agent/trade-partial")
async def cloud_agent_trade_partial(req: AgentTradePartialLog, request: Request):
    await _require_agent_async(request)
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "partial" if req.ok else "partial_failed"
    doc["closed_at"] = req.closed_at or datetime.now(timezone.utc).isoformat()
    await db.cloud_trade_partials.insert_one(doc.copy())
    await db.cloud_fanout_logs.insert_one(doc.copy())
    if req.ok and req.ticket:
        await db.cloud_trades.update_one(
            {"user_id": req.user_id, "signal_id": req.signal_id, "ticket": req.ticket, "status": "open"},
            {"$set": {"last_partial_at": doc["closed_at"],
                      "last_partial_lots": float(req.closed_lots or 0.0),
                      "last_partial_profit": float(req.profit or 0.0),
                      "lots": float(req.remaining_lots or 0.0)}}
        )
    return {"ok": True}

# Worker reports each trade-open attempt (success OR failure) so the admin
# panel + user dashboard can see exactly what the VPS executor did per signal.
class AgentTradeOpenReq(BaseModel):
    user_id: str
    signal_id: str
    ticket: int = 0
    symbol: str = "XAUUSD"
    side: str = ""
    lots: float = 0.0
    entry: float = 0.0
    sl: float = 0.0
    tp: float = 0.0
    ok: bool = False
    error: Optional[str] = ""
    opened_at: str = ""

@api_router.post("/cloud/agent/trade-open")
async def cloud_agent_trade_open(req: AgentTradeOpenReq, request: Request):
    await _require_agent_async(request)
    # v1.4.1 — DUPLICATE GUARD #2 (server-side). If a successful trade-open
    # for this exact (user_id, signal_id) is ALREADY in the DB, reject the
    # second worker's POST. Prevents two-worker races from creating duplicate
    # cloud_trades rows. Sentinel rows ("(no-active-users)") and failed rows
    # are exempt.
    if req.ok and req.user_id and not req.user_id.startswith("("):
        dup = await db.cloud_trades.find_one(
            {"user_id": req.user_id, "signal_id": req.signal_id, "status": "open"},
            {"_id": 0, "id": 1, "ticket": 1})
        if dup:
            return {"ok": True, "deduped": True,
                    "existing_ticket": dup.get("ticket"),
                    "message": "duplicate suppressed"}
    doc = req.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "open" if req.ok else "failed"
    await db.cloud_fanout_logs.insert_one(doc.copy())
    if req.ok:
        # Insert a real (non-shadow) trade row so the user dashboard sees it.
        trade = {
            "id": str(uuid.uuid4()), "user_id": req.user_id,
            "signal_id": req.signal_id, "ticket": req.ticket,
            "symbol": req.symbol, "side": req.side, "lots": req.lots,
            "entry": req.entry, "sl": req.sl, "tp": req.tp,
            "exit_price": 0, "profit": 0,
            "status": "open", "shadow": False,
            "opened_at": req.opened_at or datetime.now(timezone.utc).isoformat(),
            "closed_at": None,
        }
        await db.cloud_trades.insert_one(trade.copy())
    return {"ok": True}

# Admin diagnostic: recent command/monitor fanout outcomes (last 100) so
# operators can debug delivery without SSH-into-VPS-to-tail-logs.
@api_router.get("/admin/cloud/fanout-logs", dependencies=[Depends(get_current_admin)])
async def cloud_admin_fanout_logs(limit: int = 100):
    rows = await db.cloud_fanout_logs.find({}, {"_id": 0}).sort("opened_at", -1).to_list(min(int(limit), 500))
    return {"logs": rows, "total": len(rows)}

# Admin one-shot diagnostics: everything an operator needs to debug "trades not
# copying" without SSH-ing the VPS. Combines workers (with active_users + version),
# recent fanout log rows, recent master signals, and a per-user "ready to fan-out?"
# checklist (mt5_connected + verification_status + paused + status). 99% of bugs
# show up here as a single missing checkmark.
@api_router.get("/admin/cloud/diagnostics", dependencies=[Depends(get_current_admin)])
async def cloud_admin_diagnostics(fanout_limit: int = 50, signal_limit: int = 10):
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=3)).isoformat()
    workers_raw = await db.cloud_workers.find({}, {"_id": 0}).sort("last_heartbeat", -1).to_list(100)
    workers = []
    for w in workers_raw:
        hb = w.get("last_heartbeat")
        is_online = bool(hb and hb > cutoff)
        workers.append({
            "id": w.get("id"),
            "name": w.get("name"),
            "status": "online" if is_online else "offline",
            "last_heartbeat": hb,
            "active_users": int(w.get("active_users") or 0),
            "version": w.get("version") or "",
            "hostname": w.get("hostname") or "",
        })
    fanout = await db.cloud_fanout_logs.find({}, {"_id": 0}).sort("opened_at", -1).to_list(min(int(fanout_limit), 200))
    signals = await db.cloud_signals.find({}, {"_id": 0}).sort("ts", -1).to_list(min(int(signal_limit), 50))
    # Per-user fan-out readiness: surface anyone who looks like they should be
    # mirroring trades but won't because of a missing flag.
    users_raw = await db.cloud_users.find(
        {"status": {"$in": ["trial", "active"]}},
        {"_id": 0, "id": 1, "email": 1, "status": 1, "mt5_connected": 1,
         "mt5_verification_status": 1, "mt5_verification_error": 1,
         "paused": 1, "assigned_worker_id": 1, "last_balance": 1,
         "copy_status": 1, "copy_logged_in": 1, "copy_algo_ok": 1,
         "copy_retry_count": 1, "copy_next_retry_at": 1,
         "copy_last_success_at": 1, "copy_last_error": 1,
         "copy_last_status_at": 1, "copy_worker_id": 1}
    ).to_list(500)
    users = []
    for u in users_raw:
        connected = bool(u.get("mt5_connected"))
        verified = u.get("mt5_verification_status") == "verified"
        paused = bool(u.get("paused"))
        ready = connected and verified and not paused
        reason = ""
        if not connected: reason = "mt5 not connected"
        elif not verified: reason = f"mt5 not verified ({u.get('mt5_verification_status') or 'none'})"
        elif paused: reason = "user paused"
        copy_status = u.get("copy_status") or ("COPYING" if ready else "CONNECTING")
        if copy_status in {"LOGIN_FAILED", "EA_DISABLED", "NEEDS_ATTENTION", "DISABLED"}:
            ready = False
            reason = u.get("copy_last_error") or copy_status
        users.append({
            "id": u.get("id"),
            "email": u.get("email"),
            "status": u.get("status"),
            "mt5_connected": connected,
            "mt5_verification_status": u.get("mt5_verification_status") or "",
            "mt5_verification_error": u.get("mt5_verification_error") or "",
            "paused": paused,
            "assigned_worker_id": u.get("assigned_worker_id") or "",
            "last_balance": float(u.get("last_balance") or 0),
            "copy_status": copy_status,
            "copy_logged_in": bool(u.get("copy_logged_in")),
            "copy_algo_ok": bool(u.get("copy_algo_ok", True)),
            "copy_retry_count": int(u.get("copy_retry_count") or 0),
            "copy_next_retry_at": u.get("copy_next_retry_at") or "",
            "copy_last_success_at": u.get("copy_last_success_at") or "",
            "copy_last_error": u.get("copy_last_error") or "",
            "copy_last_status_at": u.get("copy_last_status_at") or "",
            "copy_worker_id": u.get("copy_worker_id") or "",
            "fanout_ready": ready,
            "blocked_reason": reason,
        })
    ready_count = sum(1 for u in users if u["fanout_ready"])
    return {
        "now": now.isoformat(),
        "workers": workers,
        "online_workers": sum(1 for w in workers if w["status"] == "online"),
        "fanout_logs": fanout,
        "signals": signals,
        "users": users,
        "fanout_ready_users": ready_count,
        "total_users": len(users),
    }

class AgentEquitySnapshot(BaseModel):
    user_id: str; balance: float; equity: float; margin: float; free_margin: float
    cloud_positions_count: Optional[int] = None  # v1.4.3 — orphan detection

@api_router.post("/cloud/agent/equity-snapshot")
async def cloud_agent_equity(req: AgentEquitySnapshot, request: Request):
    await _require_agent_async(request)
    doc = req.model_dump()
    doc["ts"] = datetime.now(timezone.utc).isoformat()
    await db.cloud_equity_snapshots.insert_one(doc.copy())
    set_doc = {"last_equity": req.equity, "last_balance": req.balance,
               "last_equity_ts": doc["ts"], "last_balance_updated_at": doc["ts"]}
    if req.cloud_positions_count is not None:
        set_doc["cloud_positions_count"] = int(req.cloud_positions_count)
        set_doc["cloud_positions_ts"] = doc["ts"]
    await db.cloud_users.update_one({"id": req.user_id}, {"$set": set_doc})
    return {"ok": True}

# v1.4.3 — Orphan detector. Compares each cloud user's `cloud_positions_count`
# (last reported by the worker) against the count of currently-open master
# signals. Any user whose worker reports MORE open positions than the master has
# is flagged — those extras are "orphans" (legacy trades from a pre-v1.4 worker
# that never got an XAUAI|<sigid> comment, so reconcile can't see them).
@api_router.get("/admin/cloud/orphans", dependencies=[Depends(get_current_admin)])
async def admin_cloud_orphans():
    # Master open count = signals with no closed_at (the master EA is still in)
    master_open = await db.cloud_signals.count_documents({
        "$or": [{"closed_at": None}, {"closed_at": {"$exists": False}}]
    })
    users = await db.cloud_users.find(
        {"mt5_connected": True},
        {"_id": 0, "id": 1, "email": 1, "cloud_positions_count": 1,
         "cloud_positions_ts": 1, "last_equity_ts": 1}
    ).to_list(2000)
    flagged = []
    for u in users:
        pos = int(u.get("cloud_positions_count") or 0)
        if pos <= master_open:
            continue
        flagged.append({
            "user_id": u.get("id"),
            "email": u.get("email"),
            "cloud_positions": pos,
            "master_open": master_open,
            "orphan_estimate": pos - master_open,
            "last_reported_at": u.get("cloud_positions_ts") or u.get("last_equity_ts"),
        })
    return {
        "master_open_count": master_open,
        "checked_users": len(users),
        "flagged_users": flagged,
        "ts": datetime.now(timezone.utc).isoformat(),
    }

# --- Worker heartbeat: VPS agent pings every N seconds so admin sees it online ---
class WorkerHeartbeatReq(BaseModel):
    worker_id: str
    active_users: int = 0
    version: Optional[str] = ""
    hostname: Optional[str] = ""

@api_router.post("/cloud/agent/heartbeat")
async def cloud_agent_heartbeat(req: WorkerHeartbeatReq, request: Request):
    await _require_agent_async(request)
    now = datetime.now(timezone.utc).isoformat()
    r = await db.cloud_workers.update_one(
        {"id": req.worker_id},
        {"$set": {"last_heartbeat": now, "status": "online",
                  "active_users": req.active_users,
                  "version": req.version or "",
                  "hostname": req.hostname or ""}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Unknown worker_id — register via /admin → Cloud → Infrastructure first.")
    return {"ok": True, "server_time": now}

# ===================================================================
# END XauAi CLOUD
# ===================================================================

app.include_router(api_router)


app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
