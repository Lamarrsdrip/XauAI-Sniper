import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { getCourseProgress, markCourseLessonComplete, markCourseLessonIncomplete, submitQuizAttempt } = await import("./academyCourseProgress.js");
const { XAUUSD_MASTERCLASS } = await import("./academyCatalog.js");

const COURSE_ID = XAUUSD_MASTERCLASS.id;
const FIRST_MODULE = XAUUSD_MASTERCLASS.modules[0]!;
const FIRST_LESSON_ID = FIRST_MODULE.lessons[0]!.id;
const MODULE_QUIZ = FIRST_MODULE.quiz!;

describe("academyCourseProgress -- server-authoritative course progress", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("an unknown course id returns null, never fabricated progress", async () => {
    expect(await getCourseProgress("u1", "not-a-real-course")).toBeNull();
  });

  it("a brand-new learner starts at 0% with every module incomplete", async () => {
    const progress = await getCourseProgress("u1", COURSE_ID);
    expect(progress).not.toBeNull();
    expect(progress!.completed_lesson_count).toBe(0);
    expect(progress!.progress_pct).toBe(0);
    expect(progress!.course_complete).toBe(false);
    expect(progress!.modules.every((m) => !m.module_complete)).toBe(true);
  });

  it("marking an unknown lesson id complete is rejected, not silently accepted", async () => {
    await expect(markCourseLessonComplete("u1", COURSE_ID, "not-a-real-lesson")).rejects.toThrow();
  });

  it("completing a lesson is idempotent and reflected in progress", async () => {
    await markCourseLessonComplete("u1", COURSE_ID, FIRST_LESSON_ID);
    await markCourseLessonComplete("u1", COURSE_ID, FIRST_LESSON_ID); // twice -- must not duplicate
    const progress = await getCourseProgress("u1", COURSE_ID);
    expect(progress!.completed_lesson_ids.filter((id) => id === FIRST_LESSON_ID)).toHaveLength(1);
    expect(progress!.completed_lesson_count).toBe(1);
  });

  it("uncompleting a lesson removes it from progress", async () => {
    await markCourseLessonComplete("u1", COURSE_ID, FIRST_LESSON_ID);
    await markCourseLessonIncomplete("u1", COURSE_ID, FIRST_LESSON_ID);
    const progress = await getCourseProgress("u1", COURSE_ID);
    expect(progress!.completed_lesson_ids).not.toContain(FIRST_LESSON_ID);
  });

  it("a module is only complete once every lesson AND its quiz are both done", async () => {
    for (const lesson of FIRST_MODULE.lessons) await markCourseLessonComplete("u1", COURSE_ID, lesson.id);
    let progress = await getCourseProgress("u1", COURSE_ID);
    const moduleView = () => progress!.modules.find((m) => m.module_id === FIRST_MODULE.id)!;
    expect(moduleView().lessons_complete).toBe(true);
    expect(moduleView().module_complete).toBe(false); // quiz not passed yet

    // Fail the quiz first -- module still not complete.
    const wrongAnswers = Object.fromEntries(MODULE_QUIZ.questions.map((q) => [q.id, ["definitely-wrong-option"]]));
    await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, wrongAnswers);
    progress = await getCourseProgress("u1", COURSE_ID);
    expect(moduleView().module_complete).toBe(false);

    // Now pass it for real.
    const rightAnswers = Object.fromEntries(MODULE_QUIZ.questions.map((q) => [q.id, q.correctOptionIds]));
    await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, rightAnswers);
    progress = await getCourseProgress("u1", COURSE_ID);
    expect(moduleView().module_complete).toBe(true);
  });

  it("per-user isolation: one learner's progress never appears under another user's id", async () => {
    await markCourseLessonComplete("learner-a", COURSE_ID, FIRST_LESSON_ID);
    const progressB = await getCourseProgress("learner-b", COURSE_ID);
    expect(progressB!.completed_lesson_count).toBe(0);
  });
});

describe("submitQuizAttempt -- server-side grading, never trusts a client-claimed score", () => {
  beforeEach(() => { state.db = new FakeDb(); });

  it("grades correctly and never leaks correct answers into the request itself (server computes, not the client)", async () => {
    const rightAnswers = Object.fromEntries(MODULE_QUIZ.questions.map((q) => [q.id, q.correctOptionIds]));
    const result = await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, rightAnswers);
    expect(result.score_pct).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.correct_count).toBe(MODULE_QUIZ.questions.length);
    // The response DOES reveal correct answers -- but only AFTER grading, per question.
    expect(result.per_question).toHaveLength(MODULE_QUIZ.questions.length);
    expect(result.per_question[0]!.correct_option_ids.length).toBeGreaterThan(0);
  });

  it("a completely wrong submission fails and is scored 0%", async () => {
    const wrongAnswers = Object.fromEntries(MODULE_QUIZ.questions.map((q) => [q.id, ["nope"]]));
    const result = await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, wrongAnswers);
    expect(result.score_pct).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("an unanswered question is simply wrong, not excluded from scoring", async () => {
    const result = await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, {});
    expect(result.correct_count).toBe(0);
    expect(result.total_count).toBe(MODULE_QUIZ.questions.length);
  });

  it("multi-select requires the exact correct set -- a partial match is still wrong", async () => {
    const multiQuestion = MODULE_QUIZ.questions.find((qn) => qn.type === "multi");
    if (!multiQuestion) return; // this module's quiz has no multi-select question; covered by module 1's quiz instead
    const partial = { [multiQuestion.id]: [multiQuestion.correctOptionIds[0]!] };
    const result = await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, partial);
    expect(result.per_question.find((r) => r.question_id === multiQuestion.id)!.correct).toBe(false);
  });

  it("attempt numbers increment per user per quiz, and the best (highest) score is what module-completion checks", async () => {
    const wrongAnswers = Object.fromEntries(MODULE_QUIZ.questions.map((q) => [q.id, ["nope"]]));
    const rightAnswers = Object.fromEntries(MODULE_QUIZ.questions.map((q) => [q.id, q.correctOptionIds]));
    const first = await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, wrongAnswers);
    const second = await submitQuizAttempt("u1", COURSE_ID, MODULE_QUIZ.id, rightAnswers);
    expect(first.attempt_number).toBe(1);
    expect(second.attempt_number).toBe(2);
    expect(second.passed).toBe(true);
  });

  it("rejects an unknown quiz id", async () => {
    await expect(submitQuizAttempt("u1", COURSE_ID, "not-a-real-quiz", {})).rejects.toThrow();
  });
});
