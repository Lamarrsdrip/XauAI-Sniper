#!/usr/bin/env python3
"""Prepare an authenticated, isolated MT5 replay without printing secrets."""

from __future__ import annotations

import argparse
import configparser
import hashlib
import re
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--auth-template", type=Path, required=True)
    parser.add_argument("--original-set", type=Path, required=True)
    parser.add_argument("--output-config", type=Path, required=True)
    parser.add_argument("--output-set", type=Path, required=True)
    parser.add_argument("--expert", required=True)
    parser.add_argument("--mode", choices=("1", "2"), required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()

    auth = configparser.ConfigParser(interpolation=None)
    auth.optionxform = str
    auth.read(args.auth_template, encoding="utf-8")
    credentials = {
        key: auth.get("Common", key, fallback="").strip()
        for key in ("Login", "Password", "Server")
    }
    if not all(credentials.values()):
        raise SystemExit("authenticated template is missing Login, Password, or Server")

    config = configparser.ConfigParser(interpolation=None)
    config.optionxform = str
    config["Common"] = credentials
    config["Experts"] = {"Enabled": "0", "AllowLiveTrading": "0"}
    config["Tester"] = {
        "Expert": args.expert,
        "ExpertParameters": args.output_set.name,
        "Symbol": "XAUUSD",
        "Period": "M10",
        "Model": "4",
        "FromDate": "2026.04.22",
        "ToDate": "2026.07.21",
        "ForwardMode": "0",
        "Deposit": "10000",
        "Currency": "USD",
        "Leverage": "100",
        "ExecutionMode": "0",
        "Optimization": "0",
        "Visual": "false",
        "Report": args.report,
        "ShutdownTerminal": "1",
        "ReplaceReport": "1",
    }
    args.output_config.parent.mkdir(parents=True, exist_ok=True)
    with args.output_config.open("w", encoding="utf-8", newline="\n") as handle:
        config.write(handle, space_around_delimiters=False)
    args.output_config.chmod(0o600)

    raw_set = args.original_set.read_bytes()
    set_encoding = (
        "utf-16"
        if raw_set.startswith((b"\xff\xfe", b"\xfe\xff"))
        else "utf-8"
    )
    set_text = raw_set.decode(set_encoding)
    replacements = {
        r"(?m)^InpGlobalTradeBrainMode=.*$": (
            f"InpGlobalTradeBrainMode={args.mode}||0||0||3||N"
        ),
        r"(?m)^InpTradeBrainCollectionRunId=.*$": (
            f"InpTradeBrainCollectionRunId={args.run_id}"
        ),
    }
    for pattern, replacement in replacements.items():
        set_text, count = re.subn(pattern, replacement, set_text)
        if count != 1:
            raise SystemExit(f"expected one setting match for {pattern!r}, found {count}")
    if not re.search(
        r"(?m)^InpAllowAdaptiveReversalDirectEntry=false\|\|", set_text
    ):
        raise SystemExit("recorded adaptive-reversal-direct-entry=false input is absent")

    args.output_set.parent.mkdir(parents=True, exist_ok=True)
    args.output_set.write_bytes(set_text.encode("utf-16"))
    args.output_set.chmod(0o600)
    print(
        f"prepared mode={args.mode} config_sha256={sha256(args.output_config)} "
        f"set_sha256={sha256(args.output_set)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
