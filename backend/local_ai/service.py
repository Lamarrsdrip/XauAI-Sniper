from __future__ import annotations

import argparse
import ctypes
import json
import logging
import os
import sqlite3
import statistics
import threading
import time
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import asdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .schema import DECISION_JSON_SCHEMA, Decision, SCHEMA_VERSION, SchemaError, Snapshot, snapshot_signature

LOG = logging.getLogger("xaucloud.local_ai")
SYSTEM_PROMPT = (
    "You are the bounded pure-M10 XauCloud market classifier. Use only the supplied deterministic "
    "evidence. Do not invent strategies, risk, size, stops, exits, or lower-timeframe scans. Select "
    "BUY, SELL, or NONE and use only a candidate setup from allowed_candidate_setups (or NONE). Output the exact "
    "JSON schema. Confidence means confidence in this classification, not trade certainty."
)


def _set_below_normal_priority() -> bool:
    if os.name != "nt":
        return True
    below_normal_priority_class = 0x00004000
    return bool(
        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), below_normal_priority_class
        )
    )


class ResourceProbe:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_cpu = self._cpu_times()
        self._last_sample = time.monotonic()
        self._cpu_percent = 0.0

    def sample(self) -> dict[str, float]:
        with self._lock:
            now = time.monotonic()
            current = self._cpu_times()
            if current and self._last_cpu and now > self._last_sample:
                idle_delta = current[0] - self._last_cpu[0]
                total_delta = current[1] - self._last_cpu[1]
                if total_delta > 0:
                    self._cpu_percent = max(0.0, min(100.0, 100.0 * (1.0 - idle_delta / total_delta)))
            self._last_cpu = current
            self._last_sample = now
            total, available = self._memory()
            return {
                "cpu_percent": round(self._cpu_percent, 2),
                "total_ram_gb": round(total / (1024 ** 3), 3),
                "free_ram_gb": round(available / (1024 ** 3), 3),
            }

    @staticmethod
    def _memory() -> tuple[int, int]:
        if os.name == "nt":
            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
            return status.ullTotalPhys, status.ullAvailPhys
        pages = os.sysconf("SC_PHYS_PAGES")
        available = os.sysconf("SC_AVPHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        return pages * page_size, available * page_size

    @staticmethod
    def _cpu_times() -> tuple[int, int] | None:
        if os.name == "nt":
            idle = ctypes.c_ulonglong()
            kernel = ctypes.c_ulonglong()
            user = ctypes.c_ulonglong()
            if ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                return idle.value, kernel.value + user.value
            return None
        try:
            values = [float(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
            idle = values[3] + (values[4] if len(values) > 4 else 0)
            return int(idle * 100), int(sum(values) * 100)
        except (OSError, ValueError, IndexError):
            return None


class DecisionCache:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                """CREATE TABLE IF NOT EXISTS decisions (
                    signature TEXT PRIMARY KEY,
                    closed_m10_timestamp INTEGER NOT NULL,
                    model_name TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    decision_json TEXT NOT NULL,
                    latency_ms REAL NOT NULL,
                    created_at INTEGER NOT NULL
                )"""
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=5)

    def get(self, signature: str) -> tuple[Decision, float] | None:
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT decision_json, latency_ms FROM decisions WHERE signature=?", (signature,)
            ).fetchone()
        if not row:
            return None
        return Decision.parse(json.loads(row[0])), float(row[1])

    def put(self, signature: str, snapshot: Snapshot, decision: Decision, latency_ms: float) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                """INSERT OR IGNORE INTO decisions
                   (signature,closed_m10_timestamp,model_name,snapshot_json,decision_json,latency_ms,created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    signature, snapshot.closed_m10_timestamp, snapshot.model_name,
                    json.dumps(asdict(snapshot), sort_keys=True, separators=(",", ":")),
                    json.dumps(decision.as_dict(), sort_keys=True, separators=(",", ":")),
                    latency_ms, int(time.time()),
                ),
            )

    def count(self) -> int:
        with self._lock, self._connect() as db:
            return int(db.execute("SELECT COUNT(*) FROM decisions").fetchone()[0])


class LocalAIEngine:
    def __init__(
        self,
        runtime_url: str,
        cache_path: Path,
        timeout_seconds: float = 40.0,
        confidence_threshold: int = 70,
        max_cpu_percent: float = 70.0,
        min_free_ram_gb: float = 2.0,
        model_name: str = "qwen3-0.6b-q8",
        model_path: Path | None = None,
    ) -> None:
        self.runtime_url = runtime_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.confidence_threshold = confidence_threshold
        self.max_cpu_percent = max_cpu_percent
        self.min_free_ram_gb = min_free_ram_gb
        self.model_name = model_name
        self.model_path = model_path
        self.cache = DecisionCache(cache_path)
        self.probe = ResourceProbe()
        self._inference = threading.Lock()
        self._pending_lock = threading.Lock()
        self._pending: set[str] = set()
        self._stats_lock = threading.Lock()
        self._latencies: list[float] = []
        self._stats: dict[str, int] = {
            "calls": 0, "cache_hits": 0, "parse_failures": 0, "timeouts": 0,
            "fallbacks": 0, "load_skips": 0, "busy_skips": 0,
        }
        self.last_success: dict[str, Any] | None = None

    def submit(self, raw: dict[str, Any]) -> tuple[dict[str, Any], int]:
        """Start inference without blocking the MT5 event thread.

        A cache hit returns the complete decision immediately. A miss starts
        one background inference and returns PENDING; callers poll by the
        returned signature. There is deliberately no request queue behind the
        single active inference.
        """
        try:
            snapshot = Snapshot.parse(raw)
        except SchemaError as exc:
            return {"status": "INVALID_SNAPSHOT", "fallback": "DETERMINISTIC", "reason": str(exc)}, 400
        signature = snapshot_signature(snapshot)
        cached = self.cache.get(signature)
        if cached:
            self._inc("cache_hits")
            decision, latency_ms = cached
            return self._result(signature, decision, latency_ms, cache_hit=True), 200
        load = self.probe.sample()
        if load["free_ram_gb"] < self.min_free_ram_gb or load["cpu_percent"] > self.max_cpu_percent:
            self._inc("load_skips", "fallbacks")
            return {
                "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC", "reason": "RESOURCE_GUARD",
                "signature": signature, "load": load,
            }, 200
        with self._pending_lock:
            if signature in self._pending:
                return {"status": "LOCAL_AI_PENDING", "fallback": "DETERMINISTIC", "signature": signature}, 202
            if self._inference.locked() or self._pending:
                self._inc("busy_skips", "fallbacks")
                return {
                    "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC", "reason": "QUEUE_FULL",
                    "signature": signature,
                }, 200
            self._pending.add(signature)
        thread = threading.Thread(
            target=self._background_decide, args=(signature, snapshot),
            name="xaucloud-local-ai-inference", daemon=True,
        )
        thread.start()
        return {"status": "LOCAL_AI_PENDING", "fallback": "DETERMINISTIC", "signature": signature}, 202

    def result(self, signature: str) -> tuple[dict[str, Any], int]:
        if len(signature) != 64 or any(char not in "0123456789abcdef" for char in signature):
            return {"status": "INVALID_SIGNATURE", "fallback": "DETERMINISTIC"}, 400
        cached = self.cache.get(signature)
        if cached:
            self._inc("cache_hits")
            decision, latency_ms = cached
            return self._result(signature, decision, latency_ms, cache_hit=True), 200
        with self._pending_lock:
            pending = signature in self._pending
        return {
            "status": "LOCAL_AI_PENDING" if pending else "LOCAL_AI_NOT_FOUND",
            "fallback": "DETERMINISTIC", "signature": signature,
        }, 202 if pending else 404

    def _background_decide(self, signature: str, snapshot: Snapshot) -> None:
        if not self._inference.acquire(blocking=False):
            with self._pending_lock:
                self._pending.discard(signature)
            self._inc("busy_skips", "fallbacks")
            return
        try:
            started = time.perf_counter()
            self._inc("calls")
            try:
                decision = self._call_runtime(snapshot)
            except TimeoutError:
                self._inc("timeouts", "fallbacks")
                return
            except (SchemaError, json.JSONDecodeError, KeyError, IndexError, TypeError):
                self._inc("parse_failures", "fallbacks")
                return
            except (OSError, urllib.error.URLError, urllib.error.HTTPError):
                self._inc("fallbacks")
                return
            latency_ms = (time.perf_counter() - started) * 1000.0
            self.cache.put(signature, snapshot, decision, latency_ms)
            with self._stats_lock:
                self._latencies.append(latency_ms)
                self._latencies = self._latencies[-2000:]
                self.last_success = {
                    "signature": signature, "closed_m10_timestamp": snapshot.closed_m10_timestamp,
                    "decision": decision.as_dict(), "latency_ms": round(latency_ms, 2),
                }
        finally:
            self._inference.release()
            with self._pending_lock:
                self._pending.discard(signature)

    def decide(self, raw: dict[str, Any]) -> tuple[dict[str, Any], int]:
        try:
            snapshot = Snapshot.parse(raw)
        except SchemaError as exc:
            return {"status": "INVALID_SNAPSHOT", "fallback": "DETERMINISTIC", "reason": str(exc)}, 400
        signature = snapshot_signature(snapshot)
        cached = self.cache.get(signature)
        if cached:
            self._inc("cache_hits")
            decision, latency_ms = cached
            return self._result(signature, decision, latency_ms, cache_hit=True), 200

        load = self.probe.sample()
        if load["free_ram_gb"] < self.min_free_ram_gb or load["cpu_percent"] > self.max_cpu_percent:
            self._inc("load_skips", "fallbacks")
            return {
                "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC", "reason": "RESOURCE_GUARD",
                "signature": signature, "load": load,
            }, 200
        if not self._inference.acquire(blocking=False):
            self._inc("busy_skips", "fallbacks")
            return {
                "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC", "reason": "QUEUE_FULL",
                "signature": signature,
            }, 200
        try:
            started = time.perf_counter()
            self._inc("calls")
            try:
                decision = self._call_runtime(snapshot)
            except TimeoutError:
                self._inc("timeouts", "fallbacks")
                return {
                    "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC", "reason": "LOCAL_AI_TIMEOUT",
                    "signature": signature,
                }, 200
            except (SchemaError, json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
                self._inc("parse_failures", "fallbacks")
                return {
                    "status": "LOCAL_AI_PARSE_FAILED", "fallback": "DETERMINISTIC", "reason": str(exc),
                    "signature": signature,
                }, 200
            except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
                self._inc("fallbacks")
                return {
                    "status": "LOCAL_AI_FALLBACK", "fallback": "DETERMINISTIC",
                    "reason": f"RUNTIME_UNAVAILABLE:{type(exc).__name__}", "signature": signature,
                }, 200
            latency_ms = (time.perf_counter() - started) * 1000.0
            self.cache.put(signature, snapshot, decision, latency_ms)
            with self._stats_lock:
                self._latencies.append(latency_ms)
                self._latencies = self._latencies[-2000:]
                self.last_success = {
                    "signature": signature, "closed_m10_timestamp": snapshot.closed_m10_timestamp,
                    "decision": decision.as_dict(), "latency_ms": round(latency_ms, 2),
                }
            return self._result(signature, decision, latency_ms, cache_hit=False), 200
        finally:
            self._inference.release()

    def _call_runtime(self, snapshot: Snapshot) -> Decision:
        payload = {
            "model": snapshot.model_name,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(asdict(snapshot), separators=(",", ":"), sort_keys=True)},
            ],
            "temperature": 0,
            "seed": 62530,
            "max_tokens": 220,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "xaucloud_m10_decision", "strict": True, "schema": DECISION_JSON_SCHEMA},
            },
        }
        request = urllib.request.Request(
            f"{self.runtime_url}/v1/chat/completions",
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw = json.loads(response.read().decode("utf-8"))
        except TimeoutError:
            raise
        content = raw["choices"][0]["message"]["content"]
        decision = _fail_closed_relationship(Decision.parse(json.loads(content)))
        allowed = set(snapshot.allowed_candidate_setups)
        if decision.candidate_setup != "NONE" and decision.candidate_setup not in allowed:
            raise SchemaError("candidate_setup is not an existing allowed setup family")
        return decision

    def _result(self, signature: str, decision: Decision, latency_ms: float, cache_hit: bool) -> dict[str, Any]:
        trusted = decision.confidence >= self.confidence_threshold
        return {
            "status": "LOCAL_AI_TRUSTED" if trusted else "LOCAL_AI_LOW_CONFIDENCE",
            "fallback": None if trusted else "DETERMINISTIC",
            "signature": signature, "cache_hit": cache_hit,
            "latency_ms": round(latency_ms, 2), "confidence_threshold": self.confidence_threshold,
            "decision": decision.as_dict(),
        }

    def health(self) -> dict[str, Any]:
        runtime_reachable = False
        try:
            with urllib.request.urlopen(f"{self.runtime_url}/health", timeout=1.0) as response:
                runtime_reachable = response.status == 200
        except (OSError, urllib.error.URLError):
            pass
        return {
            "status": "green" if runtime_reachable else "degraded",
            "runtime_reachable": runtime_reachable,
            "schema_version": SCHEMA_VERSION,
            "loaded_model": self.model_name,
            "normal_paid_ai_enabled": False,
            "inference_busy": self._inference.locked(),
            "load": self.probe.sample(),
        }

    def stats(self) -> dict[str, Any]:
        with self._stats_lock:
            values = dict(self._stats)
            latencies = list(self._latencies)
            last_success = self.last_success
        values.update({
            "cache_entries": self.cache.count(),
            "average_response_ms": round(statistics.fmean(latencies), 2) if latencies else 0.0,
            "p95_response_ms": round(_percentile(latencies, 0.95), 2) if latencies else 0.0,
            "last_response_ms": round(latencies[-1], 2) if latencies else 0.0,
            "queue_length": len(self._pending),
            "last_successful_ai_decision": last_success,
            "load": self.probe.sample(),
        })
        return values

    def models(self) -> dict[str, Any]:
        size_bytes = 0
        if self.model_path:
            try:
                size_bytes = self.model_path.stat().st_size
            except OSError:
                pass
        return {
            "loaded_model": self.model_name,
            "model_path": str(self.model_path) if self.model_path else "",
            "model_size_bytes": size_bytes,
            "model_size_gb": round(size_bytes / (1024 ** 3), 3),
            "runtime_url": self.runtime_url,
            "runtime_threads": 2,
            "context_length": 2048,
            "parallel_inferences": 1,
            "paid_models_enabled": False,
        }

    def _inc(self, *names: str) -> None:
        with self._stats_lock:
            for name in names:
                self._stats[name] += 1


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int((len(ordered) - 1) * fraction + 0.999999)))
    return ordered[index]


def _fail_closed_relationship(decision: Decision) -> Decision:
    if not decision.candidate_allowed:
        return decision
    if decision.preferred_direction != "NONE" and decision.candidate_setup != "NONE":
        return decision
    raw = decision.as_dict()
    raw["candidate_allowed"] = False
    raw["candidate_setup"] = "NONE"
    raw["reason_codes"] = (
        [code for code in decision.reason_codes if code != "MODEL_CONTRADICTION_FAIL_CLOSED"][:5]
        + ["MODEL_CONTRADICTION_FAIL_CLOSED"]
    )
    raw["short_reason"] = "Contradictory candidate failed closed."
    return Decision.parse(raw)


def make_handler(engine: LocalAIEngine) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "XauCloudLocalAI/1"

        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/api/local-ai/health":
                self._json(engine.health())
            elif parsed.path == "/api/local-ai/models":
                self._json(engine.models())
            elif parsed.path == "/api/local-ai/stats":
                self._json(engine.stats())
            elif parsed.path == "/api/local-ai/result":
                query = urllib.parse.parse_qs(parsed.query)
                result, status = engine.result(query.get("signature", [""])[0])
                self._json(result, status)
            else:
                self._json({"error": "not found"}, 404)

        def do_POST(self) -> None:  # noqa: N802
            if self.path not in {"/api/local-ai/decision", "/api/local-ai/submit"}:
                self._json({"error": "not found"}, 404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 32_768:
                    raise ValueError("request length must be 1..32768 bytes")
                raw = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                self._json({"status": "INVALID_SNAPSHOT", "fallback": "DETERMINISTIC", "reason": str(exc)}, 400)
                return
            result, status = engine.submit(raw) if self.path.endswith("/submit") else engine.decide(raw)
            self._json(result, status)

        def log_message(self, fmt: str, *args: Any) -> None:
            LOG.info("%s %s", self.address_string(), fmt % args)

        def _json(self, body: dict[str, Any], status: int = 200) -> None:
            payload = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Loopback-only local AI gateway for XauCloud pure M10")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--runtime-url", default="http://127.0.0.1:11434")
    parser.add_argument("--cache", type=Path, default=Path("local_ai_cache.sqlite3"))
    parser.add_argument("--timeout", type=float, default=40.0)
    parser.add_argument("--confidence-threshold", type=int, default=70)
    parser.add_argument("--max-cpu-percent", type=float, default=70.0)
    parser.add_argument("--min-free-ram-gb", type=float, default=2.0)
    parser.add_argument("--model-name", default="qwen3-0.6b-q8")
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--log", type=Path)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("refusing non-loopback bind")
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if args.log:
        args.log.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(args.log, encoding="utf-8"))
    logging.basicConfig(level=logging.INFO, handlers=handlers, format="%(asctime)s %(levelname)s %(message)s")
    if not _set_below_normal_priority():
        LOG.warning("could not set below-normal Windows process priority")
    engine = LocalAIEngine(
        args.runtime_url, args.cache, args.timeout, args.confidence_threshold,
        args.max_cpu_percent, args.min_free_ram_gb, args.model_name, args.model_path,
    )
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine))
    LOG.info("local AI gateway listening on %s:%d; paid AI disabled", args.host, args.port)
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
