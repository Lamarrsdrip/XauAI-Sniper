#!/usr/bin/env python3
"""Create isolated MT5 Model-4 replay configs without printing account secrets.

Run this on the already configured research terminal host. Authentication and
environment binding are copied from an existing working tester config and are
never emitted to stdout or placed in the repository.
"""

from __future__ import annotations

import argparse
import configparser
from pathlib import Path


def _read(path: Path) -> configparser.ConfigParser:
    raw = path.read_bytes()
    encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8"
    document = configparser.ConfigParser(interpolation=None, strict=False)
    document.optionxform = str
    document.read_string(raw.decode(encoding))
    return document


def _write(path: Path, document: configparser.ConfigParser) -> None:
    from io import StringIO

    rendered = StringIO()
    document.write(rendered, space_around_delimiters=False)
    path.write_text(rendered.getvalue(), encoding="utf-8")


def _config(
    auth: dict[str, str],
    expert: str,
    report: str,
    from_date: str,
    to_date: str,
    inputs: dict[str, str],
) -> configparser.ConfigParser:
    document = configparser.ConfigParser(interpolation=None)
    document.optionxform = str
    document["Common"] = auth
    document["Tester"] = {
        "Expert": expert,
        "Symbol": "XAUUSD",
        "Period": "M10",
        "Model": "4",
        "FromDate": from_date,
        "ToDate": to_date,
        "ForwardMode": "0",
        "Deposit": "10000",
        "Currency": "USD",
        "Leverage": "100",
        "ExecutionMode": "0",
        "Optimization": "0",
        "Visual": "false",
        "Report": report,
        "ShutdownTerminal": "1",
        "ReplaceReport": "1",
    }
    document["TesterInputs"] = inputs
    return document


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--from-date", required=True)
    parser.add_argument("--to-date", required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--cache-file", default="XauCloud_local_ai_m10_replay_cache.tsv")
    args = parser.parse_args()

    base = _read(args.base_config)
    allowed_auth = ("Login", "Password", "Server", "Environment")
    auth = {key: base.get("Common", key) for key in allowed_auth if base.has_option("Common", key)}
    if not auth.get("Login") or not auth.get("Server"):
        raise SystemExit("base config does not contain a usable saved tester account")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    common_inputs = {
        "InpLicensePIN": "ASE-TEST-0001",
        "InpBacktestMode": "true",
        "InpUseAI": "false",
        "InpAIExitOverride": "false",
        "InpEmergentDifficultFallbackEnabled": "false",
    }
    jobs = {
        "BASELINE": (
            "v62530_production_parity\\XauCloud_v62530_PRODUCTION",
            {"InpLicensePIN": "ASE-TEST-0001", "InpAuditRunId": f"{args.prefix}_BASELINE"},
        ),
        "COLLECT_WITH_OWNER": (
            "local_ai_m10\\XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS",
            common_inputs
            | {
                "InpAuditRunId": f"{args.prefix}_COLLECT_WITH_OWNER",
                "InpLocalAIEnabled": "true",
                "InpLocalAIReplayCacheEnabled": "false",
                "InpLocalAIReplayCollectMissing": "true",
                "InpLocalAIReplaySnapshotFile": f"{args.prefix}_snapshots_with_owner.tsv",
            },
        ),
        "COLLECT_NO_OWNER": (
            "local_ai_m10\\XauCloud_M10_LOCAL_AI_NO_OWNER_BLOCKERS",
            common_inputs
            | {
                "InpAuditRunId": f"{args.prefix}_COLLECT_NO_OWNER",
                "InpLocalAIEnabled": "true",
                "InpLocalAIReplayCacheEnabled": "false",
                "InpLocalAIReplayCollectMissing": "true",
                "InpLocalAIReplaySnapshotFile": f"{args.prefix}_snapshots_no_owner.tsv",
            },
        ),
        "AI_WITH_OWNER": (
            "local_ai_m10\\XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS",
            common_inputs
            | {
                "InpAuditRunId": f"{args.prefix}_AI_WITH_OWNER",
                "InpLocalAIEnabled": "true",
                "InpLocalAIReplayCacheEnabled": "true",
                "InpLocalAIReplayCollectMissing": "true",
                "InpLocalAIReplayCacheFile": args.cache_file,
                "InpLocalAIReplaySnapshotFile": f"{args.prefix}_missing_with_owner.tsv",
            },
        ),
        "AI_NO_OWNER": (
            "local_ai_m10\\XauCloud_M10_LOCAL_AI_NO_OWNER_BLOCKERS",
            common_inputs
            | {
                "InpAuditRunId": f"{args.prefix}_AI_NO_OWNER",
                "InpLocalAIEnabled": "true",
                "InpLocalAIReplayCacheEnabled": "true",
                "InpLocalAIReplayCollectMissing": "true",
                "InpLocalAIReplayCacheFile": args.cache_file,
                "InpLocalAIReplaySnapshotFile": f"{args.prefix}_missing_no_owner.tsv",
            },
        ),
    }
    for name, (expert, inputs) in jobs.items():
        report = f"{args.prefix}_{name}"
        document = _config(auth, expert, report, args.from_date, args.to_date, inputs)
        _write(args.output_dir / f"{report}.ini", document)
    print(f"prepared {len(jobs)} Model=4 configs in {args.output_dir}; credentials not printed")


if __name__ == "__main__":
    main()
