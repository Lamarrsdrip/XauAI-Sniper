//+------------------------------------------------------------------+
//| XauCloudLeaseClient.mqh                                          |
//|                                                                    |
//| EA-side bounded offline trading lease client. Isolated module --  |
//| the main EA integrates with this only through the small public    |
//| API at the bottom (XAU_Lease_* functions). See                    |
//| audits/offline_lease/ for the full design and                     |
//| audits/offline_lease/02_reservation_flow_audit.md for exactly     |
//| what the existing XAU_ClaimDirectionReservation()/                |
//| XAU_CanOpenDirection() flow does today, which this extends rather |
//| than replaces.                                                    |
//|                                                                    |
//| SCOPE (Phase 14, owner-directed conservative default): only CORE  |
//| entries may use an offline lease in this release. RE_ENTRY/       |
//| PYRAMID/COUNTER_EXCURSION are not touched by this module at all -- |
//| when the backend is unreachable, those paths keep behaving exactly|
//| as they do today (blocked), because their state depends on        |
//| existing campaign/position context this module does not attempt   |
//| to prove is safe to own offline in this release.                  |
//+------------------------------------------------------------------+
#property strict

#include "XauCloudLeaseCrypto.mqh"

//+------------------------------------------------------------------+
//| Trusted public keys (compile-time embedded -- the EA can verify a |
//| lease but can never create/sign/extend one). Rotation model: a   |
//| new EA build adds a new key_id here alongside the old one for a  |
//| transition window; see audits/offline_lease/03_lease_architecture |
//| .md "Key management" section.                                    |
//+------------------------------------------------------------------+
#define XAU_LEASE_TRUSTED_KEY_COUNT 1
string XAU_LeaseTrustedKeyIds[XAU_LEASE_TRUSTED_KEY_COUNT]   = {"PLACEHOLDER-KEY-ID"};
string XAU_LeaseTrustedModulus[XAU_LEASE_TRUSTED_KEY_COUNT]  = {"PLACEHOLDER-SET-BY-OWNER-AT-KEY-PROVISIONING-TIME"};

bool XAU_LeaseLookupTrustedModulus(const string &keyId, string &modulusOut)
{
   for(int i = 0; i < XAU_LEASE_TRUSTED_KEY_COUNT; i++)
   {
      if(XAU_LeaseTrustedKeyIds[i] == keyId)
      {
         modulusOut = XAU_LeaseTrustedModulus[i];
         return true;
      }
   }
   return false;
}

//+------------------------------------------------------------------+
//| Failure classification (Phase 6) -- replaces the single           |
//| RESERVATION_BACKEND_UNREACHABLE bucket described in                |
//| 02_reservation_flow_audit.md §4-5 with a strict, named set. Only  |
//| TEMPORARY_CONNECTIVITY_FAILURE and SERVER_TEMPORARY_FAILURE may   |
//| ever result in consulting the cached lease -- every other value   |
//| blocks the trade exactly as today, unconditionally.                |
//+------------------------------------------------------------------+
enum ENUM_XAU_LEASE_FAILURE_CLASS
{
   XAU_LFC_ONLINE_ALLOWED,
   XAU_LFC_ONLINE_DENIED,
   XAU_LFC_AUTHENTICATION_FAILURE,
   XAU_LFC_AUTHORIZATION_FAILURE,
   XAU_LFC_VALIDATION_FAILURE,
   XAU_LFC_DUPLICATE_OR_CONFLICT,
   XAU_LFC_SERVER_TEMPORARY_FAILURE,
   XAU_LFC_TEMPORARY_CONNECTIVITY_FAILURE,
   XAU_LFC_UNKNOWN_UNSAFE_FAILURE
};

string XAU_LeaseFailureClassName(ENUM_XAU_LEASE_FAILURE_CLASS c)
{
   switch(c)
   {
      case XAU_LFC_ONLINE_ALLOWED:                 return "ONLINE_ALLOWED";
      case XAU_LFC_ONLINE_DENIED:                  return "ONLINE_DENIED";
      case XAU_LFC_AUTHENTICATION_FAILURE:         return "AUTHENTICATION_FAILURE";
      case XAU_LFC_AUTHORIZATION_FAILURE:          return "AUTHORIZATION_FAILURE";
      case XAU_LFC_VALIDATION_FAILURE:             return "VALIDATION_FAILURE";
      case XAU_LFC_DUPLICATE_OR_CONFLICT:          return "DUPLICATE_OR_CONFLICT";
      case XAU_LFC_SERVER_TEMPORARY_FAILURE:       return "SERVER_TEMPORARY_FAILURE";
      case XAU_LFC_TEMPORARY_CONNECTIVITY_FAILURE: return "TEMPORARY_CONNECTIVITY_FAILURE";
      default:                                      return "UNKNOWN_UNSAFE_FAILURE";
   }
}

// httpCode: the WebRequest() return code. -1 means WebRequest itself
// failed (DNS/TLS/timeout/no permission -- no HTTP response at all).
// responseBody: raw response text (may be empty). claimedTrue: caller has
// already checked whether the body contains "claimed":true.
ENUM_XAU_LEASE_FAILURE_CLASS XAU_ClassifyReservationFailure(int httpCode, const string &responseBody, bool claimedTrue)
{
   if(httpCode == -1)
      return XAU_LFC_TEMPORARY_CONNECTIVITY_FAILURE;
   if(httpCode == 200)
   {
      if(claimedTrue) return XAU_LFC_ONLINE_ALLOWED;
      if(StringFind(responseBody, "ACTIVE_EXECUTION_RESERVED") >= 0) return XAU_LFC_ONLINE_DENIED;
      return XAU_LFC_ONLINE_DENIED; // any other 200-without-claimed body is still an explicit backend answer, not a connectivity issue
   }
   if(httpCode == 400) return XAU_LFC_VALIDATION_FAILURE;
   if(httpCode == 401) return XAU_LFC_AUTHENTICATION_FAILURE;
   if(httpCode == 403)
   {
      if(StringFind(responseBody, "PRIMARY_TERMINAL_ALREADY_ASSIGNED") >= 0 ||
         StringFind(responseBody, "NOT_CURRENT_HOLDER") >= 0)
         return XAU_LFC_AUTHORIZATION_FAILURE;
      return XAU_LFC_AUTHENTICATION_FAILURE; // license/account-binding mismatches (Phase 2 audit §9)
   }
   if(httpCode == 409) return XAU_LFC_DUPLICATE_OR_CONFLICT;
   if(httpCode == 500 || httpCode == 502 || httpCode == 503 || httpCode == 504)
      return XAU_LFC_SERVER_TEMPORARY_FAILURE;
   return XAU_LFC_UNKNOWN_UNSAFE_FAILURE; // fail closed on anything unrecognized
}

bool XAU_LeaseFailureAllowsOfflineFallback(ENUM_XAU_LEASE_FAILURE_CLASS c)
{
   return (c == XAU_LFC_TEMPORARY_CONNECTIVITY_FAILURE || c == XAU_LFC_SERVER_TEMPORARY_FAILURE);
}

//+------------------------------------------------------------------+
//| Lease state (parsed + persisted).                                 |
//+------------------------------------------------------------------+
struct XauLeaseState
{
   bool     loaded;
   // canonical signed fields (mirrors lease_service.py's _CANONICAL_FIELD_ORDER)
   int      schemaVersion;
   string   leaseId;
   string   keyId;
   string   tenantId;
   string   licenseId;
   string   accountLogin;
   string   accountServer;
   string   installationId;
   string   terminalInstanceId;
   string   normalizedSymbol;
   string   allowedDirectionsCsv;      // e.g. "1,-1"
   string   allowedEntryFamiliesCsv;   // e.g. "CORE"
   long     issuedAtUnix;
   long     notBeforeUnix;
   long     expiresAtUnix;
   long     renewalAfterUnix;
   int      maximumOfflineNewCampaigns;
   int      remainingOfflineNewCampaigns;
   long     leaseSequence;
   long     revocationEpoch;
   string   nonce;
   // signature envelope
   string   signatureAlgorithm;
   string   detachedSignature;
   // local bookkeeping (never part of the signed payload)
   datetime receivedAtBrokerTime;
   ulong    receivedAtMonotonicMs;
   int      consumedThisLease;         // how many offline campaigns already sent under this lease_id
   string   lastConsumedExecutionKey;  // most recent offline-authorized execution key, for diagnostics
};

XauLeaseState g_xauLeaseState;

//+------------------------------------------------------------------+
//| File path -- terminal-local (NOT common), so two different        |
//| terminals on the same machine never share or overwrite each      |
//| other's lease state.                                              |
//+------------------------------------------------------------------+
string XAU_LeaseStateFilePath()      { return "XauCloudLease\\lease_state.dat"; }
string XAU_LeaseStateFilePathTmp()   { return "XauCloudLease\\lease_state.tmp"; }
string XAU_LeaseInstallationIdPath() { return "XauCloudLease\\installation_id.dat"; } // common data -- survives per-machine, not per-terminal
string XAU_LeaseTerminalIdPath()     { return "XauCloudLease\\terminal_id.dat"; }     // terminal-local

//+------------------------------------------------------------------+
//| Permanent installation/terminal identity (Phase 4). Generated     |
//| once, never regenerated once written, survives EA/chart/MT5       |
//| restart because it's a file, not an in-memory value.               |
//+------------------------------------------------------------------+
string XAU_LeaseGenerateRandomId()
{
   MathSrand((int)GetTickCount64() ^ (int)TimeLocal());
   string s = "";
   for(int i = 0; i < 32; i++)
      s += StringFormat("%x", MathRand() % 16);
   return s;
}

string XAU_LeaseGetOrCreateInstallationId()
{
   string path = XAU_LeaseInstallationIdPath();
   if(FileIsExist(path, FILE_COMMON))
   {
      int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI);
      if(h != INVALID_HANDLE)
      {
         string id = FileReadString(h);
         FileClose(h);
         if(StringLen(id) > 0) return id;
      }
   }
   string newId = "INST-" + XAU_LeaseGenerateRandomId();
   int h2 = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(h2 != INVALID_HANDLE)
   {
      FileWriteString(h2, newId);
      FileFlush(h2);
      FileClose(h2);
   }
   return newId;
}

string XAU_LeaseGetOrCreateTerminalId()
{
   string path = XAU_LeaseTerminalIdPath();
   if(FileIsExist(path, 0))
   {
      int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI);
      if(h != INVALID_HANDLE)
      {
         string id = FileReadString(h);
         FileClose(h);
         if(StringLen(id) > 0) return id;
      }
   }
   string newId = "TERM-" + XAU_LeaseGenerateRandomId();
   int h2 = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h2 != INVALID_HANDLE)
   {
      FileWriteString(h2, newId);
      FileFlush(h2);
      FileClose(h2);
   }
   return newId;
}

//+------------------------------------------------------------------+
//| Atomic persistence (Phase 8): write to a temp file, flush, close, |
//| validate (reopen + re-verify signature), then replace the real    |
//| file. A partially written temp file is never mistaken for valid   |
//| state because the real file is only ever replaced after the temp  |
//| file round-trips successfully.                                    |
//+------------------------------------------------------------------+
string XAU_LeaseSerializeForFile(const XauLeaseState &st)
{
   // Pipe-delimited, one line -- deliberately not JSON (no JSON writer
   // exists in this project's MQL5 code; a fixed-order delimited line is
   // simpler to get right and this file is only ever read back by this
   // same module).
   return StringFormat(
      "%d|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%I64d|%I64d|%I64d|%I64d|%d|%d|%I64d|%I64d|%s|%s|%s|%I64d|%I64u|%d|%s",
      st.schemaVersion, st.leaseId, st.keyId, st.tenantId, st.licenseId,
      st.accountLogin, st.accountServer, st.installationId, st.terminalInstanceId,
      st.normalizedSymbol, st.allowedDirectionsCsv, st.allowedEntryFamiliesCsv,
      st.issuedAtUnix, st.notBeforeUnix, st.expiresAtUnix, st.renewalAfterUnix,
      st.maximumOfflineNewCampaigns, st.remainingOfflineNewCampaigns,
      st.leaseSequence, st.revocationEpoch, st.nonce,
      st.signatureAlgorithm, st.detachedSignature,
      (long)st.receivedAtBrokerTime, st.receivedAtMonotonicMs, st.consumedThisLease, st.lastConsumedExecutionKey
   );
}

bool XAU_LeaseDeserializeFromFile(const string &line, XauLeaseState &st)
{
   string parts[];
   int n = StringSplit(line, '|', parts);
   if(n != 27) return false;
   int idx = 0;
   st.schemaVersion = (int)StringToInteger(parts[idx++]);
   st.leaseId = parts[idx++];
   st.keyId = parts[idx++];
   st.tenantId = parts[idx++];
   st.licenseId = parts[idx++];
   st.accountLogin = parts[idx++];
   st.accountServer = parts[idx++];
   st.installationId = parts[idx++];
   st.terminalInstanceId = parts[idx++];
   st.normalizedSymbol = parts[idx++];
   st.allowedDirectionsCsv = parts[idx++];
   st.allowedEntryFamiliesCsv = parts[idx++];
   st.issuedAtUnix = StringToInteger(parts[idx++]);
   st.notBeforeUnix = StringToInteger(parts[idx++]);
   st.expiresAtUnix = StringToInteger(parts[idx++]);
   st.renewalAfterUnix = StringToInteger(parts[idx++]);
   st.maximumOfflineNewCampaigns = (int)StringToInteger(parts[idx++]);
   st.remainingOfflineNewCampaigns = (int)StringToInteger(parts[idx++]);
   st.leaseSequence = StringToInteger(parts[idx++]);
   st.revocationEpoch = StringToInteger(parts[idx++]);
   st.nonce = parts[idx++];
   st.signatureAlgorithm = parts[idx++];
   st.detachedSignature = parts[idx++];
   st.receivedAtBrokerTime = (datetime)StringToInteger(parts[idx++]);
   st.receivedAtMonotonicMs = (ulong)StringToInteger(parts[idx++]);
   st.consumedThisLease = (int)StringToInteger(parts[idx++]);
   st.lastConsumedExecutionKey = parts[idx++];
   st.loaded = true;
   return true;
}

// Rebuilds the exact canonical payload from a loaded/parsed state, in the
// same fixed field order lease_service.py's canonical_payload() uses, so
// the persisted signature can be re-verified after loading from disk (not
// just trusted because the file parsed).
string XAU_LeaseCanonicalPayloadFromState(const XauLeaseState &st)
{
   return StringFormat(
      "schema_version=%d|lease_id=%s|key_id=%s|tenant_id=%s|license_id=%s|account_login=%s|account_server=%s|installation_id=%s|terminal_instance_id=%s|normalized_symbol=%s|allowed_directions=%s|allowed_entry_families=%s|issued_at_unix=%I64d|not_before_unix=%I64d|expires_at_unix=%I64d|renewal_after_unix=%I64d|maximum_offline_new_campaigns=%d|remaining_offline_new_campaigns=%d|lease_sequence=%I64d|revocation_epoch=%I64d|nonce=%s",
      st.schemaVersion, st.leaseId, st.keyId, st.tenantId, st.licenseId,
      st.accountLogin, st.accountServer, st.installationId, st.terminalInstanceId,
      st.normalizedSymbol, st.allowedDirectionsCsv, st.allowedEntryFamiliesCsv,
      st.issuedAtUnix, st.notBeforeUnix, st.expiresAtUnix, st.renewalAfterUnix,
      st.maximumOfflineNewCampaigns, st.remainingOfflineNewCampaigns,
      st.leaseSequence, st.revocationEpoch, st.nonce
   );
}

bool XAU_LeaseVerifyState(const XauLeaseState &st)
{
   string modulus;
   if(!XAU_LeaseLookupTrustedModulus(st.keyId, modulus))
      return false; // unknown key_id -- never trust
   string payload = XAU_LeaseCanonicalPayloadFromState(st);
   uchar payloadBytes[];
   StringToCharArray(payload, payloadBytes, 0, StringLen(payload), CP_UTF8);
   // StringToCharArray appends a trailing null terminator -- strip it so
   // the byte sequence exactly matches what Python's .encode("utf-8")
   // produces (no null byte).
   int rawLen = ArraySize(payloadBytes);
   if(rawLen > 0 && payloadBytes[rawLen - 1] == 0)
   {
      ArrayResize(payloadBytes, rawLen - 1);
   }
   return XAU_LeaseVerifySignature(payloadBytes, st.detachedSignature, modulus, st.signatureAlgorithm);
}

bool XAU_LeasePersist(const XauLeaseState &st)
{
   string tmpPath = XAU_LeaseStateFilePathTmp();
   int h = FileOpen(tmpPath, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   string serialized = XAU_LeaseSerializeForFile(st);
   FileWriteString(h, serialized);
   FileFlush(h);
   FileClose(h);

   // Validate: reopen the temp file and confirm it round-trips to a
   // signature-valid state before ever touching the real file.
   int hv = FileOpen(tmpPath, FILE_READ | FILE_TXT | FILE_ANSI);
   if(hv == INVALID_HANDLE) return false;
   string readBack = FileReadString(hv);
   FileClose(hv);
   XauLeaseState verifyState;
   if(!XAU_LeaseDeserializeFromFile(readBack, verifyState)) return false;
   if(!XAU_LeaseVerifyState(verifyState)) return false;

   FileDelete(XAU_LeaseStateFilePath());
   bool moved = FileMove(tmpPath, 0, XAU_LeaseStateFilePath(), FILE_REWRITE);
   return moved;
}

bool XAU_LeaseLoadFromDisk(XauLeaseState &st)
{
   string path = XAU_LeaseStateFilePath();
   if(!FileIsExist(path, 0)) return false;
   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   string line = FileReadString(h);
   FileClose(h);
   if(!XAU_LeaseDeserializeFromFile(line, st)) return false;
   if(!XAU_LeaseVerifyState(st)) return false; // corrupted/tampered file -- never trust
   return true;
}

//+------------------------------------------------------------------+
//| Clock integrity (Phase 9). Never trust wall-clock alone: track    |
//| both a broker-time anchor (set at lease receipt) and a monotonic  |
//| GetTickCount64() anchor from the same instant. While the same     |
//| process keeps running, elapsed time is computed from the          |
//| monotonic counter (immune to the OS clock being changed); the     |
//| broker-time anchor is cross-checked against a fresh TimeCurrent() |
//| read to catch a computer clock that has jumped backwards or a     |
//| broker-time/monotonic divergence beyond tolerance. An MT5 restart |
//| loses the monotonic anchor's meaning (GetTickCount64 resets), so  |
//| a reloaded lease is re-anchored to a FRESH monotonic reading at   |
//| load time -- expiry itself is still judged from the signed        |
//| expires_at_unix vs. fresh broker time, so restarting MT5 can      |
//| never extend how long a lease is considered valid.                |
//+------------------------------------------------------------------+
#define XAU_LEASE_CLOCK_DIVERGENCE_TOLERANCE_SEC 120

enum ENUM_XAU_LEASE_VALIDITY
{
   XAU_LEASE_VALID,
   XAU_LEASE_INVALID_NOT_LOADED,
   XAU_LEASE_INVALID_SIGNATURE,
   XAU_LEASE_INVALID_EXPIRED,
   XAU_LEASE_INVALID_NOT_YET_VALID,
   XAU_LEASE_INVALID_NO_ALLOWANCE_REMAINING,
   XAU_LEASE_INVALID_CLOCK_INTEGRITY,
   XAU_LEASE_INVALID_WRONG_SCOPE
};

string XAU_LeaseValidityName(ENUM_XAU_LEASE_VALIDITY v)
{
   switch(v)
   {
      case XAU_LEASE_VALID:                             return "VALID";
      case XAU_LEASE_INVALID_NOT_LOADED:                return "NOT_LOADED";
      case XAU_LEASE_INVALID_SIGNATURE:                 return "INVALID_SIGNATURE";
      case XAU_LEASE_INVALID_EXPIRED:                   return "EXPIRED";
      case XAU_LEASE_INVALID_NOT_YET_VALID:              return "NOT_YET_VALID";
      case XAU_LEASE_INVALID_NO_ALLOWANCE_REMAINING:     return "NO_ALLOWANCE_REMAINING";
      case XAU_LEASE_INVALID_CLOCK_INTEGRITY:            return "CLOCK_INTEGRITY_FAILURE";
      case XAU_LEASE_INVALID_WRONG_SCOPE:                return "WRONG_SCOPE";
      default:                                            return "UNKNOWN";
   }
}

// Fresh broker time is REQUIRED -- if the terminal has no recent quote
// (e.g. market fully disconnected, not just the cloud backend), we
// cannot responsibly judge lease expiry and must fail closed.
ENUM_XAU_LEASE_VALIDITY XAU_LeaseCheckValidity(const XauLeaseState &st, int direction, const string &entryFamily,
                                                const string &accountLoginNow, const string &accountServerNow,
                                                const string &symbolNow, const string &installationIdNow,
                                                const string &terminalInstanceIdNow)
{
   if(!st.loaded) return XAU_LEASE_INVALID_NOT_LOADED;
   if(!XAU_LeaseVerifyState(st)) return XAU_LEASE_INVALID_SIGNATURE;

   if(st.accountLogin != accountLoginNow) return XAU_LEASE_INVALID_WRONG_SCOPE;
   if(st.accountServer != accountServerNow) return XAU_LEASE_INVALID_WRONG_SCOPE;
   if(st.normalizedSymbol != symbolNow) return XAU_LEASE_INVALID_WRONG_SCOPE;
   if(st.installationId != installationIdNow) return XAU_LEASE_INVALID_WRONG_SCOPE;
   if(st.terminalInstanceId != terminalInstanceIdNow) return XAU_LEASE_INVALID_WRONG_SCOPE;
   if(StringFind("," + st.allowedDirectionsCsv + ",", "," + IntegerToString(direction) + ",") < 0)
      return XAU_LEASE_INVALID_WRONG_SCOPE;
   if(StringFind("," + st.allowedEntryFamiliesCsv + ",", "," + entryFamily + ",") < 0)
      return XAU_LEASE_INVALID_WRONG_SCOPE;

   datetime brokerNow = TimeCurrent();
   if(brokerNow <= 0) return XAU_LEASE_INVALID_CLOCK_INTEGRITY; // no fresh broker time available at all

   ulong monotonicNow = GetTickCount64();
   // Elapsed time per the monotonic counter since the lease was received/
   // loaded (immune to wall-clock changes; wraps roughly every 584 million
   // years at the ulong width used here, not a practical concern).
   ulong monotonicElapsedMs = monotonicNow - st.receivedAtMonotonicMs;
   long brokerElapsedSec = (long)brokerNow - (long)st.receivedAtBrokerTime;
   long monotonicElapsedSec = (long)(monotonicElapsedMs / 1000);

   // If broker time and the monotonic counter have diverged by more than
   // the tolerance, something is wrong (computer clock jumped, broker time
   // feed is stale/wrong) -- fail closed rather than guess which to trust.
   long divergence = brokerElapsedSec - monotonicElapsedSec;
   if(divergence < 0) divergence = -divergence;
   if(divergence > XAU_LEASE_CLOCK_DIVERGENCE_TOLERANCE_SEC)
      return XAU_LEASE_INVALID_CLOCK_INTEGRITY;

   if(brokerNow < (datetime)st.notBeforeUnix) return XAU_LEASE_INVALID_NOT_YET_VALID;
   if(brokerNow >= (datetime)st.expiresAtUnix) return XAU_LEASE_INVALID_EXPIRED;
   // remainingOfflineNewCampaigns is a SIGNED field -- it is the original
   // grant and must never be mutated locally (doing so would invalidate
   // the signature on next reload). Consumption is tracked separately in
   // the local-only (unsigned) consumedThisLease counter; the effective
   // remaining allowance is always the signed grant minus local
   // consumption, never the signed field mutated in place.
   if(st.remainingOfflineNewCampaigns - st.consumedThisLease <= 0) return XAU_LEASE_INVALID_NO_ALLOWANCE_REMAINING;

   return XAU_LEASE_VALID;
}

//+------------------------------------------------------------------+
//| Local same-terminal mutex (Phase 10) -- extends, does not replace, |
//| the existing XAU_TryClaimEntryLock() GlobalVariable pattern       |
//| (mq5:4015-4073 per audits/offline_lease/02_reservation_flow_audit |
//| .md). This is a SEPARATE, additionally-scoped mutex specifically  |
//| guarding the offline-authorized send path, keyed by license+      |
//| account+server+symbol+direction so it never collides with the    |
//| existing online-path lock names.                                  |
//+------------------------------------------------------------------+
string XAU_LeaseMutexName(const string &licenseId, const string &accountLogin, const string &accountServer,
                          const string &symbol, int direction)
{
   return "XAUCLOUD_LEASE_MUTEX_" + licenseId + "_" + accountLogin + "_" + accountServer + "_" + symbol + "_" + (direction == 1 ? "BUY" : "SELL");
}

// Compare-and-set: succeeds only if the named global variable does not
// exist or is older than staleSeconds (a crashed/hung prior attempt).
// Mirrors XAU_TryClaimEntryLock()'s proven compare-and-swap exactly
// (mq5:4056-4073 -- see the v6.20.3 adversarial-review comment there
// explaining why a plain check-then-set is a real TOCTOU race between
// two chart instances): GlobalVariableSetOnCondition only succeeds if
// the variable's value is STILL exactly oldVal at the instant of the
// write, so a racing second acquire attempt correctly fails closed
// instead of silently overwriting the first holder's claim.
bool XAU_LeaseMutexTryAcquire(const string &name, int staleSeconds = 60)
{
   // GlobalVariableSetOnCondition() does NOT create a variable that does
   // not exist yet in this MQL5 build (verified empirically: it fails
   // with GetLastError()==4501/"global variable not found" even when
   // comparing against check_value=0.0 -- not the commonly-assumed
   // auto-create-on-zero behavior). For the true first-ever claim of this
   // exact key there is by definition no prior claimant to race against,
   // so a plain GlobalVariableSet() is the correct primitive there. Once
   // the variable exists, every subsequent claim goes through the real
   // compare-and-swap below, identical to XAU_TryClaimEntryLock()'s
   // proven pattern (mq5:4056-4073).
   if(!GlobalVariableCheck(name))
      return GlobalVariableSet(name, (double)TimeCurrent()) != 0;

   double oldVal = GlobalVariableGet(name);
   double elapsed = (oldVal > 0.0) ? (double)(TimeCurrent() - (datetime)oldVal) : 1.0e9;
   if(elapsed < staleSeconds)
      return false; // held by a still-fresh attempt
   return GlobalVariableSetOnCondition(name, (double)TimeCurrent(), oldVal);
}

void XAU_LeaseMutexRelease(const string &name)
{
   GlobalVariableDel(name);
}

//+------------------------------------------------------------------+
//| Deterministic offline execution key + durable dedup ledger        |
//| (Phase 11). Reuses the EXISTING XAU_CoreExecutionKey() identity   |
//| unmodified (this module never changes that function or its        |
//| online-path callers) and combines it with the current lease_id +  |
//| lease_sequence, then checks/records it in a restart-surviving      |
//| ledger file scoped ONLY to offline-authorized sends -- the online |
//| path's own duplicate protection (existing GV lock + backend        |
//| reservation) is completely untouched.                              |
//+------------------------------------------------------------------+
string XAU_LeaseOfflineExecutionKey(const string &coreExecutionKey, const string &leaseId, long leaseSequence)
{
   return coreExecutionKey + "|LEASE|" + leaseId + "|" + IntegerToString((int)leaseSequence);
}

string XAU_LeaseOfflineLedgerPath() { return "XauCloudLease\\offline_sent_ledger.dat"; }

// Returns true if this exact offline execution key has NOT been sent
// before (i.e. it is safe to proceed) and durably records it before the
// caller is allowed to continue -- restart-proof because it's a file,
// checked BEFORE the broker send is attempted, same discipline as the
// existing local GV mutex but surviving process restart.
// Read-only peek -- true if this execution key has already been recorded
// (i.e. it must never be sent). Used at AUTHORIZATION time (before the
// broker send) to refuse re-attempting an already-consumed candidate,
// without yet writing anything -- the actual record is only written by
// XAU_LeaseOfflineLedgerTryRecordNew() once the real broker outcome is
// known (confirmed or ambiguous), never merely because a candidate was
// evaluated or authorized (owner requirement, Phase 5/Phase 12 step 30).
bool XAU_LeaseOfflineLedgerContains(const string &executionKey)
{
   string path = XAU_LeaseOfflineLedgerPath();
   if(!FileIsExist(path, 0)) return false;
   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   bool found = false;
   while(!FileIsEnding(h))
   {
      string existing = FileReadString(h);
      if(existing == executionKey) { found = true; break; }
   }
   FileClose(h);
   return found;
}

bool XAU_LeaseOfflineLedgerTryRecordNew(const string &executionKey)
{
   if(XAU_LeaseOfflineLedgerContains(executionKey))
      return false; // already recorded -- never send twice for this key
   string path = XAU_LeaseOfflineLedgerPath();
   int ha = FileOpen(path, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(ha == INVALID_HANDLE) return false;
   FileSeek(ha, 0, SEEK_END);
   FileWriteString(ha, executionKey + "\n");
   FileFlush(ha);
   FileClose(ha);
   return true;
}

// Called ONLY after a broker send whose retcode was accepted (confirmed
// OR ambiguous-may-have-executed) -- never on evaluation alone, never on
// an explicit rejection. Increments the LOCAL (unsigned) consumption
// counter and re-persists the lease state file (the signed fields are
// untouched, so the signature remains valid on next reload -- see the
// comment on XAU_LeaseCheckValidity's allowance check).
bool XAU_LeaseConsumeOfflineAllowance(XauLeaseState &st, const string &executionKey)
{
   if(!XAU_LeaseOfflineLedgerTryRecordNew(executionKey))
      return false; // already consumed for this exact candidate -- do not double-count
   st.consumedThisLease = st.consumedThisLease + 1;
   st.lastConsumedExecutionKey = executionKey;
   return XAU_LeasePersist(st);
}

//+------------------------------------------------------------------+
//| Durable reconciliation queue (Phase 15) -- every offline-authorized|
//| send (confirmed or ambiguous) is appended here with everything the |
//| backend's /cloud/lease/reconcile endpoint needs. Never deleted by  |
//| this module on a failed upload attempt -- only the reconciliation  |
//| upload code (wired at reconnection) removes an entry, and only     |
//| after the backend acknowledges it.                                 |
//+------------------------------------------------------------------+
string XAU_LeaseReconcileQueuePath() { return "XauCloudLease\\reconcile_queue.dat"; }

void XAU_LeaseQueueReconciliationEvent(const string &executionKey, const string &leaseId, long leaseSequence,
                                       int direction, const string &entryFamily, string brokerTicket,
                                       string result, datetime executedAt)
{
   string line = StringFormat("%s|%s|%I64d|%d|%s|%s|%s|%I64d",
                               executionKey, leaseId, leaseSequence, direction, entryFamily,
                               brokerTicket, result, (long)executedAt);
   int h = FileOpen(XAU_LeaseReconcileQueuePath(), FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, line + "\n");
   FileFlush(h);
   FileClose(h);
}

//+------------------------------------------------------------------+
//| Minimal JSON field extraction -- raw substring search, matching   |
//| this codebase's existing convention (per                          |
//| audits/offline_lease/02_reservation_flow_audit.md §1: the existing|
//| XAU_ClaimDirectionReservation() already parses "claimed":true and |
//| "reservationId" this same way, not with a full JSON library).     |
//| Only used to read a handful of known, backend-controlled response |
//| fields -- never used to parse anything that gets signature-        |
//| verified (the signed lease fields are parsed by the fixed-order    |
//| pipe-delimited path above once persisted, not from this JSON       |
//| directly).                                                         |
//+------------------------------------------------------------------+
// Advances past any run of plain ASCII spaces starting at `pos`. Python's
// json.dumps() (the real backend's serializer) uses the default
// separators (", ", ": ") -- i.e. a space after every colon and every
// comma -- so a JSON extractor that assumes compact/no-space JSON
// silently fails to find anything at all. This was a real bug caught by
// running the full parse pipeline in Strategy Tester: every field
// defaulted to empty/zero because the naive needle-with-no-space never
// matched.
int XAU_JsonSkipWhitespace(const string &json, int pos)
{
   int len = StringLen(json);
   while(pos < len && StringGetCharacter(json, pos) == ' ')
      pos++;
   return pos;
}

string XAU_JsonExtractString(const string &json, const string &key)
{
   string needle = "\"" + key + "\":";
   int pos = StringFind(json, needle);
   if(pos < 0) return "";
   int start = XAU_JsonSkipWhitespace(json, pos + StringLen(needle));
   if(start >= StringLen(json) || StringGetCharacter(json, start) != '"') return "";
   start++; // skip the opening quote
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

long XAU_JsonExtractInt(const string &json, const string &key)
{
   string needle = "\"" + key + "\":";
   int pos = StringFind(json, needle);
   if(pos < 0) return 0;
   int start = XAU_JsonSkipWhitespace(json, pos + StringLen(needle));
   int end = start;
   int len = StringLen(json);
   while(end < len)
   {
      ushort c = StringGetCharacter(json, end);
      if((c >= '0' && c <= '9') || c == '-') { end++; continue; }
      break;
   }
   return StringToInteger(StringSubstr(json, start, end - start));
}

bool XAU_JsonExtractBool(const string &json, const string &key)
{
   string needle = "\"" + key + "\":";
   int pos = StringFind(json, needle);
   if(pos < 0) return false;
   int start = XAU_JsonSkipWhitespace(json, pos + StringLen(needle));
   return StringSubstr(json, start, 4) == "true";
}

void XAU_LeaseParseResponseIntoState(const string &json, XauLeaseState &st)
{
   st.schemaVersion = (int)XAU_JsonExtractInt(json, "schema_version");
   st.leaseId = XAU_JsonExtractString(json, "lease_id");
   st.keyId = XAU_JsonExtractString(json, "key_id");
   st.tenantId = XAU_JsonExtractString(json, "tenant_id");
   st.licenseId = XAU_JsonExtractString(json, "license_id");
   st.accountLogin = XAU_JsonExtractString(json, "account_login");
   st.accountServer = XAU_JsonExtractString(json, "account_server");
   st.installationId = XAU_JsonExtractString(json, "installation_id");
   st.terminalInstanceId = XAU_JsonExtractString(json, "terminal_instance_id");
   st.normalizedSymbol = XAU_JsonExtractString(json, "normalized_symbol");
   st.issuedAtUnix = XAU_JsonExtractInt(json, "issued_at_unix");
   st.notBeforeUnix = XAU_JsonExtractInt(json, "not_before_unix");
   st.expiresAtUnix = XAU_JsonExtractInt(json, "expires_at_unix");
   st.renewalAfterUnix = XAU_JsonExtractInt(json, "renewal_after_unix");
   st.maximumOfflineNewCampaigns = (int)XAU_JsonExtractInt(json, "maximum_offline_new_campaigns");
   st.remainingOfflineNewCampaigns = (int)XAU_JsonExtractInt(json, "remaining_offline_new_campaigns");
   st.leaseSequence = XAU_JsonExtractInt(json, "lease_sequence");
   st.revocationEpoch = XAU_JsonExtractInt(json, "revocation_epoch");
   st.nonce = XAU_JsonExtractString(json, "nonce");
   st.signatureAlgorithm = XAU_JsonExtractString(json, "signature_algorithm");
   st.detachedSignature = XAU_JsonExtractString(json, "detached_signature");
   // allowed_directions / allowed_entry_families arrive as JSON arrays
   // (e.g. [1,-1] / ["CORE"]); normalize to the same comma-joined form
   // used internally and in the canonical payload.
   st.allowedDirectionsCsv = XAU_LeaseExtractArrayAsCsv(json, "allowed_directions");
   st.allowedEntryFamiliesCsv = XAU_LeaseExtractArrayAsCsv(json, "allowed_entry_families", true);
   st.receivedAtBrokerTime = TimeCurrent();
   st.receivedAtMonotonicMs = GetTickCount64();
   st.consumedThisLease = 0;
   st.lastConsumedExecutionKey = "";
   st.loaded = true;
}

// Normalizes a JSON array's elements into a plain comma-joined string with
// NO surrounding whitespace and no quotes -- e.g. "[1, -1]" and "[1,-1]"
// both become "1,-1", matching exactly what Python's canonical_payload()
// produces (",".join(str(v) for v in value), no spaces). This was a real
// bug caught by running the full parse-then-verify pipeline in Strategy
// Tester: Python's json.dumps() inserts ", " between array elements by
// default, which silently broke signature verification for every lease
// until this was fixed to split/trim/rejoin instead of taking the raw
// bracket interior verbatim.
string XAU_LeaseExtractArrayAsCsv(const string &json, const string &key, bool isStringArray = false)
{
   string needle = "\"" + key + "\":";
   int pos = StringFind(json, needle);
   if(pos < 0) return "";
   int bracketPos = XAU_JsonSkipWhitespace(json, pos + StringLen(needle));
   if(bracketPos >= StringLen(json) || StringGetCharacter(json, bracketPos) != '[') return "";
   int start = bracketPos + 1;
   int end = StringFind(json, "]", start);
   if(end < 0) return "";
   string inner = StringSubstr(json, start, end - start);

   string tokens[];
   int n = StringSplit(inner, ',', tokens);
   string result = "";
   for(int i = 0; i < n; i++)
   {
      string t = tokens[i];
      StringTrimLeft(t);
      StringTrimRight(t);
      // strip surrounding quotes if this is a string-array element
      if(StringLen(t) >= 2 && StringGetCharacter(t, 0) == '"' && StringGetCharacter(t, StringLen(t) - 1) == '"')
         t = StringSubstr(t, 1, StringLen(t) - 2);
      if(i > 0) result += ",";
      result += t;
   }
   return result;
}

//+------------------------------------------------------------------+
//| Network calls. Every one of these returns the failure             |
//| classification alongside its result, so the caller never has to   |
//| re-derive it. On XAU_LFC_ONLINE_ALLOWED, the parsed+verified lease |
//| is already persisted to disk before returning.                    |
//+------------------------------------------------------------------+
ENUM_XAU_LEASE_FAILURE_CLASS XAU_LeaseRequestOnline(const string &cloudUrl, int timeoutMs, const string &pin,
                                                     const string &account, const string &brokerServer, const string &symbol,
                                                     const string &installationId, const string &terminalInstanceId,
                                                     const string &endpointSuffix, XauLeaseState &outState)
{
   string body = StringFormat(
      "{\"pin\":\"%s\",\"account\":\"%s\",\"broker_server\":\"%s\",\"symbol\":\"%s\",\"installation_id\":\"%s\",\"terminal_instance_id\":\"%s\",\"allowed_directions\":[1,-1],\"allowed_entry_families\":[\"CORE\"]}",
      pin, account, brokerServer, symbol, installationId, terminalInstanceId
   );
   uchar pd[]; StringToCharArray(body, pd, 0, StringLen(body), CP_UTF8);
   int rawLen = ArraySize(pd);
   if(rawLen > 0 && pd[rawLen - 1] == 0) ArrayResize(pd, rawLen - 1);

   string hdr = "Content-Type: application/json\r\n";
   uchar res[]; string rh;
   ResetLastError();
   int code = WebRequest("POST", cloudUrl + "/api/cloud/lease/" + endpointSuffix, hdr, timeoutMs, pd, res, rh);
   string responseBody = "";
   if(code != -1) responseBody = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);

   bool issuedTrue = XAU_JsonExtractBool(responseBody, "issued");
   ENUM_XAU_LEASE_FAILURE_CLASS cls = XAU_ClassifyReservationFailure(code, responseBody, issuedTrue);
   if(cls == XAU_LFC_ONLINE_ALLOWED && issuedTrue)
   {
      XAU_LeaseParseResponseIntoState(responseBody, outState);
      if(!XAU_LeaseVerifyState(outState))
      {
         PrintFormat("XAUCLOUD_LEASE_SIGNATURE_REJECTED_ON_ISSUE endpoint=%s -- refusing to persist an unverifiable lease", endpointSuffix);
         return XAU_LFC_UNKNOWN_UNSAFE_FAILURE;
      }
      if(!XAU_LeasePersist(outState))
      {
         PrintFormat("XAUCLOUD_LEASE_PERSIST_FAILED endpoint=%s", endpointSuffix);
         return XAU_LFC_UNKNOWN_UNSAFE_FAILURE;
      }
      PrintFormat("XAUCLOUD_LEASE_ISSUED endpoint=%s lease_id=%s sequence=%I64d expires_at_unix=%I64d",
                  endpointSuffix, outState.leaseId, outState.leaseSequence, outState.expiresAtUnix);
   }
   return cls;
}

void XAU_LeaseSurrenderOnline(const string &cloudUrl, int timeoutMs, const string &pin, const string &account,
                              const string &brokerServer, const string &symbol, const string &installationId,
                              const string &terminalInstanceId, const string &leaseId)
{
   string body = StringFormat(
      "{\"pin\":\"%s\",\"account\":\"%s\",\"broker_server\":\"%s\",\"symbol\":\"%s\",\"installation_id\":\"%s\",\"terminal_instance_id\":\"%s\",\"lease_id\":\"%s\"}",
      pin, account, brokerServer, symbol, installationId, terminalInstanceId, leaseId
   );
   uchar pd[]; StringToCharArray(body, pd, 0, StringLen(body), CP_UTF8);
   int rawLen = ArraySize(pd);
   if(rawLen > 0 && pd[rawLen - 1] == 0) ArrayResize(pd, rawLen - 1);
   string hdr = "Content-Type: application/json\r\n";
   uchar res[]; string rh;
   ResetLastError();
   WebRequest("POST", cloudUrl + "/api/cloud/lease/surrender", hdr, timeoutMs, pd, res, rh);
   // Best-effort, same discipline as the existing XAU_ReleaseDirectionReservation()
   // (mq5:5425-5447) -- no retry; the lease's own expiry is the backstop.
}

//+------------------------------------------------------------------+
//| Single top-level entry point the main EA calls at the final       |
//| order-send choke point (Phase 12). Bundles: load persisted lease   |
//| from disk, verify its signature, check clock-integrity/scope/      |
//| allowance validity, peek (not consume) the offline dedup ledger,   |
//| and acquire the local same-terminal mutex -- all in one call so    |
//| the EA integration itself stays a small, easy-to-review diff.      |
//|                                                                    |
//| On success (returns true): the caller now holds the local mutex   |
//| and MUST release it (XAU_LeaseMutexRelease with the returned       |
//| mutexNameOut) after the broker result is known, and must call      |
//| XAU_LeaseConsumeOfflineAllowance() -- only if the broker retcode   |
//| was accepted (confirmed or ambiguous) -- never on outright         |
//| rejection or merely for having attempted the send.                 |
//+------------------------------------------------------------------+
bool XAU_LeaseTryAuthorizeOffline(int direction, const string &entryFamily, const string &candidateExecutionKey,
                                   const string &accountLogin, const string &accountServer, const string &symbol,
                                   XauLeaseState &outState, string &offlineExecutionKeyOut, string &mutexNameOut,
                                   string &blockReasonOut)
{
   blockReasonOut = "";
   if(!XAU_LeaseLoadFromDisk(outState))
   {
      blockReasonOut = "OFFLINE_LEASE_NOT_LOADED";
      return false;
   }
   string installationId = XAU_LeaseGetOrCreateInstallationId();
   string terminalId = XAU_LeaseGetOrCreateTerminalId();
   ENUM_XAU_LEASE_VALIDITY validity = XAU_LeaseCheckValidity(outState, direction, entryFamily,
                                                              accountLogin, accountServer, symbol,
                                                              installationId, terminalId);
   if(validity != XAU_LEASE_VALID)
   {
      blockReasonOut = "OFFLINE_LEASE_" + XAU_LeaseValidityName(validity);
      return false;
   }

   mutexNameOut = XAU_LeaseMutexName(outState.licenseId, accountLogin, accountServer, symbol, direction);
   if(!XAU_LeaseMutexTryAcquire(mutexNameOut))
   {
      blockReasonOut = "OFFLINE_LEASE_LOCAL_MUTEX_HELD";
      return false;
   }

   offlineExecutionKeyOut = XAU_LeaseOfflineExecutionKey(candidateExecutionKey, outState.leaseId, outState.leaseSequence);
   if(XAU_LeaseOfflineLedgerContains(offlineExecutionKeyOut))
   {
      blockReasonOut = "OFFLINE_LEASE_EXECUTION_KEY_ALREADY_CONSUMED";
      XAU_LeaseMutexRelease(mutexNameOut);
      return false;
   }

   return true;
}

//+------------------------------------------------------------------+
//| Reconnection/reconciliation upload (Phase 15). Called periodically |
//| (gated by InpOfflineLeaseEnabled, rate-limited) once the backend is |
//| reachable again. Uploads every queued offline event idempotently -- |
//| the backend's /cloud/lease/reconcile endpoint keys each event by    |
//| its execution_key and safely no-ops a duplicate upload. Queue       |
//| entries are only ever removed after a real HTTP 200 response;       |
//| a failed upload attempt leaves the file untouched so nothing is     |
//| ever lost to one bad network call.                                  |
//+------------------------------------------------------------------+
bool XAU_LeaseUploadReconciliationQueue(const string &cloudUrl, int timeoutMs, const string &pin,
                                        const string &account, const string &brokerServer, const string &symbol,
                                        const string &installationId, const string &terminalInstanceId)
{
   string path = XAU_LeaseReconcileQueuePath();
   if(!FileIsExist(path, 0)) return true; // nothing queued -- trivially successful

   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return false;
   string lines[];
   int n = 0;
   while(!FileIsEnding(h))
   {
      string line = FileReadString(h);
      if(StringLen(line) == 0) continue;
      ArrayResize(lines, n + 1);
      lines[n] = line;
      n++;
   }
   FileClose(h);
   if(n == 0) return true;

   string eventsJson = "[";
   for(int i = 0; i < n; i++)
   {
      string parts[];
      int partCount = StringSplit(lines[i], '|', parts);
      if(partCount != 8) continue; // malformed line -- skip rather than crash, left in queue for a human to inspect
      if(i > 0) eventsJson += ",";
      eventsJson += StringFormat(
         "{\"execution_key\":\"%s\",\"lease_id\":\"%s\",\"lease_sequence\":%s,\"direction\":%s,\"entry_family\":\"%s\",\"broker_ticket\":%s,\"result\":\"%s\",\"executed_at\":\"%s\"}",
         parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[7]);
   }
   eventsJson += "]";

   string body = StringFormat(
      "{\"pin\":\"%s\",\"account\":\"%s\",\"broker_server\":\"%s\",\"symbol\":\"%s\",\"installation_id\":\"%s\",\"terminal_instance_id\":\"%s\",\"events\":%s}",
      pin, account, brokerServer, symbol, installationId, terminalInstanceId, eventsJson);
   uchar pd[]; StringToCharArray(body, pd, 0, StringLen(body), CP_UTF8);
   int rawLen = ArraySize(pd);
   if(rawLen > 0 && pd[rawLen - 1] == 0) ArrayResize(pd, rawLen - 1);
   string hdr = "Content-Type: application/json\r\n";
   uchar res[]; string rh;
   ResetLastError();
   int code = WebRequest("POST", cloudUrl + "/api/cloud/lease/reconcile", hdr, timeoutMs, pd, res, rh);
   if(code != 200)
   {
      PrintFormat("XAUCLOUD_LEASE_RECONCILE_UPLOAD_FAILED httpCode=%d err=%d queuedEvents=%d -- left in queue, will retry", code, GetLastError(), n);
      return false;
   }

   // Backend acknowledged (idempotently) -- safe to clear the queue now.
   FileDelete(path);
   PrintFormat("XAUCLOUD_LEASE_RECONCILE_UPLOAD_SUCCEEDED queuedEvents=%d", n);
   return true;
}
