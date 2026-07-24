# XauCloud Deployment Staging (Mac + VPS) — Uploaded Only, Not Activated

Real deployment actions taken this session, both purely additive (new filenames,
nothing overwritten, nothing attached, nothing restarted, AutoTrading untouched).

## Files deployed

`XauCloud.mq5` / `XauCloud.ex5`, copied from the audited source/compile:
- MQ5 SHA-256: `656805f78444faf4b4fe3ffe6028ca6728d096f71bc814e844831506b3cffbe0`
- EX5 SHA-256: `948aeee5d792df440c13bf455e2f876725a832eda154fc1de9e9eb86c711a06b`
- Source commit: `61ec3814527c0c57815b7e4cbd39745b2c19d40d`

## Mac (this machine)

- Live terminal confirmed running: `terminal64.exe`, native `MetaTrader 5.app`,
  PID 34561 (running continuously throughout this session — never touched).
- Experts folder: `~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Experts` (portable-mode install, single unambiguous location).
- Backup of pre-existing top-level files: `~/Desktop/XauCloud_Backup_Mac_<timestamp>`.
- `XauCloud.mq5`/`XauCloud.ex5` copied in — hashes verified identical post-copy.
- **Not attached to any chart, not enabled for AutoTrading.** Won't appear in
  Navigator until the user manually refreshes Expert Advisors or restarts MT5 —
  MT5 doesn't hot-detect new Experts-folder files while running.

## VPS (173.212.249.202)

- Connection verified (`VMI3424536`, `vmi3424536\administrator`).
- Staged first at `C:\Users\Administrator\Desktop\XauCloud_Release\` — hashes
  verified identical to local.
- Live terminal confirmed running: PID 8752, started 2026-07-21. Journal shows
  real trading activity on account `436698921`, symbol `XAUUSDm` (broker-suffixed
  — reads as a real-money account, not the MetaQuotes-Demo account used for this
  session's replay testing).
- Experts folder (single unambiguous match):
  `C:\Users\Administrator\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075\MQL5\Experts`.
- Backup created at `C:\Users\Administrator\Desktop\XauCloud_Backup_20260724_121447`.
- `XauCloud.mq5`/`XauCloud.ex5` copied in — hashes verified identical post-copy.
- **Anomaly, unresolved**: two pre-existing `.ex5` files
  (`XAUUSD_AI_Sniper_EA_v6.25.24_FINAL_PRODUCTION_AUDIT.ex5`,
  `XAUUSD_AI_Sniper_EA_v6.25.24_REPLAY_ROOT_CONSOLIDATED_FIX.ex5`) disappeared
  from that Experts folder between two listings taken ~4 minutes apart during
  this session. Confirmed not caused by this session's script (it only ever used
  `Copy-Item`, verified by rereading the exact script executed — never
  `Remove-Item`). Something else on that VPS — most plausibly the live terminal
  itself or a scheduled task — is modifying that folder concurrently. **Needs the
  owner's direct investigation before any further VPS action.**
- **Not attached to any chart, not restarted, AutoTrading status unchanged.**

## What this does and doesn't mean

- Both machines now have the exact audited, hash-verified build available under
  the `XauCloud` filenames the owner requested.
- Neither machine is running it. Attachment/activation is a separate, deliberate
  action the owner needs to take (or explicitly direct), especially given the
  VPS's real-money account and the unresolved file-disappearance anomaly.
- This does not change the Phase 9 release-gate verdict (still RELEASE HOLD) —
  file staging isn't runtime verification. Confirming what's actually attached
  and running on both terminals (§3 of `05_live_step_packages.md`) remains open.

## Update: VPS runtime confirmed healthy (post-deployment check)

Read `MQL5\Logs\20260724.log` (the actual Experts-tab log — distinct from the
terminal-level `Logs\` journal checked earlier) directly via SSH. Findings:

- License validated for real: `BOT-MONITOR heartbeat OK account=436698921
  pin=ASE-OV8Z-AJ2J ... 'auth':'license_pin','bound':true` — backend-confirmed,
  not just a local PIN-format check.
- M10 decision authority confirmed intact despite the chart being attached on
  M5: log is full of `M10_SIGNAL_ANALYSIS`, `M10_EVIDENCE_STORED`,
  `M10_FRESHNESS` lines, exactly matching the source-level guarantee from
  `02_ea_root_audit.md` (no `Period()` usage anywhere in the EA — decisions
  never depend on the attached chart's timeframe).
- No errors; correctly returning `NO_TRADE` when setup evidence doesn't clear
  threshold (`buyCaseScore=48.4` vs `threshold=55.0`) — truthful non-trading,
  not a fault.
- Server is `Exness-MT5Trial9` — suggests a broker trial/demo account rather
  than confirmed funded real money, though this isn't independently verified
  beyond the server name.

This resolves the runtime-verification gap for the VPS. Mac verification
remains partial (attached, AutoTrading confirmed off, but the Mac's own
MQL5\Logs Experts-tab output was not separately checked this session).
