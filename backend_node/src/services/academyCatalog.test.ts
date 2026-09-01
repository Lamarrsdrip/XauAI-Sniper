import { describe, expect, it } from "vitest";
import { ACADEMY_COURSES, publicCatalog, courseLessonIds } from "./academyCatalog.js";
import { REQUIRED_LESSON_IDS } from "./academyCurriculum.js";

describe("expanded Academy catalog", () => {
  it("ships all 16 requested major courses as an additive curriculum", () => {
    expect(ACADEMY_COURSES).toHaveLength(16);
    expect(ACADEMY_COURSES.map((course) => course.title)).toEqual(expect.arrayContaining([
      "Financial Markets & Trading Foundations", "Complete Forex Course", "Chart Reading & Market Structure",
      "Price Action Mastery", "Technical Analysis", "Fundamental & Macro Analysis", "Gold / XAUUSD Masterclass",
      "Cryptocurrency & Digital Assets", "Risk & Money Management", "Trading Psychology",
      "Strategy Development & Trading Systems", "Backtesting, Journaling & Performance Analysis",
      "Brokers, Execution & MT5", "Algorithmic & Automated Trading", "AI & Machine Learning in Trading",
      "Trading Security, Fraud & Professional Practice",
    ]));
  });

  it("requires real learning work before a course certificate can be earned", () => {
    for (const course of ACADEMY_COURSES) {
      expect(course.modules.length).toBeGreaterThanOrEqual(3);
      expect(course.modules.every((module) => module.lessons.length >= 3 && module.quiz?.questions.length)).toBe(true);
      expect(course.finalAssessment?.questions.length).toBeGreaterThanOrEqual(3);
      expect(course.certificateEligible).toBe(true);
    }
  });

  it("serves assessment prompts/options but never an answer key before grading", () => {
    const catalog = publicCatalog();
    const sample = catalog.find((course) => course.id === "risk-money-management")!;
    const question = sample.modules[0]!.quiz!.questions[0]!;
    expect(question).not.toHaveProperty("correctOptionIds");
    expect(question).not.toHaveProperty("explanation");
  });

  it("folds every original v1 lesson id into exactly one course, as real lesson content -- never dropped, never a second copy", () => {
    const allLessonIds = ACADEMY_COURSES.flatMap((course) => courseLessonIds(course));
    for (const legacyId of REQUIRED_LESSON_IDS) {
      expect(allLessonIds.filter((id) => id === legacyId)).toHaveLength(1);
    }
    const coursesCarryingIt = (legacyId: string) => ACADEMY_COURSES.filter((course) => course.legacyLessonIds?.includes(legacyId));
    for (const legacyId of REQUIRED_LESSON_IDS) {
      expect(coursesCarryingIt(legacyId)).toHaveLength(1);
    }
  });

  it("never issues the same lesson id from two different courses", () => {
    const allLessonIds = ACADEMY_COURSES.flatMap((course) => courseLessonIds(course));
    expect(new Set(allLessonIds).size).toBe(allLessonIds.length);
  });
});
