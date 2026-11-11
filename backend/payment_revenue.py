"""USD revenue from stored payment records. Does not mutate orders or invent exchange rates."""
from __future__ import annotations

PENDING = {
    "pending", "PENDING",
    "MANUAL_PENDING", "MANUAL_SUBMITTED", "MANUAL_EXPIRED",
    "FULFILLING", "PAID", "VERIFYING",
    "BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED", "UNDER_ADMIN_REVIEW",
}
MAX_USD_CENTS = 100_000_000


def format_usd_from_cents(cents: int) -> str:
    negative = cents < 0
    absolute = abs(int(cents))
    return f"{'-' if negative else ''}${absolute // 100:,}.{absolute % 100:02d}"


def _positive_int(value):
    return value if type(value) is int and value > 0 else None


def _positive_finite(value):
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value or value in (float("inf"), float("-inf")) or value <= 0:
        return None
    return float(value)


def _accept(cents) -> int | None:
    if type(cents) is not int or cents <= 0 or cents > MAX_USD_CENTS:
        return None
    return cents


def _success(status: str) -> bool:
    return status == "FULFILLED" or status.lower() == "success"


def usd_cents_for_successful_payment(tx: dict) -> int | None:
    recorded = _positive_int(tx.get("price_usd_cents"))
    if recorded is not None:
        return _accept(recorded)
    currency = str(tx.get("currency") or "").upper()
    if currency in ("USDT", "USDC"):
        return None
    if currency == "USD":
        return _accept(_positive_int(tx.get("amount_minor")) or _positive_int(tx.get("amount_kobo")) or 0)
    if currency not in ("NGN", ""):
        return None
    if str(tx.get("display_currency") or "").upper() != "USD":
        return None
    shown = _positive_finite(tx.get("display_amount"))
    if shown is not None:
        return _accept(int(round(shown * 100)))
    rate = _positive_finite(tx.get("fx_rate"))
    kobo = _positive_int(tx.get("amount_kobo"))
    if rate is None or kobo is None:
        return None
    return _accept(int(round((kobo / 100) * rate * 100)))


def _created(tx: dict) -> str:
    value = tx.get("created_at")
    return value.isoformat() if hasattr(value, "isoformat") else value if isinstance(value, str) else ""


def summarize_payment_revenue(rows, range_from: str | None = None, range_to: str | None = None) -> dict:
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
            cents = usd_cents_for_successful_payment(tx)
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
            f"{excluded} successful historical payment{'s' if excluded != 1 else ''} had no recorded USD price or exchange rate and "
            f"{'were' if excluded != 1 else 'was'} excluded from revenue."
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
    return summarize_payment_revenue(rows, range_from, range_to)
