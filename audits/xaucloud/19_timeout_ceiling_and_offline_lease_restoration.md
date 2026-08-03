# Two Owner-Directed Fixes: AI Submit Timeout Ceiling + Offline Lease Restoration (Phase 19)

Both fixes were scoped to touch only what the owner asked. Neither changes
signal generation, risk, lot sizing, SL, exits, permanent blocks, or
owner-location blocks — confirmed by diff review (only the described lines
changed) and by every affected input/parameter defaulting to today's
behavior (`InpOfflineLeaseEnabled=false`, so the lease path never engages
unless explicitly turned on).

## 1. AI submit-timeout hard ceiling

`XAU_LocalAISubmitM10()`'s WebRequest call used
`MathMax(100,InpLocalAISubmitTimeoutMs)` — a floor only. Its sibling
`XAU_LocalAIPollM10()` (two call sites) already used
`MathMax(100,MathMin(1000,InpLocalAISubmitTimeoutMs))` — floor AND a
hard 1-second ceiling. A misconfigured `InpLocalAISubmitTimeoutMs` could
therefore add unbounded latency to the submit call specifically, even
though the design intent (and the poll call) caps it at 1s.

**Fix:** submit now uses the identical `MathMax(100,MathMin(1000,...))`
clamp as poll. One-line change, applied identically to all three source
copies that must stay byte-identical: `XAUUSD_AI_Sniper_EA.mq5`,
`backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`, and the
`research/local_ai_m10/XauCloud_M10_LOCAL_AI_WITH_OWNER_BLOCKERS.mq5` /
`..._NO_OWNER_BLOCKERS.mq5` research variants.

**Test:** `tests/test_xau_local_ai_m10_research.py::test_submit_timeout_has_same_hard_ceiling_as_poll_timeout`
(new) — asserts the ceiling clamp is present at the submit call site in the
canonical EA and both research variants, and asserts the old floor-only
form is gone. Passing, along with the other 10 tests in that file.

## 2. Bounded offline trading lease — restored from the last proven-safe implementation

The diff-reconciliation audit found this branch (private-VPS-AI-relay
lineage) was missing the offline-lease fallback that exists on the other
lineage (`promotion/xaucloud-m10-approved-main`). Rather than redesign it,
this restoration replicates the exact, already-proven integration from
commits `4f7fc4f` (Phase 12-14, the real EA choke-point wiring) and
`72d0716` (Phase 15, reconciliation upload), verified hunk-by-hunk against
`git show` of those commits before applying. The EA-side crypto/lease
library (`lease/XauCloudLeaseClient.mqh` and its two dependencies) and the
backend lease service (`backend/lease_service.py`) were never removed from
this branch — only the `.mq5` integration was missing, which is what this
restores.

**What changed** (all in `XAUUSD_AI_Sniper_EA.mq5`, mirrored to
`backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` and the local-AI research
variants):

- Re-added `#include "lease/XauCloudLeaseClient.mqh"` and the
  `InpOfflineLeaseEnabled` input (**default false** — zero behavior change
  unless the owner explicitly turns it on).
- `XAU_ClaimDirectionReservation()` gains a strict failure classification
  out-param (`ENUM_XAU_LEASE_FAILURE_CLASS`) so callers can tell a genuine
  "backend didn't answer" from an explicit deny/auth/validation failure —
  same WebRequest call, same existing behavior for every explicit response.
- `XAU_CanOpenDirection()` gains one new defaulted parameter,
  `allowOfflineFallback = false`. PYRAMID and COUNTER_EXCURSION call sites
  never pass it, so they are byte-unchanged. Only when true AND
  `InpOfflineLeaseEnabled` AND the failure classification genuinely means
  "temporary, not a denial" does it consult a valid signed offline lease
  instead of blocking outright.
- `OpenTrade()`: a new `xauLeaseIsGenuineCoreEntry` check (excludes
  `RE_ENTRY_FRESH_SETUP:` and manual/force overrides — offline execution
  authority is scoped to genuine, fully-automated CORE candidates only)
  feeds that parameter. The offline allowance is consumed, and the event
  durably queued for backend reconciliation, **only after the real broker
  retcode is known to be accepted** (confirmed or ambiguous) — never for
  merely attempting the send, never on a definitive rejection.
- `OnTimer()`: uploads any queued offline-executed events once the backend
  is reachable again, rate-limited to once per minute, never inside
  Strategy Tester.

**Time-limited, signed, account-bound, fail-closed** — all four properties
come from the untouched lease library, not new code written this session:
the lease itself carries a signed expiry (`XauCloudLeaseClient.mqh`,
unchanged), is scoped to the specific account/server/symbol at issue time
(`XAU_LeaseTryAuthorizeOffline`'s parameters), and every failure path in
the restored integration (invalid/expired lease, mutex unavailable,
`InpOfflineLeaseEnabled=false`, non-qualifying failure class, non-CORE
candidate) falls through to the original hard block — there is no new path
that authorizes a trade the old, un-restored code would have allowed to
block.

**Compile:** `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5` (same directory as
the real `lease/` folder), MetaEditor64.exe via Wine: **0 errors, 0
warnings, 49,263 ms elapsed.** Binary copied back to root
(`XAUUSD_AI_Sniper_EA.ex5`, SHA-256 `34f1f532f0a158686f0e5cb9d90ad68dfaf1c9dcc0809a587e50ee6072c8db7b`).

**Tests:** updated `tests/test_xau_v6250_direction_exclusivity.py`'s
`test_five_arg_overload_claims_reservation_and_rechecks_after_claim` to
match the new (legitimately changed) 6-argument signature and the new
3-argument `XAU_ClaimDirectionReservation` call — the only test in the
repo whose assertion was an exact function-signature string match against
what this restoration intentionally changed.

Ran every test file that references `XAU_CanOpenDirection`,
`XAU_ClaimDirectionReservation`, or `OpenTrade`, plus the rebrand-safety
suite: **99 passed, 7 failed.** Verified via `git stash` (reverting to the
pre-restoration tree and re-running the same 7) that **all 7 failures are
pre-existing** — stale version-pinned assertions referencing old build
strings (`v6.25.24`, `v6256-m30-exhaustion-scope-fix`) and one unrelated
pyramid-comment-window brittleness, all present identically with this
session's changes removed. None of the 7 reference the lease/timeout code.
Zero new regressions introduced.

`backend/tests/test_offline_lease.py` (the backend-side lease service
tests) could not be run in this environment — `ModuleNotFoundError: No
module named 'cryptography'`, a pre-existing environment gap (that
dependency was never touched this session, and `backend/lease_service.py`
itself was not modified).

## Not done — explicitly deferred pending the owner

Nothing was attached to a live chart, deployed to the Mac terminal, or
deployed to the VPS. Both features remain off by default
(`InpOfflineLeaseEnabled=false`, and the AI-submit fix is a pure safety
clamp with no behavior change at the default 1000ms input). Per the audit's
prior recommendation, the private-VPS-AI-relay's 30-day comparison replay
is still unfinished — attaching this build to a live account should wait
for that, independent of these two fixes.
