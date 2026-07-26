//+------------------------------------------------------------------+
//| XauCloudLeaseClientTestEA.mq5 -- generated test vectors           |
//| Timestamps anchored well before/after the Tester simulated clock  |
//| bar-open (2026.07.20 00:00:00 UTC), not real wall-clock time.      |
//+------------------------------------------------------------------+
#property strict

#include "XauCloudLeaseClient.mqh"

string TEST_MODULUS = "9d636fd81fd41a97cff554478aa70e9c7706a7721d3b1a5b2d7542453d1177a13147477ba525da6f4edc98302f7d08817341a5f04370ff3fd8fda77ffe1b91b3e953ade49787ed02189688358065de61d01302f511800a216883322802753cfd03d552fb5c36b63ca25dda89704d3324addd84e3e2fc7de9d8a06a8bd6742b5ee1ce485935110b1b3ab18ed6c7f03a4528775096385c71eac4c6a72fc89f12b794022b6c3f9d79c9cd36a22d687b04c8048d7a78a38a0fb396c2cf04575434b89c3f58f1cdf251cdb1e1c2c880d0a02580e03e64374d6b60ab5133c3721a1053e61611142543f902f50ce61db7b24d1f4d84b975b7b9b1dccfe3f06df16823b1";
string JSON_VALID = "{\"schema_version\": 1, \"lease_id\": \"lease-valid-1\", \"key_id\": \"EATEST-KEY-1\", \"tenant_id\": \"lic-ea-test\", \"license_id\": \"lic-ea-test\", \"account_login\": \"109865659\", \"account_server\": \"MetaQuotes-Demo\", \"installation_id\": \"INST-EATEST\", \"terminal_instance_id\": \"TERM-EATEST\", \"normalized_symbol\": \"XAUUSD\", \"allowed_directions\": [1, -1], \"allowed_entry_families\": [\"CORE\"], \"issued_at_unix\": 1784503800, \"not_before_unix\": 1784503800, \"expires_at_unix\": 1784511000, \"renewal_after_unix\": 1784510400, \"maximum_offline_new_campaigns\": 1, \"remaining_offline_new_campaigns\": 1, \"lease_sequence\": 1, \"revocation_epoch\": 1, \"nonce\": \"839986361a8f7a1a3705156c60c1e23e\", \"issued\": true, \"signature_algorithm\": \"XAUCLOUD-LEASE-RS256-v1\", \"detached_signature\": \"2e7e71a7ede1a5d203e36083b4d964414f6a2eae2255e099914eebd774975b01de2fcb09c7cfecf5b6ff536dac06c741a743639dedc551760305ea690f913320c59ca8786f1c4d0042fb8b19f6b1016d528a55e01d7ca5d61f70835db3d3ecfa1e18768d341eadc77ad2fdb042d9a7edc4fd35118a46b1a0a90c0767ebb0d59ace7853b0c2a234bacf152b5ea7b8936c3dc5077700b62ed5825b1fdb4a1ebf1f63cb25e460d9e88465845b05aada4c8da29072523061be7cafee9ca53513ee13229ff641df776d82aa45b6c575b2b1b3978fabd2f0400e8a7f284b8b553e4060276a018a6ded7f8f27d3a944f9f9f7fc8ab888368ed6ea6d10666d36db8ffac3\"}";
string JSON_EXPIRED = "{\"schema_version\": 1, \"lease_id\": \"lease-expired-1\", \"key_id\": \"EATEST-KEY-1\", \"tenant_id\": \"lic-ea-test\", \"license_id\": \"lic-ea-test\", \"account_login\": \"109865659\", \"account_server\": \"MetaQuotes-Demo\", \"installation_id\": \"INST-EATEST\", \"terminal_instance_id\": \"TERM-EATEST\", \"normalized_symbol\": \"XAUUSD\", \"allowed_directions\": [1, -1], \"allowed_entry_families\": [\"CORE\"], \"issued_at_unix\": 1784503800, \"not_before_unix\": 1784496600, \"expires_at_unix\": 1784505300, \"renewal_after_unix\": 1784510400, \"maximum_offline_new_campaigns\": 1, \"remaining_offline_new_campaigns\": 1, \"lease_sequence\": 1, \"revocation_epoch\": 1, \"nonce\": \"f05c77b238439b85ff1679d9ee758474\", \"issued\": true, \"signature_algorithm\": \"XAUCLOUD-LEASE-RS256-v1\", \"detached_signature\": \"58e3b4581e3edc5d86470d8c8faf2c8e68798d85ff9a3550c64af2806900ba6064291c5d3dca191994ada2f60f4c0b93e5cd822490f6278bbc13a682f590be28e2104af30cc7753c6b30b2a95d4287652931ccef22a4c527679fe30938428b529d78306d68e5254268554973b10e1d1356e18d09cbac3c0d7480f2f9d5e31050fbd60808138be24ab059c73cc3b04bd6dda7aa72c93fb2cb1b3057b5f9abcf8a8c4b787676dd9c99f045773789ac362963741a8b56160f9a466709ab5081ead0bd80eae6e843b72638b613a790b29846df4ee774da32e8910c8f4aead183824dc7b52ac571f216603b366a60f159e211f0739204a8d84eb15539ed3dfa8d1376\"}";
string JSON_NOT_YET_VALID = "{\"schema_version\": 1, \"lease_id\": \"lease-notyet-1\", \"key_id\": \"EATEST-KEY-1\", \"tenant_id\": \"lic-ea-test\", \"license_id\": \"lic-ea-test\", \"account_login\": \"109865659\", \"account_server\": \"MetaQuotes-Demo\", \"installation_id\": \"INST-EATEST\", \"terminal_instance_id\": \"TERM-EATEST\", \"normalized_symbol\": \"XAUUSD\", \"allowed_directions\": [1, -1], \"allowed_entry_families\": [\"CORE\"], \"issued_at_unix\": 1784503800, \"not_before_unix\": 1784509200, \"expires_at_unix\": 1784512800, \"renewal_after_unix\": 1784510400, \"maximum_offline_new_campaigns\": 1, \"remaining_offline_new_campaigns\": 1, \"lease_sequence\": 1, \"revocation_epoch\": 1, \"nonce\": \"3e8564812df2eb64f949354877052998\", \"issued\": true, \"signature_algorithm\": \"XAUCLOUD-LEASE-RS256-v1\", \"detached_signature\": \"5f110162861de41bfcf7a16a5b4e5ae6973c6fa1a1769dd33198a37eb12d49eb6b72d2f32fff180c80e7ae280b27e0916a4281bfe3be9d62077afbeb1d40d20bc51fc8c7b376421848bdeedc28c6435b0b722be5bf5f8356ef273f155d545eeb0cfc0618f887080ac80fc29c5e4a39885d997d94c4e0f4d9401d55cdaf2e849ea47583030c6869126b2108f8e4247b567d7a933d9a0c924c5f30ebfc2fa0fcfa05a67abea4015d6bd84d060825f831670c6c0a4d122a5c457b954ea324f27ffab1ec8342bff46bfbfb6ecb0ebd67e390d402f3bb9027ae594e2e079e84d98862d8f517d4750302935bf84bb16a64986814afe54c2824e6f36405b131dda7cf29\"}";
string JSON_WRONG_ACCOUNT = "{\"schema_version\": 1, \"lease_id\": \"lease-wrongaccount-1\", \"key_id\": \"EATEST-KEY-1\", \"tenant_id\": \"lic-ea-test\", \"license_id\": \"lic-ea-test\", \"account_login\": \"999999999\", \"account_server\": \"MetaQuotes-Demo\", \"installation_id\": \"INST-EATEST\", \"terminal_instance_id\": \"TERM-EATEST\", \"normalized_symbol\": \"XAUUSD\", \"allowed_directions\": [1, -1], \"allowed_entry_families\": [\"CORE\"], \"issued_at_unix\": 1784503800, \"not_before_unix\": 1784503800, \"expires_at_unix\": 1784511000, \"renewal_after_unix\": 1784510400, \"maximum_offline_new_campaigns\": 1, \"remaining_offline_new_campaigns\": 1, \"lease_sequence\": 1, \"revocation_epoch\": 1, \"nonce\": \"c4bc6a4a638b6063f63d31f9004ace94\", \"issued\": true, \"signature_algorithm\": \"XAUCLOUD-LEASE-RS256-v1\", \"detached_signature\": \"8a678a5fe4187075cc45e5472fb032e568c74b5a364f2233dad73e873eae4c3dc1365e20ad2a7686c435c2bcc678be2772c26bc67c5fabf93dbed75d76fd1b72d0a74813b4534c07f3f57a836eaa0389a919d103c67e3a9863fa8b7bb16287dfcf19e022a95c3e7d33962cd67d7091f7c1810f9d83b43817caaef060148a0f99b369084551a28b9ba5043555d45243a60a1e9370915606b6ec95cbb6bb306775b86304ad28bc677c2a175b08a657c755ee74dc433fc83dcd790ee1bef7fb854595b0c0240398d24cdbb70838fc94ba3e9cd727e1301d98e1d21298b62527010341dd62a30e2033213da815aca42231ab9e6b4408bbad987ba502f1baed031ce3\"}";
string JSON_NO_ALLOWANCE = "{\"schema_version\": 1, \"lease_id\": \"lease-noallowance-1\", \"key_id\": \"EATEST-KEY-1\", \"tenant_id\": \"lic-ea-test\", \"license_id\": \"lic-ea-test\", \"account_login\": \"109865659\", \"account_server\": \"MetaQuotes-Demo\", \"installation_id\": \"INST-EATEST\", \"terminal_instance_id\": \"TERM-EATEST\", \"normalized_symbol\": \"XAUUSD\", \"allowed_directions\": [1, -1], \"allowed_entry_families\": [\"CORE\"], \"issued_at_unix\": 1784503800, \"not_before_unix\": 1784503800, \"expires_at_unix\": 1784511000, \"renewal_after_unix\": 1784510400, \"maximum_offline_new_campaigns\": 1, \"remaining_offline_new_campaigns\": 0, \"lease_sequence\": 1, \"revocation_epoch\": 1, \"nonce\": \"474f4a0182334596b0ab4d0a86c3284b\", \"issued\": true, \"signature_algorithm\": \"XAUCLOUD-LEASE-RS256-v1\", \"detached_signature\": \"4ac43a360eed96515f561cb4f7f79ed92f6f8d24a5ec4a0a711c8e4bfdaf0dbf470b5566b04b49e2a46e06a8fc6fe2bb825686e088d3967707edea8c91cd47dc188c94d3cefca0fba8432850f690abf462cc04deea41e608e5b6dfc3bf644941996986c31596a59498e96ed7be06207be1beb994c930c190b6dc01ad7e06eab8db72b66365e2dca740a334b92acb9324c5b21cb240a1838c46f9996b1b955ddae5805258ed55b52b6169e7315c279e2a391d45af5abbde4c462e4f4b6589d2daeeda0ae9f57392bc8ee47c8816e47b252365738e6ba275d21e8cc9ff2ce7cfac046aa3aec3705e8bf657bef18191b8b43cb0bbbf4085b5594c3ec19fd5e73be4\"}";
string JSON_TAMPERED_SIGNATURE = "{\"schema_version\": 1, \"lease_id\": \"lease-noallowance-1\", \"key_id\": \"EATEST-KEY-1\", \"tenant_id\": \"lic-ea-test\", \"license_id\": \"lic-ea-test\", \"account_login\": \"109865659\", \"account_server\": \"MetaQuotes-Demo\", \"installation_id\": \"INST-EATEST\", \"terminal_instance_id\": \"TERM-EATEST\", \"normalized_symbol\": \"XAUUSD\", \"allowed_directions\": [1, -1], \"allowed_entry_families\": [\"CORE\"], \"issued_at_unix\": 1784503800, \"not_before_unix\": 1784503800, \"expires_at_unix\": 1784511000, \"renewal_after_unix\": 1784510400, \"maximum_offline_new_campaigns\": 1, \"remaining_offline_new_campaigns\": 0, \"lease_sequence\": 1, \"revocation_epoch\": 1, \"nonce\": \"474f4a0182334596b0ab4d0a86c3284b\", \"issued\": true, \"signature_algorithm\": \"XAUCLOUD-LEASE-RS256-v1\", \"detached_signature\": \"4ac43a360eed96515f561cb4f7f79ed92f6f8d24a5ec4a0a711c8e4bfdaf0dbf470b5566b04b49e2a46e06a8fc6fe2bb825686e088d3967707edea8c91cd47dc188c94d3cefca0fba8432850f690abf462cc04deea41e608e5b6dfc3bf644941996986c31596a59498e96ed7be06207be1beb994c930c190b6dc01ad7e06eab8db72b66365e2dca740a334b92acb9324c5b21cb240a1838c46f9996b1b955ddae5805258ed55b52b6169e7315c279e2a391d45af5abbde4c462e4f4b6589d2daeeda0ae9f57392bc8ee47c8816e47b252365738e6ba275d21e8cc9ff2ce7cfac046aa3aec3705e8bf657bef18191b8b43cb0bbbf4085b5594c3ec19fd5e73be0\"}";


int g_pass = 0;
int g_fail = 0;

void Check(string label, bool got, bool want)
{
   if(got == want) { g_pass++; PrintFormat("XAUCLOUD_LEASE_CLIENT_TEST PASS | %s", label); }
   else { g_fail++; PrintFormat("XAUCLOUD_LEASE_CLIENT_TEST FAIL | %s | expected=%s got=%s", label, (string)want, (string)got); }
}

void SetTrustedKey()
{
   XAU_LeaseTrustedKeyIds[0] = "EATEST-KEY-1";
   XAU_LeaseTrustedModulus[0] = TEST_MODULUS;
}

int OnInit()
{
   Print("XAUCLOUD_LEASE_CLIENT_TEST BEGIN");
   SetTrustedKey();
   GlobalVariableDel(XAU_LeaseMutexName("lic-ea-test", "109865659", "MetaQuotes-Demo", "XAUUSD", 1));
   PrintFormat("DIAG_TIMECURRENT=%I64d", (long)TimeCurrent());

   // 1. Parse + verify a valid lease -> signature must check out
   XauLeaseState st;
   XAU_LeaseParseResponseIntoState(JSON_VALID, st);
   Check("valid-lease-signature-verifies", XAU_LeaseVerifyState(st), true);

   // 2. Persist it atomically, then reload from disk and re-verify
   bool persisted = XAU_LeasePersist(st);
   Check("persist-succeeds", persisted, true);
   XauLeaseState reloaded;
   bool loaded = XAU_LeaseLoadFromDisk(reloaded);
   Check("reload-from-disk-succeeds", loaded, true);
   Check("reloaded-lease-id-matches", reloaded.leaseId == st.leaseId, true);
   Check("reloaded-signature-still-verifies", XAU_LeaseVerifyState(reloaded), true);

   // 3. Clock-integrity check on the freshly-issued, in-scope lease -> VALID
   ENUM_XAU_LEASE_VALIDITY v1 = XAU_LeaseCheckValidity(reloaded, 1, "CORE",
      "109865659", "MetaQuotes-Demo", "XAUUSD", "INST-EATEST", "TERM-EATEST");
   Check("valid-lease-passes-clock-check", v1 == XAU_LEASE_VALID, true);

   // 4. Wrong scope (different direction not in allowed set is impossible here since both allowed;
   //    test wrong symbol instead)
   ENUM_XAU_LEASE_VALIDITY vWrongSymbol = XAU_LeaseCheckValidity(reloaded, 1, "CORE",
      "109865659", "MetaQuotes-Demo", "EURUSD", "INST-EATEST", "TERM-EATEST");
   Check("wrong-symbol-rejected", vWrongSymbol == XAU_LEASE_INVALID_WRONG_SCOPE, true);

   ENUM_XAU_LEASE_VALIDITY vWrongTerminal = XAU_LeaseCheckValidity(reloaded, 1, "CORE",
      "109865659", "MetaQuotes-Demo", "XAUUSD", "INST-EATEST", "SOME-OTHER-TERMINAL");
   Check("wrong-terminal-rejected", vWrongTerminal == XAU_LEASE_INVALID_WRONG_SCOPE, true);

   // 5. Expired lease -> EXPIRED
   XauLeaseState stExpired;
   XAU_LeaseParseResponseIntoState(JSON_EXPIRED, stExpired);
   ENUM_XAU_LEASE_VALIDITY vExpired = XAU_LeaseCheckValidity(stExpired, 1, "CORE",
      "109865659", "MetaQuotes-Demo", "XAUUSD", "INST-EATEST", "TERM-EATEST");
   Check("expired-lease-rejected", vExpired == XAU_LEASE_INVALID_EXPIRED, true);

   // 6. Not-yet-valid lease -> NOT_YET_VALID
   XauLeaseState stNotYet;
   XAU_LeaseParseResponseIntoState(JSON_NOT_YET_VALID, stNotYet);
   ENUM_XAU_LEASE_VALIDITY vNotYet = XAU_LeaseCheckValidity(stNotYet, 1, "CORE",
      "109865659", "MetaQuotes-Demo", "XAUUSD", "INST-EATEST", "TERM-EATEST");
   Check("not-yet-valid-lease-rejected", vNotYet == XAU_LEASE_INVALID_NOT_YET_VALID, true);

   // 7. Wrong account scope -> WRONG_SCOPE
   XauLeaseState stWrongAcct;
   XAU_LeaseParseResponseIntoState(JSON_WRONG_ACCOUNT, stWrongAcct);
   ENUM_XAU_LEASE_VALIDITY vWrongAcct = XAU_LeaseCheckValidity(stWrongAcct, 1, "CORE",
      "109865659", "MetaQuotes-Demo", "XAUUSD", "INST-EATEST", "TERM-EATEST");
   Check("wrong-account-lease-rejected", vWrongAcct == XAU_LEASE_INVALID_WRONG_SCOPE, true);

   // 8. Zero remaining allowance -> NO_ALLOWANCE_REMAINING
   XauLeaseState stNoAllowance;
   XAU_LeaseParseResponseIntoState(JSON_NO_ALLOWANCE, stNoAllowance);
   ENUM_XAU_LEASE_VALIDITY vNoAllowance = XAU_LeaseCheckValidity(stNoAllowance, 1, "CORE",
      "109865659", "MetaQuotes-Demo", "XAUUSD", "INST-EATEST", "TERM-EATEST");
   Check("zero-allowance-lease-rejected", vNoAllowance == XAU_LEASE_INVALID_NO_ALLOWANCE_REMAINING, true);

   // 9. Tampered signature -> signature verify fails, and persist refuses to write it
   XauLeaseState stTampered;
   XAU_LeaseParseResponseIntoState(JSON_TAMPERED_SIGNATURE, stTampered);
   Check("tampered-signature-rejected", XAU_LeaseVerifyState(stTampered), false);

   // 10. Failure classification (Phase 6)
   Check("classify-webrequest-failure-as-temp-connectivity",
         XAU_ClassifyReservationFailure(-1, "", false) == XAU_LFC_TEMPORARY_CONNECTIVITY_FAILURE, true);
   Check("classify-200-claimed-true-as-online-allowed",
         XAU_ClassifyReservationFailure(200, "{\"claimed\":true}", true) == XAU_LFC_ONLINE_ALLOWED, true);
   Check("classify-200-claimed-false-as-online-denied",
         XAU_ClassifyReservationFailure(200, "{\"claimed\":false,\"reason\":\"ACTIVE_EXECUTION_RESERVED\"}", false) == XAU_LFC_ONLINE_DENIED, true);
   Check("classify-400-as-validation-failure",
         XAU_ClassifyReservationFailure(400, "{}", false) == XAU_LFC_VALIDATION_FAILURE, true);
   Check("classify-401-as-authentication-failure",
         XAU_ClassifyReservationFailure(401, "{}", false) == XAU_LFC_AUTHENTICATION_FAILURE, true);
   Check("classify-403-primary-assigned-as-authorization-failure",
         XAU_ClassifyReservationFailure(403, "{\"reason\":\"PRIMARY_TERMINAL_ALREADY_ASSIGNED\"}", false) == XAU_LFC_AUTHORIZATION_FAILURE, true);
   Check("classify-403-license-mismatch-as-authentication-failure",
         XAU_ClassifyReservationFailure(403, "{\"reason\":\"LICENSE_BOUND_TO_DIFFERENT_MT5_ACCOUNT\"}", false) == XAU_LFC_AUTHENTICATION_FAILURE, true);
   Check("classify-500-as-server-temporary-failure",
         XAU_ClassifyReservationFailure(500, "{}", false) == XAU_LFC_SERVER_TEMPORARY_FAILURE, true);
   Check("classify-503-as-server-temporary-failure",
         XAU_ClassifyReservationFailure(503, "{}", false) == XAU_LFC_SERVER_TEMPORARY_FAILURE, true);
   Check("classify-unknown-as-unsafe-fail-closed",
         XAU_ClassifyReservationFailure(418, "{}", false) == XAU_LFC_UNKNOWN_UNSAFE_FAILURE, true);
   Check("only-temp-connectivity-allows-offline",
         XAU_LeaseFailureAllowsOfflineFallback(XAU_LFC_TEMPORARY_CONNECTIVITY_FAILURE), true);
   Check("only-server-temp-allows-offline",
         XAU_LeaseFailureAllowsOfflineFallback(XAU_LFC_SERVER_TEMPORARY_FAILURE), true);
   Check("online-denied-does-not-allow-offline",
         XAU_LeaseFailureAllowsOfflineFallback(XAU_LFC_ONLINE_DENIED), false);
   Check("auth-failure-does-not-allow-offline",
         XAU_LeaseFailureAllowsOfflineFallback(XAU_LFC_AUTHENTICATION_FAILURE), false);
   Check("authz-failure-does-not-allow-offline",
         XAU_LeaseFailureAllowsOfflineFallback(XAU_LFC_AUTHORIZATION_FAILURE), false);
   Check("validation-failure-does-not-allow-offline",
         XAU_LeaseFailureAllowsOfflineFallback(XAU_LFC_VALIDATION_FAILURE), false);
   Check("unknown-unsafe-does-not-allow-offline",
         XAU_LeaseFailureAllowsOfflineFallback(XAU_LFC_UNKNOWN_UNSAFE_FAILURE), false);

   // 11. Deterministic offline execution key + durable dedup ledger
   string execKey1 = XAU_LeaseOfflineExecutionKey("109865659|XAUUSD|20250401|BUY|CANDIDATE-ABC", "lease-valid-1", 1);
   string execKey1Again = XAU_LeaseOfflineExecutionKey("109865659|XAUUSD|20250401|BUY|CANDIDATE-ABC", "lease-valid-1", 1);
   Check("execution-key-deterministic", execKey1 == execKey1Again, true);
   bool firstRecord = XAU_LeaseOfflineLedgerTryRecordNew(execKey1);
   Check("first-record-of-execution-key-succeeds", firstRecord, true);
   bool secondRecord = XAU_LeaseOfflineLedgerTryRecordNew(execKey1);
   Check("duplicate-execution-key-rejected-by-ledger", secondRecord, false);
   string execKey2 = XAU_LeaseOfflineExecutionKey("109865659|XAUUSD|20250401|SELL|CANDIDATE-XYZ", "lease-valid-1", 1);
   bool differentKeyRecord = XAU_LeaseOfflineLedgerTryRecordNew(execKey2);
   Check("different-execution-key-accepted", differentKeyRecord, true);

   // 12. Local mutex acquire/release
   string mutexName = XAU_LeaseMutexName("lic-ea-test", "109865659", "MetaQuotes-Demo", "XAUUSD", 1);
   bool acquired1 = XAU_LeaseMutexTryAcquire(mutexName);
   Check("mutex-first-acquire-succeeds", acquired1, true);
   bool acquired2 = XAU_LeaseMutexTryAcquire(mutexName);
   Check("mutex-second-acquire-blocked-while-held", acquired2, false);
   XAU_LeaseMutexRelease(mutexName);
   bool acquired3 = XAU_LeaseMutexTryAcquire(mutexName);
   Check("mutex-acquire-succeeds-after-release", acquired3, true);
   XAU_LeaseMutexRelease(mutexName);

   // 13. Installation/terminal identity persistence (survives being called twice = "restart")
   string inst1 = XAU_LeaseGetOrCreateInstallationId();
   string inst2 = XAU_LeaseGetOrCreateInstallationId();
   Check("installation-id-stable-across-calls", inst1 == inst2, true);
   string term1 = XAU_LeaseGetOrCreateTerminalId();
   string term2 = XAU_LeaseGetOrCreateTerminalId();
   Check("terminal-id-stable-across-calls", term1 == term2, true);

   PrintFormat("XAUCLOUD_LEASE_CLIENT_TEST SUMMARY pass=%d fail=%d", g_pass, g_fail);
   if(g_fail == 0) Print("XAUCLOUD_LEASE_CLIENT_TEST ALL TESTS PASSED");
   else Print("XAUCLOUD_LEASE_CLIENT_TEST TESTS FAILED");

   return(INIT_FAILED);
}

void OnTick() {}
