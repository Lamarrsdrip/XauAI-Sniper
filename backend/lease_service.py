"""
XauCloud bounded offline trading lease -- signing service.

Pure functions only (no DB access -- that lives in server.py, same
separation already used for nomba_service.py vs. its DB-touching
callers in server.py). This module owns exactly one responsibility:
build the canonical lease payload and produce a detached RSA-2048/
SHA-256/PKCS#1v1.5 signature over it ("XAUCLOUD-LEASE-RS256-v1" --
see audits/offline_lease/03_lease_architecture.md for the full design
and audits/offline_lease/04_ea_crypto_module.md for the matching
pure-MQL5 verifier this signs for).

The private key never leaves this process's memory space beyond what
`cryptography` itself holds -- it is loaded once from an environment
variable (or an approved secret-management service), never logged,
never returned by any API response, and never written to the database.
"""
from __future__ import annotations

import os
import base64
import secrets
from dataclasses import dataclass, field
from typing import Optional, List

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

LEASE_ALGORITHM_ID = "XAUCLOUD-LEASE-RS256-v1"
LEASE_SCHEMA_VERSION = 1
RSA_KEY_BITS = 2048
RSA_PUBLIC_EXPONENT = 65537

# Fixed field order -- MUST exactly match XAU_LeaseVerifySignature's caller
# construction in the EA. MQL5 has no canonical-JSON serializer, so a fixed
# field list (not dict/alphabetical order) is the canonicalization rule.
#
# Timestamps are plain Unix integer seconds, NOT ISO8601 strings. MQL5 has
# no safe ISO8601 parser, and Python's datetime.isoformat() emits a
# variable-length microseconds component -- both are unnecessary parsing
# risk for a security-critical field the EA's clock-integrity logic
# depends on. An integer is unambiguous and trivial to parse on both
# sides, and is still fully covered by the signature like every other
# field here.
_CANONICAL_FIELD_ORDER = [
    "schema_version", "lease_id", "key_id", "tenant_id", "license_id",
    "account_login", "account_server", "installation_id", "terminal_instance_id",
    "normalized_symbol", "allowed_directions", "allowed_entry_families",
    "issued_at_unix", "not_before_unix", "expires_at_unix", "renewal_after_unix",
    "maximum_offline_new_campaigns", "remaining_offline_new_campaigns",
    "lease_sequence", "revocation_epoch", "nonce",
]


class LeaseCryptoNotConfigured(RuntimeError):
    """Raised when no signing key is configured. Callers must fail closed
    (503) rather than silently skip signing or sign with a fallback key."""


@dataclass
class LeaseSigningKey:
    key_id: str
    private_key: rsa.RSAPrivateKey

    @property
    def modulus_hex(self) -> str:
        n = self.private_key.public_key().public_numbers().n
        return format(n, "0512x")  # 2048 bits = 512 hex chars, zero-padded

    @property
    def exponent(self) -> int:
        return self.private_key.public_key().public_numbers().e


def _b64_or_raw_pem(value: str) -> bytes:
    value = value.strip()
    if value.startswith("-----BEGIN"):
        return value.encode("utf-8")
    return base64.b64decode(value)


def load_signing_key() -> LeaseSigningKey:
    """Reads XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY (PEM, or base64-encoded PEM,
    to survive .env files that can't hold literal newlines) and
    XAUCLOUD_LEASE_SIGNING_KEY_ID. Raises LeaseCryptoNotConfigured if either
    is missing -- callers must return 503, never a fallback/dev key."""
    pem_env = os.environ.get("XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY")
    key_id = os.environ.get("XAUCLOUD_LEASE_SIGNING_KEY_ID")
    if not pem_env or not key_id:
        raise LeaseCryptoNotConfigured("XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY / XAUCLOUD_LEASE_SIGNING_KEY_ID not set")
    pem_bytes = _b64_or_raw_pem(pem_env)
    private_key = serialization.load_pem_private_key(pem_bytes, password=None)
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise LeaseCryptoNotConfigured("configured lease signing key is not an RSA private key")
    if private_key.key_size != RSA_KEY_BITS:
        raise LeaseCryptoNotConfigured(f"configured lease signing key is {private_key.key_size} bits, expected {RSA_KEY_BITS}")
    if private_key.public_key().public_numbers().e != RSA_PUBLIC_EXPONENT:
        raise LeaseCryptoNotConfigured("configured lease signing key does not use the fixed public exponent 65537")
    return LeaseSigningKey(key_id=key_id, private_key=private_key)


def generate_dev_signing_key(key_id: str = "dev-local") -> LeaseSigningKey:
    """For local/test use only -- generates a throwaway key in-process.
    Never used by any production code path (production always goes
    through load_signing_key() and a real configured env var)."""
    pk = rsa.generate_private_key(public_exponent=RSA_PUBLIC_EXPONENT, key_size=RSA_KEY_BITS)
    return LeaseSigningKey(key_id=key_id, private_key=pk)


def _fmt_field(value) -> str:
    if isinstance(value, (list, tuple)):
        return ",".join(str(v) for v in value)
    if value is None:
        return ""
    return str(value)


def canonical_payload(lease_fields: dict) -> bytes:
    """Builds the exact byte sequence that gets signed/verified. Every
    field in _CANONICAL_FIELD_ORDER must be present in lease_fields (a
    missing field is a caller bug, not something to silently default)."""
    missing = [f for f in _CANONICAL_FIELD_ORDER if f not in lease_fields]
    if missing:
        raise ValueError(f"canonical_payload missing required fields: {missing}")
    parts = [f"{name}={_fmt_field(lease_fields[name])}" for name in _CANONICAL_FIELD_ORDER]
    return "|".join(parts).encode("utf-8")


def sign_lease(signing_key: LeaseSigningKey, lease_fields: dict) -> str:
    """Returns the detached signature as a 512-char hex string (256 bytes,
    matching RSA-2048's modulus width -- exactly what
    XAU_LeaseVerifySignature expects for `signatureHex`)."""
    payload = canonical_payload(lease_fields)
    signature = signing_key.private_key.sign(payload, padding.PKCS1v15(), hashes.SHA256())
    assert len(signature) == RSA_KEY_BITS // 8
    return signature.hex()


def verify_lease_signature_backend_side(modulus_hex: str, exponent: int, lease_fields: dict, signature_hex: str) -> bool:
    """Backend-side re-verification (used by tests and by admin-facing
    lease-history display integrity checks) -- constructs a public key from
    the given modulus/exponent and verifies via `cryptography`, completely
    independently of the MQL5 implementation. This is NOT what the EA uses
    (the EA has its own from-scratch verifier, see
    backend/ea_code/lease/XauCloudLeaseCrypto.mqh) -- this exists so the
    backend can also confirm a lease it's about to hand out (or one an EA
    reports back during reconciliation) is well-formed."""
    n = int(modulus_hex, 16)
    public_numbers = rsa.RSAPublicNumbers(e=exponent, n=n)
    public_key = public_numbers.public_key()
    payload = canonical_payload(lease_fields)
    try:
        public_key.verify(bytes.fromhex(signature_hex), payload, padding.PKCS1v15(), hashes.SHA256())
        return True
    except Exception:
        return False


def new_nonce() -> str:
    return secrets.token_hex(16)
