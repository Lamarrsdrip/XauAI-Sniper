import { describe, expect, it } from "vitest";
import { clampGoldStopToMaxDistance } from "./marketOutlookCore.js";

describe("clampGoldStopToMaxDistance", () => {
  it("caps Outlook stops at $10 while preserving narrower stops", () => {
    expect(clampGoldStopToMaxDistance(4350, 4335, 1)).toBe(4340);
    expect(clampGoldStopToMaxDistance(4350, 4365, -1)).toBe(4360);
    expect(clampGoldStopToMaxDistance(4350, 4345, 1)).toBe(4345);
  });
});
