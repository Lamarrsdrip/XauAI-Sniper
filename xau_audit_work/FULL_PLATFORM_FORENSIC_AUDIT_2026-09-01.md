# XauCloud Full-Platform Forensic Audit — 2026-09-01

Scope: fresh full project snapshot at commit c1a01540, covering production Node backend, legacy Python/backend contracts, Outlook, Global Brain, admin/auth, Command Center APIs, payment/push surfaces, mobile UI, CI/release contracts, and EA/release linkage.

## Repairs applied in this audit

- Admin/customer auth hardening: access-token type/identity validation, session-version revocation for admin sessions, stricter login/MFA schemas, admin-role enforcement at login, safer client-IP handling, production JWT-secret strength enforcement, and bootstrap admin password no longer overwrites a password changed in-product on restart.
- Account/session security: sensitive account/auth mutations increment session_version so previously issued sessions are revoked rather than remaining valid.
- Push subscription isolation: deletion is scoped by authenticated user as well as endpoint, preventing one account from removing another account's subscription by knowing an endpoint.
- Outlook history/data integrity: added bounded idempotent historical repair for signal/outlook records and startup execution off the readiness-critical path; no invented outcome is created when the available history cannot prove one.
- Outlook/Global Brain safety: tightened influence/training handling around current learning buckets and signal generation, while preserving the previously repaired Global Brain core and Outlook broker-evidence rules.
- Startup/index resilience: lifecycle indexes are created independently so one legacy/duplicate index failure cannot prevent the rest of the required indexes from being created.
- Release/CI drift: stale tests are aligned to the current eight counterfactual offsets and current XauCloud-Fixed-B1 production source; customer download naming is allowed to differ from the internal artifact filename while the exact EX5 hash verification remains mandatory.
- Node runtime contract: production/CI runtime raised to Node 22 to match dependencies that require >=22 rather than silently running an unsupported Node 20 runtime.
- Mobile keyboard usability: bottom-sheet content now uses KeyboardAvoidingView + scroll behavior so forms remain visible/editable when the iOS/Android keyboard opens.
- Mobile CI: dedicated workflow added so mobile unit/type checks are not silently omitted from repository CI.

## Verification / limitations

The repository was audited statically and cross-file call paths were traced. The supplied snapshot itself contains historical/stale test families that expect old root-level EA experiment files and cannot all be treated as current production gates. In this execution environment, dependency trees were incomplete after the source archive was unpacked, so a clean end-to-end npm/pytest run could not be truthfully claimed: Node tests could not launch because local vitest/craco packages were absent; legacy Python collection also lacked runtime dependency `motor`. Those are environment/dependency-install limitations, not reported as passing tests.

A live MT5/VPS verification is still required to prove that the EX5 actually loaded on the terminal matches the manifest hash/version and that broker-side behavior corresponds to the audited source. Source audit cannot establish live binary identity by itself.
