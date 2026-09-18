/**
 * Safe read scope for Market Outlook documents across the Node migration.
 *
 * New rows are expected to carry BOTH account and license_key and must match
 * both when both are known.  Older Python-era rows may legitimately have only
 * one identity field.  We allow those one-sided legacy rows only when the
 * other field is genuinely absent/empty.  A row that contains a conflicting
 * non-empty account or license can therefore never match this scope.
 */
export function outlookReadScope(accountInput: string, licenseKeyInput: string): Record<string, unknown> {
  const account = String(accountInput ?? "").trim();
  const licenseKey = String(licenseKeyInput ?? "").trim();

  if (account && licenseKey) {
    return {
      $or: [
        { account, license_key: licenseKey },
        {
          $and: [
            { account },
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
  if (account) return { account };
  if (licenseKey) return { license_key: licenseKey };
  return { _id: { $exists: false } };
}

/** Strict scope for live/event collections whose rows are created by the
 * current Node pipeline and therefore must never need legacy fallback. */
export function exactOutlookIdentityScope(accountInput: string, licenseKeyInput: string): Record<string, unknown> {
  const account = String(accountInput ?? "").trim();
  const licenseKey = String(licenseKeyInput ?? "").trim();
  if (account && licenseKey) return { account, license_key: licenseKey };
  if (account) return { account };
  if (licenseKey) return { license_key: licenseKey };
  return { _id: { $exists: false } };
}
