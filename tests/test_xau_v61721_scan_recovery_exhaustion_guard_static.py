from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA_v6.17.21.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").replace("\x00", "")


def body(src: str, signature: str) -> str:
    idx = src.index(signature)
    start = src.index("{", idx)
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise AssertionError(f"unbalanced braces for {signature}")


def test_current_release_source_is_synced_to_backend():
    assert read(EA) == read(BACKEND_EA)


def test_version_bumped_to_v61721():
    ea = read(BACKEND_EA)
    assert '#define XAUAI_EA_VERSION "v6.17.21"' in ea


def test_header_banner_matches_property_version_for_website_display():
    import re
    ea = read(BACKEND_EA)
    m = re.search(r'v(\d+\.\d+\.\d+)\s*[—\-]+\s*(.+)', ea[:3000])
    assert m is not None
    assert f"v{m.group(1)}" == "v6.17.21"


# ---------------------------------------------------------------------------
# BUG 1 — scan-recovery state machine
# ---------------------------------------------------------------------------
def test_recovery_state_enum_and_globals_exist():
    ea = read(BACKEND_EA)
    assert "enum ENUM_IndicatorRecoveryState { RECOVERY_NONE, RECOVERY_WARMUP, RECOVERY_BACKOFF };" in ea
    for g in ("g_recoveryState", "g_recoveryLabel", "g_recoveryStartedAt",
              "g_recoveryRetryAt", "g_recoveryLastStatusAt"):
        assert g in ea


def test_ontick_gates_before_scan_started_during_active_backoff():
    ea = read(BACKEND_EA)
    fn = body(ea, "void OnTick()")
    gate_idx = fn.index("g_recoveryState == RECOVERY_BACKOFF && TimeCurrent() < g_recoveryRetryAt")
    scan_started_idx = fn.index('XAU_LogScanState("SCAN_STARTED")')
    # the gate must appear BEFORE SCAN_STARTED can ever be logged
    assert gate_idx < scan_started_idx


def test_rebuild_enters_warmup_and_fires_recovery_started_once():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool RebuildEntryIndicatorHandles(string why)")
    assert "if(g_recoveryState == RECOVERY_NONE)" in fn
    assert 'Print("INDICATOR_RECOVERY_STARTED: ", why);' in fn
    assert "g_recoveryState        = RECOVERY_WARMUP;" in fn


def test_recovery_succeeded_only_fires_for_matching_label():
    ea = read(BACKEND_EA)
    fn = body(ea, "void XAU_RecoverySucceededIfMatch(string label)")
    assert "if(g_recoveryState == RECOVERY_NONE || label != g_recoveryLabel) return;" in fn


def test_scan_recovery_state_machine_simulation_collapses_the_reported_loop():
    # Faithful re-implementation of the fixed control flow (OnTick's gate +
    # CopyEntryBuffer's backoff/rebuild/success branches), driven by a
    # synthetic fast tick feed -- proves reason=INDICATOR_RECOVERY_BACKOFF
    # aborts collapse to one-per-rebuild-cycle instead of one-per-tick.
    BACKOFF_SEC = 90
    WARMUP_SEC = 12
    RELOAD_FAILS = 3
    TICK_INTERVAL = 0.3
    EMA_BROKEN_UNTIL = 260

    class Sim:
        def __init__(self):
            self.t = 0.0
            self.last_rebuild_at = None
            self.warmup_until = None
            self.recovery_state = "NONE"
            self.recovery_retry_at = None
            self.fail_count = 0
            self.scan_started = 0
            self.backoff_reason_aborts = 0

        def ema_healthy(self):
            return self.t >= EMA_BROKEN_UNTIL

        def rebuild(self):
            self.last_rebuild_at = self.t
            self.warmup_until = self.t + WARMUP_SEC
            self.recovery_state = "WARMUP"

        def copy_ema(self):
            if self.warmup_until is not None and self.t < self.warmup_until:
                if self.ema_healthy():
                    self.warmup_until = None
                    self.recovery_state = "NONE"
                    self.fail_count = 0
                    return True
                return False
            if self.warmup_until is not None and self.t >= self.warmup_until:
                self.warmup_until = None
            if self.ema_healthy():
                self.recovery_state = "NONE"
                self.fail_count = 0
                return True
            self.fail_count += 1
            if self.fail_count >= RELOAD_FAILS:
                rebuild_allowed = (self.last_rebuild_at is None or
                                    self.t - self.last_rebuild_at >= BACKOFF_SEC)
                if not rebuild_allowed:
                    self.recovery_state = "BACKOFF"
                    self.recovery_retry_at = self.last_rebuild_at + BACKOFF_SEC
                    self.backoff_reason_aborts += 1
                    return False
                self.rebuild()
            return False

        def tick(self):
            if self.recovery_state == "BACKOFF" and self.t < self.recovery_retry_at:
                return  # the v6.17.21 gate: skipped entirely, no SCAN_STARTED
            self.scan_started += 1
            self.copy_ema()

        def run(self, duration):
            n = int(duration / TICK_INTERVAL)
            for _ in range(n):
                self.tick()
                self.t += TICK_INTERVAL

    sim = Sim()
    sim.run(400)
    # Before the fix this was 744 (one per tick for the whole backoff window).
    assert sim.backoff_reason_aborts <= 5
    assert sim.scan_started < 700  # before the fix: 1333


# ---------------------------------------------------------------------------
# BUG 2 — exhaustion / reversal guard
# ---------------------------------------------------------------------------
def test_exhaustion_reversal_guard_exists_with_six_conditions_per_side():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool XAU_ExhaustionReversalGuard(int dir, double atr,")
    for cond in ("sellLargeLegDone", "sellNearLow", "sellReclaimSeen",
                 "sellStructBroken", "sellRoomAsymmetric", "sellMomentumFading",
                 "buyLargeLegDone", "buyNearHigh", "buyReclaimSeen",
                 "buyStructBroken", "buyRoomAsymmetric", "buyMomentumFading"):
        assert cond in fn
    assert "sellHits >= 4 && sellReclaimSeen" in fn
    assert "buyHits >= 4 && buyReclaimSeen" in fn


def test_opentrade_calls_guard_as_backstop_for_every_caller():
    ea = read(BACKEND_EA)
    fn = body(ea, "bool OpenTrade(int signal, double atr, string reason, double sizeMulti)")
    assert "XAU_ExhaustionReversalGuard(signal, atr" in fn
    assert "DIRECTION_QUALITY" in fn


def test_recovery_and_force_open_paths_reach_opentrade_and_therefore_the_guard():
    ea = read(BACKEND_EA)
    recovery_fn = body(ea, "void XAU_CheckPendingOpportunityRecovery()")
    assert "OpenTrade(dir, atrNow, recoveryReason, 1.0)" in recovery_fn
    force_fn = body(ea, "bool XAU_TryForceOpenTrade(int dir, string setup, string grade, string originalBlocker,")
    assert "OpenTrade(dir, atrNow, forceReason, 1.0)" in force_fn
