from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5").read_text()
SERVER = (ROOT / "backend" / "server.py").read_text()
DASHBOARD = (ROOT / "frontend" / "src" / "components" / "cloud" / "CloudDashboard.jsx").read_text()


def test_prop_firm_settings_are_command_center_owned_not_ea_inputs():
    assert "input bool   InpPropFirmMode" not in EA
    assert "input double InpPropFirmDailyLossPct" not in EA
    assert "g_propFirmMode = false" in EA
    assert "UPDATE_PROP_FIRM_CONFIG" in EA
    assert "PROP FIRM MODE" in DASHBOARD


def test_backend_validates_and_persists_prop_firm_configuration_per_license():
    assert '"UPDATE_PROP_FIRM_CONFIG": "Update prop firm protection"' in SERVER
    assert "_normalize_prop_firm_config" in SERVER
    assert "prop_firm_requested" in SERVER
    assert "prop_firm_applied" in SERVER
    assert '@api_router.get("/cloud/prop-firm/config")' in SERVER


def test_ea_persists_remote_config_and_reports_applied_state():
    assert "LoadPropFirmConfig()" in EA
    assert "SavePropFirmConfig()" in EA
    assert "GlobalVariableGet" in EA
    assert "GlobalVariableSet" in EA
    assert "prop_firm_mode" in EA
    assert "prop_daily_loss_pct" in EA
    assert "prop_max_loss_pct" in EA
    assert "prop_risk_per_trade_pct" in EA
    assert "prop_max_basket_risk_pct" in EA


def test_prop_firm_mode_caps_risk_without_changing_entry_intelligence():
    assert "EffectiveSingleRiskCapPct()" in EA
    assert "EffectiveAggregateRiskCapPct()" in EA
    assert "PROP-FIRM RISK CAP" in EA
    assert "PROP-FIRM MODE: large-account risk floor disabled" in EA
    timing_guard = EA[EA.index("bool XAUEntryTimingGuard"):EA.index("void OpenTrade")]
    assert "g_propFirmMode" not in timing_guard


def test_prop_firm_pyramid_allows_only_one_confirmed_retest_add_inside_budget():
    assert "g_propFirmAllowOneRetestAdd" in EA
    assert "g_propFirmRetestAddLotMulti" in EA
    assert "PROP-FIRM PYRAMID BLOCK" in EA
    assert "one confirmed retest add already used" in EA
    assert "pyramidSizeMulti *= g_propFirmRetestAddLotMulti" in EA


def test_command_center_has_editable_limits_and_applied_status():
    for label in (
        "Daily loss limit",
        "Maximum total loss",
        "Risk per trade",
        "Maximum basket risk",
        "Safety buffer",
        "Allow one confirmed retest add",
        "Apply to EA",
        "Applied by EA",
    ):
        assert label in DASHBOARD


def test_version_is_updated():
    assert "v5.9.0" in EA
    assert '\\"ea_version\\":\\"v5.9.0\\"' in EA
