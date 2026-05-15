#!/usr/bin/env bash
# ============================================================================
#  XauAi Cloud Worker — one-line installer for macOS / Linux
#  Usage:   curl -fsSL https://xauaisniper.com/install-worker.sh | bash
# ============================================================================
set -e
GREEN="\033[1;32m"; RED="\033[1;31m"; CYAN="\033[1;36m"; NC="\033[0m"
say() { echo -e "${CYAN}[xauai]${NC} $*"; }
err() { echo -e "${RED}[fail]${NC}  $*"; exit 1; }
ok()  { echo -e "${GREEN}[ok]${NC}    $*"; }

INSTALL_DIR="$HOME/xauai-worker"
ZIP_URL="https://xauaisniper.com/xauai_worker_agent_v1.5.1.zip"

say "Installing XauAi Cloud Worker → $INSTALL_DIR"

# 1. Python check
if ! command -v python3 >/dev/null 2>&1; then
  err "Python 3.10+ required. macOS:  brew install python  |  Ubuntu: sudo apt install python3 python3-venv"
fi
PYV=$(python3 -c 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
ok "Python $PYV found"

# 2. Download
say "Downloading worker agent…"
mkdir -p "$INSTALL_DIR" && cd "$INSTALL_DIR"
curl -fsSL "$ZIP_URL" -o worker.zip || err "Download failed: $ZIP_URL"
rm -rf worker_agent
unzip -q worker.zip
rm worker.zip
cd worker_agent
ok "Downloaded"

# 3. Virtualenv + deps
say "Installing Python dependencies…"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
ok "Dependencies installed"

# 4. Pair (interactive)
echo
echo "──────────────────────────────────────────────────────────"
echo "  PAIRING — open xauaisniper.com/admin → Cloud → Infrastructure"
echo "  Click '+ Generate Pairing Code' and paste the 6 digits below."
echo "──────────────────────────────────────────────────────────"
# Detect OS — set MOCK_MT5 default automatically
case "$(uname -s)" in
  Linux*|Darwin*)  export MOCK_MT5=1 ;;  # MetaTrader5 SDK is Windows-only
  *) export MOCK_MT5=0 ;;
esac
[ "$MOCK_MT5" = "1" ] && say "Detected non-Windows OS → MOCK_MT5=1 (verification works, real trades won't fire — use Windows VPS for live execution)"
python3 worker_agent.py &
WORKER_PID=$!
# We just want pairing to happen; the pairing prompt is interactive so let it run for ~3s after pairing
# Actually simpler: don't background — let pairing prompt block, then ctrl-c after pairing succeeds
# Revised approach: pair only, don't start the loop
kill $WORKER_PID 2>/dev/null || true
wait $WORKER_PID 2>/dev/null || true

# Use a helper script that ONLY does pairing (no loop)
python3 <<'PYEOF'
import os, sys, socket, requests
cloud = input("Cloud URL [https://xauaisniper.com]: ").strip() or "https://xauaisniper.com"
code = input("6-digit pairing code: ").strip()
if not (code.isdigit() and len(code) == 6):
    print("Bad code."); sys.exit(1)
r = requests.post(f"{cloud.rstrip('/')}/api/cloud/agent/pair",
                  json={"code": code, "hostname": socket.gethostname()}, timeout=15)
r.raise_for_status()
data = r.json()
mock = os.environ.get("MOCK_MT5", "0")
with open(".env","w") as f:
    f.write(f"CLOUD_URL={cloud}\n")
    f.write(f"CLOUD_AGENT_TOKEN={data['agent_token']}\n")
    f.write(f"WORKER_ID={data['worker_id']}\n")
    f.write("POLL_SEC=10\nHEARTBEAT_SEC=60\nEQUITY_SEC=120\nHTTP_TIMEOUT=15\n")
    f.write(f"MOCK_MT5={mock}\n")
print(f"\n[ok] Paired as worker: {data.get('worker_name')}")
PYEOF
[ -f .env ] || err "Pairing failed."
ok "Paired"

# 5. Auto-start (macOS launchd / Linux systemd-user)
PYBIN="$INSTALL_DIR/worker_agent/.venv/bin/python"
WORKER="$INSTALL_DIR/worker_agent/worker_agent.py"
case "$(uname -s)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/com.xauai.worker.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.xauai.worker</string>
  <key>ProgramArguments</key><array>
    <string>$PYBIN</string><string>$WORKER</string>
  </array>
  <key>WorkingDirectory</key><string>$INSTALL_DIR/worker_agent</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/xauai-worker.log</string>
  <key>StandardErrorPath</key><string>/tmp/xauai-worker.err</string>
</dict></plist>
PLISTEOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    ok "Auto-start installed (launchd). Logs: /tmp/xauai-worker.log"
    ;;
  Linux)
    SVC="$HOME/.config/systemd/user/xauai-worker.service"
    mkdir -p "$(dirname "$SVC")"
    cat > "$SVC" <<SVCEOF
[Unit]
Description=XauAi Cloud Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/worker_agent
ExecStart=$PYBIN $WORKER
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
SVCEOF
    systemctl --user daemon-reload
    systemctl --user enable --now xauai-worker.service
    loginctl enable-linger "$USER" 2>/dev/null || true
    ok "Auto-start installed (systemd-user). Status: systemctl --user status xauai-worker"
    ;;
esac

echo
echo "──────────────────────────────────────────────────────────"
echo "  ✅ DONE. Refresh xauaisniper.com/admin — your worker is now ONLINE."
echo "  Stop:    launchctl unload ~/Library/LaunchAgents/com.xauai.worker.plist  (mac)"
echo "           systemctl --user stop xauai-worker  (linux)"
echo "  Logs:    tail -f /tmp/xauai-worker.log"
echo "──────────────────────────────────────────────────────────"
