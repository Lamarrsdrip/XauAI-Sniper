# XauCloud Production Branch Promotion (Phase 16)

## CORRECTION — original promotion used the wrong lineage

This document originally promoted `promotion/xaucloud-m10-approved-main`
(commit `9d99ee9`, the Asia-A+-only v6.25.30 line) to
`XauCloud_m10_private_vps_ai` and pushed it to `origin`. That was wrong and
has been undone (branch deleted, both local and remote, and recreated per
below) before any downstream work depended on it. The owner clarified the
actual replay-approved build is the **private-VPS-AI-relay line on `main`**,
not the Asia-A+-only line. This correction follows the same disclose-not-hide
convention as `13_CORRECTION_synthetic_vs_real_tick_data.md`.

## Decision

Owner-approved: the build on `origin/main` at commit
`8498c47eefec0e3cba71ec0c3bb5967feb0de096` ("Fix local Model 4 inference
timeout chain") is the exact build the owner personally replayed and
approved. It sits on top of the `83a6c3c` merge, "Add private VPS AI relay
for customer pure-M10 EAs" ("Keeps deterministic fallback and private
loopback model ports"), which added a local/on-VPS LLM (Qwen3 0.6B) relay
under `audits/local_ai_m10_14d/` with its own compile logs, benchmark data,
and real Strategy Tester HTML replay reports
(`LOCAL_AI_M10_14D_COLLECT_NO_OWNER.htm`, `..._WITH_OWNER.htm`). This is now
the authoritative production version and the base of the primary branch.

## What changed

- Branch `XauCloud_m10_private_vps_ai` created at commit `8498c47` (same tree
  as `origin/main` at creation — zero code delta). This is the internal
  codename and primary development branch going forward.
- `backend/ea_releases/manifest.json`: added `internal_codename`,
  `production_branch`, `production_branch_source_commit` (`8498c47...`),
  `website_product_name` ("XauCloud"), `mt5_market_product_name` ("Claude
  XauCloud"). No existing keys modified. Note: `current_version` is still
  `v6.25.30` in this file even though a `main` commit message says "publish
  XauCloud-m10 v6.25.31 as current release" — that release was never
  actually written into the manifest's `releases` map (checked: no `v6.25.31`
  key exists). Flagged, not silently fixed — the owner should confirm whether
  a real v6.25.31 manifest entry (with a real compiled EX5 hash) is still
  needed, or whether the private-VPS-AI-relay work supersedes that version
  number entirely.
- `README.md`: title changed from "XauAI Sniper" to "XauCloud (internal
  codename: XauCloud_m10_private_vps_ai)", pointing at this document.

## What was deliberately NOT renamed (consistent with `03_rebrand_ledger.md`)

Same reasoning as Phase 5: filenames under `backend/ea_code/` and
`backend/ea_releases/`, the `_get_ea_meta()` lookup prefix, EA-generated
telemetry file prefixes, order-comment prefixes, internal macro names
(`XAUAI_EA_VERSION`, `XAUAI_BUILD_HASH`), and the `xauaisniper.com` domain
are all unchanged.

## Not yet done at this checkpoint

- The independent compile re-verification from the original (now-deleted)
  promotion attempt was against the WRONG source and has been discarded —
  needs to be redone against this branch's actual `XAUUSD_AI_Sniper_EA.mq5`
  (which differs by roughly +502 lines from the Asia-A+-only line due to the
  AI-relay work).
- Experimental branches/worktrees have not yet been archived.
- The Market-compliance fork ("Claude XauCloud") work started against the
  wrong base and needs to be redone against this corrected branch.
- The "genuine gaps" identified in the earlier audit-synthesis pass (VPS AI
  backend / local AI service coverage, preservation mode, margin
  emergency-close, log rotation, memory/CPU measurement, restart-recovery
  live evidence) were derived from the Asia-A+-only line's docs and need to
  be re-checked against this branch — the local-AI-relay work in particular
  makes "VPS AI backend / local AI service" the single most relevant gap to
  close first, since that's exactly what changed here.
