"""Outbound-only VPS worker for the XauCloud customer local-AI relay."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import os
import socket
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid
from typing import Any

from cryptography.hazmat.primitives import serialization


LOG = logging.getLogger("xaucloud.local_ai.remote_worker")


class RelayClient:
    def __init__(self, public_url: str, gateway_url: str, token: str, worker_id: str,
                 private_key_path: str = "",
                 request_timeout: float = 10.0, inference_timeout: float = 30.0) -> None:
        self.public_url = public_url.rstrip("/")
        self.gateway_url = gateway_url.rstrip("/")
        self.token = token
        self.worker_id = worker_id
        self.private_key = None
        if not token and private_key_path:
            with open(private_key_path, "rb") as handle:
                self.private_key = serialization.load_pem_private_key(handle.read(), password=None)
        self.request_timeout = request_timeout
        self.inference_timeout = inference_timeout

    def _request(self, url: str, method: str = "GET", body: dict[str, Any] | None = None,
                 headers: dict[str, str] | None = None, timeout: float = 10.0) -> tuple[dict[str, Any], int]:
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        request_headers = {"Accept": "application/json", **(headers or {})}
        if data is not None:
            request_headers["Content-Type"] = "application/json"
        if "/api/local-ai/worker/" in url:
            if self.token:
                request_headers["X-Xau-Worker-Token"] = self.token
            elif self.private_key is not None:
                timestamp = str(int(time.time()))
                nonce = uuid.uuid4().hex
                path = urllib.parse.urlparse(url).path
                body_hash = hashlib.sha256(data or b"").hexdigest()
                canonical = f"{method}\n{path}\n{timestamp}\n{nonce}\n{body_hash}".encode("utf-8")
                signature = self.private_key.sign(canonical)
                request_headers.update({
                    "X-Xau-Worker-Timestamp": timestamp,
                    "X-Xau-Worker-Nonce": nonce,
                    "X-Xau-Worker-Signature": base64.b64encode(signature).decode("ascii"),
                })
        request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8")), response.status
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = {"detail": f"HTTP {exc.code}"}
            return payload, exc.code

    def claim(self) -> dict[str, Any]:
        payload, code = self._request(
            f"{self.public_url}/api/local-ai/worker/claim", "POST",
            {"worker_id": self.worker_id}, timeout=self.request_timeout,
        )
        if code != 200:
            raise RuntimeError(f"relay claim failed with HTTP {code}")
        return payload

    def gateway_decision(self, snapshot: dict[str, Any], signature: str) -> dict[str, Any]:
        result, code = self._request(
            f"{self.gateway_url}/api/local-ai/submit", "POST", snapshot,
            timeout=min(5.0, self.request_timeout),
        )
        if code not in {200, 202}:
            return {"status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
                    "reason": f"GATEWAY_SUBMIT_HTTP_{code}", "signature": signature}
        if result.get("status") != "LOCAL_AI_PENDING":
            return result

        deadline = time.monotonic() + self.inference_timeout
        while time.monotonic() < deadline:
            time.sleep(0.35)
            result, code = self._request(
                f"{self.gateway_url}/api/local-ai/result?signature={signature}",
                timeout=min(3.0, self.request_timeout),
            )
            if code == 200 and result.get("status") != "LOCAL_AI_PENDING":
                return result
            if code not in {200, 202, 404}:
                break
        return {"status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
                "reason": "LOCAL_AI_TIMEOUT", "signature": signature}

    def complete(self, job: dict[str, Any], result: dict[str, Any]) -> None:
        _, code = self._request(
            f"{self.public_url}/api/local-ai/worker/complete", "POST",
            {
                "worker_id": self.worker_id,
                "job_id": job["job_id"],
                "lease_token": job["lease_token"],
                "result": result,
            },
            timeout=self.request_timeout,
        )
        if code != 200:
            raise RuntimeError(f"relay completion failed with HTTP {code}")

    def run_forever(self, idle_seconds: float = 1.0) -> None:
        failures = 0
        while True:
            try:
                job = self.claim()
                if job.get("status") == "IDLE":
                    failures = 0
                    time.sleep(idle_seconds)
                    continue
                if job.get("status") != "CLAIMED":
                    raise RuntimeError("relay returned an invalid claim envelope")
                signature = str(job.get("signature", ""))
                LOG.info("claimed job=%s signature=%s attempt=%s", job.get("job_id"), signature[:12], job.get("attempts"))
                try:
                    result = self.gateway_decision(job["snapshot"], signature)
                except (OSError, TimeoutError, ValueError, KeyError, urllib.error.URLError) as exc:
                    LOG.warning("local gateway failed for signature=%s: %s", signature[:12], type(exc).__name__)
                    result = {"status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
                              "reason": f"GATEWAY_UNAVAILABLE_{type(exc).__name__.upper()}",
                              "signature": signature}
                self.complete(job, result)
                LOG.info("completed job=%s status=%s", job.get("job_id"), result.get("status"))
                failures = 0
            except (OSError, TimeoutError, RuntimeError, ValueError, KeyError, urllib.error.URLError) as exc:
                failures += 1
                delay = min(30.0, max(idle_seconds, 2 ** min(failures, 5)))
                LOG.warning("worker cycle failed (%s); retrying in %.1fs", type(exc).__name__, delay)
                time.sleep(delay)


def main() -> None:
    parser = argparse.ArgumentParser(description="Outbound-only XauCloud VPS local-AI relay worker")
    parser.add_argument("--public-url", default=os.environ.get("XAU_PUBLIC_BACKEND_URL", "https://xauaisniper.com"))
    parser.add_argument("--gateway-url", default="http://127.0.0.1:8765")
    parser.add_argument("--worker-id", default=f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}")
    parser.add_argument("--token", default=os.environ.get("XAU_LOCAL_AI_WORKER_SECRET", ""))
    parser.add_argument("--private-key", default=r"C:\XauCloudLocalAI\secrets\worker_private_key.pem")
    parser.add_argument("--idle-seconds", type=float, default=1.0)
    parser.add_argument("--inference-timeout", type=float, default=30.0)
    parser.add_argument("--log")
    args = parser.parse_args()
    if args.token and len(args.token) < 32:
        raise SystemExit("XAU_LOCAL_AI_WORKER_SECRET must be at least 32 characters")
    if not args.token and not os.path.isfile(args.private_key):
        raise SystemExit("worker private key is required when no token is configured")
    if not args.public_url.lower().startswith("https://"):
        raise SystemExit("public relay URL must use HTTPS")
    if not args.gateway_url.startswith(("http://127.0.0.1", "http://localhost")):
        raise SystemExit("local gateway must remain loopback-only")

    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if args.log:
        handlers.append(logging.FileHandler(args.log, encoding="utf-8"))
    logging.basicConfig(level=logging.INFO, handlers=handlers, format="%(asctime)s %(levelname)s %(message)s")
    RelayClient(args.public_url, args.gateway_url, args.token, args.worker_id, args.private_key,
                inference_timeout=args.inference_timeout).run_forever(max(0.25, args.idle_seconds))


if __name__ == "__main__":
    main()
