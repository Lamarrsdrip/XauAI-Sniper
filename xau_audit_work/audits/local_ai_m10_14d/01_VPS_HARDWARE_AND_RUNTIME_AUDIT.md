# XauCloud pure-M10 local AI — VPS audit and runtime evidence

Date: 2026-08-02
Branch: `research/ai-m10-14d-low-cost`

## Safety status

- The production EA was not replaced or attached to a chart.
- No firewall rule was created.
- Runtime and gateway listen only on `127.0.0.1`.
- No Emergent/OpenAI/Anthropic call was made. Measured paid-AI spend: **$0.00**.
- The Emergent key pasted into chat was not copied into source, Git, scripts,
  process arguments, environment variables, logs, or the VPS.

## Hardware and operating system

| Item | Measured result |
|---|---|
| Windows | Windows Server 2022 Datacenter, build 20348 |
| CPU | AMD EPYC Processor (with IBPB), 4 cores / 4 logical processors, 2.795 GHz max |
| RAM | 7.99 GB total; 4.47–4.59 GB free before model installation |
| GPU | Microsoft Basic Display Adapter; no usable compute GPU or VRAM |
| Disk | C: 149.66 GB total; 94.66 GB free before model download |
| Hypervisor | Hypervisor reported present; Hyper-V, VirtualMachinePlatform and WSL optional features disabled |
| Provider nested-virtualization policy | Not independently available from the VPS; native Windows runtime avoids depending on it |
| Python | Python 3.13 present |
| Node.js | Present through an existing application runtime |
| Docker | Not installed |
| Ollama | Not installed |
| WSL | Executable present, feature not enabled |

## Existing load and services

Six idle samples before installation showed total system CPU between 0% and
10%, about 4.47 GB free RAM, and two `terminal64.exe` processes using about
124.5 MB combined working set. The actively loaded terminal's cumulative CPU
counter barely changed during the 16-second baseline sample.

Existing listeners included Windows management/RDP/SMB/OpenSSH, the existing
Caddy/Node application stack, and MT5's loopback listener. No pre-existing
Ollama, llama.cpp, local model, MongoDB, or Python backend service was found.

## Runtime decision

Selected: pinned native **llama.cpp b10229** (`c745be2a2`), Windows CPU x64.

Reasons:

- Native Windows; no WSL2, Docker, nested virtualization, or interactive GUI.
- Exact limits for CPU threads, context, parallel slots, batch size and bind address.
- Smaller service footprint than installing an unused GPU-oriented bundle.
- Structured JSON schema support through the OpenAI-compatible local endpoint.

The VPS had a 2016 Microsoft C++ runtime which caused the current llama.cpp
binary to fail inside `MSVCP140.dll`. The authenticode-valid Microsoft x64
redistributable was installed; `MSVCP140.dll` is now 14.44.35211.0. No reboot
was pending and llama.cpp then reported version 10229 successfully.

Runtime checksum:

- `llama-b10229-bin-win-cpu-x64.zip`:
  `142d927c697e9b518c2834b8faecde0a1a8c09acbcf9da62057947c99d2b19c0`

## Model comparison

Both files came from the official Qwen GGUF repositories and were verified
before activation.

| Model | File size | SHA-256 | Working RAM | Test | Result |
|---|---:|---|---:|---|---|
| Qwen3 0.6B Q8_0 | 639,446,688 bytes | `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031` | ~0.90 GB idle; ~1.23 GB observed under inference | 20 cases | 100% strict-JSON validity, 0 timeouts, 14.30 s average, 15.61 s p95; 4/20 cleared 70% confidence |
| Qwen3 1.7B Q8_0 | 1,834,426,016 bytes | `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a` | ~2.03 GB idle | bounded 5-case probe | 5/5 exceeded 20 s, 0 usable decisions; only ~2.44 GB RAM remained |

Selected model: **Qwen3 0.6B Q8_0**. The 1.7B model was rejected because it
failed the timeout and consumed too much of an 8 GB trading VPS's headroom.

The 0.6B model's low confidence is not silently promoted. The configured 70%
threshold made 16/20 benchmark opinions deterministic fallbacks. This is the
requested behavior and prevents a tiny model from over-controlling the EA.

The final prompt/cache contract is `xaucloud-local-ai-v4`. Its fresh ten-case
VPS acceptance run returned 10/10 strict decisions, zero timeouts, 13.08 s
average wall time and 14.18 s p95. Eight of ten were below 70% and therefore
used deterministic fallback. Two logically contradictory but schema-valid
model outputs found during rejected v2/v3 trials (`candidate_allowed=true`
with setup `NONE`) led to an explicit fail-closed normalizer. It can only turn
that contradiction into `candidate_allowed=false`; it can never promote a
candidate. Prompt/schema versions v2 and v3 were rejected before replay-cache
generation and cannot collide with v4 signatures.

## Resource limits

- 2 generation threads and 2 prompt threads on a 4-vCPU host.
- Below-normal process priority.
- 2,048-token context.
- One model slot / one inference at a time.
- 128 logical batch and 64 physical micro-batch.
- No request queue behind the active inference.
- Gateway pre-call guard: skip above 70% system CPU or below 2 GB free RAM.
- 20-second model timeout.
- MT5-facing submit/poll timeout: 1 second maximum.
- Deterministic fallback on overload, timeout, malformed JSON, stopped
  service, missing cache entry, or queue contention.

During inference, observed total CPU was about 55–59% and free RAM was about
3.34 GB. The model runs at below-normal priority; MT5 and Windows retain
scheduler priority. A real asynchronous smoke test returned the MT5-facing
submit response in **41.08 ms**, completed inference off-thread, and later
returned a schema-valid decision with 74% confidence.

## Endpoints and persistence

- Runtime: `http://127.0.0.1:11434`
- Gateway: `http://127.0.0.1:8765`
- Health: `/api/local-ai/health`
- Model metadata: `/api/local-ai/models`
- Statistics: `/api/local-ai/stats`
- Non-blocking submit: `/api/local-ai/submit`
- Cached result poll: `/api/local-ai/result?signature=...`
- Persistent cache: `C:\XauCloudLocalAI\cache\decisions.sqlite3` (SQLite WAL)
- Logs: `C:\XauCloudLocalAI\logs\runtime.log` and `gateway.log`

The signature includes the closed M10 timestamp, both directional scores,
direction, setup, grade, session, regime, location, momentum, structure,
reward/room, open-position state, allowed existing setup families, model name,
and prompt/schema version.

## Autostart

Two Windows Scheduled Tasks run as `SYSTEM` at boot without interactive login:

1. `XauCloudLocalAI_Runtime`
2. `XauCloudLocalAI_Gateway` (20-second delayed start)

Both have restart-on-failure settings and were manually stopped/restarted to
verify recovery. Both returned `Running`; runtime and gateway health returned
green afterward. A full VPS reboot was intentionally not performed while MT5
was active, so boot-trigger verification is configuration-level plus manual
task restart, not a production reboot claim.

## EA build evidence

- `XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS`: 0 errors, 0 warnings, 35,643 ms;
  EX5 SHA-256 `069af44e7bbd1f5966f170757ca2cff51220d41b1d35b6a5668e13fce038a7a5`.
- `XauCloud_M10_LOCAL_AI_NO_OWNER_BLOCKERS`: 0 errors, 0 warnings, 37,056 ms;
  EX5 SHA-256 `716caa8d5dfd379e1c618e763c8277b8282dadf5b260f7aa2f0079c5a5d360c0`.

The EAs were compiled in the isolated research directory on the VPS and were
not copied into the live Experts folder or attached to a chart.

The local-AI path is pure M10. It submits the one closed-M10 deterministic
snapshot asynchronously, uses only existing setup-family names, ignores local
confidence below 70%, reuses a persistent cache, and cannot bypass owner,
normal, broker, margin, risk, SL, exit, or order-send protections.

## Replay evidence gate

The fixed 14-day Model=4 collection passes are complete; see
`02_IMPLEMENTATION_AND_REPLAY_STATUS.md`. The final shared-cache A/B passes
and unseen holdout remain mandatory before any experimental EA is attached to
a trading chart. The current production EA remains untouched.
