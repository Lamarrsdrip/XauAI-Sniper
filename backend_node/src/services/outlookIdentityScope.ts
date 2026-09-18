function accountCandidates(accountInput: string): Array<string | number> {
  const account = String(accountInput ?? "").trim();
  if (!account) return [];
  const values: Array<string | number> = [account];
  const numeric = Number(account);
  // Historical Python/Mongo rows are mixed-type: some stored the MT5 login as
  // a BSON number while newer Node rows store it as a string. Treat those two
  // representations as the same account without broadening to any other ID.
  if (Number.isFinite(numeric) && Number.isSafeInteger(numeric)) values.push(numeric);
  return values;
}

function accountClause(accountInput: string): Record<string, unknown> {
  const candidates = accountCandidates(accountInput);
  if (candidates.length === 0) return { _id: { $exists: false } };
  return candidates.length === 1 ? { account: candidates[0] } : { account: { $in: candidates } };
}

/**
 * Safe read scope for Market Outlook documents across the Node migration.
 *
 * New rows are expected to carry BOTH account and license_key and must match
 * both when both are known. Older Python-era rows may legitimately have only
 * one identity field, and their MT5 account may be stored as either a BSON
 * number or a string. We allow those exact one-sided legacy rows only when the
 * other field is genuinely absent/empty. A row that contains a conflicting
 * non-empty account or license can therefore never match this scope.
 */
export function outlookReadScope(accountInput: string, licenseKeyInput: string): Record<string, unknown> {
  const account = String(accountInput ?? "").trim();
  const licenseKey = String(licenseKeyInput ?? "").trim();
  const accountMatch = accountClause(account);

  if (account && licenseKey) {
    return {
      $or: [
        { $and: [accountMatch, { license_key: licenseKey }] },
        {
          $and: [
            accountMatch,
            { $or: [{ license_key: { $exists: false } }, { license_key: null }, { license_key: "" }] },
          ],
        },
        {
          $and: [
            { license_key: licenseKey },
            { $or: [{ account: { $exists: false } }, { account: null }, { account: "" }] },
          ],
        },
      ],
    };
  }
  if (account) return accountMatch;
  if (licenseKey) return { license_key: licenseKey };
  return { _id: { $exists: false } };
}

/** Strict scope for live/event collections whose rows are created by the
 * current Node pipeline and therefore must never need legacy fallback. */
export function exactOutlookIdentityScope(accountInput: string, licenseKeyInput: string): Record<string, unknown> {
  const account = String(accountInput ?? "").trim();
  const licenseKey = String(licenseKeyInput ?? "").trim();
  const accountMatch = accountClause(account);
  if (account && licenseKey) return { $and: [accountMatch, { license_key: licenseKey }] };
  if (account) return accountMatch;
  if (licenseKey) return { license_key: licenseKey };
  return { _id: { $exists: false } };
}
