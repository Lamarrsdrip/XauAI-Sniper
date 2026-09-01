"""Regression locks for full-date broker-day state resets."""
from pathlib import Path


EA = (Path(__file__).resolve().parents[1] / "backend" / "ea_code" / "XauCloud.io.mq5").read_text(encoding="utf-8")


def test_daily_state_uses_full_broker_date_identity_not_day_of_month():
    assert "int XAU_BrokerDateKey(datetime when)" in EA
    assert "return dt.year * 10000 + dt.mon * 100 + dt.day;" in EA
    assert "XAU_BrokerDateKey(TimeCurrent()) != XAU_BrokerDateKey(todayLossResetDay)" in EA
    assert "XAU_BrokerDateKey(TimeCurrent()) != XAU_BrokerDateKey(lastDayReset)" in EA
    assert "dtNow.day != dtLast.day" not in EA


def test_july_9_and_august_9_are_different_reset_days():
    assert 20260709 != 20260809
