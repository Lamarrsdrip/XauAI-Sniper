/**
 * One source of truth for XauCloud market-intelligence freshness/retention.
 * Different concepts intentionally have different windows; callers must use
 * the named constant instead of embedding magic numbers or user-facing text.
 */
export const BROKER_QUOTE_FRESH_SECONDS = 10 * 60;
export const M10_EXPECTED_CADENCE_SECONDS = 10 * 60;
export const M10_STALE_GRACE_SECONDS = 5 * 60;
export const OUTLOOK_EVIDENCE_MAX_AGE_SECONDS = M10_EXPECTED_CADENCE_SECONDS + M10_STALE_GRACE_SECONDS;
export const MARKET_EVIDENCE_RETENTION_DAYS = 14;
export const MARKET_EVIDENCE_COLLECTION = "cloud_market_evidence";
/**
 * Longest the heartbeat/activity routes wait for downstream intelligence
 * before acknowledging the EA. MT5 WebRequest is synchronous on the EA thread
 * (InpCloudTimeoutMs defaults to 5000 ms), so Outlook/M10/hourly work beyond
 * this budget completes in the background instead of delaying the EA.
 */
export const MARKET_INTELLIGENCE_RESPONSE_BUDGET_MS = 1500;

export function outlookEvidenceStaleMessage(): string {
  const minutes = Math.round(OUTLOOK_EVIDENCE_MAX_AGE_SECONDS / 60);
  return `This account has not reported usable market evidence in the last ${minutes} minutes. The EA may still be online; check broker-quote and M10-engine health separately.`;
}
