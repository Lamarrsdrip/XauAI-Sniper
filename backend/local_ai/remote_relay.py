"""Authenticated public relay for the private XauCloud VPS local-AI worker.

Customer EAs talk only to the normal HTTPS backend.  The owner VPS makes
outbound HTTPS claims, calls the loopback-only local gateway, and completes
the jobs.  No model/runtime port is exposed to the Internet.
"""
from __future__ import annotations

import hashlib
import hmac
import base64
import os
import re
import secrets
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization

from .schema import Decision, SchemaError, Snapshot, snapshot_signature


COLLECTION_NAME = "local_ai_remote_jobs"
SIGNATURE_RE = re.compile(r"^[0-9a-f]{64}$")
TERMINAL_STATUSES = {"LOCAL_AI_TRUSTED", "LOCAL_AI_LOW_CONFIDENCE", "LOCAL_AI_FALLBACK", "LOCAL_AI_PARSE_FAILED"}


class RemoteSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str = Field(min_length=8, max_length=64)
    account: str = Field(min_length=1, max_length=32)
    broker_server: str = Field(default="", max_length=96)
    terminal_instance_id: str = Field(default="", max_length=128)
    snapshot: dict[str, Any]


class RemoteResultRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str = Field(min_length=8, max_length=64)
    account: str = Field(min_length=1, max_length=32)
    signature: str = Field(min_length=64, max_length=64)


class WorkerClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=1, max_length=96)


class WorkerCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=1, max_length=96)
    job_id: str = Field(min_length=1, max_length=96)
    lease_token: str = Field(min_length=32, max_length=128)
    result: dict[str, Any]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(value: Any, now: datetime) -> bool:
    if not isinstance(value, datetime):
        return False
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value <= now


def _tenant_key(license_id: str, account: str, signature: str) -> str:
    return hashlib.sha256(f"{license_id}\0{account}\0{signature}".encode("utf-8")).hexdigest()


def _safe_short_text(value: Any, name: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    value = value.strip()
    if not value or len(value) > limit or any(ord(char) < 32 for char in value):
        raise ValueError(f"{name} must contain 1..{limit} printable characters")
    return value


def sanitize_worker_result(raw: dict[str, Any], expected_signature: str, snapshot: Snapshot,
                           confidence_threshold: int = 70) -> dict[str, Any]:
    """Validate and minimize an untrusted worker result before persistence."""
    if not isinstance(raw, dict):
        raise ValueError("worker result must be an object")
    status = raw.get("status")
    if status not in TERMINAL_STATUSES:
        raise ValueError("worker result is not terminal")
    if raw.get("signature") != expected_signature:
        raise ValueError("worker result signature mismatch")

    if status in {"LOCAL_AI_TRUSTED", "LOCAL_AI_LOW_CONFIDENCE"}:
        try:
            decision = Decision.parse(raw.get("decision"))
        except SchemaError as exc:
            raise ValueError(str(exc)) from exc
        if decision.candidate_allowed and (
            decision.preferred_direction == "NONE"
            or decision.candidate_setup == "NONE"
            or decision.candidate_setup not in snapshot.allowed_candidate_setups
        ):
            raise ValueError("worker decision violates the allowed setup relationship")
        trusted = decision.confidence >= confidence_threshold
        normalized_status = "LOCAL_AI_TRUSTED" if trusted else "LOCAL_AI_LOW_CONFIDENCE"
        latency = raw.get("latency_ms", 0.0)
        if isinstance(latency, bool) or not isinstance(latency, (int, float)) or latency < 0 or latency > 120_000:
            latency = 0.0
        return {
            "status": normalized_status,
            "fallback": None if trusted else "DETERMINISTIC",
            "signature": expected_signature,
            "cache_hit": bool(raw.get("cache_hit", False)),
            "latency_ms": round(float(latency), 2),
            "confidence_threshold": confidence_threshold,
            "decision": decision.as_dict(),
        }

    reason = _safe_short_text(raw.get("reason", status), "reason", 240)
    return {
        "status": status,
        "fallback": "DETERMINISTIC",
        "reason": reason,
        "signature": expected_signature,
    }


def build_router(
    *,
    db: Any,
    resolve_license: Callable[..., Awaitable[dict]],
    rate_limit: Callable[[str, int, int], None],
    client_ip: Callable[[Request], str],
) -> APIRouter:
    router = APIRouter(prefix="/local-ai")
    jobs = getattr(db, COLLECTION_NAME)
    nonces = db.local_ai_worker_nonces
    worker_secret = os.environ.get("XAU_LOCAL_AI_WORKER_SECRET", "").strip()
    public_key_path = os.path.join(os.path.dirname(__file__), "worker_public_key.pem")
    worker_public_key = None
    try:
        with open(public_key_path, "rb") as handle:
            worker_public_key = serialization.load_pem_public_key(handle.read())
    except (OSError, ValueError):
        worker_public_key = None
    lease_seconds = max(20, min(180, int(os.environ.get("XAU_LOCAL_AI_WORKER_LEASE_SECONDS", "60"))))
    job_deadline_seconds = max(60, min(1800, int(os.environ.get("XAU_LOCAL_AI_JOB_DEADLINE_SECONDS", "300"))))
    retention_seconds = max(3600, min(604800, int(os.environ.get("XAU_LOCAL_AI_RESULT_RETENTION_SECONDS", "86400"))))
    max_attempts = max(1, min(10, int(os.environ.get("XAU_LOCAL_AI_MAX_ATTEMPTS", "3"))))
    global_queue_limit = max(10, min(10_000, int(os.environ.get("XAU_LOCAL_AI_GLOBAL_QUEUE_LIMIT", "100"))))
    confidence_threshold = max(70, min(100, int(os.environ.get("XAU_LOCAL_AI_CONFIDENCE_THRESHOLD", "70"))))

    async def require_worker(request: Request, token: Optional[str]) -> None:
        if not worker_secret and worker_public_key is None:
            raise HTTPException(status_code=503, detail="Private local-AI worker is not configured.")
        if worker_secret and token and hmac.compare_digest(token, worker_secret):
            return

        timestamp = request.headers.get("X-Xau-Worker-Timestamp", "")
        nonce = request.headers.get("X-Xau-Worker-Nonce", "")
        signature_b64 = request.headers.get("X-Xau-Worker-Signature", "")
        try:
            timestamp_int = int(timestamp)
            if abs(int(_utcnow().timestamp()) - timestamp_int) > 90:
                raise ValueError("stale timestamp")
            if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", nonce):
                raise ValueError("invalid nonce")
            signature = base64.b64decode(signature_b64, validate=True)
            body_hash = hashlib.sha256(await request.body()).hexdigest()
            canonical = f"{request.method}\n{request.url.path}\n{timestamp}\n{nonce}\n{body_hash}".encode("utf-8")
            if worker_public_key is None:
                raise ValueError("public key unavailable")
            worker_public_key.verify(signature, canonical)
            await nonces.insert_one({
                "nonce": nonce, "used_at": _utcnow(), "expires_at": _utcnow() + timedelta(minutes=5),
            })
        except DuplicateKeyError as exc:
            raise HTTPException(status_code=401, detail="Replayed worker request.") from exc
        except (ValueError, TypeError, InvalidSignature) as exc:
            raise HTTPException(status_code=401, detail="Invalid worker credential.") from exc

    async def tenant(req: RemoteSubmitRequest | RemoteResultRequest, request: Request) -> tuple[dict, str]:
        lic = await resolve_license(req.pin, req.account, request)
        license_id = str(lic.get("id") or "").strip()
        if not license_id:
            raise HTTPException(status_code=403, detail="License identity is unavailable.")
        opaque = hashlib.sha256(f"{license_id}:{req.account}".encode()).hexdigest()[:24]
        rate_limit(f"local_ai_tenant:{opaque}", 12, 3600)
        rate_limit(f"local_ai_ip:{client_ip(request)}", 60, 3600)
        return lic, license_id

    @router.post("/remote/submit")
    async def remote_submit(req: RemoteSubmitRequest, request: Request):
        if not worker_secret and worker_public_key is None:
            raise HTTPException(status_code=503, detail="Private local-AI worker is not configured.")
        _, license_id = await tenant(req, request)
        try:
            snapshot = Snapshot.parse(req.snapshot)
        except SchemaError as exc:
            raise HTTPException(status_code=400, detail=f"INVALID_SNAPSHOT: {exc}") from exc
        symbol = snapshot.symbol.upper()
        if "XAU" not in symbol and "GOLD" not in symbol:
            raise HTTPException(status_code=400, detail="Pure-M10 local AI accepts gold symbols only.")

        signature = snapshot_signature(snapshot)
        now = _utcnow()
        tenant_key = _tenant_key(license_id, req.account, signature)
        existing = await jobs.find_one({"tenant_key": tenant_key}, {"_id": 0})
        if existing:
            if existing.get("status") == "COMPLETE" and isinstance(existing.get("result"), dict):
                result = dict(existing["result"])
                result["cache_hit"] = True
                return result
            return {"status": "LOCAL_AI_PENDING", "fallback": "DETERMINISTIC", "signature": signature}

        active = await jobs.count_documents({
            "license_id": license_id, "account": req.account,
            "status": {"$in": ["QUEUED", "LEASED"]}, "job_deadline_at": {"$gt": now},
        })
        if active >= 2:
            return {"status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
                    "reason": "TENANT_QUEUE_FULL", "signature": signature}
        global_active = await jobs.count_documents({
            "status": {"$in": ["QUEUED", "LEASED"]}, "job_deadline_at": {"$gt": now},
        })
        if global_active >= global_queue_limit:
            return {"status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
                    "reason": "REMOTE_AI_CAPACITY_GUARD", "signature": signature}

        doc = {
            "job_id": str(uuid.uuid4()),
            "tenant_key": tenant_key,
            "license_id": license_id,
            "account": req.account,
            "broker_server": req.broker_server,
            "terminal_instance_id": req.terminal_instance_id,
            "signature": signature,
            "snapshot": asdict(snapshot),
            "status": "QUEUED",
            "attempts": 0,
            "created_at": now,
            "updated_at": now,
            "job_deadline_at": now + timedelta(seconds=job_deadline_seconds),
            "expires_at": now + timedelta(seconds=retention_seconds),
        }
        try:
            await jobs.insert_one(doc)
        except DuplicateKeyError:
            pass
        return {"status": "LOCAL_AI_PENDING", "fallback": "DETERMINISTIC", "signature": signature}

    @router.post("/remote/result")
    async def remote_result(req: RemoteResultRequest, request: Request):
        if not SIGNATURE_RE.fullmatch(req.signature):
            raise HTTPException(status_code=400, detail="Invalid local-AI signature.")
        _, license_id = await tenant(req, request)
        job = await jobs.find_one({
            "tenant_key": _tenant_key(license_id, req.account, req.signature),
        }, {"_id": 0})
        if not job:
            return {"status": "LOCAL_AI_NOT_FOUND", "fallback": "DETERMINISTIC", "signature": req.signature}
        if job.get("status") == "COMPLETE" and isinstance(job.get("result"), dict):
            result = dict(job["result"])
            result["cache_hit"] = True
            return result
        if _is_expired(job.get("job_deadline_at"), _utcnow()):
            return {"status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
                    "reason": "REMOTE_AI_DEADLINE_EXPIRED", "signature": req.signature}
        return {"status": "LOCAL_AI_PENDING", "fallback": "DETERMINISTIC", "signature": req.signature}

    @router.post("/worker/claim")
    async def worker_claim(req: WorkerClaimRequest, request: Request,
                           x_xau_worker_token: Optional[str] = Header(default=None)):
        await require_worker(request, x_xau_worker_token)
        now = _utcnow()
        lease_token = secrets.token_urlsafe(32)
        job = await jobs.find_one_and_update(
            {
                "job_deadline_at": {"$gt": now},
                "attempts": {"$lt": max_attempts},
                "$or": [
                    {"status": "QUEUED"},
                    {"status": "LEASED", "lease_until": {"$lte": now}},
                ],
            },
            {"$set": {
                "status": "LEASED", "worker_id": req.worker_id,
                "lease_token": lease_token, "lease_until": now + timedelta(seconds=lease_seconds),
                "updated_at": now,
            }, "$inc": {"attempts": 1}},
            sort=[("created_at", 1)],
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0, "job_id": 1, "signature": 1, "snapshot": 1,
                        "lease_token": 1, "lease_until": 1, "attempts": 1},
        )
        if not job:
            return {"status": "IDLE"}
        return {"status": "CLAIMED", **job}

    @router.post("/worker/complete")
    async def worker_complete(req: WorkerCompleteRequest, request: Request,
                              x_xau_worker_token: Optional[str] = Header(default=None)):
        await require_worker(request, x_xau_worker_token)
        job = await jobs.find_one({
            "job_id": req.job_id, "status": "LEASED", "worker_id": req.worker_id,
            "lease_token": req.lease_token,
        })
        if not job:
            raise HTTPException(status_code=409, detail="Job lease is missing, expired, or owned by another worker.")
        try:
            snapshot = Snapshot.parse(job["snapshot"])
            result = sanitize_worker_result(req.result, job["signature"], snapshot, confidence_threshold)
        except (SchemaError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"INVALID_WORKER_RESULT: {exc}") from exc
        now = _utcnow()
        completed = await jobs.find_one_and_update(
            {"job_id": req.job_id, "status": "LEASED", "worker_id": req.worker_id,
             "lease_token": req.lease_token},
            {"$set": {"status": "COMPLETE", "result": result, "completed_at": now, "updated_at": now},
             "$unset": {"lease_token": "", "lease_until": ""}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0, "job_id": 1},
        )
        if not completed:
            raise HTTPException(status_code=409, detail="Job lease changed before completion.")
        return {"status": "ACCEPTED", "job_id": req.job_id}

    return router


async def ensure_indexes(db: Any) -> None:
    jobs = getattr(db, COLLECTION_NAME)
    await jobs.create_index("tenant_key", unique=True)
    await jobs.create_index([("status", 1), ("job_deadline_at", 1), ("created_at", 1)])
    await jobs.create_index("expires_at", expireAfterSeconds=0)
    await db.local_ai_worker_nonces.create_index("nonce", unique=True)
    await db.local_ai_worker_nonces.create_index("expires_at", expireAfterSeconds=0)
