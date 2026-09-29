import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EA = (ROOT / "backend/ea_code/XauCloud_v6.28.8_AUDIT_REPAIRED.mq5").read_text(encoding="utf-8")
LEASE = (ROOT / "backend/ea_code/lease/XauCloudLeaseClient.mqh").read_text(encoding="utf-8")

def test_release_manifests_remain_on_verified_v6286():
    for rel in ["backend/ea_releases/manifest.json", "backend_node/ea_releases/manifest.json"]:
        manifest = json.loads((ROOT / rel).read_text(encoding="utf-8"))
        assert manifest["current_version"] == "v6.28.6"
        assert "v6.28.8" not in manifest.get("releases", {})

def test_v6288_is_a_distinct_unpromoted_source_candidate():
    assert '#define XAUAI_EA_VERSION "XauCloud_v6.28.8-AUDIT-REPAIRED"' in EA
    assert '#define XAUAI_EA_VERSION_NUM "6.288"' in EA
    assert '#define XAUAI_BUILD_HASH "xaucloud-v6288-audit-repair-source-candidate"' in EA

def test_delayed_core_and_pyramid_fills_have_durable_pending_identity():
    required = [
        "struct XAU_PendingBrokerOpenState",
        "XAU_PendingBrokerOpenPersistSlot",
        "XAU_PendingBrokerOpenLoadAll",
        'blockReason="BROKER_OPEN_PENDING_RECONCILIATION"',
        "XAU_PendingBrokerOpenArmCore",
        "XAU_PendingBrokerOpenArmPyramid",
        "XAU_FindPendingBrokerDealPosition",
        "XAU_PromotePendingBrokerOpen",
        'XAU_ReconcilePendingBrokerOpens("STARTUP")',
        'XAU_ReconcilePendingBrokerOpens("TICK")',
        'XAU_ReconcilePendingBrokerOpens("TIMER")',
        '"ON_TRADE_TRANSACTION"',
        "XAU_CampaignOpenCore(direction,pending.setupName",
        'XAU_CampaignRegisterAdd(direction,"PYRAMID_DELAYED_BROKER_FILL")',
    ]
    for marker in required:
        assert marker in EA, marker

def test_placed_is_pending_not_rejection_and_is_fenced_against_resend():
    assert "TRADE_RETCODE_PLACED" in EA
    assert "BROKER_OPEN_RESEND_BLOCKED" in EA
    assert "BROKER_DELAYED_CORE_PROMOTED" in EA
    assert "BROKER_DELAYED_PYRAMID_PROMOTED" in EA
    assert "brokerOrderId" in EA

def test_close_and_modify_require_retcode_and_broker_readback():
    assert "SL_MODIFY_ACCEPTED_PENDING" in EA
    assert "SL_MODIFY_PENDING_RECONCILIATION" in EA
    assert "SL_MODIFY_CONFIRMED" in EA
    assert "OWNER_R_EXIT_CLOSE_ACCEPTED_PENDING" in EA
    assert "READBACK_RECONCILE_NO_IMMEDIATE_RESEND" in EA
    assert "closeAccepted=(astraCloseRet==TRADE_RETCODE_DONE" in EA
    assert "readbackConfirmed=PositionSelectByTicket(ticket)" in EA
    assert 'acceptedPending?"CLOSE_ACCEPTED_PENDING":"CLOSE_PENDING_RETRY"' in EA

def test_offline_lease_restart_guards_are_present():
    markers = [
        "XAU_LeaseGetOrCreatePersistentId",
        "OFFLINE_LEASE_IDENTITY_NOT_DURABLE",
        "XAU_LeaseOfflineLedgerCountForLease",
        "XAU_LeasePersistenceUnsafeKey",
        "XAUCLOUD_LEASE_CONSUME_PERSISTENCE_FATAL",
        "XAU_LeaseMutexFilePath",
    ]
    for marker in markers:
        assert marker in LEASE, marker

def test_basic_source_delimiter_sanity():
    # Not a MetaEditor compile; catches accidental text-transform damage before
    # the candidate reaches the native compiler gate.
    assert EA.count("{") == EA.count("}")
    assert LEASE.count("{") == LEASE.count("}")
