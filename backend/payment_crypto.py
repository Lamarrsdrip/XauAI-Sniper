"""AES-256-GCM encryption for payment provider configuration secrets.

Purpose-built for the Nomba (and any future payment provider) admin
config, kept separate from the existing MFA Fernet system
(backend/server.py's _cloud_encrypt/_cloud_decrypt) deliberately:

  - That system derives its key from JWT_SECRET (a shared secret used
    for session tokens too) with no key-versioning. Payment provider
    credentials are a higher-stakes secret category and deserve their
    own dedicated master key, so rotating JWT_SECRET never silently
    breaks (or is coupled to) decrypting stored payment credentials,
    and vice versa.
  - AES-256-GCM specifically (not AES-128-CBC+HMAC, which is what
    Fernet uses) per the explicit spec for this migration.
  - Key-version support, so the master key can be rotated later without
    a flag day that breaks every previously-encrypted row.

Uses `cryptography` (already a project dependency, cryptography==46.0.7
per backend/requirements.txt) — a proven library, not hand-rolled crypto.

Master key source: PAYMENT_CONFIG_ENCRYPTION_KEY environment variable
only. Never stored in the database, never editable from the admin
dashboard, never logged. Must decode (after base64) to exactly 32 bytes
(AES-256). Generate one with:
    python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
"""
from __future__ import annotations

import base64
import os
import secrets as _secrets
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# v-prefixed key version, so a future re-key can add "v2": "<base64 key>"
# alongside this one and decrypt() can dispatch on the stored version tag
# without invalidating existing rows.
_CURRENT_KEY_VERSION = "v1"


class PaymentCryptoNotConfigured(RuntimeError):
    """Raised when PAYMENT_CONFIG_ENCRYPTION_KEY is missing or malformed.
    Callers must fail closed (refuse to save/read payment credentials),
    never silently fall back to plaintext."""


def _load_master_key() -> bytes:
    raw = os.environ.get("PAYMENT_CONFIG_ENCRYPTION_KEY", "").strip()
    if not raw:
        raise PaymentCryptoNotConfigured(
            "PAYMENT_CONFIG_ENCRYPTION_KEY is not set. Payment provider "
            "credentials cannot be encrypted or decrypted without it. Generate "
            "one with: python3 -c \"import secrets,base64; "
            "print(base64.b64encode(secrets.token_bytes(32)).decode())\" "
            "and set it in the server environment (never in the database, "
            "never in the admin dashboard)."
        )
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise PaymentCryptoNotConfigured(
            f"PAYMENT_CONFIG_ENCRYPTION_KEY is not valid base64: {exc}"
        ) from exc
    if len(key) != 32:
        raise PaymentCryptoNotConfigured(
            f"PAYMENT_CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes "
            f"(AES-256), got {len(key)} bytes."
        )
    return key


def encrypt_secret(plaintext: str) -> dict:
    """Encrypts a single secret value. Returns a dict safe to store as a
    MongoDB subdocument: {"v": key_version, "n": base64 nonce, "ct": base64
    ciphertext+tag}. AESGCM's ciphertext output already includes the auth
    tag appended -- no separate tag field needed."""
    if plaintext is None:
        plaintext = ""
    key = _load_master_key()
    aesgcm = AESGCM(key)
    nonce = _secrets.token_bytes(12)  # 96-bit nonce, random per encryption
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return {
        "v": _CURRENT_KEY_VERSION,
        "n": base64.b64encode(nonce).decode("ascii"),
        "ct": base64.b64encode(ct).decode("ascii"),
    }


def decrypt_secret(enc: Optional[dict]) -> str:
    """Decrypts a dict produced by encrypt_secret(). Returns "" for
    None/empty input (never-configured case) rather than raising, so
    callers can treat "not configured" and "decrypt failed" distinctly:
    this returns "" for the former, raises for the latter (tampered/
    wrong-key ciphertext) rather than silently returning "" for both --
    a payment integration must never treat "credentials corrupted"
    the same as "credentials not set"."""
    if not enc:
        return ""
    key = _load_master_key()
    version = enc.get("v")
    if version != _CURRENT_KEY_VERSION:
        raise PaymentCryptoNotConfigured(
            f"Encrypted payment secret has unknown key version {version!r} "
            f"(expected {_CURRENT_KEY_VERSION!r}). A key-rotation migration "
            "is needed before this value can be decrypted."
        )
    try:
        nonce = base64.b64decode(enc["n"])
        ct = base64.b64decode(enc["ct"])
        aesgcm = AESGCM(key)
        pt = aesgcm.decrypt(nonce, ct, None)
        return pt.decode("utf-8")
    except Exception as exc:
        raise RuntimeError(
            "Failed to decrypt a stored payment secret -- either "
            "PAYMENT_CONFIG_ENCRYPTION_KEY has changed since it was "
            "encrypted, or the stored value is corrupted/tampered. Refusing "
            "to silently treat this as 'not configured'."
        ) from exc


def mask_preview(plaintext: str) -> str:
    """Same preview convention already used for paystack_key_preview /
    onesignal_api_key_preview in the existing admin settings response --
    never return the real secret to the browser."""
    if not plaintext:
        return ""
    if len(plaintext) <= 12:
        return "set"
    return f"{plaintext[:6]}...{plaintext[-4:]}"


def is_configured() -> bool:
    """Cheap check for whether PAYMENT_CONFIG_ENCRYPTION_KEY is present
    and well-formed, without needing an actual secret to decrypt --
    used by /admin routes and startup checks to report a clear
    remediation message instead of an opaque failure."""
    try:
        _load_master_key()
        return True
    except PaymentCryptoNotConfigured:
        return False
