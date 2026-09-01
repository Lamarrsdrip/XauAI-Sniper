import { describe, expect, it } from "vitest";
import { REQUIRED_LESSON_IDS, computeIsComplete, isKnownLessonId } from "./academyCurriculum.js";

describe("Academy curriculum (server-authoritative required lesson list)", () => {
  it("matches the frontend's 21-topic curriculum, not a hard-coded assumption elsewhere", () => {
    expect(REQUIRED_LESSON_IDS).toHaveLength(21);
  });

  it("is not complete at 99% -- one missing lesson keeps it incomplete", () => {
    const almostAll = REQUIRED_LESSON_IDS.slice(0, -1);
    expect(computeIsComplete(almostAll)).toBe(false);
  });

  it("is complete only once every required lesson id is present", () => {
    expect(computeIsComplete([...REQUIRED_LESSON_IDS])).toBe(true);
  });

  it("ignores unknown/extra ids rather than being tricked by them -- completeness still requires the real set", () => {
    expect(computeIsComplete(["not-a-real-lesson", "another-fake"])).toBe(false);
  });

  it("rejects a lesson id that isn't part of the curriculum", () => {
    expect(isKnownLessonId("foundation")).toBe(true);
    expect(isKnownLessonId("made-up-lesson")).toBe(false);
  });
});
