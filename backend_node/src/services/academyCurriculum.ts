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

/**
 * Certificate wording describing what a given curriculum_version actually
 * covered, so a printed certificate never claims completion of topics that
 * weren't part of the version the recipient earned. Keyed by
 * CURRICULUM_VERSION; add a new entry whenever the version bumps rather than
 * editing an existing one, so already-issued certificates keep rendering
 * the description they were actually earned under.
 */
const CURRICULUM_DESCRIPTIONS: Readonly<Record<string, string>> = {
  v1: "Having completed the required XauCloud Forex Academy curriculum and assessments covering financial markets, market mechanics, risk management, price action, trading psychology, Gold/XAUUSD and trading systems.",
  // 2026-08-26 Academy expansion: per-course certificates use the
  // "course:<courseId>" key convention -- see academyCourseCertificates.ts.
  "course:xauusd-masterclass": "Having completed the XauCloud Gold / XAUUSD Masterclass, covering gold market structure and sessions, the macro and real-yield drivers of gold price action, practical intraday and swing trading approaches, and gold-specific risk management -- including all module quizzes and the course final assessment.",
};

export function curriculumDescription(version: string): string {
  return CURRICULUM_DESCRIPTIONS[version] ?? CURRICULUM_DESCRIPTIONS["v1"]!;
}
