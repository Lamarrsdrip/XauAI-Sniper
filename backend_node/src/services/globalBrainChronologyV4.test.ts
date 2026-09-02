import { describe, expect, it } from "vitest";
import { buildOutlookObservation } from "./globalBrainIngest.js";
import { computeCounterfactualTiming } from "./globalBrainCounterfactual.js";
import { QUESTION_SPECS } from "./globalBrainTraining.js";

const t = (m: number) => new Date(`2026-09-02T10:${String(m).padStart(2, "0")}:00.000Z`);

describe("Global Brain v4 chronology", () => {
  it("SL first then later TP stays a counterfactual loss", () => {
    const r = computeCounterfactualTiming([[99.9,100,t(0)],[94.9,95,t(1)],[106,106.1,t(2)]], { direction:"BUY", tp1:105,tp2:110,tp3:115,sl:95,publishedQuoteAt:t(0),evaluationDeadline:t(10) });
    expect(r.find((x) => x.offset === "IMMEDIATE")?.achieved_r).toBe(-1);
  });
  it("TP first then later SL stays a counterfactual win", () => {
    const r = computeCounterfactualTiming([[99.9,100,t(0)],[105.1,105.2,t(1)],[94.9,95,t(2)]], { direction:"BUY", tp1:105,tp2:110,tp3:115,sl:95,publishedQuoteAt:t(0),evaluationDeadline:t(10) });
    expect(r.find((x) => x.offset === "IMMEDIATE")?.achieved_r).toBe(0.5);
  });
  it("TP_BEFORE_SL uses timestamps, not eventual WIN/R", () => {
    const o = buildOutlookObservation({ id:"sl-first",account:"1",symbol:"XAUUSD",primary_direction:"BUY",published_at:t(0).toISOString(),published_quote_at:t(0).toISOString(),evaluation_deadline:t(10).toISOString(),classification_at:t(2).toISOString(),analytics_outcome:"WIN",analytics_r:0.5,tp1_price:105,tp2_price:110,tp3_price:115,original_sl:95,sl_hit_at:t(1).toISOString(),tp1_hit_at:t(2).toISOString(),setup_type:"TEST",market_regime:"TREND_UP" }, [[99.9,100,t(0)],[94.9,95,t(1)],[105.1,105.2,t(2)]]);
    expect(o?.outcome?.first_terminal_event).toBe("SL");
    expect(o?.outcome?.tp_before_sl).toBe(false);
    expect(QUESTION_SPECS.TP_BEFORE_SL.eligible(o!)).toBe(true);
    expect(QUESTION_SPECS.TP_BEFORE_SL.isSuccess(o!)).toBe(false);
  });
  it("timeout with neither TP nor SL is ineligible for literal TP_BEFORE_SL", () => {
    const o = buildOutlookObservation({ id:"timeout",account:"1",symbol:"XAUUSD",primary_direction:"BUY",published_at:t(0).toISOString(),published_quote_at:t(0).toISOString(),evaluation_deadline:t(10).toISOString(),classification_at:t(10).toISOString(),analytics_outcome:"BREAK_EVEN",analytics_r:0,tp1_price:105,tp2_price:110,tp3_price:115,original_sl:95,setup_type:"TEST",market_regime:"TREND_UP" }, [[99.9,100,t(0)]]);
    expect(o?.outcome?.first_terminal_event).toBe("TIMEOUT");
    expect(o?.outcome?.tp_before_sl).toBeNull();
    expect(QUESTION_SPECS.TP_BEFORE_SL.eligible(o!)).toBe(false);
  });
});
