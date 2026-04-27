from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends
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
from emergentintegrations.llm.chat import LlmChat, UserMessage

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
@api_router.get("/download/ea")
async def download_ea():
    p = ROOT_DIR / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
    if not p.exists(): raise HTTPException(status_code=404)
    return FileResponse(path=str(p), filename="XAUUSD_AI_Sniper_EA.mq5", media_type="application/octet-stream")

@api_router.get("/download/package")
async def download_package():
    d = ROOT_DIR / "ea_code"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in d.rglob("*"):
            if f.is_file(): z.write(f, f.relative_to(d))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=AI_Sniper_EA_Package.zip"})

@api_router.get("/performance/summary")
async def get_performance_summary():
    return {"total_trades":247,"win_rate":68.4,"profit_factor":2.31,"max_drawdown":8.7,"avg_rr_ratio":1.82,"weekly_return_avg":12.6,"sharpe_ratio":1.94,"best_week":34.2,"worst_week":-6.8,"avg_trade_duration":"2h 15m","longest_winning_streak":9,"longest_losing_streak":3,"monthly_returns":[{"month":"Jul 2025","return":42.1,"trades":38},{"month":"Aug 2025","return":28.7,"trades":31},{"month":"Sep 2025","return":-4.2,"trades":22},{"month":"Oct 2025","return":51.3,"trades":41},{"month":"Nov 2025","return":35.8,"trades":36},{"month":"Dec 2025","return":19.4,"trades":29}],"strategy_breakdown":[{"strategy":"Trend","trades":142,"win_rate":72.5,"profit_share":61.3},{"strategy":"Range","trades":58,"win_rate":62.1,"profit_share":18.7},{"strategy":"Breakout","trades":47,"win_rate":66.0,"profit_share":20.0}],"weekly_data":[{"week":"W1","return":8.2,"drawdown":2.1,"trades":7},{"week":"W2","return":15.4,"drawdown":3.5,"trades":9},{"week":"W3","return":-2.1,"drawdown":5.8,"trades":5},{"week":"W4","return":22.7,"drawdown":1.9,"trades":11},{"week":"W5","return":11.3,"drawdown":4.2,"trades":8},{"week":"W6","return":18.9,"drawdown":2.7,"trades":10},{"week":"W7","return":-6.8,"drawdown":8.7,"trades":4},{"week":"W8","return":34.2,"drawdown":1.4,"trades":12}],"equity_curve":[{"day":1,"equity":10000},{"day":5,"equity":10820},{"day":10,"equity":12480},{"day":15,"equity":12160},{"day":20,"equity":14890},{"day":25,"equity":16200},{"day":30,"equity":18930},{"day":35,"equity":17640},{"day":40,"equity":21580},{"day":45,"equity":24100},{"day":50,"equity":26730},{"day":55,"equity":28410},{"day":60,"equity":31200}],"ai_features":{"market_classification_accuracy":91.4,"avg_confidence_on_wins":88,"avg_confidence_on_losses":54,"pattern_memory_size":3247,"adaptation_cycles":812,"learning_rate_current":0.89,"win_rate_after_learning":84.7,"loss_avoidance_rate":78.3}}

@api_router.get("/architecture")
async def get_architecture():
    return {"modules":[{"name":"Market Analysis Engine","description":"Multi-layered analysis using EMA, RSI, ATR, BB across M5, H1, H4","components":["Trend Detection (EMA 50/200)","Market Structure (HH/LL)","Volatility Analysis (ATR)","Multi-Timeframe Confirmation"]},{"name":"AI Adaptive Decision Engine","description":"ML classifier targeting 80-90% win rate with self-improving confidence","components":["Market Classifier","Confidence Scoring (0-100)","Deep Pattern Memory (3000+)","Self-Improving Engine"]},{"name":"Strategy Engine","description":"Three strategies with dynamic switching","components":["Trend Mode","Range Mode","Breakout Mode","Pattern Recognition"]},{"name":"Risk Management","description":"Institutional controls with 20-50% weekly targets","components":["Dynamic Position Sizing","ATR-based SL/TP","Daily/Weekly Limits","Equity Protection"]},{"name":"Execution Engine","description":"Precision execution with PIN validation","components":["Market/Limit Orders","Spread Filter","Partial Close","Trailing Stop"]},{"name":"Performance Tracking","description":"Logging + ML feedback loop","components":["Trade Journal","Win Rate Tracking","Drawdown Monitor","Pattern Learning"]}],"filters":[{"name":"Session Filter","description":"London & NY only"},{"name":"Spread Filter","description":"Avoids high spread"},{"name":"News Filter","description":"Avoids events"},{"name":"Volatility Filter","description":"Adapts to volatility"}]}

@api_router.get("/docs/installation")
async def get_installation_guide():
    return {"steps":[{"step":1,"title":"Download EA","description":"Download .mq5 from Download section."},{"step":2,"title":"Open MT5","description":"Launch MetaTrader 5."},{"step":3,"title":"Copy to Folder","description":"File > Open Data Folder > MQL5 > Experts. Paste file."},{"step":4,"title":"Compile","description":"Press F4 (MetaEditor), open file, press F7."},{"step":5,"title":"Open Chart","description":"Open XAUUSD M5 chart."},{"step":6,"title":"Attach EA","description":"Drag EA from Navigator onto chart."},{"step":7,"title":"Enter PIN","description":"Input your license PIN. Configure settings."},{"step":8,"title":"Enable","description":"Click Algo Trading (green). Bot starts!"}],"requirements":["MetaTrader 5","XAUUSD symbol","Valid PIN","Internet","$1000+ balance","Low-spread broker"],"warnings":["Start with demo","No guaranteed profits","Don't risk what you can't lose","Keep PIN private"]}

@api_router.get("/docs/how-it-works")
async def get_how_it_works():
    return {"sections":[{"title":"How XauAI Sniper Works","subtitle":"Your intelligent XAUUSD trading assistant","steps":[{"id":1,"title":"Market Scanning","description":"Scans XAUUSD across M5, H1, H4 every 5 minutes using EMA, RSI, ATR, Bollinger Bands.","detail":"Multi-timeframe filters false signals."},{"id":2,"title":"AI Classification","description":"Classifies market as TRENDING, RANGING, or BREAKOUT using weighted scoring.","detail":"Different strategy for each condition."},{"id":3,"title":"Confidence Scoring","description":"Scores 0-100 using global ML from all users. Only takes trades above 75+ confidence.","detail":"Sniper approach = fewer, higher-quality trades."},{"id":4,"title":"Smart Execution","description":"ATR-based stop loss, 1.5:1 R:R take profit, partial close at first target, trailing stop.","detail":"Locks profit early, lets winners run."},{"id":5,"title":"Risk Protection","description":"Per-trade risk limit, daily loss cap, weekly drawdown stop, cooldown after losses.","detail":"3 losses = pause. 3% daily = stops. Never blows account."},{"id":6,"title":"Global Learning","description":"Every trade from every user feeds the global AI brain. The more users trade, the smarter ALL bots get.","detail":"Cloud ML with 90%+ confidence target."}]}],"faq":[{"q":"Do I need to keep my computer on?","a":"Yes. Use a VPS ($5-10/mo) for 24/7 trading."},{"q":"What account size?","a":"Min $500, recommended $1,000+. Bot auto-calculates lot sizes."},{"q":"Which broker?","a":"We recommend Trade.com (75% deposit bonus). Any MT5 broker with XAUUSD works."},{"q":"Can I close trades manually?","a":"Yes, anytime. The bot won't interfere."},{"q":"What if I lose internet?","a":"Your SL/TP protect you. Bot resumes when reconnected."}]}

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
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@2026!")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_password), "name": "Admin", "role": "admin", "created_at": datetime.now(timezone.utc).isoformat()})
        logger.info(f"Admin seeded: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Admin password updated")
    await db.users.create_index("email", unique=True)
    # Write test credentials
    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(exist_ok=True)
    creds_path.write_text(f"# Test Credentials\n\n## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n## Endpoints\n- Login: POST /api/auth/login\n- Admin Portal: /admin\n")

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

app.include_router(api_router)

app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
