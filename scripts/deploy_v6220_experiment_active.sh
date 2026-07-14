#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EA="XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1"
SOURCE="$ROOT/$EA.mq5"
BINARY="$ROOT/$EA.ex5"
PRESET="$ROOT/config/${EA}_ACTIVE.set"
EXPECTED_BUILD="v6220-campaign-manual-micro-transition-active-20260714"
TERMINAL_DATA_DIR=""
DEMO_CONFIRMED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --terminal-data-dir) TERMINAL_DATA_DIR="${2:-}"; shift 2 ;;
    --demo-confirmed) DEMO_CONFIRMED=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$DEMO_CONFIRMED" == true ]] || { echo "Refusing install: pass --demo-confirmed after verifying an isolated demo terminal." >&2; exit 3; }
[[ -d "$TERMINAL_DATA_DIR/MQL5" ]] || { echo "Invalid MT5 data directory." >&2; exit 4; }
[[ -f "$SOURCE" && -f "$BINARY" && -f "$PRESET" ]] || { echo "Source, compiled EX5, or ACTIVE preset missing." >&2; exit 5; }
grep -Fq "$EXPECTED_BUILD" "$SOURCE" || { echo "Unexpected source build marker." >&2; exit 6; }
grep -Fq "InpCampaignTransitionMode = CAMPAIGN_TRANSITION_ACTIVE" "$SOURCE" || { echo "Source is not ACTIVE by default." >&2; exit 7; }
grep -Eq '^InpCampaignTransitionMode=2$' "$PRESET" || { echo "Preset is not ACTIVE." >&2; exit 8; }

DEST_EXPERTS="$TERMINAL_DATA_DIR/MQL5/Experts"
DEST_PRESETS="$TERMINAL_DATA_DIR/MQL5/Profiles/Presets"
DEST_RUNTIME_PRESETS="$TERMINAL_DATA_DIR/MQL5/Presets"
ROLLBACK="$TERMINAL_DATA_DIR/MQL5/Experts/rollback_v6220_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DEST_EXPERTS" "$DEST_PRESETS" "$DEST_RUNTIME_PRESETS" "$ROLLBACK"
if [[ -f "$DEST_EXPERTS/$EA.ex5" ]]; then
  cp -p "$DEST_EXPERTS/$EA.ex5" "$ROLLBACK/$EA.ex5"
fi
if [[ -f "$DEST_EXPERTS/$EA.mq5" ]]; then
  cp -p "$DEST_EXPERTS/$EA.mq5" "$ROLLBACK/$EA.mq5"
fi
cp -p "$SOURCE" "$DEST_EXPERTS/$EA.mq5"
cp -p "$BINARY" "$DEST_EXPERTS/$EA.ex5"
cp -p "$PRESET" "$DEST_PRESETS/${EA}_ACTIVE.set"
cp -p "$PRESET" "$DEST_RUNTIME_PRESETS/${EA}_ACTIVE.set"

SOURCE_SHA="$(shasum -a 256 "$BINARY" | awk '{print $1}')"
INSTALLED_SHA="$(shasum -a 256 "$DEST_EXPERTS/$EA.ex5" | awk '{print $1}')"
[[ "$SOURCE_SHA" == "$INSTALLED_SHA" ]] || { echo "Installed EX5 checksum mismatch." >&2; exit 9; }
echo "Installed isolated v6.22.0 ACTIVE experiment. EX5 SHA-256: $INSTALLED_SHA"
echo "Rollback directory: $ROLLBACK"
echo "Manual safety step remains: attach exactly one instance to the isolated demo chart and verify CAMPAIGN_TRANSITION_ACTIVE_ASSERTION_PASSED in Journal."
