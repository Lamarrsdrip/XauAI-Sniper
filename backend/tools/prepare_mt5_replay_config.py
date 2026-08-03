#!/usr/bin/env python3
"""Bind an MT5 tester config to the already configured local account safely.

The account identifier is copied from the config's existing [Common] section to
[Tester], as required by MT5's command-line tester.  It is never printed.
"""

from __future__ import annotations

import argparse
import configparser
import hashlib
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    args = parser.parse_args()

    raw = args.config.read_bytes()
    encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8"
    document = configparser.ConfigParser(interpolation=None, strict=False)
    document.optionxform = str
    document.read_string(raw.decode(encoding))

    login = document.get("Common", "Login", fallback="").strip()
    if not login:
        raise SystemExit("existing [Common] Login is absent; config was not changed")
    if not document.has_section("Tester"):
        raise SystemExit("[Tester] section is absent; config was not changed")

    document.set("Tester", "Login", login)
    document.set("Tester", "Leverage", "1:100")

    # Alternate configs need the installation's encrypted environment binding
    # to locate the already-saved account database.  Copy the binding without
    # exposing it or modifying the installation's normal common.ini.
    common_path = args.config.parent / "common.ini"
    common_raw = common_path.read_bytes()
    common_encoding = (
        "utf-16"
        if common_raw.startswith((b"\xff\xfe", b"\xfe\xff"))
        else "utf-8"
    )
    installed = configparser.ConfigParser(interpolation=None, strict=False)
    installed.optionxform = str
    installed.read_string(common_raw.decode(common_encoding))
    environment = installed.get("Common", "Environment", fallback="").strip()
    if not environment:
        raise SystemExit("installed account environment binding is absent")
    document.set("Common", "Environment", environment)

    if not document.has_section("Experts"):
        document.add_section("Experts")
    document.set("Experts", "Enabled", "0")
    document.set("Experts", "AllowLiveTrading", "0")

    from io import StringIO

    rendered = StringIO()
    document.write(rendered, space_around_delimiters=False)
    args.config.write_bytes(rendered.getvalue().encode("utf-16"))
    digest = hashlib.sha256(args.config.read_bytes()).hexdigest()
    print(f"updated {args.config.name}: tester login bound, leverage=1:100, sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
