# Rollback instructions

No MT5 terminal, VPS, chart or live account was modified by this repair.

## Before commit

Restore the frozen files from `audit/aligned-entry-repair/rollback/pre-change/`, or remove this isolated worktree. The original dirty experiment checkout was not modified.

## After a future commit

1. Create a new rollback branch from the production branch.
2. Revert the v6.24.0 repair commit with `git revert <commit>`; do not force-push.
3. Recompile the restored source in MetaEditor and require 0 errors and 0 warnings.
4. Verify the restored MQ5 and EX5 hashes against the frozen baseline recorded in `PRE_CHANGE_BLOCKER_PLAN.md`.
5. Deploy only through the separate approved deployment procedure; this task intentionally performs no deployment.

Frozen baseline source SHA-256: `a351a2f361c1ac2a3f977fbb7577ddc5f9e1c066ae83d28e114bcf853fcf150d`.
