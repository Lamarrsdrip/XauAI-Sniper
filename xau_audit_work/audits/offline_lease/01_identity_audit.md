# Offline Lease — Phase 1: Root and Production Identity Audit

## Repository / branch state at task start

- Repo root: `/Users/libertyelectronics/XauAI-Sniper-m10-fixed-sl` (`Lamarrsdrip/XauAI-Sniper`).
- `git status` at task start: clean except two pre-existing untracked items left by
  unrelated, still-open work threads in this same session — preserved untouched:
  - `audits/xaucloud/015r_extension_experiment/` (extension-rule test artifact, task #27-30 thread)
  - `release_staging/` (a stale `XauCloud.ex5`/`.mq5` pair — hash-matches **v6.25.24**,
    not the current v6.25.28, so this is leftover from an earlier release stage, not
    live deployment material)
- Starting branch: `fix/performance-forward-reset` @ `13c447d` (== `origin/main` @ time
  of fetch — the performance-reset branch from the prior task, already pushed).
- `git fetch origin` → `origin/main` = `13c447d` (no divergence).
- Created `feature/xaucloud-bounded-offline-lease` off this commit. No force-push used;
  none planned.

## Active release identity

`backend/ea_releases/manifest.json`:
- `current_version`: **v6.25.28**
- `source_commit`: `dca5f1e86f81cd1583a99f9eb8c047adac562066`
- `ex5_sha256` (isolated-sandbox compile, per manifest): `68a710374868da4b8b1ff6f41d124bc3ef56b1ff575b3a90d239b7ac107600dc`
- `customer_filename`: `XauCloud.ex5`
- Manifest's own deployment note: *"deployed to owner's Mac and VPS Experts folders,
  both hash-verified 68a71037... -- not attached to any chart"* (written by a prior
  session, not verified fresh in this task).

## Hash verification performed this session

| Artifact | SHA-256 | Result |
|---|---|---|
| Root `XAUUSD_AI_Sniper_EA.mq5` | `cf4f4f6eed22acc0c622a56185b617b8e6e347340fadfd4ab4dbaaa5af6219e5` | matches |
| `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` | `cf4f4f6eed22acc0c622a56185b617b8e6e347340fadfd4ab4dbaaa5af6219e5` | **matches root — identical** |
| Mac Experts folder `XauCloud1.mq5` (top-level, not a backup subfolder) | byte-diff against `backend/ea_code` source | **0 differences — identical source present on Mac** |
| Mac Experts folder `XauCloud1.ex5` (compiled, sits beside the matching source above) | `96d90c63a8c513cf95270b1d2dda88dca4f31bf7d5a2ab16e73cf704b0a91ed2` | **does NOT match manifest's `68a71037...`** |
| Mac `XauCloud_Backup_20260724_201123/XauCloud.mq5` | diffed against current source | **is actually v6.25.25 source** (missing the v6.25.28 `InpExtensionFloor015REnabled`/`InpExtension70PctRatchetEnabled` input group and `R_EXIT_STATE_SCHEMA_VERSION 7`) — its folder name's timestamp coincides with the v6.25.28 build time but it is a different, older backup, not the current release |
| `release_staging/XauCloud.ex5` | `948aeee5d792df440c13bf455e2f876725a832eda154fc1de9e9eb86c711a06b` | matches **v6.25.24**, not current |
| `XauCloud_Market_Edition.ex5`/`.mq5` (Mac Experts) | n/a | different product entirely (the standalone MQL5 Market submission built in an earlier task) — not in scope |
| VPS Experts folder copy | **not checked** | **no SSH/remote access configured in this environment** (`~/.ssh/config` has no host entries) — cannot be verified from this session, same limitation documented in every prior task this session |
| Which MT5 chart(s) have an EA attached, and to which compiled binary | **not determinable** | `.chr` chart-profile files were inspected (`strings` search across all 8 "Default" profile charts) and contain no readable EA-name references in this binary format; MT5 does not expose "attached expert per chart" through any file this session can parse without the live GUI |

## Conclusion — what is proven vs. not

**Proven:** The exact v6.25.28 **source** (byte-identical to `backend/ea_code` and to
the repo root) is present on the Mac, in the live Experts folder (`XauCloud1.mq5`),
not just in a backup subfolder.

**Not proven, and explicitly flagged rather than assumed:**
1. The **compiled** `.ex5` sitting next to that source on the Mac does not hash-match
   the manifest's recorded build. This is consistent with MetaEditor producing a
   non-byte-reproducible binary on a second compile of identical source (common —
   compile timestamps/paths get embedded), but it could also mean a stale binary is
   sitting there. Only a fresh, owner-run MetaEditor compile + hash comparison, or
   the owner directly confirming which `.ex5` a chart has loaded, can resolve this.
2. **VPS state is entirely unverified this session** — no remote access exists here.
3. **Whether any chart on Mac or VPS currently has an EA attached at all**, and if so
   which build, cannot be determined from static files. Per the task's own explicit
   instruction, this is not assumed either way.

This does not block the offline-lease implementation work itself (Phases 2 onward),
which is source-level engineering. It does mean: **before any live/production
activation of the lease system, the owner must independently confirm, from the live
MT5 terminal UI on both Mac and VPS, exactly which compiled EA is attached to which
chart** — this cannot be done from this session and is carried forward as an explicit
remaining manual step in the final report.
