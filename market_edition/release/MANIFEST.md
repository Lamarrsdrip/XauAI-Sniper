# Release Manifest — XauCloud v1.00

## Contents

- `XauCloud.mq5` — full source
- `XauCloud.ex5` — compiled binary
- `docs/` — the full documentation package (README, installation,
  strategy overview, risk disclosure, symbol compatibility, known
  limitations, changelog, inputs reference, FAQ, support)

## Identity

- Product name: XauCloud
- Version: `1.00` (independent of the source cloud product's own internal
  version numbering)
- Magic number: `26080301`
- Copyright: XauCloud
- Source path: `market_edition/XauCloud.mq5`
  (repository: `XauAI-Sniper-market-edition-claude-xaucloud`, branch
  `market-edition/claude-xaucloud`)

## Verification hashes (this release)

- Source SHA-256: `186fd45a0e2d0e739e78405de90de85b355b3e6e6a8abbbf45254a6189d8846f`
- Compiled `.ex5` SHA-256: `2caa126e5023eddad481e373504ee57e7df6b56a88520f108296b37b2d60ce2c`

Both hashes are copied from
`audits/xaucloud/17_market_edition_claude_xaucloud.md` (this release's
compile record) and re-verified against the files in this `release/`
folder at doc-package-write time. If you recompile from source yourself,
the source hash is the durable identity check — a rebuilt `.ex5` hash can
shift with compiler/build-environment differences even from identical
source.

## What this release is

- A standalone fork of the cloud-connected "XauCloud" production EA, with
  every AI/LLM call, cloud backend dependency, and remote-control surface
  removed. See `docs/CHANGELOG.md` and
  `audits/xaucloud/17_market_edition_claude_xaucloud.md` for the full
  removal record.
- Compiled clean: 0 errors, 0 warnings (MetaEditor64, isolated Wine
  sandbox toolchain, per the audit record above).
- Static network-surface sweep on the final compiled source:
  `WebRequest` → 0, `#import` → 0, `ShellExecute` → 0, `.dll`/`dllcall` →
  0.

## What this release is not

- Not merged into `main`, `XauCloud_m10_private_vps_ai`, or
  `market/mql5-standalone-edition` — this work lives entirely on
  `market-edition/claude-xaucloud`.
- Not pushed to `origin`.
- Not deployed to any live or demo terminal beyond the isolated compile
  sandbox used for verification.
- Not submitted to the MQL5 Marketplace — that step is the owner's own
  action to take when ready.
- Not yet validated with a dedicated Strategy Tester run against this
  exact compiled build — see `docs/KNOWN_LIMITATIONS.md`.

## Items flagged for the owner before submission

1. `InpMagicNumber` default (`26080301`) was chosen to be obviously
   distinct from the cloud product's `20250401`, but has not been
   cross-checked against every other magic number this codebase's many
   research branches have ever allocated. Verify uniqueness before
   submission.
2. No Strategy Tester run has been performed against this exact build.
   Recommend a controlled real-tick pass before submission.
3. Inert legacy inputs (former cloud/AI URL, token, and toggle fields)
   remain visible in the input panel — cosmetic, not a compliance issue,
   but worth a cleanup pass before a public listing. See
   `docs/KNOWN_LIMITATIONS.md` and `docs/INPUTS_REFERENCE.md`.
4. `docs/SUPPORT.md` contains placeholder contact fields
   (`[SUPPORT_EMAIL]`, `[MARKET_LISTING_URL]`) that need the owner's real
   support channel before this doc package is distributed.

## Full audit trail

`audits/xaucloud/17_market_edition_claude_xaucloud.md` in the repository
root — the complete record of what was stripped/kept and why (the
AI-relay, cloud telemetry, copy-trading fanout, kill-switch, PIN-licensing
removal, and the cross-instance-lock behavior change), the compile
history, and the flagged/uncertain decisions for the owner to review.
