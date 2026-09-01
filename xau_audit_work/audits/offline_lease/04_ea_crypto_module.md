# Offline Lease — Phase 7: Pure-MQL5 Signature Verification Module

## Decision: RSA-2048/SHA-256/PKCS#1v1.5, not Ed25519

Confirmed by repo-wide search (dedicated Explore pass, all `.mq5` files at
root + `backend/ea_code*` + `release_staging`, word-boundary-filtered):
**no SHA-256/512, HMAC, RSA, Ed25519/Curve25519, big-integer/modexp, or
signature-verification code exists anywhere in this codebase.** This is a
from-scratch build with nothing to extend.

Ed25519 needs full Edwards-curve point arithmetic (point add/double,
cofactor clearing, compressed-point decode with sign-bit recovery via
modular square root) — a large, easy-to-get-subtly-wrong surface with no
reference implementation in this MQL5 project to model against. RSA
verification needs only modular exponentiation: schoolbook multiply plus a
purely mechanical bit-serial binary reduction (no Knuth-style quotient-digit
estimation). Given the choice explicitly offered by the task ("Ed25519, or
a carefully implemented and restricted JWS profile"), **RSA-2048 with a
single restricted profile, `XAUCLOUD-LEASE-RS256-v1`, was chosen** as the
meaningfully lower-risk path to a correctly-verified implementation within
this session. There is no algorithm negotiation: an incoming lease's
`signature_algorithm` field is compared against exactly this one string;
any other value fails closed before any cryptographic operation is
attempted (no `alg` value from the payload ever selects verification logic).

## A real, empirically-confirmed finding: MQL5's built-in hashing doesn't exist here

The original plan was to hash with MQL5's built-in `CryptEncode(CRYPT_SHA256,
...)` intrinsic and write only the RSA modexp logic by hand. This was
**tested, not assumed**: a probe script declaring `ENUM_CRYPT_METHOD`
variables for `CRYPT_SHA1`/`CRYPT_SHA256`/`CRYPT_MD5` was compiled against
the real MetaEditor64.exe build used throughout this session
(`/Users/libertyelectronics/XauAI-Sniper/tester_sandbox/MT5_Isolated`), and
all three failed with `error 256: undeclared identifier` — only
`CRYPT_BASE64` and `CRYPT_AES256` exist in this build's enum. **This
build's `CryptEncode` does not support hashing at all.** SHA-256 was
therefore written from scratch too (`XauCloudLeaseSha256.mqh`) — a
well-specified, fixed-width 32-bit-word algorithm (FIPS 180-4) with no
big-integer complexity, much lower risk than the RSA piece.

## Validation method: prototype first in Python, then transliterate, then run for real in MQL5

1. **SHA-256**: implemented in Python, checked byte-for-byte against
   `hashlib.sha256` across 4 messages (empty, `"abc"`, a 56-byte NIST
   multi-block vector, 1000 bytes) plus the two official NIST FIPS 180-4
   test vectors, before writing a single line of MQL5.
2. **RSA modexp + PKCS#1v1.5 verify**: implemented in Python
   (schoolbook bignum multiply, then a bit-serial binary shift-subtract
   modular reduction — chosen specifically for auditability over speed).
   **A real bug was caught by this prototype before it ever reached
   MQL5**: the first version of the binary-reduction function sized its
   remainder register at exactly the modulus width (2048 bits) and hit an
   assertion failure, because `remainder*2 + next_bit` can transiently
   need one more bit than the modulus itself has, before the conditional
   subtraction brings it back down. Fixed by giving the remainder register
   one extra limb of headroom. Validated against 4 messages × (1 valid +
   3 negative cases: tampered message, tampered signature, wrong public
   key) — all correct — using **real RSA-2048 key pairs and real
   signatures produced by Python's `cryptography` library** (the actual
   library the backend will use to sign), not synthetic/toy numbers.
3. **MQL5 port**: `backend/ea_code/lease/XauCloudLeaseSha256.mqh` and
   `XauCloudLeaseCrypto.mqh`, a close, function-by-function
   transliteration of the validated Python algorithms.
4. **Compiled clean**: `0 errors, 0 warnings` (MetaEditor64.exe, isolated
   `MT5_Isolated` sandbox) for both the crypto module and a self-test
   harness. Two real compile errors were caught and fixed along the way:
   a name collision with MQL5's own built-in `ShortToString` function
   (renamed my helper), and the `CRYPT_SHA256` finding above.
5. **Actually executed inside the real MetaTrader terminal** — not just
   compiled. The self-test was packaged as a minimal Expert Advisor
   (`XauCloudLeaseCryptoTestEA.mq5`, `OnInit()` runs the checks and
   returns `INIT_FAILED` so it never trades) and run through Strategy
   Tester via `terminal64.exe /config:...` (this repo's established
   pattern for automated MQL5 execution), against real historical
   XAUUSD M10 data. The Tester agent log
   (`Tester/Agent-127.0.0.1-3002/logs/20260725.log`) shows:

   ```
   XAUCLOUD_LEASE_CRYPTO_TEST BEGIN
   XAUCLOUD_LEASE_CRYPTO_TEST PASS | sha256-empty-string | expected=true got=true
   XAUCLOUD_LEASE_CRYPTO_TEST PASS | sha256-abc-nist-vector | expected=true got=true
   XAUCLOUD_LEASE_CRYPTO_TEST PASS | empty-message valid-signature | expected=true got=true
   XAUCLOUD_LEASE_CRYPTO_TEST PASS | empty-message tampered-message-rejected | expected=false got=false
   XAUCLOUD_LEASE_CRYPTO_TEST PASS | empty-message tampered-signature-rejected | expected=false got=false
   XAUCLOUD_LEASE_CRYPTO_TEST PASS | empty-message wrong-key-rejected | expected=false got=false
   XAUCLOUD_LEASE_CRYPTO_TEST PASS | empty-message unknown-algorithm-rejected | expected=false got=false
   ... (same 5 checks × 3 messages: empty, "abc", a realistic lease-shaped payload)
   XAUCLOUD_LEASE_CRYPTO_TEST SUMMARY pass=17 fail=0
   XAUCLOUD_LEASE_CRYPTO_TEST ALL TESTS PASSED
   ```

   **17/17 real, in-terminal MQL5 execution passes.** Every test vector's
   signature was produced by the real `cryptography` library on the
   Python side (see `test_vectors.json` generation script, reproduced in
   this doc's companion test file), so this proves actual cross-language
   interoperability between the backend signer and the EA verifier — not
   just that the MQL5 arithmetic is internally self-consistent.

## What's proven vs. what still needs independent review

**Proven**: the exact algorithm (SHA-256 + RSA-2048 modexp + PKCS#1v1.5
padding check) is implemented correctly in real, compiled, executing MQL5,
cross-checked against a real independent implementation (Python
`cryptography`), across valid signatures and 4 classes of negative case
(tampered message, tampered signature, wrong public key, unrecognized
algorithm id) for 3 different message shapes including one shaped like a
real lease payload.

**Not yet done, carried into Phase 19's full test matrix**: expired/
not-yet-valid lease field checks (those are lease-schema-level checks in
`XAU_LeaseVerifySignature`'s caller, not the crypto module itself), a
malformed-encoding/truncated-payload fuzz pass, and an independent review
by a second pass (the task's own explicit Phase 7 step 12) — planned as
part of the final report's review section rather than repeated here.

## Files

- `backend/ea_code/lease/XauCloudLeaseSha256.mqh` — from-scratch SHA-256.
- `backend/ea_code/lease/XauCloudLeaseCrypto.mqh` — bignum core (mul/mod/
  modexp), hex/byte conversions, and `XAU_LeaseVerifySignature()`, the one
  public entry point callers use.
- `backend/ea_code/lease/XauCloudLeaseCryptoTest.mq5` — Script-form
  self-test (for manual chart-attach testing).
- `backend/ea_code/lease/XauCloudLeaseCryptoTestEA.mq5` — EA-form
  self-test (for automated Strategy Tester execution, as run above).
