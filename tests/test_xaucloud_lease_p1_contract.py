from pathlib import Path

LEASE = Path("backend/ea_code/lease/XauCloudLeaseClient.mqh").read_text(encoding="utf-8")

def test_first_use_identity_is_exclusive_and_verified():
    assert "XAU_LeaseGetOrCreatePersistentId" in LEASE
    assert "FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI" in LEASE
    assert "XAUCLOUD_LEASE_ID_VERIFY_MISMATCH" in LEASE
    assert "OFFLINE_LEASE_IDENTITY_NOT_DURABLE" in LEASE

def test_offline_mutex_uses_exclusive_file_handle():
    block = LEASE.split("bool XAU_LeaseMutexTryAcquire", 1)[1].split("void XAU_LeaseMutexRelease", 1)[0]
    assert "FileOpen(path, FILE_READ | FILE_WRITE | FILE_BIN)" in block
    assert "FILE_SHARE_READ" not in block
    assert "FILE_SHARE_WRITE" not in block
    assert "GlobalVariableSet(name" not in block

def test_state_replace_preserves_previous_primary_until_move():
    block = LEASE.split("bool XAU_LeasePersist", 1)[1].split("bool XAU_LeaseLoadFromDisk", 1)[0]
    assert "FileMove(tmpPath, 0, XAU_LeaseStateFilePath(), FILE_REWRITE)" in block
    assert "FileDelete(XAU_LeaseStateFilePath())" not in block

def test_consumption_survives_restart_when_one_durable_record_fails():
    assert "XAU_LeaseOfflineLedgerCountForLease" in LEASE
    assert "effectiveConsumed = MathMax(st.consumedThisLease, ledgerConsumed)" in LEASE
    assert "statePersisted || ledgerRecorded" in LEASE
    assert "XAU_LeasePersistenceUnsafeKey" in LEASE
    assert "GlobalVariablesFlush();" in LEASE
    assert "outState.lastConsumedExecutionKey == offlineExecutionKeyOut" in LEASE
