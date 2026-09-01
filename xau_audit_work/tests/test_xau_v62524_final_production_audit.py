import csv
import hashlib
import json
import re
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EA = ROOT / "XAUUSD_AI_Sniper_EA.mq5"
BACKEND_EA = ROOT / "backend" / "ea_code" / "XAUUSD_AI_Sniper_EA.mq5"
RUN = ROOT / "analysis" / "tradebrain" / "V62524_M10_90D_20260422_20260721_RUN1"
SEED = RUN / "reports" / "XAUAI_ValidatedTradeBrainSeed_v1.json"


def source() -> str:
    return EA.read_text(encoding="utf-8")


class FinalProductionAuditTests(unittest.TestCase):
    def test_canonical_sources_are_identical(self):
        self.assertEqual(EA.read_bytes(), BACKEND_EA.read_bytes())

    def test_metaeditor_compile_and_release_binary(self):
        compile_log = (ROOT / "test_reports" / "metaeditor_v62524_final.log").read_text(encoding="utf-16")
        self.assertIn("Result: 0 errors, 0 warnings", compile_log)
        root_ex5 = ROOT / "XAUUSD_AI_Sniper_EA.ex5"
        release_ex5 = ROOT / "backend" / "ea_releases" / "v6.25.24" / "XAUUSD_AI_Sniper_EA_v6.25.24.ex5"
        self.assertEqual(root_ex5.read_bytes(), release_ex5.read_bytes())

    def test_candidate_manifest_is_hash_bound_but_not_published(self):
        manifest = json.loads((ROOT / "backend" / "ea_releases" / "manifest.json").read_text())
        candidate = manifest["releases"]["v6.25.24"]
        release_ex5 = ROOT / "backend" / "ea_releases" / "v6.25.24" / candidate["ex5_filename"]
        self.assertEqual(manifest["current_version"], "v6.25.8")
        self.assertFalse(candidate["stable_status"])
        self.assertEqual(hashlib.sha256(release_ex5.read_bytes()).hexdigest(), candidate["ex5_sha256"])

    def test_customer_ui_does_not_hard_code_candidate_as_current(self):
        frontend = ROOT / "frontend" / "src"
        hard_coded = []
        for path in frontend.rglob("*.jsx"):
            if "v6.25.24" in path.read_text(encoding="utf-8"):
                hard_coded.append(str(path.relative_to(ROOT)))
        self.assertEqual(hard_coded, [])
        server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
        self.assertNotIn("v6.25.24", server)

    def test_advisor_seed_is_warning_only_and_integrity_bound(self):
        text = source()
        seed_bytes = SEED.read_bytes()
        seed_hash = hashlib.sha256(seed_bytes).hexdigest()
        data = json.loads(seed_bytes)
        self.assertIn("InpGlobalTradeBrainMode = GLOBAL_TRADEBRAIN_ADVISOR", text)
        self.assertIn(f'XAU_TRADEBRAIN_SEED_SHA256 "{seed_hash}"', text)
        self.assertIn("XAU_TRADEBRAIN_SEED_ACTIVE_BLOCK_COUNT 0", text)
        self.assertIn("XAU_TRADEBRAIN_LOCAL_ROWS_HAVE_AUTHORITY false", text)
        self.assertEqual(data["active_hard_blocks"], [])
        self.assertEqual(len(data["warning_cohorts"]), 4)
        self.assertTrue(all(row["authority"] == "WARNING_ONLY" for row in data["warning_cohorts"]))

    def test_advisor_decision_is_execution_neutral(self):
        text = source()
        self.assertIn("active_blocks=0 | decision=ALLOW | lot_multiplier=1.00", text)
        self.assertIn("direction_unchanged=true | risk_unchanged=true | exits_unchanged=true", text)
        self.assertRegex(text, r"XAU_TRADEBRAIN_SEED_ACTIVE_BLOCK_COUNT==0")

    def test_general_deadline_exception_is_exact_and_state_validated(self):
        text = source()
        helper = re.search(r"bool XAU_ConfirmedGeneralDeadlineClose\(.*?\n\}", text, re.S).group(0)
        self.assertIn('StringFind(ctx,"OWNER_R_EXIT_GENERAL_10M_DEADLINE")!=0', helper)
        self.assertIn("ownerExitProfile==(int)OWNER_EXIT_GENERAL", helper)
        self.assertIn("extensionFullyConfirmed", helper)
        self.assertIn("TimeCurrent()>=g_rExit[idx].extensionDeadline", helper)
        self.assertIn("!confirmedDeadlineClose && !XAU_LossCloseFirewallAllows", text)

    def test_4807_counters_are_semantically_separated(self):
        text = source()
        handler = re.search(r"bool XAU_HandlePersistentStable4807\(.*?\n\}", text, re.S).group(0)
        self.assertIn("g_entrySnapshotTransient4807Waits++", handler)
        self.assertNotIn("g_entrySnapshotDataWaits++", handler)
        self.assertIn("g_entrySnapshotPersistent4807Recoveries++", handler)
        self.assertIn("XAU_M10_4807_PERSIST_TICKS 3", text)
        self.assertIn("XAU_M10_4807_PERSIST_SECONDS 2", text)

    def test_execution_anomaly_fields_are_append_only_telemetry(self):
        text = source()
        for field in (
            "brokerDealReason",
            "requestedSL",
            "actualClosePrice",
            "slippageBeyondSLPoints",
            "slippageBeyondSLR",
            "sessionGapSeconds",
            "firstAvailableTickTime",
            "closeDealFee",
            "netProfitIncludingFees",
            "executionAnomalyQuarantine",
        ):
            self.assertIn(f'XAU_CsvAppendField(header, "{field}")', text)
        self.assertIn("authority=TELEMETRY_ONLY", text)

    def test_raw_dataset_identity_and_counts(self):
        path = next((RUN / "raw").glob("*TradeBrainCollect_v2_V62524*.csv"))
        with path.open(encoding="utf-16", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(Counter(row["event"] for row in rows), Counter({"POST_CLOSE": 775, "OPEN": 155, "CLOSE": 155}))
        self.assertEqual({row["collectionRunId"] for row in rows}, {"V62524_M10_90D_20260422_20260721_RUN1"})
        self.assertEqual({row["eaVersion"] for row in rows}, {"v6.25.24"})

    def test_key_event_extractions_are_nonempty_and_prove_incidents(self):
        p130 = (RUN / "raw" / "POSITION_130_FULL_LOG_EVENTS_UTF8.log").read_text()
        p212 = (RUN / "raw" / "POSITION_212_FULL_LOG_EVENTS_UTF8.log").read_text()
        fixed = (RUN / "raw" / "V62524_90DAY_KEY_EVENTS_FIXED_UTF8.log").read_text()
        self.assertIn("actualSL=4490.84000", p130)
        self.assertIn("at 4535.29", p130)
        self.assertIn("attempt=417 sendOk=false", p212)
        self.assertIn("LOSS_CLOSE_BLOCKED #212", p212)
        self.assertIn("failedFinal=0", fixed)


if __name__ == "__main__":
    unittest.main()
