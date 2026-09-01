#!/usr/bin/env python3
"""Auto-promotion logic for backend/ea_releases/manifest.json, run by
.github/workflows/ea.yml on every push to main.

A developer's normal workflow is: compile a new EX5, commit it under
backend/ea_releases/<version>/, add a manifest entry with
stable_status: true and a build_timestamp, and push to main -- exactly as
already documented in RELEASE_CHECKLIST.md. This script is what then moves
manifest.json's current_version pointer automatically, so the developer
never has to remember to hand-edit that pointer separately, while still
refusing to promote anything that hasn't been explicitly marked
stable_status: true or that fails a hash/artifact-existence check.

Never touches an unapproved (stable_status: false) release, never promotes
something older than or equal to the currently-promoted build_timestamp,
and never partially writes the manifest (only rewrites it after every check
has passed).

Usage:
    python3 scripts/auto_promote_release.py [--manifest-path PATH] [--dry-run]

Exit codes:
    0 -- either promoted successfully, or no newer stable candidate existed
         (both are a "nothing went wrong" outcome for CI).
    1 -- a newer-build_timestamp candidate exists but fails validation
         (not stable, missing artifact, hash mismatch, version/key
         mismatch) -- CI must fail the build and leave current_version
         untouched so the previous verified release stays live.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Optional


def _validate_candidate(version: str, release: dict, releases_dir: Path) -> list[str]:
    """Returns a list of human-readable problems; empty list means the
    candidate is safe to promote."""
    problems = []
    if not release.get("stable_status"):
        problems.append("stable_status is not true")
    if release.get("version") != version:
        problems.append(f"release.version ({release.get('version')!r}) does not match its own manifest key ({version!r})")
    filename = release.get("ex5_filename")
    if not filename:
        problems.append("no ex5_filename in manifest entry")
        return problems
    artifact_path = releases_dir / version / filename
    if not artifact_path.exists():
        problems.append(f"EX5 artifact not found at {artifact_path}")
        return problems
    actual_hash = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
    expected_hash = release.get("ex5_sha256", "")
    if actual_hash != expected_hash:
        problems.append(f"SHA-256 mismatch: manifest says {expected_hash}, artifact is {actual_hash}")
    return problems


def decide_promotion(manifest: dict, releases_dir: Path) -> tuple[Optional[str], Optional[str], list[str]]:
    """Returns (candidate_version_or_None, reason_if_no_candidate, problems).

    - If there's no stable release newer than current_version:
      (None, "no newer stable release found", [])
    - If the newest-by-build_timestamp stable release fails validation:
      (that_version, None, [list of problems])  -- caller must fail the build
    - If a valid newer stable release is found:
      (that_version, None, [])  -- caller should promote it
    """
    current = manifest.get("current_version")
    releases = manifest.get("releases", {})
    current_ts = (releases.get(current) or {}).get("build_timestamp", "") or ""

    candidates = []
    for version, release in releases.items():
        if version == current:
            continue
        if not release.get("stable_status"):
            continue
        ts = release.get("build_timestamp", "") or ""
        if ts and ts > current_ts:
            candidates.append((ts, version, release))

    if not candidates:
        return None, "no newer stable release found", []

    candidates.sort()
    _newest_ts, newest_version, newest_release = candidates[-1]
    problems = _validate_candidate(newest_version, newest_release, releases_dir)
    return newest_version, None, problems


def sync_runtime_release(manifest: dict, releases_dir: Path, runtime_manifest_path: Path) -> bool:
    """Synchronize the one promoted release into the deployed Node runtime.

    The source manifest remains the release authority. The Node backend keeps a
    smaller runtime manifest, so copying the whole historical manifest would
    advertise artifacts that are intentionally not present there.
    """
    version = manifest.get("current_version")
    release = (manifest.get("releases") or {}).get(version)
    if not version or not release:
        raise ValueError("source manifest has no valid current release")
    problems = _validate_candidate(version, release, releases_dir)
    if problems:
        raise ValueError(f"cannot synchronize {version}: {'; '.join(problems)}")

    runtime = json.loads(runtime_manifest_path.read_text(encoding="utf-8")) if runtime_manifest_path.exists() else {
        "website_product_name": manifest.get("website_product_name", "XauCloud"),
        "mt5_market_product_name": manifest.get("mt5_market_product_name", "XauCloud"),
        "releases": {},
    }
    if not isinstance(runtime.get("releases"), dict):
        runtime["releases"] = {}
    runtime["current_version"] = version
    runtime["releases"][version] = release

    filename = release["ex5_filename"]
    source_artifact = releases_dir / version / filename
    runtime_artifact = runtime_manifest_path.parent / version / filename
    runtime_artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact_changed = not runtime_artifact.exists() or hashlib.sha256(runtime_artifact.read_bytes()).hexdigest() != release["ex5_sha256"]
    if artifact_changed:
        shutil.copyfile(source_artifact, runtime_artifact)
    copied_hash = hashlib.sha256(runtime_artifact.read_bytes()).hexdigest()
    if copied_hash != release["ex5_sha256"]:
        raise ValueError(f"runtime artifact hash mismatch after copy: {copied_hash}")

    rendered = json.dumps(runtime, indent=2) + "\n"
    manifest_changed = not runtime_manifest_path.exists() or runtime_manifest_path.read_text(encoding="utf-8") != rendered
    if manifest_changed:
        runtime_manifest_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = runtime_manifest_path.with_suffix(runtime_manifest_path.suffix + ".tmp")
        tmp.write_text(rendered, encoding="utf-8")
        os.replace(tmp, runtime_manifest_path)
    return artifact_changed or manifest_changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-path", default="backend/ea_releases/manifest.json")
    parser.add_argument("--runtime-manifest-path", default="backend_node/ea_releases/manifest.json")
    parser.add_argument("--dry-run", action="store_true", help="Decide but never write the manifest.")
    args = parser.parse_args()

    manifest_path = Path(args.manifest_path)
    releases_dir = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    candidate_version, no_candidate_reason, problems = decide_promotion(manifest, releases_dir)

    github_output = os.environ.get("GITHUB_OUTPUT")

    def _emit(promoted: bool, version: str = "", runtime_synced: bool = False):
        if github_output:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"promoted={'true' if promoted else 'false'}\n")
                f.write(f"version={version}\n")
                f.write(f"runtime_synced={'true' if runtime_synced else 'false'}\n")

    if candidate_version is None:
        print(f"No promotion needed: {no_candidate_reason}. current_version stays {manifest.get('current_version')!r}.")
        runtime_synced = False if args.dry_run else sync_runtime_release(manifest, releases_dir, Path(args.runtime_manifest_path))
        _emit(promoted=False, version=str(manifest.get("current_version") or ""), runtime_synced=runtime_synced)
        return 0

    if problems:
        print(f"::error::Cannot auto-promote {candidate_version}: {'; '.join(problems)}")
        print(f"Keeping current_version={manifest.get('current_version')!r} live. Fix the issues above and push again.")
        _emit(promoted=False)
        return 1

    previous = manifest.get("current_version")
    print(f"Promoting current_version: {previous!r} -> {candidate_version!r}")
    manifest["current_version"] = candidate_version
    if not args.dry_run:
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    runtime_synced = False if args.dry_run else sync_runtime_release(manifest, releases_dir, Path(args.runtime_manifest_path))
    _emit(promoted=True, version=candidate_version, runtime_synced=runtime_synced)
    return 0


if __name__ == "__main__":
    sys.exit(main())
