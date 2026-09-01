#!/usr/bin/env python3
"""Extract selected MT5 tester events from UTF-16 logs without loading them whole."""

from __future__ import annotations

import argparse
import codecs
import re
from pathlib import Path


def detect_utf16(path: Path, offset: int = 0) -> str:
    with path.open("rb") as handle:
        handle.seek(offset)
        sample = handle.read(4096)
    if sample.startswith(codecs.BOM_UTF16_LE):
        return "utf-16-le"
    if sample.startswith(codecs.BOM_UTF16_BE):
        return "utf-16-be"
    # Sliced MT5 logs commonly omit the original BOM. ASCII journal text has
    # zeroes predominantly in odd bytes for LE and even bytes for BE.
    even_zeroes = sample[0::2].count(0)
    odd_zeroes = sample[1::2].count(0)
    if max(even_zeroes, odd_zeroes) == 0:
        raise ValueError(f"{path} does not look like UTF-16 text")
    return "utf-16-le" if odd_zeroes >= even_zeroes else "utf-16-be"


def extract(
    source: Path,
    destination: Path,
    patterns: list[str],
    start_byte: int = 0,
    byte_count: int | None = None,
) -> int:
    encoding = detect_utf16(source, start_byte)
    matcher = re.compile("|".join(f"(?:{p})" for p in patterns))
    decoder = codecs.getincrementaldecoder(encoding)(errors="replace")
    remaining = byte_count
    pending = ""
    matched: list[str] = []

    with source.open("rb") as handle:
        handle.seek(start_byte - start_byte % 2)
        while remaining is None or remaining > 0:
            size = 1024 * 1024 if remaining is None else min(1024 * 1024, remaining)
            block = handle.read(size)
            if not block:
                break
            if remaining is not None:
                remaining -= len(block)
            text = pending + decoder.decode(block)
            lines = text.splitlines(keepends=True)
            if lines and not lines[-1].endswith(("\n", "\r")):
                pending = lines.pop()
            else:
                pending = ""
            matched.extend(line.rstrip("\r\n") for line in lines if matcher.search(line))
        pending += decoder.decode(b"", final=True)
        if pending and matcher.search(pending):
            matched.append(pending.rstrip("\r\n"))

    if not matched:
        raise RuntimeError("event extraction produced zero lines")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(matched) + "\n", encoding="utf-8")
    return len(matched)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--pattern", action="append", required=True)
    parser.add_argument("--start-byte", type=int, default=0)
    parser.add_argument("--byte-count", type=int)
    args = parser.parse_args()
    count = extract(
        args.source,
        args.destination,
        args.pattern,
        args.start_byte,
        args.byte_count,
    )
    print(f"extracted_lines={count} encoding={detect_utf16(args.source, args.start_byte)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
