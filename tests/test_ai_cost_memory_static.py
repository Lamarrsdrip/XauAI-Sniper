from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA_ROOT = ROOT / "XAUUSD_AI_Sniper_EA_v6.9.0.mq5"
EA_BACKEND = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
SERVER = ROOT / "backend" / "server.py"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_ea_and_backend_copy_stay_identical():
    assert read(EA_ROOT) == read(EA_BACKEND)


def test_backend_has_llm_cost_budget_cache_and_local_only_guards():
    server = read(SERVER)

    for token in (
        "AI_COST_DAILY_CALL_LIMIT",
        "AI_COST_MIN_SECONDS",
        "AI_COST_CACHE_TTL_SECONDS",
        "_ai_cost_cache",
        "_ai_cost_stats",
        "_ai_cost_state_hash",
        "_ai_budget_allows",
        "_ai_cache_get",
        "_ai_cache_put",
        "_record_ai_cost",
        "_estimate_ai_tokens",
        "AI_COST_CACHE_HIT",
        "AI_COST_SKIP",
        "local_only_cost_guard",
        '@api_router.get("/ai/cost/stats")',
    ):
        assert token in server

    assert "asyncio.gather(claude_task, gpt_task)" not in server
    assert "_should_call_dual_ai" in server


def test_backend_has_trade_memory_store_query_and_report_contract():
    server = read(SERVER)

    for token in (
        "class TradeMemoryRecord",
        "class TradeMemoryQuery",
        "TRADE_MEMORY_PATH",
        "_trade_memory_state_hash",
        "_score_memory_similarity",
        "_build_memory_recommendation",
        '@api_router.post("/ai/memory/record")',
        '@api_router.post("/ai/memory/query")',
        '@api_router.get("/ai/memory/report")',
        "confidence_weight",
        "similar_memories",
        "AI-MEMORY",
    ):
        assert token in server


def test_ea_exposes_ai_cost_inputs_counters_and_dashboard_diagnostics():
    ea = read(EA_ROOT)

    for token in (
        "InpAICostDailyCallLimit",
        "InpAIMinEntryCallSec",
        "InpAIMarketStateCacheSec",
        "InpAIOnlyHighImpact",
        "InpAIMinGradeForLLM",
        "g_aiCallsToday",
        "g_aiCacheHitsToday",
        "g_aiSkippedToday",
        "g_aiEstimatedTokensToday",
        "g_aiEstimatedCostToday",
        "g_aiLastCallReason",
        "g_aiLastSkipReason",
        "XAU_AICostResetIfNewDay",
        "XAU_AICostStateHash",
        "XAU_AICostAllowEntry",
        "XAU_AICostRecordCall",
        "AI_COST_SKIP",
        "AI Cost:",
        "AI calls today:",
        "AI cache hits:",
    ):
        assert token in ea


def test_ea_rich_memory_records_similarity_and_backend_sync():
    ea = read(EA_ROOT)

    for token in (
        "XAUAI_ConsciousMemory_",
        "struct XAUConsciousMemoryStats",
        "XAU_AppendConsciousMemory",
        "XAU_QueryConsciousMemory",
        "XAU_MemoryInfluenceLabel",
        "XAU_MemoryCanInfluence",
        "XAU_MemoryRecommendation",
        "XAU_SendMemoryRecordToBackend",
        "XAU_PostTradeConsciousAnalysis",
        "XAU_WriteLearningReport",
        "AI-MEMORY:",
        "profit_left_after_exit",
        "risk_avoided_after_exit",
        "entry_quality",
        "exit_quality",
        "lot_quality",
        "should_hold_longer",
        "should_close_earlier",
        "what_ai_should_remember",
        "information only",
        "weak influence",
        "strong influence",
        "trusted pattern",
    ):
        assert token in ea


def test_memory_uses_aggregate_evidence_not_single_trade_replay():
    ea = read(EA_ROOT)
    server = read(SERVER)

    for token in (
        "samples >= 50",
        "samples >= 20",
        "samples >= 5",
        "samples < 5",
    ):
        assert token in ea

    for token in (
        "1 similar memory = information only",
        "5 similar memories = weak influence",
        "20+ similar memories = strong influence",
        "50+ similar memories = trusted pattern",
    ):
        assert token in server
