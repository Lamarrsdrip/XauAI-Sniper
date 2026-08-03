# Git Release Management (Phase 18)

## Production branch and tag

- Primary production branch: `XauCloud_m10_private_vps_ai` (origin, tracking).
- Annotated release tag: `production/xaucloud-m10-private-vps-ai-20260803`
  at commit `a518d7b`, pushed to origin.

## Discovery: ~26 of the "experimental directories" are git worktrees, not separate clones

`git worktree list` confirms nearly every `XauAI-Sniper-*` directory under
`/Users/libertyelectronics/` is a worktree of this same repository, each with
a branch checked out. This changes what "archive" safely means: deleting a
branch that backs an active worktree does not just remove a branch-list
entry, it would require `git worktree remove` — which deletes real files on
disk, potentially including uncommitted work. That is a materially bigger
and more destructive action than branch archival, and was not attempted here
without explicit confirmation.

## What was done (zero data-loss risk, verified before any deletion)

Every one of the 36 branches on this repo (12 pre-existing remote + 24
local-only) was individually checked with `git merge-base --is-ancestor`
against `origin/main` before any action:

- **16 local-only branches confirmed fully merged into `origin/main`** and
  with no worktree attached: deleted locally. Their content is 100%
  preserved in `main`'s history; nothing was lost.
- **2 local-only branches with unique, unmerged work and no worktree**
  (`experiment/v62525-full-m5-scan`, `experiment/v62526-two-m5-scan-m10-execution`):
  pushed to `origin` under `archive/<name>` before local deletion.
- **5 local-only branches with unique, unmerged work AND an active worktree**
  (`experiment/v62525-m5-tradebrain-learning`,
  `fix/flat-entry-restore-candidate-generation`,
  `research/v5850-engine-current-policy-hybrid`,
  `fix/m101-flat-entry-location-filtered`,
  `fix/m101-add-asia-nonaplus-and-resetpending-policy`): pushed to origin
  under their real names (backup only — local branch/worktree untouched, so
  the owner can keep working in them).
- **`market/mql5-standalone-edition`** (valuable pre-existing Market-edition
  work, previously local-only): pushed to origin under its real name, since
  it's being actively reused this session, not merely archived.
- All other pre-existing remote branches (merged or unique) were left
  exactly as they were — already safe on origin, no action needed.

### Correction during this work

An earlier attempt in this same session used a broken push refspec
(missing colon) to archive two branches; the archive push failed but a
subsequent `git branch -D` still ran and deleted them locally before the
bug was caught. Both were recovered immediately from the commit hash git
printed in its own deletion message (`experiment/v62525-full-m5-scan` @
`40d6909`, `experiment/v62526-two-m5-scan-m10-execution` @ `0f3ee24`),
verified, and then correctly archived. No data was actually lost, but the
near-miss is recorded here rather than omitted.

## What was deliberately NOT done — needs the owner's explicit decision

- **No worktree directories were removed and no worktree-attached branch was
  deleted.** ~24 directories under `/Users/libertyelectronics/` remain as
  live worktrees. If the owner wants actual disk space reclaimed (this is
  likely a substantial amount — many worktrees contain their own
  multi-GB `Tester/`, `audits/`, and report directories), that is a separate
  decision: `git worktree remove <path>` deletes files on disk, including
  anything uncommitted in that worktree. Recommend the owner review the list
  below and confirm which, if any, can actually be removed.
- **Remote-only unique branches were not renamed to `archive/`**
  (`opportunity-recovery-v62525`,
  `experiment/xaucloud-pure-m5-location-blocked`,
  `experiment/xaucloud-two-m5-m10-location-blocked`,
  `research/opposite-direction-forming-direct-inversion`) — each still backs
  an active local worktree, and renaming the remote ref would silently break
  that worktree's upstream-tracking display for a cosmetic-only benefit.
  Left as-is; zero data-loss risk either way since they're already on
  origin.

## Full worktree inventory (for the owner's disk-cleanup decision)

| Path | Branch | Merge status |
|---|---|---|
| XauAI-Sniper | (detached @ 6d9ae81) | old production, dirty/detached per prior handoff — not touched |
| XauAI-Sniper-ai-m10-14d-low-cost | research/ai-m10-14d-low-cost | merged into main |
| XauAI-Sniper-aligned-entry-repair | (detached @ 815bbc2) | unknown, not classified |
| XauAI-Sniper-flat-entry-fix | fix/flat-entry-restore-candidate-generation | unique, now backed up |
| XauAI-Sniper-fresh-signal-live-entry | research/fresh-signal-live-entry-intelligence | merged into main |
| XauAI-Sniper-homepage-redesign | homepage-redesign-20260725 | merged into main |
| XauAI-Sniper-hybrid-m5-evidence | research/hybrid-m5-evidence-m10-execution | merged into main |
| XauAI-Sniper-hybrid-m5scan-m10exec | experiment/xaucloud-two-m5-m10-location-blocked | unique, already on origin |
| XauAI-Sniper-increase-frequency | research/increase-valid-trade-frequency | merged into main |
| XauAI-Sniper-m10-category-blocks | experiment/xaucloud-m10-category-blocks | merged into main |
| XauAI-Sniper-m10-fixed-sl | research/opposite-direction-forming-direct-inversion | unique, already on origin |
| XauAI-Sniper-m101-flat-entry-fix | fix/m101-flat-entry-location-filtered | unique, now backed up |
| XauAI-Sniper-m101-plus-asia-policy | fix/m101-add-asia-nonaplus-and-resetpending-policy | unique, now backed up |
| XauAI-Sniper-m5-experiment | experiment/xaucloud-pure-m5-location-blocked | unique, already on origin |
| XauAI-Sniper-m5-tradebrain | experiment/v62525-m5-tradebrain-learning | unique, now backed up |
| XauAI-Sniper-market-edition-claude-xaucloud | market-edition/claude-xaucloud | active this session |
| XauAI-Sniper-opportunity-recovery-v62525 | opportunity-recovery-v62525 | unique, already on origin |
| XauAI-Sniper-pure-m10-cycle-fix | fix/pure-m10-candidate-cycle | merged into main |
| XauAI-Sniper-release-v62514-wt | release-v62514 | merged into main |
| XauAI-Sniper-smart-profit-loss-reduction | research/smart-profit-loss-reduction | merged into main |
| XauAI-Sniper-v5850-hybrid-research | research/v5850-engine-current-policy-hybrid | unique, now backed up |
| XauAI-Sniper-v62524-final-audit | final-v62524-production-20260722 | merged into main |
| XauAI-Sniper-v6257 | main | tracks main directly |
| XauAI-v625-exhaustion-m10-direction-reentry | (detached @ f6e159b) | unknown, not classified |
| XauAI-v6251-full-repair | (detached @ d4b5913) | unknown, not classified |

Everything in the "merged into main" rows is safe to remove with zero
history loss whenever the owner wants the disk space back. The "unique"
rows now all have their branch content safely backed up on origin
regardless of what happens to the local directory.
