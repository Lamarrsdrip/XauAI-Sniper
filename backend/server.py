from fastapi import FastAPI, APIRouter, Response
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import zipfile
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

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
    london_start: int = 8
    london_end: int = 16
    ny_start: int = 13
    ny_end: int = 21
    equity_protection: float = 70.0
    consecutive_loss_max: int = 3
    magic_number: int = 20250101
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
    rsi_period: Optional[int] = 14
    atr_period: Optional[int] = 14
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

# -------------------------------------------------------------------
# ROUTES
# -------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "AI Sniper EA API v2.0"}

@api_router.get("/health")
async def health():
    return {"status": "ok", "service": "AI Sniper EA Backend"}

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
    configs = await db.ea_configs.find({}, {"_id": 0}).to_list(100)
    return configs

@api_router.get("/configs/{config_id}", response_model=EAConfig)
async def get_config(config_id: str):
    config = await db.ea_configs.find_one({"id": config_id}, {"_id": 0})
    if not config:
        return Response(status_code=404, content="Config not found")
    return config

@api_router.delete("/configs/{config_id}")
async def delete_config(config_id: str):
    result = await db.ea_configs.delete_one({"id": config_id})
    return {"deleted": result.deleted_count > 0}

# --- EA Download ---

@api_router.get("/download/ea")
async def download_ea():
    """Download the MQL5 Expert Advisor file"""
    ea_path = ROOT_DIR / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
    if not ea_path.exists():
        return Response(status_code=404, content="EA file not found")
    return FileResponse(
        path=str(ea_path),
        filename="XAUUSD_AI_Sniper_EA.mq5",
        media_type="application/octet-stream"
    )

@api_router.get("/download/package")
async def download_package():
    """Download complete EA package as ZIP"""
    ea_dir = ROOT_DIR / "ea_code"
    
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for file_path in ea_dir.rglob("*"):
            if file_path.is_file():
                arcname = file_path.relative_to(ea_dir)
                zf.write(file_path, arcname)
    
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=AI_Sniper_EA_Package.zip"}
    )

# --- Performance Data (sample/demo) ---

@api_router.get("/performance/summary")
async def get_performance_summary():
    """Return sample performance metrics for the dashboard"""
    return {
        "total_trades": 247,
        "win_rate": 68.4,
        "profit_factor": 2.31,
        "max_drawdown": 8.7,
        "avg_rr_ratio": 1.82,
        "weekly_return_avg": 12.6,
        "sharpe_ratio": 1.94,
        "best_week": 34.2,
        "worst_week": -6.8,
        "avg_trade_duration": "2h 15m",
        "longest_winning_streak": 9,
        "longest_losing_streak": 3,
        "monthly_returns": [
            {"month": "Jul 2025", "return": 42.1, "trades": 38},
            {"month": "Aug 2025", "return": 28.7, "trades": 31},
            {"month": "Sep 2025", "return": -4.2, "trades": 22},
            {"month": "Oct 2025", "return": 51.3, "trades": 41},
            {"month": "Nov 2025", "return": 35.8, "trades": 36},
            {"month": "Dec 2025", "return": 19.4, "trades": 29}
        ],
        "strategy_breakdown": [
            {"strategy": "Trend", "trades": 142, "win_rate": 72.5, "profit_share": 61.3},
            {"strategy": "Range", "trades": 58, "win_rate": 62.1, "profit_share": 18.7},
            {"strategy": "Breakout", "trades": 47, "win_rate": 66.0, "profit_share": 20.0}
        ],
        "weekly_data": [
            {"week": "W1", "return": 8.2, "drawdown": 2.1, "trades": 7},
            {"week": "W2", "return": 15.4, "drawdown": 3.5, "trades": 9},
            {"week": "W3", "return": -2.1, "drawdown": 5.8, "trades": 5},
            {"week": "W4", "return": 22.7, "drawdown": 1.9, "trades": 11},
            {"week": "W5", "return": 11.3, "drawdown": 4.2, "trades": 8},
            {"week": "W6", "return": 18.9, "drawdown": 2.7, "trades": 10},
            {"week": "W7", "return": -6.8, "drawdown": 8.7, "trades": 4},
            {"week": "W8", "return": 34.2, "drawdown": 1.4, "trades": 12}
        ],
        "equity_curve": [
            {"day": 1, "equity": 10000}, {"day": 5, "equity": 10820},
            {"day": 10, "equity": 12480}, {"day": 15, "equity": 12160},
            {"day": 20, "equity": 14890}, {"day": 25, "equity": 16200},
            {"day": 30, "equity": 18930}, {"day": 35, "equity": 17640},
            {"day": 40, "equity": 21580}, {"day": 45, "equity": 24100},
            {"day": 50, "equity": 26730}, {"day": 55, "equity": 28410},
            {"day": 60, "equity": 31200}
        ]
    }

# --- System Architecture Info ---

@api_router.get("/architecture")
async def get_architecture():
    return {
        "modules": [
            {
                "name": "Market Analysis Engine",
                "description": "Multi-layered market analysis using EMA, RSI, ATR, and Bollinger Bands across M5, H1, and H4 timeframes",
                "components": ["Trend Detection (EMA 50/200)", "Market Structure (HH/LL)", "Volatility Analysis (ATR)", "Multi-Timeframe Confirmation"]
            },
            {
                "name": "AI Adaptive Decision Engine",
                "description": "Classifies market conditions and automatically switches between strategies with confidence scoring",
                "components": ["Market Classifier (Trending/Ranging/Breakout)", "Strategy Selector", "Confidence Scoring (0-100)", "Dynamic Mode Switching"]
            },
            {
                "name": "Strategy Engine",
                "description": "Three specialized trading strategies optimized for different market conditions",
                "components": ["Trend Mode (EMA Pullback)", "Range Mode (BB S/R)", "Breakout Mode (Volatility)", "Smart Money Concepts"]
            },
            {
                "name": "Risk Management System",
                "description": "Institutional-grade risk controls to protect capital and prevent blow-up",
                "components": ["Dynamic Position Sizing", "ATR-based SL/TP", "Daily/Weekly Limits", "Equity Protection", "Cooldown System"]
            },
            {
                "name": "Trade Execution Engine",
                "description": "Precise order execution with spread filtering and slippage handling",
                "components": ["Market/Limit Orders", "Immediate SL/TP", "Spread Filter", "Partial Close", "Trailing Stop"]
            },
            {
                "name": "Performance Tracking",
                "description": "Comprehensive trade logging and performance analytics",
                "components": ["Trade Logger", "Win Rate Tracking", "Drawdown Monitoring", "Weekly Return Calc", "On-Chart Dashboard"]
            }
        ],
        "filters": [
            {"name": "Session Filter", "description": "London & New York sessions only"},
            {"name": "Spread Filter", "description": "Avoids high-spread conditions"},
            {"name": "News Filter", "description": "Avoids major economic events"},
            {"name": "Volatility Filter", "description": "Adapts to market volatility"}
        ]
    }

# --- Documentation ---

@api_router.get("/docs/installation")
async def get_installation_guide():
    return {
        "steps": [
            {
                "step": 1,
                "title": "Download the EA File",
                "description": "Download XAUUSD_AI_Sniper_EA.mq5 from the Download section above."
            },
            {
                "step": 2,
                "title": "Open MetaTrader 5",
                "description": "Launch your MetaTrader 5 terminal. Ensure you have a demo or live account connected."
            },
            {
                "step": 3,
                "title": "Copy to Data Folder",
                "description": "Navigate to File > Open Data Folder > MQL5 > Experts. Copy the .mq5 file here."
            },
            {
                "step": 4,
                "title": "Compile the EA",
                "description": "Open MetaEditor (F4), open the EA file, and press F7 to compile. Ensure zero errors."
            },
            {
                "step": 5,
                "title": "Attach to Chart",
                "description": "Open a XAUUSD M5 chart. Drag the EA from the Navigator panel onto the chart."
            },
            {
                "step": 6,
                "title": "Configure Settings",
                "description": "Adjust input parameters in the EA properties dialog. Set your risk %, strategy preferences, and session times."
            },
            {
                "step": 7,
                "title": "Enable Auto Trading",
                "description": "Click the 'Auto Trading' button in the toolbar to enable it. The EA will now monitor and trade automatically."
            },
            {
                "step": 8,
                "title": "Backtest First",
                "description": "Go to View > Strategy Tester. Select the EA, set XAUUSD M5, and run a backtest with historical data before live trading."
            }
        ],
        "requirements": [
            "MetaTrader 5 terminal (build 3000+)",
            "XAUUSD symbol available from your broker",
            "Stable internet connection",
            "Sufficient account balance (recommended: $1,000+ for micro lots)",
            "ECN or low-spread broker recommended"
        ],
        "warnings": [
            "Always start with a demo account",
            "Past performance does not guarantee future results",
            "Never risk money you cannot afford to lose",
            "Ensure your broker allows Expert Advisors"
        ]
    }

@api_router.get("/docs/parameters")
async def get_parameter_docs():
    return {
        "groups": [
            {
                "name": "Risk Management",
                "params": [
                    {"name": "Risk %", "key": "risk_percent", "default": 1.0, "range": "0.1-3.0", "description": "Percentage of account balance risked per trade"},
                    {"name": "Daily Loss Limit", "key": "daily_loss_limit", "default": 3.0, "range": "1-10", "description": "Maximum daily loss as % of equity before stopping"},
                    {"name": "Weekly Drawdown", "key": "weekly_drawdown_limit", "default": 10.0, "range": "5-20", "description": "Maximum weekly equity drawdown before stopping"},
                    {"name": "Weekly Target", "key": "weekly_profit_target", "default": 35.0, "range": "10-100", "description": "Weekly profit target (reduces risk when reached)"},
                    {"name": "Max Open Trades", "key": "max_open_trades", "default": 2, "range": "1-5", "description": "Maximum simultaneous open positions"},
                    {"name": "Max Trades/Day", "key": "max_trades_per_day", "default": 3, "range": "1-10", "description": "Maximum number of trades per day"}
                ]
            },
            {
                "name": "Strategy",
                "params": [
                    {"name": "Trend Mode", "key": "enable_trend_mode", "default": True, "description": "Enable trend-following strategy"},
                    {"name": "Range Mode", "key": "enable_range_mode", "default": True, "description": "Enable range-trading strategy"},
                    {"name": "Breakout Mode", "key": "enable_breakout_mode", "default": True, "description": "Enable breakout strategy"},
                    {"name": "Confidence Threshold", "key": "confidence_threshold", "default": 75, "range": "50-95", "description": "Minimum confidence score to execute a trade"}
                ]
            },
            {
                "name": "Trade Management",
                "params": [
                    {"name": "Min R:R Ratio", "key": "min_rr_ratio", "default": 1.5, "range": "1.0-5.0", "description": "Minimum risk-to-reward ratio"},
                    {"name": "Partial Close %", "key": "partial_close_percent", "default": 50.0, "range": "30-80", "description": "Percentage to close at first target"},
                    {"name": "Trailing ATR Multi", "key": "trailing_atr_multi", "default": 1.5, "range": "0.5-3.0", "description": "ATR multiplier for trailing stop"},
                    {"name": "SL ATR Multi", "key": "sl_atr_multiplier", "default": 2.0, "range": "1.0-4.0", "description": "ATR multiplier for initial stop loss"}
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

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
