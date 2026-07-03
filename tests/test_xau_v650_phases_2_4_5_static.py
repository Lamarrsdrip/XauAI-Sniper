from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.12.0.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
SERVER = ROOT / "backend" / "server.py"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def test_v650_fixes_are_still_present_and_backend_stays_synced():
    # v6.6.0: the exact v6.5.0 identity assertions are obsolete now that the
    # file has moved on to v6.6.0 (verified by its own dedicated test file).
    # Root/backend sync is the enduring check kept from this file's purpose.
    ea = read(EA)
    backend = read(BACKEND_EA)
    assert ea == backend


def test_bug5_growth_guard_tautology_fixed_and_scales_with_june_mode():
    ea = read(EA)

    assert 'input double InpGrowthJuneModeCapSLMultiple' in ea

    fn_start = ea.index("bool XAU_GrowthGuardManagePosition(ulong ticket, bool isBuy, double openPx,")
    fn_snippet = ea[fn_start:fn_start + 6000]

    # cap must be raised to at least the real SL risk in June mode
    assert "if(InpLotSizingMode == JUNE_16_19_BALANCE_MODE && slDist > 0.0 && lotsOpen > 0.0)" in fn_snippet
    assert "double realSLRiskUSD = RiskPerLotForDistance(slDist) * lotsOpen;" in fn_snippet

    # the tautological clause (compared against its own default) must be gone
    assert "maxTradeLossUSD <= equity * 0.015" not in fn_snippet
    assert "maxTradeLossUSD <= equity * 0.008" in fn_snippet


def test_bug8_ai_fallback_confidence_is_honest():
    server = read(SERVER)

    # genuine dual-SKIP (both providers answered) keeps a real confidence
    assert 'confidence = 50' in server
    assert 'if c_ok and g_ok:' in server
    # fallback/error paths must NOT claim confidence=50 anymore
    assert 'return {"action": "SKIP", "confidence": 50, "reason": f"AI error' not in server
    assert 'return {"action": "SKIP", "confidence": 0, "reason": f"AI error' in server

    ea = read(EA)
    # EA must not halve B-grade lot size when the AI never actually answered
    reduce_idx = ea.index('AI DIRECTOR: REDUCE (AI SKIP, real confidence=')
    snippet = ea[reduce_idx - 800:reduce_idx + 400]
    assert "if(lastAIConfidence > 0)" in snippet
    assert "NO-AI-ANSWER" in snippet


def test_bug6_second_chance_and_cycle_decay_require_evidence_when_profitable():
    ea = read(EA)

    # SECOND_CHANCE_PROFIT_EXIT must now route through the gate
    sc_idx = ea.index("SECOND_CHANCE_PROFIT_EXIT BASKET | recovered to $%.2f after peak $%.2f")
    sc_snippet = ea[sc_idx:sc_idx + 1600]
    assert "XAU_GateEarlyLossClose(0, basketDirSC >= 0" in sc_snippet
    assert ", true))" in sc_snippet  # isGivebackTrigger=true

    # both CYCLE_DECAY_EXIT gate calls must pass isGivebackTrigger=true
    assert ea.count('"CYCLE_DECAY_EXIT BASKET",\n                                XAU_BasketStructureBroken(basketDirCD1), false, -1.0, true))') == 1
    assert ea.count('"CYCLE_DECAY_EXIT BASKET",\n                                XAU_BasketStructureBroken(basketDirCD2), false, -1.0, true))') == 1


def test_phase4_unified_reversal_confirmation_exists_and_is_used():
    ea = read(EA)

    assert "bool XAU_ReversalConfirmed(ulong ticket, bool isBuy, bool structureConfirmedBroken," in ea

    fn_start = ea.index("bool XAU_ReversalConfirmed(ulong ticket, bool isBuy, bool structureConfirmedBroken,")
    fn_end = ea.index("\n}\n", fn_start)
    fn_body = ea[fn_start:fn_end]

    # must incorporate the per-ticket BOS/HTF flip via TTM's entry snapshot —
    # the exact capability gap the audit found in per-ticket gate calls
    assert "TTM_FindActiveSlot(ticket)" in fn_body
    assert "int tradeDir = isBuy ? 1 : -1;" in fn_body
    assert "XAU_NewHostileStructureFlip(entryBOS, g_smc_bos_dir, tradeDir)" in fn_body
    assert "XAU_NewHostileStructureFlip(entryHTF, g_htfConsensusDir, tradeDir)" in fn_body

    # both duplicated call sites must now route through the canonical function
    assert "bool reversalConfirmedGiveback = XAU_ReversalConfirmed(ticket, isBuy, structureConfirmedBroken," in ea
    assert "bool reversalConfirmedTrend = XAU_ReversalConfirmed(ticket, isBuy, structureConfirmedBroken," in ea


def test_phase5_no_hardcoded_admin_password_and_cookie_is_secure():
    server = read(SERVER)

    assert 'admin_password = admin_password_env or "Admin@2026!"' not in server
    assert "secrets.token_urlsafe(18)" in server
    assert 'secure=os.environ.get(\'COOKIE_SECURE\', \'true\').lower() != \'false\'' in server
    assert "_load_or_create_jwt_secret" in server
    assert "allow_credentials=(_cors_origins != ['*'])" in server


def test_phase5_dead_code_removed():
    assert not (ROOT / "frontend" / "src" / "components" / "PinManagerSection.jsx").exists()
    assert not (ROOT / "backend_test.py").exists()


def test_no_new_protective_or_restrictive_defaults_introduced():
    ea = read(EA)

    # unchanged from prior releases — no new hard veto/reduction defaults
    assert "InpAllowEarlyLossExit            = false;" in ea
    assert "InpAllowGivebackPanicClose       = false;" in ea
    assert 'InpBasketSoftLockIgnoresCloudSafe = true;' in ea
    # the new June-mode multiple defaults to 1.0 (match real SL, not tighter)
    assert "InpGrowthJuneModeCapSLMultiple       = 1.0;" in ea
