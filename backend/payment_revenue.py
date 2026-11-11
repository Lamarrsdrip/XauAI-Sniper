"""USD revenue from stored payment records. Does not mutate orders.
Legacy naira amounts convert with that payment's own recorded FX, otherwise
the administrator's saved NGN-per-USD rate. No rate is invented.
"""
from __future__ import annotations

from datetime import datetime, timezone

PENDING = {
    "pending", "PENDING",
    "MANUAL_PENDING", "MANUAL_SUBMITTED", "MANUAL_EXPIRED",
    "FULFILLING", "PAID", "VERIFYING",
    "BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED", "UNDER_ADMIN_REVIEW",
}
MAX_USD_CENTS = 100_000_000
DEFAULT_NGN_PER_USD = 1400.0
RATE_POLICY_AT = datetime(2026, 11, 11, tzinfo=timezone.utc)


def format_usd_from_cents(cents: int) -> str:
    negative = cents < 0
    absolute = abs(int(cents))
    return f"{'-' if negative else ''}${absolute // 100:,}.{absolute % 100:02d}"


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return float(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return value
    if isinstance(value, str) and value.strip():
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _positive(value):
    number = _number(value)
    return number if number is not None and number > 0 else None


def _accept(cents) -> int | None:
    if isinstance(cents, bool) or not isinstance(cents, (int, float)):
        return None
    rounded = int(round(cents))
    if rounded <= 0 or rounded > MAX_USD_CENTS:
        return None
    return rounded


def _success(status: str) -> bool:
    return status == "FULFILLED" or status.lower() == "success"


def _ngn_kobo_to_usd_cents(kobo: float, rate: float) -> int | None:
    if kobo <= 0 or rate <= 0:
        return None
    return _accept(kobo / rate if rate >= 50 else kobo * rate)


def usd_cents_for_successful_payment(tx: dict, ngn_per_usd: float | None = None) -> int | None:
    recorded = _positive(tx.get("price_usd_cents"))
    if recorded is not None:
        return _accept(recorded)
    currency = str(tx.get("currency") or "").upper()
    minor = _positive(tx.get("amount_minor")) or _positive(tx.get("amount_kobo"))
    if currency == "USD":
        return _accept(minor) if minor is not None else None
    if currency in ("USDT", "USDC"):
        return _accept(minor) if minor is not None else None
    kobo = _positive(tx.get("amount_kobo")) or (_positive(tx.get("amount_minor")) if currency == "NGN" else None)
    if kobo is None or currency not in ("NGN", ""):
        return None
    display = str(tx.get("display_currency") or "").upper()
    if display == "USD":
        shown = _positive(tx.get("display_amount"))
        if shown is not None:
            return _accept(shown * 100)
    if display in ("", "USD", "NGN"):
        own_rate = _positive(tx.get("fx_rate"))
        if own_rate is not None:
            return _ngn_kobo_to_usd_cents(kobo, own_rate)
    if ngn_per_usd is None:
        return None
    return _ngn_kobo_to_usd_cents(kobo, ngn_per_usd)


def _created(tx: dict) -> str:
    value = tx.get("created_at")
    return value.isoformat() if hasattr(value, "isoformat") else value if isinstance(value, str) else ""


def summarize_payment_revenue(rows, range_from: str | None = None, range_to: str | None = None, ngn_per_usd: float | None = None) -> dict:
    chosen = {}
    anonymous = []
    for row in rows:
        reference = row.get("reference") if isinstance(row.get("reference"), str) else ""
        if not reference:
            anonymous.append(row)
            continue
        previous = chosen.get(reference)
        if previous is None or (not _success(str(previous.get("payment_status") or "")) and _success(str(row.get("payment_status") or ""))):
            chosen[reference] = row
    revenue = successful = pending = failed = total = excluded = 0
    for tx in [*chosen.values(), *anonymous]:
        created = _created(tx)
        if range_from or range_to:
            if not created or (range_from and created < range_from) or (range_to and created > range_to):
                continue
        total += 1
        status = str(tx.get("payment_status") or "")
        if _success(status):
            successful += 1
            cents = usd_cents_for_successful_payment(tx, ngn_per_usd)
            if cents is None:
                excluded += 1
            else:
                revenue += cents
        elif status in PENDING or status.lower() == "pending":
            pending += 1
        else:
            failed += 1
    return {
        "currency": "USD",
        "total_revenue_usd_cents": revenue,
        "amount": revenue / 100,
        "formatted_revenue": format_usd_from_cents(revenue),
        "successful_payments": successful,
        "total_orders": total,
        "total_transactions": total,
        "pending_payments": pending,
        "failed_rejected_payments": failed,
        "excluded_unconverted_payments": excluded,
        "excluded_unconverted_note": (
            f"{excluded} successful payment{'s' if excluded != 1 else ''} had no amount and no USD/NGN rate, so "
            f"{'they were' if excluded != 1 else 'it was'} left out of the USD total."
        ) if excluded else "",
    }


async def payment_revenue_report(db, range_from: str | None = None, range_to: str | None = None) -> dict:
    query = {}
    if range_from or range_to:
        created = {}
        if range_from:
            created["$gte"] = range_from
        if range_to:
            created["$lte"] = range_to
        query["created_at"] = created
    rows = await db.payment_transactions.find(query, {
        "_id": 0, "reference": 1, "payment_status": 1, "provider": 1, "method": 1, "currency": 1,
        "amount_minor": 1, "amount_kobo": 1, "price_usd_cents": 1, "created_at": 1,
        "display_currency": 1, "display_amount": 1, "fx_rate": 1,
    }).to_list(length=100000)
    settings = await db.admin_settings.find_one({"key": "main"}, {"_id": 0, "direct_usd_ngn_rate": 1, "direct_fx_as_of": 1})
    rate = _positive((settings or {}).get("direct_usd_ngn_rate"))
    reviewed = (settings or {}).get("direct_fx_as_of")
    reviewed_at = None
    if isinstance(reviewed, str):
        try:
            reviewed_at = datetime.fromisoformat(reviewed.replace("Z", "+00:00"))
        except ValueError:
            reviewed_at = None
    if reviewed_at is not None and reviewed_at.tzinfo is None:
        reviewed_at = reviewed_at.replace(tzinfo=timezone.utc)
    ngn_per_usd = rate if rate is not None and 50 <= rate <= 1_000_000 and reviewed_at is not None and reviewed_at >= RATE_POLICY_AT else DEFAULT_NGN_PER_USD
    return summarize_payment_revenue(rows, range_from, range_to, ngn_per_usd)
