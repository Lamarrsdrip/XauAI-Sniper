# XauAi Cloud — Worker Agent

A headless Python agent that runs on a Windows VPS and mirrors **master EA
signals** into every subscriber's MetaTrader 5 terminal, lot-sized to their
individual balance + risk tier.

```
  Master EA (your PC / master VPS)
        │   POST /cloud/master/signal   on every open
        │   POST /cloud/master/signal-close on every close
        ▼
  XauAi Cloud Backend  ───── fanout ─────►  Worker Agent (this script)
                                                 │
                                                 ├── subscriber A → mt5.order_send(...)
                                                 ├── subscriber B → mt5.order_send(...)
                                                 └── subscriber N → mt5.order_send(...)
```

---

## Prerequisites

- **Windows Server VPS** (Windows 10/11 or Server 2019/2022)
- **Python 3.10+** installed
- **MetaTrader 5** terminal installed (the Python package talks to the installed terminal)
- Outbound HTTPS to your backend (port 443)
- The **agent token** from `/admin → Cloud → Infrastructure → Rotate Token`
- A registered **worker_id** (add this VPS under `/admin → Cloud → Infrastructure → Add Worker`)

## Install

```powershell
git clone <your-repo>              # or just copy the worker_agent/ folder
cd worker_agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.env .env
notepad .env                       # fill CLOUD_URL / CLOUD_AGENT_TOKEN / WORKER_ID
python worker_agent.py
```

You should see:
```
XauAi Worker Agent 1.0.0 starting — worker_id=... mock=False ...
users synced: 0 active
```

## Dry-run without MT5 (macOS / Linux / any dev machine)

```bash
cd worker_agent
pip install -r requirements.txt   # MetaTrader5 is skipped on non-Windows
cp config.example.env .env
# set MOCK_MT5=1 in .env
python worker_agent.py
```

Every `order_send` / `close_position` call is logged but not executed.
Use this to verify the backend end-to-end before renting the VPS.

## Run 24/7 on Windows (NSSM = easiest)

1. Download NSSM (`nssm.cc`).
2. `nssm install XauAiWorker`
3. Set **Path** → `C:\path\to\worker_agent\.venv\Scripts\python.exe`
4. Set **Arguments** → `worker_agent.py`
5. Set **Startup directory** → `C:\path\to\worker_agent`
6. I/O tab → redirect stdout/stderr to `worker.log`
7. `nssm start XauAiWorker`

The service will auto-restart if the agent crashes and survives reboots.

## What the agent does

| Every | Action |
|-------|--------|
| 10 s  | `GET /api/cloud/agent/pending-signals?since=T` → execute new opens/closes |
| 30 s  | `GET /api/cloud/agent/pending-users` → refresh credentials, log in missing users |
| 60 s  | `POST /api/cloud/agent/heartbeat` → admin panel shows this worker online |
| 120 s | `POST /api/cloud/agent/equity-snapshot` per user → live balance/equity shown on user dashboards |
| on close | `POST /api/cloud/agent/trade-close` → trade appears in user's history with P/L |

## Troubleshooting

- **`MT5 login FAIL`** — the MT5 terminal must be installed and running on the VPS,
  and the broker's server name must match exactly (e.g. `Exness-MT5Trial9`).
- **`heartbeat failed: 403`** — agent token rotated in admin panel. Update `.env`.
- **`heartbeat failed: 404`** — worker_id not registered. Add it in admin panel.
- **Signals not firing** — confirm master EA dashboard shows `CLOUD: ON` and
  `/admin → Cloud → Infrastructure` shows `master_ea_status: online`.
