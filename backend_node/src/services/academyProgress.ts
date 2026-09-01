/**
 * Server-authoritative Academy lesson progress. Replaces trusting the
 * frontend's localStorage-only completion state (xaucloud_edu_completed) --
 * that remains as a same-device convenience cache in the UI, but eligibility
 * for a certificate is decided ONLY from this collection.
 */
import { getDb } from "../db.js";
import { isKnownLessonId, computeIsComplete, REQUIRED_LESSON_IDS, CURRICULUM_VERSION } from "./academyCurriculum.js";

export interface AcademyProgressDoc {
  user_id: string;
  curriculum_version: string;
  completed_lesson_ids: string[];
  updated_at: string;
}

export interface AcademyProgressSummary {
  curriculum_version: string;
  completed_lesson_ids: string[];
  required_lesson_ids: readonly string[];
  completed_count: number;
  required_count: number;
  is_complete: boolean;
}

async function getOrInitProgress(userId: string): Promise<AcademyProgressDoc> {
  const db = getDb();
  const row = await db.collection("academy_progress").findOne({ user_id: userId, curriculum_version: CURRICULUM_VERSION }, { projection: { _id: 0 } });
  if (row) return row as unknown as AcademyProgressDoc;
  return { user_id: userId, curriculum_version: CURRICULUM_VERSION, completed_lesson_ids: [], updated_at: new Date().toISOString() };
}

/** Lightweight accessor used by academyCourseProgress.ts to fold v1 completions into a course's progress view without duplicating the completion record. */
export async function getCompletedLegacyLessonIds(userId: string): Promise<string[]> {
  const doc = await getOrInitProgress(userId);
  return doc.completed_lesson_ids;
}

export async function getAcademyProgress(userId: string): Promise<AcademyProgressSummary> {
  const doc = await getOrInitProgress(userId);
  return {
    curriculum_version: doc.curriculum_version,
    completed_lesson_ids: doc.completed_lesson_ids,
    required_lesson_ids: REQUIRED_LESSON_IDS,
    completed_count: doc.completed_lesson_ids.length,
    required_count: REQUIRED_LESSON_IDS.length,
    is_complete: computeIsComplete(doc.completed_lesson_ids),
  };
}

/** Idempotent: marking an already-complete lesson complete again is a no-op. Rejects an unknown lesson id rather than silently accepting frontend drift. */
export async function markLessonComplete(userId: string, lessonId: string): Promise<AcademyProgressSummary> {
  if (!isKnownLessonId(lessonId)) throw Object.assign(new Error("Unknown lesson id."), { statusCode: 400 });
  await getDb().collection("academy_progress").updateOne(
    { user_id: userId, curriculum_version: CURRICULUM_VERSION },
    { $addToSet: { completed_lesson_ids: lessonId }, $set: { updated_at: new Date().toISOString() }, $setOnInsert: { user_id: userId, curriculum_version: CURRICULUM_VERSION } },
    { upsert: true },
  );
  return getAcademyProgress(userId);
}

export async function markLessonIncomplete(userId: string, lessonId: string): Promise<AcademyProgressSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mongodb's PullOperator<Document> typing rejects an otherwise-valid $pull on a plain-string array field.
  await getDb().collection("academy_progress").updateOne(
    { user_id: userId, curriculum_version: CURRICULUM_VERSION },
    { $pull: { completed_lesson_ids: lessonId }, $set: { updated_at: new Date().toISOString() } } as any,
  );
  return getAcademyProgress(userId);
}
