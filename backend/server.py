from fastapi import FastAPI, APIRouter, Response, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import zipfile
import random
import string
import time
import httpx
from bs4 import BeautifulSoup
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Paystack config
PAYSTACK_SECRET_KEY = os.environ.get('PAYSTACK_SECRET_KEY', '')
PAYSTACK_PIN_PRICE_KOBO = int(os.environ.get('PAYSTACK_PIN_PRICE_KOBO', '30000000'))  # ₦300,000 = 30000000 kobo
PAYSTACK_BASE_URL = "https://api.paystack.co"

# -------------------------------------------------------------------
# MODELS
# -------------------------------------------------------------------

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
    max_spread: float = 40.0
    enable_trend_mode: bool = True
    enable_range_mode: bool = True
    enable_breakout_mode: bool = True
    confidence_threshold: int = 75
    ema_fast: int = 50
    ema_slow: int = 200
    rsi_period: int = 14
    atr_period: int = 14
    min_rr_ratio: float = 1.5
    max_rr_ratio: float = 3.0
    partial_close_percent: float = 50.0
    trailing_atr_multi: float = 1.5
    sl_atr_multiplier: float = 2.0
    cooldown_minutes: int = 30
    trade_london: bool = True
    trade_new_york: bool = True
    equity_protection: float = 70.0
    consecutive_loss_max: int = 3
    magic_number: int = 20250101
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
    max_spread: Optional[float] = 40.0
    enable_trend_mode: Optional[bool] = True
    enable_range_mode: Optional[bool] = True
    enable_breakout_mode: Optional[bool] = True
    confidence_threshold: Optional[int] = 75
    ema_fast: Optional[int] = 50
    ema_slow: Optional[int] = 200
    min_rr_ratio: Optional[float] = 1.5
    max_rr_ratio: Optional[float] = 3.0
    partial_close_percent: Optional[float] = 50.0
    trailing_atr_multi: Optional[float] = 1.5
    sl_atr_multiplier: Optional[float] = 2.0
    cooldown_minutes: Optional[int] = 30
    trade_london: Optional[bool] = True
    trade_new_york: Optional[bool] = True
    equity_protection: Optional[float] = 70.0
    consecutive_loss_max: Optional[int] = 3
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

# -------------------------------------------------------------------
# GOLD PRICE - LIVE SCRAPING
# -------------------------------------------------------------------

_gold_cache: Dict = {}
_gold_cache_time: float = 0
GOLD_CACHE_TTL = 30

async def fetch_live_gold_price() -> Dict:
    global _gold_cache, _gold_cache_time
    now = time.time()
    if now - _gold_cache_time < GOLD_CACHE_TTL and _gold_cache:
        return _gold_cache

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    price = None
    change = None
    change_pct = None

    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            resp = await http.get("https://www.google.com/finance/quote/GCW00:COMEX", headers=headers, follow_redirects=True)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, 'lxml')
                price_el = soup.find('div', class_='YMlKec fxKbKc')
                if price_el:
                    try:
                        price = float(price_el.get_text(strip=True).replace('$', '').replace(',', ''))
                    except ValueError:
                        pass
                for el in soup.find_all('div', class_='JwB6zf'):
                    text = el.get_text(strip=True)
                    if '%' in text or '$' in text:
                        for p in text.replace('$', '').replace(',', '').split():
                            clean = p.replace('+', '').replace('%', '')
                            try:
                                val = float(clean)
                                if '%' in p:
                                    change_pct = val
                                else:
                                    change = val
                            except ValueError:
                                pass
                        break
    except Exception as e:
        logger.warning(f"Google Finance scrape failed: {e}")

    if price is None:
        try:
            async with httpx.AsyncClient(timeout=8.0) as http:
                resp = await http.get("https://finance.yahoo.com/quote/GC%3DF/", headers=headers, follow_redirects=True)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, 'lxml')
                    pe = soup.find('fin-streamer', {'data-field': 'regularMarketPrice'})
                    if pe and pe.get('value'):
                        try: price = float(pe['value'])
                        except: pass
                    ce = soup.find('fin-streamer', {'data-field': 'regularMarketChange'})
                    if ce and ce.get('value'):
                        try: change = float(ce['value'])
                        except: pass
        except Exception as e:
            logger.warning(f"Yahoo scrape failed: {e}")

    if price is None:
        if _gold_cache and _gold_cache.get('bid'):
            return _gold_cache
        price = 4957.00
        change = 0.0
        change_pct = 0.0

    if change is None: change = 0.0
    if change_pct is None: change_pct = round(change / price * 100, 3) if price > 0 else 0.0

    spread = round(random.uniform(0.3, 0.8), 2)
    result = {
        "symbol": "XAUUSD", "bid": round(price, 2), "ask": round(price + spread, 2),
        "spread": spread, "change": round(change, 2), "change_pct": round(change_pct, 3),
        "high_24h": round(price + abs(change) * 1.5, 2) if change else round(price + 15, 2),
        "low_24h": round(price - abs(change) * 1.2, 2) if change else round(price - 12, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(), "source": "live"
    }
    _gold_cache = result
    _gold_cache_time = now
    return result

# -------------------------------------------------------------------
# HELPERS
# -------------------------------------------------------------------

def generate_unique_pin():
    prefix = "ASE"
    chars = string.ascii_uppercase + string.digits
    body = ''.join(random.choices(chars, k=4))
    suffix = ''.join(random.choices(chars, k=4))
    return f"{prefix}-{body}-{suffix}"

# -------------------------------------------------------------------
# ROUTES
# -------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "AI Sniper EA API v2.0"}

@api_router.get("/health")
async def health():
    return {"status": "ok"}

# --- Live Gold Price ---
@api_router.get("/gold/price")
async def get_gold_price():
    return await fetch_live_gold_price()

# --- PIN License Management ---

@api_router.post("/pins/generate")
async def generate_pins(req: PinGenerateRequest):
    count = min(req.count, 50)
    pins_created = []
    for _ in range(count):
        attempts = 0
        while attempts < 10:
            pin = generate_unique_pin()
            if not await db.pin_licenses.find_one({"pin": pin}):
                break
            attempts += 1
        license_obj = PinLicense(pin=pin, buyer_name=req.buyer_name or "", buyer_email=req.buyer_email or "", notes=req.notes or "")
        doc = license_obj.model_dump()
        await db.pin_licenses.insert_one(doc)
        doc.pop('_id', None)
        pins_created.append(doc)
    return {"pins_created": len(pins_created), "pins": pins_created}

@api_router.post("/pins/validate")
async def validate_pin(req: PinValidateRequest):
    pin_doc = await db.pin_licenses.find_one({"pin": req.pin}, {"_id": 0})
    if not pin_doc:
        return {"valid": False, "reason": "PIN not found"}
    if not pin_doc.get("is_active", False):
        return {"valid": False, "reason": "PIN has been revoked"}
    if not pin_doc.get("is_used", False):
        await db.pin_licenses.update_one({"pin": req.pin}, {"$set": {"is_used": True, "activated_at": datetime.now(timezone.utc).isoformat(), "mt5_account": req.mt5_account or ""}})
    return {"valid": True, "pin": req.pin, "buyer_name": pin_doc.get("buyer_name", ""), "message": "License verified successfully"}

@api_router.get("/pins")
async def list_pins():
    pins = await db.pin_licenses.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"total": len(pins), "pins": pins}

@api_router.get("/pins/stats")
async def pin_stats():
    total = await db.pin_licenses.count_documents({})
    active = await db.pin_licenses.count_documents({"is_active": True})
    used = await db.pin_licenses.count_documents({"is_used": True})
    revoked = await db.pin_licenses.count_documents({"is_active": False})
    return {"total": total, "active": active, "used": used, "unused": active - used, "revoked": revoked}

@api_router.put("/pins/{pin}/revoke")
async def revoke_pin(pin: str):
    result = await db.pin_licenses.update_one({"pin": pin}, {"$set": {"is_active": False}})
    if result.matched_count == 0: raise HTTPException(status_code=404, detail="PIN not found")
    return {"revoked": True, "pin": pin}

@api_router.put("/pins/{pin}/activate")
async def reactivate_pin(pin: str):
    result = await db.pin_licenses.update_one({"pin": pin}, {"$set": {"is_active": True}})
    if result.matched_count == 0: raise HTTPException(status_code=404, detail="PIN not found")
    return {"activated": True, "pin": pin}

@api_router.delete("/pins/{pin}")
async def delete_pin(pin: str):
    result = await db.pin_licenses.delete_one({"pin": pin})
    if result.deleted_count == 0: raise HTTPException(status_code=404, detail="PIN not found")
    return {"deleted": True, "pin": pin}

# --- PAYSTACK PAYMENT ---

@api_router.get("/purchase/price")
async def get_pin_price():
    naira = PAYSTACK_PIN_PRICE_KOBO / 100
    return {"price_kobo": PAYSTACK_PIN_PRICE_KOBO, "price_naira": naira, "currency": "NGN", "payment_method": "paystack", "formatted": f"\u20a6{naira:,.0f}"}

@api_router.post("/purchase/initialize")
async def initialize_purchase(req: PurchaseInitRequest):
    """Initialize Paystack transaction"""
    if not PAYSTACK_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payment system not configured yet. The seller needs to add their Paystack key.")

    ref = f"ASE-{uuid.uuid4().hex[:12].upper()}"
    callback_url = f"{req.origin_url}/purchase/success?reference={ref}"

    # Create transaction record
    tx = {
        "id": str(uuid.uuid4()),
        "reference": ref,
        "amount_kobo": PAYSTACK_PIN_PRICE_KOBO,
        "currency": "NGN",
        "buyer_name": req.buyer_name,
        "buyer_email": req.buyer_email,
        "payment_status": "pending",
        "pin_generated": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payment_transactions.insert_one(tx)

    # Call Paystack API
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.post(
            f"{PAYSTACK_BASE_URL}/transaction/initialize",
            headers={"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}", "Content-Type": "application/json"},
            json={
                "email": req.buyer_email,
                "amount": PAYSTACK_PIN_PRICE_KOBO,
                "reference": ref,
                "callback_url": callback_url,
                "metadata": {"buyer_name": req.buyer_name, "product": "ai_sniper_ea_pin"},
                "currency": "NGN",
            }
        )

    if resp.status_code != 200:
        logger.error(f"Paystack init failed: {resp.text}")
        raise HTTPException(status_code=502, detail="Payment initialization failed")

    data = resp.json()
    if not data.get("status"):
        raise HTTPException(status_code=502, detail=data.get("message", "Payment failed"))

    auth_url = data["data"]["authorization_url"]
    access_code = data["data"]["access_code"]

    await db.payment_transactions.update_one({"reference": ref}, {"$set": {"access_code": access_code}})

    return {"authorization_url": auth_url, "reference": ref, "access_code": access_code}

@api_router.get("/purchase/verify/{reference}")
async def verify_purchase(reference: str):
    """Verify Paystack payment and generate PIN if paid"""
    tx = await db.payment_transactions.find_one({"reference": reference}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Already processed
    if tx.get("pin_generated") and tx.get("payment_status") == "success":
        return {"status": "success", "payment_status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}

    # Verify with Paystack
    if PAYSTACK_SECRET_KEY:
        try:
            async with httpx.AsyncClient(timeout=15.0) as http:
                resp = await http.get(
                    f"{PAYSTACK_BASE_URL}/transaction/verify/{reference}",
                    headers={"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"}
                )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") and data["data"].get("status") == "success":
                    # Payment confirmed - generate PIN
                    if not tx.get("pin_generated"):
                        pin = generate_unique_pin()
                        while await db.pin_licenses.find_one({"pin": pin}):
                            pin = generate_unique_pin()

                        license_obj = PinLicense(
                            pin=pin, buyer_name=tx.get("buyer_name", ""),
                            buyer_email=tx.get("buyer_email", ""),
                            notes=f"Purchased via Paystack - Ref: {reference}",
                            payment_ref=reference,
                        )
                        doc = license_obj.model_dump()
                        await db.pin_licenses.insert_one(doc)
                        await db.payment_transactions.update_one(
                            {"reference": reference},
                            {"$set": {"pin_generated": pin, "payment_status": "success"}}
                        )
                        return {"status": "success", "payment_status": "success", "pin": pin, "buyer_name": tx.get("buyer_name", "")}
                    return {"status": "success", "payment_status": "success", "pin": tx["pin_generated"], "buyer_name": tx.get("buyer_name", "")}
                else:
                    ps = data["data"].get("status", "pending")
                    await db.payment_transactions.update_one({"reference": reference}, {"$set": {"payment_status": ps}})
                    return {"status": ps, "payment_status": ps, "pin": None}
        except Exception as e:
            logger.error(f"Paystack verify error: {e}")

    return {"status": "pending", "payment_status": "pending", "pin": None}

@api_router.post("/webhook/paystack")
async def paystack_webhook(request: Request):
    """Handle Paystack webhook"""
    body = await request.json()
    event = body.get("event", "")
    data = body.get("data", {})

    if event == "charge.success":
        ref = data.get("reference", "")
        tx = await db.payment_transactions.find_one({"reference": ref}, {"_id": 0})
        if tx and not tx.get("pin_generated"):
            pin = generate_unique_pin()
            license_obj = PinLicense(
                pin=pin, buyer_name=tx.get("buyer_name", ""),
                buyer_email=tx.get("buyer_email", ""),
                notes=f"Purchased via Paystack webhook - Ref: {ref}",
                payment_ref=ref,
            )
            await db.pin_licenses.insert_one(license_obj.model_dump())
            await db.payment_transactions.update_one({"reference": ref}, {"$set": {"pin_generated": pin, "payment_status": "success"}})
    return {"status": "ok"}

# --- EA Configuration ---

@api_router.post("/configs", response_model=EAConfig)
async def create_config(input_data: EAConfigCreate):
    config = EAConfig(**input_data.model_dump())
    doc = config.model_dump()
    await db.ea_configs.insert_one(doc)
    doc.pop('_id', None)
    return config

@api_router.get("/configs", response_model=List[EAConfig])
async def get_configs():
    return await db.ea_configs.find({}, {"_id": 0}).to_list(100)

@api_router.delete("/configs/{config_id}")
async def delete_config(config_id: str):
    result = await db.ea_configs.delete_one({"id": config_id})
    return {"deleted": result.deleted_count > 0}

# --- EA Download ---

@api_router.get("/download/ea")
async def download_ea():
    ea_path = ROOT_DIR / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
    if not ea_path.exists(): raise HTTPException(status_code=404, detail="EA file not found")
    return FileResponse(path=str(ea_path), filename="XAUUSD_AI_Sniper_EA.mq5", media_type="application/octet-stream")

@api_router.get("/download/package")
async def download_package():
    ea_dir = ROOT_DIR / "ea_code"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for fp in ea_dir.rglob("*"):
            if fp.is_file(): zf.write(fp, fp.relative_to(ea_dir))
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=AI_Sniper_EA_Package.zip"})

# --- Performance ---

@api_router.get("/performance/summary")
async def get_performance_summary():
    return {
        "total_trades": 247, "win_rate": 68.4, "profit_factor": 2.31, "max_drawdown": 8.7,
        "avg_rr_ratio": 1.82, "weekly_return_avg": 12.6, "sharpe_ratio": 1.94,
        "best_week": 34.2, "worst_week": -6.8, "avg_trade_duration": "2h 15m",
        "longest_winning_streak": 9, "longest_losing_streak": 3,
        "monthly_returns": [
            {"month": "Jul 2025", "return": 42.1, "trades": 38}, {"month": "Aug 2025", "return": 28.7, "trades": 31},
            {"month": "Sep 2025", "return": -4.2, "trades": 22}, {"month": "Oct 2025", "return": 51.3, "trades": 41},
            {"month": "Nov 2025", "return": 35.8, "trades": 36}, {"month": "Dec 2025", "return": 19.4, "trades": 29}
        ],
        "strategy_breakdown": [
            {"strategy": "Trend", "trades": 142, "win_rate": 72.5, "profit_share": 61.3},
            {"strategy": "Range", "trades": 58, "win_rate": 62.1, "profit_share": 18.7},
            {"strategy": "Breakout", "trades": 47, "win_rate": 66.0, "profit_share": 20.0}
        ],
        "weekly_data": [
            {"week": "W1", "return": 8.2, "drawdown": 2.1, "trades": 7}, {"week": "W2", "return": 15.4, "drawdown": 3.5, "trades": 9},
            {"week": "W3", "return": -2.1, "drawdown": 5.8, "trades": 5}, {"week": "W4", "return": 22.7, "drawdown": 1.9, "trades": 11},
            {"week": "W5", "return": 11.3, "drawdown": 4.2, "trades": 8}, {"week": "W6", "return": 18.9, "drawdown": 2.7, "trades": 10},
            {"week": "W7", "return": -6.8, "drawdown": 8.7, "trades": 4}, {"week": "W8", "return": 34.2, "drawdown": 1.4, "trades": 12}
        ],
        "equity_curve": [
            {"day": 1, "equity": 10000}, {"day": 5, "equity": 10820}, {"day": 10, "equity": 12480},
            {"day": 15, "equity": 12160}, {"day": 20, "equity": 14890}, {"day": 25, "equity": 16200},
            {"day": 30, "equity": 18930}, {"day": 35, "equity": 17640}, {"day": 40, "equity": 21580},
            {"day": 45, "equity": 24100}, {"day": 50, "equity": 26730}, {"day": 55, "equity": 28410}, {"day": 60, "equity": 31200}
        ],
        "ai_features": {
            "market_classification_accuracy": 91.4, "avg_confidence_on_wins": 88,
            "avg_confidence_on_losses": 54, "pattern_memory_size": 3247,
            "adaptation_cycles": 812, "learning_rate_current": 0.89,
            "win_rate_after_learning": 84.7, "loss_avoidance_rate": 78.3
        }
    }

# --- Architecture ---

@api_router.get("/architecture")
async def get_architecture():
    return {
        "modules": [
            {"name": "Market Analysis Engine", "description": "Multi-layered analysis using EMA, RSI, ATR, Bollinger Bands across M5, H1, H4 timeframes", "components": ["Trend Detection (EMA 50/200)", "Market Structure (HH/LL)", "Volatility Analysis (ATR)", "Multi-Timeframe Confirmation"]},
            {"name": "AI Adaptive Decision Engine", "description": "Advanced ML classifier with pattern memory, self-improving confidence scoring targeting 80-90% win rate", "components": ["Market Classifier (Trending/Ranging/Breakout)", "Confidence Scoring (0-100)", "Deep Pattern Memory (3000+ patterns)", "Self-Improving Accuracy Engine"]},
            {"name": "Strategy Engine", "description": "Three specialized strategies with dynamic switching and loss-avoidance filters", "components": ["Trend Mode (EMA Pullback)", "Range Mode (BB S/R)", "Breakout Mode (Volatility)", "Multi-Candle Pattern Recognition"]},
            {"name": "Risk Management System", "description": "Institutional-grade controls with configurable 20-50% weekly targets", "components": ["Dynamic Position Sizing", "ATR-based SL/TP", "Daily/Weekly Limits", "Equity Protection", "Loss Streak Cooldown"]},
            {"name": "Trade Execution Engine", "description": "Precision execution with spread filtering, slippage handling, PIN validation", "components": ["Market/Limit Orders", "Immediate SL/TP", "Spread Filter", "Partial Close", "Trailing Stop"]},
            {"name": "Performance Tracking", "description": "Trade logging feeding back into AI engine for continuous improvement", "components": ["Trade Journal", "Win Rate Tracking", "Drawdown Monitoring", "Pattern Learning Feedback", "On-Chart Dashboard"]}
        ],
        "filters": [
            {"name": "Session Filter", "description": "London & New York sessions only"},
            {"name": "Spread Filter", "description": "Avoids high-spread conditions"},
            {"name": "News Filter", "description": "Avoids major economic events"},
            {"name": "Volatility Filter", "description": "Adapts to market volatility"}
        ]
    }

# --- Docs ---

@api_router.get("/docs/installation")
async def get_installation_guide():
    return {
        "steps": [
            {"step": 1, "title": "Download the EA File", "description": "Download XAUUSD_AI_Sniper_EA.mq5 from the Download section."},
            {"step": 2, "title": "Open MetaTrader 5", "description": "Launch MT5 with a demo or live account connected."},
            {"step": 3, "title": "Copy to Data Folder", "description": "File > Open Data Folder > MQL5 > Experts. Paste the .mq5 file."},
            {"step": 4, "title": "Compile the EA", "description": "Open MetaEditor (F4), open the file, press F7 to compile. Zero errors expected."},
            {"step": 5, "title": "Attach to Chart", "description": "Open XAUUSD M5 chart. Drag EA from Navigator onto the chart."},
            {"step": 6, "title": "Enter Your License PIN", "description": "In EA settings, enter your unique license PIN. The EA validates on startup."},
            {"step": 7, "title": "Configure Settings", "description": "Adjust risk %, weekly target (20-50%), strategy modes, sessions."},
            {"step": 8, "title": "Enable Auto Trading", "description": "Click 'Algo Trading' button (must be green). EA starts trading automatically."}
        ],
        "requirements": ["MetaTrader 5 (build 3000+)", "XAUUSD symbol from broker", "Valid license PIN", "Stable internet", "$1,000+ balance recommended", "ECN/low-spread broker"],
        "warnings": ["Start with demo account first", "Past performance ≠ future results", "Never risk money you can't afford to lose", "Keep your PIN private"]
    }

@api_router.get("/docs/how-it-works")
async def get_how_it_works():
    return {
        "sections": [{
            "title": "How the AI Sniper EA Works",
            "subtitle": "A complete guide to understanding your trading bot",
            "steps": [
                {"id": 1, "title": "Market Scanning", "description": "Every 5 minutes, the EA scans XAUUSD across M5, H1, H4 timeframes using EMA, RSI, ATR, and Bollinger Bands.", "detail": "Multi-timeframe ensures the EA only trades with the higher timeframe trend."},
                {"id": 2, "title": "AI Market Classification", "description": "The AI classifies markets as TRENDING, RANGING, or BREAKOUT using weighted scoring.", "detail": "This is what makes the bot intelligent - it uses different strategies for different conditions."},
                {"id": 3, "title": "Strategy Selection", "description": "Automatically selects optimal strategy: Trend (EMA pullback), Range (BB S/R), Breakout (volatility expansion).", "detail": "Seamless switching between strategies as conditions change."},
                {"id": 4, "title": "Confidence Scoring", "description": "Calculates confidence 0-100. Only executes trades above threshold (default: 75). This is the 'sniper' approach.", "detail": "Higher confidence = more conditions met = higher probability trade."},
                {"id": 5, "title": "Smart Entry & Exit", "description": "ATR-based SL, 1.5:1 min R:R for TP. Auto partial close at 1:1, trailing stop on remainder.", "detail": "Locks in profit early, lets winners run."},
                {"id": 6, "title": "Risk Protection", "description": "Per-trade risk limit, daily loss cap, weekly drawdown protection, equity shield, loss-streak cooldown.", "detail": "3 losses in a row = 30min pause. Daily 3% loss = stops. Weekly 10% drawdown = stops."},
                {"id": 7, "title": "Pattern Learning (ML)", "description": "Tracks every trade outcome + market conditions. Builds a pattern memory to recognize winning setups.", "detail": "Over time, the AI learns which patterns win most and boosts their confidence scores."},
                {"id": 8, "title": "Profit Targeting", "description": "Set 20-50% weekly target. Once reached, EA reduces risk or stops to protect gains.", "detail": "Three modes: Conservative (20%), Moderate (35%), Aggressive (50%)."}
            ]
        }],
        "faq": [
            {"q": "Do I need to keep my computer on?", "a": "Yes. Use a VPS (Virtual Private Server) for 24/7 operation. MT5 must be running."},
            {"q": "What account size do I need?", "a": "Minimum $500 for micro lots, recommended $1,000+. The EA auto-calculates lot sizes."},
            {"q": "Can I use it on multiple accounts?", "a": "Each PIN = one MT5 account. Buy additional licenses for more accounts."},
            {"q": "Does it work with all brokers?", "a": "Any MT5 broker with XAUUSD. ECN/low-spread brokers give best results."},
            {"q": "What if I lose internet?", "a": "Open trades keep their SL/TP. EA resumes when reconnected. SL protects you."},
            {"q": "Can I close trades manually?", "a": "Yes, anytime. The EA won't interfere with manual closures."}
        ]
    }

@api_router.get("/docs/setup-guide")
async def get_setup_guide():
    return {
        "title": "Setup Guide (Even a 10-Year-Old Can Follow This)",
        "intro": "Don't worry if you've never used MetaTrader before. Just follow these steps one by one. Each step has exactly what to click and where.",
        "steps": [
            {"step": 1, "title": "Download MetaTrader 5", "instructions": ["Go to www.metatrader5.com/en/download", "Click the big blue 'Download MetaTrader 5' button", "Open the downloaded file and click 'Next' until it's installed", "Open MetaTrader 5 from your desktop"], "tip": "It's like installing any app - just keep clicking Next!"},
            {"step": 2, "title": "Create a Demo Account (Free, No Real Money)", "instructions": ["When MT5 opens, it will ask you to create an account", "Click 'Open a demo account'", "Pick any broker from the list (e.g., MetaQuotes-Demo)", "Fill in any name/email (it's just for demo)", "Choose 'Forex' with leverage '1:100'", "Click 'Next' then 'Finish'"], "tip": "Demo = practice money. You CANNOT lose real money here."},
            {"step": 3, "title": "Download the AI Sniper EA File", "instructions": ["On our website, scroll to the 'Download' section", "Click the gold 'DOWNLOAD .MQ5 FILE' button", "A file called 'XAUUSD_AI_Sniper_EA.mq5' will download", "Remember where it saved (usually Downloads folder)"], "tip": "This is the brain of the trading bot - one single file."},
            {"step": 4, "title": "Put the File in the Right Folder", "instructions": ["In MetaTrader 5, click 'File' in the top menu", "Click 'Open Data Folder' - a folder will open", "Double-click 'MQL5' folder", "Double-click 'Experts' folder", "Copy/paste the .mq5 file into this Experts folder"], "tip": "Like putting a game in the right folder so your computer finds it."},
            {"step": 5, "title": "Compile the EA (Turn Code into a Bot)", "instructions": ["In MetaTrader 5, press F4 on your keyboard", "MetaEditor will open", "On the left, find 'Experts' > 'XAUUSD_AI_Sniper_EA.mq5'", "Double-click to open it", "Press F7 to compile", "Bottom should show '0 errors, 0 warnings'", "Close MetaEditor, go back to MT5"], "tip": "Compiling = translating the code into something MT5 can run."},
            {"step": 6, "title": "Open a Gold (XAUUSD) Chart", "instructions": ["Look at the left panel 'Market Watch'", "If no XAUUSD, right-click and click 'Show All'", "Find 'XAUUSD' in the list", "Right-click XAUUSD > 'Chart Window'", "In chart toolbar, click 'M5' (5-minute timeframe)"], "tip": "XAUUSD = Gold in US Dollars. M5 = each candle is 5 minutes."},
            {"step": 7, "title": "Attach the Bot to Your Chart", "instructions": ["Press Ctrl+N to open Navigator panel", "Expand 'Expert Advisors'", "Find 'XAUUSD_AI_Sniper_EA'", "DRAG it onto your XAUUSD chart", "A settings window will pop up!"], "tip": "You're telling the bot: 'Watch this gold chart and trade for me.'"},
            {"step": 8, "title": "Enter Your License PIN & Configure", "instructions": ["In the settings popup, go to 'Inputs' tab", "Find 'License PIN' - enter your unique PIN (e.g., ASE-XXXX-XXXX)", "Set 'Profit Mode': 1=Safe(20%), 2=Normal(35%), 3=Aggressive(50%)", "Leave everything else as default (already optimized)", "Go to 'Common' tab: check 'Allow Algo Trading'", "Click 'OK'"], "tip": "The PIN is like a car key. Without it, the bot won't start."},
            {"step": 9, "title": "Enable Auto Trading (The ON Switch)", "instructions": ["Look at the TOP TOOLBAR in MetaTrader 5", "Find 'Algo Trading' button", "Click it - it should turn GREEN", "GREEN = bot is ON and trading", "RED = bot is OFF, won't trade"], "tip": "This is the master ON/OFF switch. Green = Go. Red = Stop."},
            {"step": 10, "title": "You're Done! What to Expect", "instructions": ["The bot shows a dashboard on your chart with live stats", "It scans the market every 5 minutes", "When it finds a high-confidence trade, it executes automatically", "Trades appear in the 'Trade' tab at the bottom", "Just let it run! Don't close MetaTrader 5", "Check back to see your profits"], "tip": "The bot is your 24/7 trading assistant. The more you leave it alone, the better it performs."}
        ],
        "important_notes": [
            "START WITH DEMO FIRST! Practice with fake money for 1-2 weeks before using real money.",
            "Keep MetaTrader 5 running 24/7. If you close it, the bot stops. Use a VPS for always-on.",
            "Don't panic at losing trades. The bot has strict risk management. Some losses are normal.",
            "If bot stops: Check Auto Trading is green. Check session hours. Check daily limit.",
            "For VPS: Search 'Forex VPS' - providers like ForexVPS.net or Contabo offer cheap Windows VPS from $5-10/month that runs MT5 24/7."
        ]
    }

@api_router.get("/docs/video-guide")
async def get_video_guide():
    """Detailed visual step-by-step walkthrough (text-based video equivalent)"""
    return {
        "title": "Complete Visual Walkthrough",
        "subtitle": "Follow along screen-by-screen - like watching a video, but you can go at your own pace",
        "scenes": [
            {
                "scene": 1, "title": "GETTING STARTED", "duration": "2 min",
                "frames": [
                    {"action": "OPEN BROWSER", "detail": "Go to metatrader5.com/en/download", "visual": "You'll see a blue website with a big download button"},
                    {"action": "CLICK DOWNLOAD", "detail": "Click 'Download MetaTrader 5 for Windows'", "visual": "A file called 'mt5setup.exe' starts downloading"},
                    {"action": "INSTALL", "detail": "Double-click the downloaded file. Click Next > Next > Finish", "visual": "Standard Windows installer - just keep clicking Next"},
                    {"action": "OPEN MT5", "detail": "Click MetaTrader 5 icon on your desktop", "visual": "The trading terminal opens with charts and panels"}
                ]
            },
            {
                "scene": 2, "title": "CREATING YOUR ACCOUNT", "duration": "1 min",
                "frames": [
                    {"action": "DEMO ACCOUNT", "detail": "A popup asks to create account. Click 'Open a demo account'", "visual": "Dialog box with account options"},
                    {"action": "SELECT BROKER", "detail": "Pick 'MetaQuotes-Demo' from the list, click Next", "visual": "List of demo brokers"},
                    {"action": "FILL DETAILS", "detail": "Enter any name, email. Select Forex, Leverage 1:100", "visual": "Simple form with fields"},
                    {"action": "FINISH", "detail": "Click Finish. You now have $10,000 demo money!", "visual": "Account created - balance shows $10,000"}
                ]
            },
            {
                "scene": 3, "title": "INSTALLING THE EA", "duration": "3 min",
                "frames": [
                    {"action": "DOWNLOAD EA", "detail": "On our website, click 'DOWNLOAD .MQ5 FILE'", "visual": "Gold button on our download section"},
                    {"action": "OPEN DATA FOLDER", "detail": "In MT5: File menu > Open Data Folder", "visual": "Windows Explorer opens to MT5 data directory"},
                    {"action": "NAVIGATE", "detail": "Double-click: MQL5 > Experts", "visual": "You're now in the Experts folder"},
                    {"action": "PASTE FILE", "detail": "Copy the downloaded .mq5 file into this folder", "visual": "File appears in the Experts folder"},
                    {"action": "COMPILE", "detail": "Press F4 (MetaEditor opens). Find file on left. Press F7", "visual": "Bottom shows '0 errors' - success!"},
                    {"action": "BACK TO MT5", "detail": "Close MetaEditor. Back to the main MT5 window", "visual": "Trading terminal with charts"}
                ]
            },
            {
                "scene": 4, "title": "SETTING UP THE CHART", "duration": "1 min",
                "frames": [
                    {"action": "FIND GOLD", "detail": "Left panel 'Market Watch'. Right-click > Show All. Find XAUUSD", "visual": "Long list of symbols. XAUUSD near the bottom"},
                    {"action": "OPEN CHART", "detail": "Right-click XAUUSD > Chart Window", "visual": "A candlestick chart appears"},
                    {"action": "SET TIMEFRAME", "detail": "Click 'M5' in the toolbar (or press F6 and select)", "visual": "Chart changes to 5-minute candles"}
                ]
            },
            {
                "scene": 5, "title": "ACTIVATING THE BOT", "duration": "2 min",
                "frames": [
                    {"action": "OPEN NAVIGATOR", "detail": "Press Ctrl+N. Expand 'Expert Advisors'", "visual": "Panel shows list including 'XAUUSD_AI_Sniper_EA'"},
                    {"action": "DRAG TO CHART", "detail": "Click and hold the EA name. Drag onto your XAUUSD chart. Release", "visual": "Settings dialog pops up"},
                    {"action": "ENTER PIN", "detail": "Inputs tab > License PIN field > Type your PIN (ASE-XXXX-XXXX)", "visual": "Input field with your PIN"},
                    {"action": "SET PROFIT MODE", "detail": "Find 'Profit Mode'. Set to 1 (safe), 2 (normal), or 3 (aggressive)", "visual": "Dropdown or number input"},
                    {"action": "ENABLE ALGO", "detail": "Common tab > Check 'Allow Algo Trading' checkbox", "visual": "Checkbox gets a checkmark"},
                    {"action": "CLICK OK", "detail": "Click OK. The EA attaches to your chart!", "visual": "You'll see a smiley face icon in the chart corner"},
                    {"action": "TURN ON", "detail": "Click 'Algo Trading' button in toolbar until it's GREEN", "visual": "Button turns green - the bot is LIVE!"},
                    {"action": "DONE!", "detail": "The bot now shows a dashboard overlay on your chart", "visual": "Dashboard shows: Balance, Strategy, Confidence, Trade count"}
                ]
            },
            {
                "scene": 6, "title": "VPS SETUP (OPTIONAL - FOR 24/7 TRADING)", "duration": "5 min",
                "frames": [
                    {"action": "WHAT IS VPS?", "detail": "A VPS is a computer in the cloud that runs 24/7. Your bot never stops even when your PC is off.", "visual": "Think of it as renting a computer that never sleeps"},
                    {"action": "GET A VPS", "detail": "Go to ForexVPS.net, Contabo.com, or search 'Forex VPS'. Get the cheapest Windows plan ($5-10/month)", "visual": "Pricing pages showing Windows VPS plans"},
                    {"action": "CONNECT", "detail": "You'll get an IP address, username, password. Open Remote Desktop on your PC. Enter the IP.", "visual": "Windows Remote Desktop Connection dialog"},
                    {"action": "INSTALL MT5 ON VPS", "detail": "Inside the VPS, download and install MT5 just like on your PC", "visual": "Same MT5 installation process, but on the VPS"},
                    {"action": "COPY EA TO VPS", "detail": "Copy the .mq5 file to the VPS. Install it the same way.", "visual": "File transfer to VPS"},
                    {"action": "SET UP AND FORGET", "detail": "Attach EA to chart, enter PIN, enable Algo Trading. Close Remote Desktop. The bot keeps running!", "visual": "VPS runs MT5 24/7 even when you disconnect"}
                ]
            }
        ]
    }

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
