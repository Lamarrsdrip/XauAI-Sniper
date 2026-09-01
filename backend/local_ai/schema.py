from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields
from typing import Any

SCHEMA_VERSION = "xaucloud-local-ai-v4"

DIRECTIONS = {"BUY", "SELL", "NONE"}
MARKET_STATES = {"TREND", "PULLBACK", "BREAKOUT", "REVERSAL", "RANGE", "NO_EDGE"}
STRUCTURE_STATES = {"CONFIRMED", "DEVELOPING", "BROKEN", "UNCLEAR"}
MOMENTUM_STATES = {"IMPROVING", "STABLE", "WEAKENING", "CONTRADICTORY"}
LOCATION_QUALITIES = {"GOOD", "EXCELLENT", "LATE", "RESET_PENDING", "OTHER"}


class SchemaError(ValueError):
    pass


@dataclass(frozen=True)
class Snapshot:
    symbol: str
    closed_m10_timestamp: int
    recent_m10_ohlc: list[list[float]]
    atr: float
    volatility_state: str
    ema_state: str
    rsi: float
    momentum_score: float
    buy_score: float
    sell_score: float
    preferred_direction: str
    setup: str
    grade: str
    session: str
    regime: str
    location: str
    structure_state: str
    breakout_state: str
    pullback_state: str
    reset_state: str
    reward_room_r: float
    higher_timeframe_context: str
    open_position_state: str
    allowed_candidate_setups: list[str]
    model_name: str
    prompt_schema_version: str = SCHEMA_VERSION

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Snapshot":
        if not isinstance(raw, dict):
            raise SchemaError("snapshot must be an object")
        expected = {field.name for field in fields(cls)}
        extra = set(raw) - expected
        if extra:
            raise SchemaError(f"unknown snapshot fields: {sorted(extra)}")
        missing = expected - set(raw) - {"prompt_schema_version"}
        if missing:
            raise SchemaError(f"missing snapshot fields: {sorted(missing)}")

        values = dict(raw)
        values.setdefault("prompt_schema_version", SCHEMA_VERSION)
        if values["prompt_schema_version"] != SCHEMA_VERSION:
            raise SchemaError("unsupported prompt/schema version")
        values["symbol"] = _short_text(values["symbol"], "symbol", 24)
        values["model_name"] = _short_text(values["model_name"], "model_name", 96)
        for name in (
            "volatility_state", "ema_state", "setup", "grade", "session", "regime",
            "location", "structure_state", "breakout_state", "pullback_state",
            "reset_state", "higher_timeframe_context", "open_position_state",
        ):
            values[name] = _short_text(values[name], name, 160)
        values["preferred_direction"] = _enum(values["preferred_direction"], "preferred_direction", DIRECTIONS)
        if not isinstance(values["closed_m10_timestamp"], int) or values["closed_m10_timestamp"] <= 0:
            raise SchemaError("closed_m10_timestamp must be a positive integer")
        for name in ("atr", "rsi", "momentum_score", "buy_score", "sell_score", "reward_room_r"):
            values[name] = _number(values[name], name, -1_000_000.0, 1_000_000.0)
        ohlc = values["recent_m10_ohlc"]
        if not isinstance(ohlc, list) or not 1 <= len(ohlc) <= 6:
            raise SchemaError("recent_m10_ohlc must contain 1..6 closed candles")
        parsed_ohlc: list[list[float]] = []
        for index, candle in enumerate(ohlc):
            if not isinstance(candle, list) or len(candle) != 4:
                raise SchemaError(f"recent_m10_ohlc[{index}] must be [open,high,low,close]")
            parsed_ohlc.append([_number(v, f"ohlc[{index}]", 0.0, 1_000_000.0) for v in candle])
        values["recent_m10_ohlc"] = parsed_ohlc
        allowed_setups = values["allowed_candidate_setups"]
        if not isinstance(allowed_setups, list) or not 1 <= len(allowed_setups) <= 12:
            raise SchemaError("allowed_candidate_setups must contain 1..12 existing setup names")
        values["allowed_candidate_setups"] = [
            _short_code(value) for value in allowed_setups
        ]
        return cls(**values)


@dataclass(frozen=True)
class Decision:
    preferred_direction: str
    candidate_allowed: bool
    candidate_setup: str
    market_state: str
    structure_state: str
    momentum_state: str
    location_quality: str
    confidence: int
    reason_codes: list[str]
    short_reason: str

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> "Decision":
        if not isinstance(raw, dict):
            raise SchemaError("decision must be an object")
        expected = {field.name for field in fields(cls)}
        if set(raw) != expected:
            raise SchemaError(f"decision fields must be exactly {sorted(expected)}")
        if not isinstance(raw["candidate_allowed"], bool):
            raise SchemaError("candidate_allowed must be boolean")
        confidence = raw["confidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, int) or not 0 <= confidence <= 100:
            raise SchemaError("confidence must be an integer from 0 to 100")
        reason_codes = raw["reason_codes"]
        if not isinstance(reason_codes, list) or len(reason_codes) > 6:
            raise SchemaError("reason_codes must be an array of at most 6 items")
        parsed_codes = [_short_code(item) for item in reason_codes]
        return cls(
            preferred_direction=_enum(raw["preferred_direction"], "preferred_direction", DIRECTIONS),
            candidate_allowed=raw["candidate_allowed"],
            candidate_setup=_short_text(raw["candidate_setup"], "candidate_setup", 96),
            market_state=_enum(raw["market_state"], "market_state", MARKET_STATES),
            structure_state=_enum(raw["structure_state"], "structure_state", STRUCTURE_STATES),
            momentum_state=_enum(raw["momentum_state"], "momentum_state", MOMENTUM_STATES),
            location_quality=_enum(raw["location_quality"], "location_quality", LOCATION_QUALITIES),
            confidence=confidence,
            reason_codes=parsed_codes,
            short_reason=_short_text(raw["short_reason"], "short_reason", 240),
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


DECISION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [field.name for field in fields(Decision)],
    "properties": {
        "preferred_direction": {"type": "string", "enum": sorted(DIRECTIONS)},
        "candidate_allowed": {"type": "boolean"},
        "candidate_setup": {"type": "string", "maxLength": 96},
        "market_state": {"type": "string", "enum": sorted(MARKET_STATES)},
        "structure_state": {"type": "string", "enum": sorted(STRUCTURE_STATES)},
        "momentum_state": {"type": "string", "enum": sorted(MOMENTUM_STATES)},
        "location_quality": {"type": "string", "enum": sorted(LOCATION_QUALITIES)},
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
        "reason_codes": {
            "type": "array", "maxItems": 6,
            "items": {"type": "string", "pattern": "^[A-Z0-9_]{1,48}$"},
        },
        "short_reason": {"type": "string", "maxLength": 240},
    },
}


def snapshot_signature(snapshot: Snapshot) -> str:
    canonical = json.dumps(asdict(snapshot), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _enum(value: Any, name: str, allowed: set[str]) -> str:
    value = _short_text(value, name, 96).upper()
    if value not in allowed:
        raise SchemaError(f"{name} must be one of {sorted(allowed)}")
    return value


def _short_text(value: Any, name: str, limit: int) -> str:
    if not isinstance(value, str):
        raise SchemaError(f"{name} must be a string")
    value = value.strip()
    if not value or len(value) > limit or any(ord(char) < 32 for char in value):
        raise SchemaError(f"{name} must contain 1..{limit} printable characters")
    return value


def _short_code(value: Any) -> str:
    value = _short_text(value, "reason_code", 48).upper()
    if not all(char.isdigit() or "A" <= char <= "Z" or char == "_" for char in value):
        raise SchemaError("reason codes may contain only A-Z, 0-9 and underscore")
    return value


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaError(f"{name} must be numeric")
    value = float(value)
    if value != value or not minimum <= value <= maximum:
        raise SchemaError(f"{name} is outside the allowed range")
    return value
