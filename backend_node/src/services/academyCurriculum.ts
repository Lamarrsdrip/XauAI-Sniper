/**
 * Authoritative Forex Academy curriculum -- the backend's source of truth
 * for "what counts as complete," independent of anything the frontend sends.
 *
 * Mirrors frontend/src/components/cloud/CloudDashboard.jsx's FOREX_CURRICULUM
 * topic ids exactly (verified 2026-08-25: 21 topics, ids below in the same
 * order). This file intentionally does NOT duplicate the lesson content
 * (titles/body text) -- only the id list, which is all server-side
 * eligibility needs. Bumping CURRICULUM_VERSION when the required topic set
 * changes lets an already-issued certificate remain valid for the version it
 * was actually earned under (see academyCertificates.ts).
 */
export const CURRICULUM_VERSION = "v1";

export const REQUIRED_LESSON_IDS: readonly string[] = [
  "foundation", "quotes", "orders", "margin", "risk", "structure", "sr",
  "candles", "patterns", "indicators", "timeframes", "sessions", "xau",
  "strategy", "execution", "management", "psychology", "journal",
  "backtest", "prop", "xaucloud",
];

export function isKnownLessonId(id: string): boolean {
  return REQUIRED_LESSON_IDS.includes(id);
}

export function computeIsComplete(completedLessonIds: readonly string[]): boolean {
  const done = new Set(completedLessonIds);
  return REQUIRED_LESSON_IDS.every((id) => done.has(id));
}
