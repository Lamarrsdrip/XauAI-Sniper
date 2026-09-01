import { describe, expect, it } from "vitest";
import { isMarketOpen, marketDaysElapsed } from "./marketCalendar.js";

// 2024-01-01 is a known Monday.
const MON = "2024-01-01", TUE = "2024-01-02", WED = "2024-01-03", THU = "2024-01-04";
const FRI = "2024-01-05", SAT = "2024-01-06", SUN = "2024-01-07", MON2 = "2024-01-08", TUE2 = "2024-01-09";

describe("isMarketOpen", () => {
  it("is open on ordinary weekdays", () => {
    for (const d of [MON, TUE, WED, THU]) expect(isMarketOpen(new Date(`${d}T10:00:00Z`))).toBe(true);
  });
  it("is closed all day Saturday", () => {
    expect(isMarketOpen(new Date(`${SAT}T00:00:00Z`))).toBe(false);
    expect(isMarketOpen(new Date(`${SAT}T23:59:00Z`))).toBe(false);
  });
  it("closes Friday at 21:00 UTC and reopens Sunday at 21:00 UTC", () => {
    expect(isMarketOpen(new Date(`${FRI}T20:59:00Z`))).toBe(true);
    expect(isMarketOpen(new Date(`${FRI}T21:00:00Z`))).toBe(false);
    expect(isMarketOpen(new Date(`${SUN}T20:59:00Z`))).toBe(false);
    expect(isMarketOpen(new Date(`${SUN}T21:00:00Z`))).toBe(true);
  });
});

describe("marketDaysElapsed (3-market-day trial counting)", () => {
  it("matches the documented Friday-start example: Fri=1, Sat/Sun ignored, Mon=2, Tue=3", () => {
    const start = new Date(`${FRI}T10:00:00Z`);
    expect(marketDaysElapsed(start, new Date(`${FRI}T10:00:00Z`))).toBe(1);
    expect(marketDaysElapsed(start, new Date(`${SAT}T10:00:00Z`))).toBe(1);
    expect(marketDaysElapsed(start, new Date(`${SUN}T10:00:00Z`))).toBe(1);
    expect(marketDaysElapsed(start, new Date(`${MON2}T10:00:00Z`))).toBe(2);
    expect(marketDaysElapsed(start, new Date(`${TUE2}T10:00:00Z`))).toBe(3);
  });

  it("counts zero for a 'now' before the trial started", () => {
    expect(marketDaysElapsed(new Date(`${TUE}T10:00:00Z`), new Date(`${MON}T10:00:00Z`))).toBe(0);
  });

  it("a Monday-start trial reaches 3 market days by Wednesday", () => {
    const start = new Date(`${MON}T09:00:00Z`);
    expect(marketDaysElapsed(start, new Date(`${MON}T09:00:00Z`))).toBe(1);
    expect(marketDaysElapsed(start, new Date(`${TUE}T09:00:00Z`))).toBe(2);
    expect(marketDaysElapsed(start, new Date(`${WED}T09:00:00Z`))).toBe(3);
  });
});
