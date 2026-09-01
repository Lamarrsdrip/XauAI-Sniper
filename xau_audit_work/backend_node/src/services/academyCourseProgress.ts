/**
 * Server-authoritative progress + quiz grading for the new course catalog
 * (academyCatalog.ts). Deliberately separate collections from the original
 * v1 curriculum (academy_progress/academy_certificates in academyProgress.ts
 * /academyCertificates.ts) -- that system is completely untouched by this
 * file, so existing learner progress and issued certificates can never be
 * affected by anything here, and there is zero migration risk.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { findCourse, findLesson, findQuiz, courseLessonIds, courseQuizIds, ACADEMY_COURSES, type Course } from "./academyCatalog.js";
import { isKnownLessonId } from "./academyCurriculum.js";
import { getCompletedLegacyLessonIds, markLessonComplete, markLessonIncomplete } from "./academyProgress.js";

export interface CourseProgressDoc {
  user_id: string;
  course_id: string;
  completed_lesson_ids: string[];
  updated_at: string;
}

export interface QuizAttemptDoc {
  id: string;
  user_id: string;
  course_id: string;
  quiz_id: string;
  attempt_number: number;
  score_pct: number;
  passed: boolean;
  answers: Record<string, string[]>;
  created_at: string;
}

async function getOrInitProgress(userId: string, courseId: string): Promise<CourseProgressDoc> {
  const db = getDb();
  const row = await db.collection("academy_course_progress").findOne({ user_id: userId, course_id: courseId }, { projection: { _id: 0 } });
  if (row) return row as unknown as CourseProgressDoc;
  return { user_id: userId, course_id: courseId, completed_lesson_ids: [], updated_at: new Date().toISOString() };
}

async function bestQuizAttempt(userId: string, quizId: string): Promise<QuizAttemptDoc | null> {
  const db = getDb();
  const rows = await db.collection("academy_quiz_attempts")
    .find({ user_id: userId, quiz_id: quizId }, { projection: { _id: 0 } })
    .sort({ score_pct: -1, attempt_number: -1 })
    .limit(1)
    .toArray();
  return (rows[0] as unknown as QuizAttemptDoc) ?? null;
}

export interface ModuleProgressView {
  module_id: string;
  title: string;
  lesson_count: number;
  completed_lesson_count: number;
  lessons_complete: boolean;
  quiz_id: string | null;
  quiz_passed: boolean;
  module_complete: boolean;
}

export interface CourseProgressView {
  course_id: string;
  completed_lesson_ids: string[];
  completed_lesson_count: number;
  total_lesson_count: number;
  modules: ModuleProgressView[];
  final_assessment_id: string | null;
  final_assessment_passed: boolean;
  course_complete: boolean;
  progress_pct: number;
}

/**
 * Reconciles this course's own progress record with any of its folded-in v1
 * lessons the learner already completed under the original curriculum, so
 * the unified view is never contradictory (e.g. showing 0/7 on a course that
 * contains 4 lessons the learner finished years ago under the old Academy).
 * The v1 record (academy_progress) stays the single source of truth for
 * those specific ids; this only reads it, it never copies/duplicates it.
 */
async function reconciledCompletedLessonIds(userId: string, course: Course, ownCompleted: readonly string[]): Promise<string[]> {
  if (!course.legacyLessonIds?.length) return [...ownCompleted];
  const legacyDone = new Set(await getCompletedLegacyLessonIds(userId));
  const carriedOver = course.legacyLessonIds.filter((id) => legacyDone.has(id));
  return [...new Set([...ownCompleted, ...carriedOver])];
}

export async function getCourseProgress(userId: string, courseId: string): Promise<CourseProgressView | null> {
  const course = findCourse(courseId);
  if (!course) return null;
  const progress = await getOrInitProgress(userId, courseId);
  const completedLessonIds = await reconciledCompletedLessonIds(userId, course, progress.completed_lesson_ids);
  const completed = new Set(completedLessonIds);

  const modules: ModuleProgressView[] = [];
  for (const m of course.modules) {
    const completedInModule = m.lessons.filter((l) => completed.has(l.id)).length;
    const lessonsComplete = completedInModule === m.lessons.length;
    let quizPassed = true;
    if (m.quiz) {
      const best = await bestQuizAttempt(userId, m.quiz.id);
      quizPassed = Boolean(best?.passed);
    }
    modules.push({
      module_id: m.id, title: m.title, lesson_count: m.lessons.length, completed_lesson_count: completedInModule,
      lessons_complete: lessonsComplete, quiz_id: m.quiz?.id ?? null, quiz_passed: quizPassed,
      module_complete: lessonsComplete && quizPassed,
    });
  }

  let finalPassed = true;
  if (course.finalAssessment) {
    const best = await bestQuizAttempt(userId, course.finalAssessment.id);
    finalPassed = Boolean(best?.passed);
  }

  const allLessonIds = courseLessonIds(course);
  const courseComplete = modules.every((m) => m.module_complete) && finalPassed;
  const progressPct = allLessonIds.length === 0 ? 0 : Math.round((completedLessonIds.length / allLessonIds.length) * 100);

  return {
    course_id: course.id,
    completed_lesson_ids: completedLessonIds,
    completed_lesson_count: completedLessonIds.length,
    total_lesson_count: allLessonIds.length,
    modules,
    final_assessment_id: course.finalAssessment?.id ?? null,
    final_assessment_passed: finalPassed,
    course_complete: courseComplete,
    progress_pct: progressPct,
  };
}

/**
 * A folded-in v1 lesson id's completion truth lives in academy_progress
 * (not academy_course_progress) -- writing it there instead of here keeps
 * exactly one record per lesson id and means the original v1
 * curriculum/certificate stay in sync automatically, satisfied by whichever
 * UI (old lesson view or unified course view) the learner used.
 */
export async function markCourseLessonComplete(userId: string, courseId: string, lessonId: string): Promise<CourseProgressView> {
  const found = findLesson(courseId, lessonId);
  if (!found) throw Object.assign(new Error("Unknown course/lesson id."), { statusCode: 400 });
  if (isKnownLessonId(lessonId) && found.course.legacyLessonIds?.includes(lessonId)) {
    await markLessonComplete(userId, lessonId);
    return (await getCourseProgress(userId, courseId))!;
  }
  await getDb().collection("academy_course_progress").updateOne(
    { user_id: userId, course_id: courseId },
    { $addToSet: { completed_lesson_ids: lessonId }, $set: { updated_at: new Date().toISOString() }, $setOnInsert: { user_id: userId, course_id: courseId } },
    { upsert: true },
  );
  return (await getCourseProgress(userId, courseId))!;
}

export async function markCourseLessonIncomplete(userId: string, courseId: string, lessonId: string): Promise<CourseProgressView> {
  const found = findLesson(courseId, lessonId);
  if (found && isKnownLessonId(lessonId) && found.course.legacyLessonIds?.includes(lessonId)) {
    await markLessonIncomplete(userId, lessonId);
    return (await getCourseProgress(userId, courseId))!;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mongodb's PullOperator typing rejects an otherwise-valid $pull on a plain-string array field.
  await getDb().collection("academy_course_progress").updateOne(
    { user_id: userId, course_id: courseId },
    { $pull: { completed_lesson_ids: lessonId }, $set: { updated_at: new Date().toISOString() } } as any,
  );
  const view = await getCourseProgress(userId, courseId);
  if (!view) throw Object.assign(new Error("Unknown course id."), { statusCode: 400 });
  return view;
}

export interface QuizSubmitResult {
  quiz_id: string;
  score_pct: number;
  passed: boolean;
  passing_score_pct: number;
  attempt_number: number;
  correct_count: number;
  total_count: number;
  per_question: Array<{ question_id: string; correct: boolean; correct_option_ids: string[]; explanation: string }>;
}

/**
 * Grades entirely server-side from the catalog's own correctOptionIds --
 * the client never sends or receives correct answers ahead of this call.
 * courseId "" means "search every course for this quiz id" (used by
 * knowledge-check grading, which doesn't need attempt tracking).
 */
export async function submitQuizAttempt(
  userId: string, courseId: string, quizId: string, answers: Record<string, string[]>,
): Promise<QuizSubmitResult> {
  const found = courseId ? findQuiz(courseId, quizId) : findQuizAcrossCourses(quizId);
  if (!found) throw Object.assign(new Error("Unknown quiz id."), { statusCode: 400 });
  const { quiz } = found;

  const perQuestion = quiz.questions.map((question) => {
    const given = new Set((answers[question.id] ?? []).map(String));
    const correctSet = new Set(question.correctOptionIds);
    const correct = given.size === correctSet.size && [...given].every((id) => correctSet.has(id));
    return { question_id: question.id, correct, correct_option_ids: question.correctOptionIds, explanation: question.explanation };
  });
  const correctCount = perQuestion.filter((r) => r.correct).length;
  const scorePct = quiz.questions.length === 0 ? 0 : Math.round((correctCount / quiz.questions.length) * 100);
  const passed = scorePct >= quiz.passingScorePct;

  const db = getDb();
  const priorAttempts = await db.collection("academy_quiz_attempts").countDocuments({ user_id: userId, quiz_id: quizId });
  const attemptDoc: QuizAttemptDoc = {
    id: randomUUID(), user_id: userId, course_id: found.course.id, quiz_id: quizId,
    attempt_number: priorAttempts + 1, score_pct: scorePct, passed, answers, created_at: new Date().toISOString(),
  };
  await db.collection("academy_quiz_attempts").insertOne(attemptDoc);

  return {
    quiz_id: quizId, score_pct: scorePct, passed, passing_score_pct: quiz.passingScorePct,
    attempt_number: attemptDoc.attempt_number, correct_count: correctCount, total_count: quiz.questions.length,
    per_question: perQuestion,
  };
}

function findQuizAcrossCourses(quizId: string) {
  for (const course of ACADEMY_COURSES) {
    const found = findQuiz(course.id, quizId);
    if (found) return found;
  }
  return undefined;
}

export async function quizAttemptHistory(userId: string, quizId: string): Promise<QuizAttemptDoc[]> {
  return getDb().collection("academy_quiz_attempts")
    .find({ user_id: userId, quiz_id: quizId }, { projection: { _id: 0 } })
    .sort({ attempt_number: -1 })
    .toArray() as unknown as Promise<QuizAttemptDoc[]>;
}

export { courseQuizIds };

export async function ensureAcademyCourseInfrastructure(): Promise<void> {
  const db = getDb();
  await Promise.all([
    db.collection("academy_course_progress").createIndex({ user_id: 1, course_id: 1 }, { unique: true }),
    db.collection("academy_quiz_attempts").createIndex({ user_id: 1, quiz_id: 1 }),
  ]);
}
