import { describe, expect, it } from "vitest";
import { selectConnectedMt5Source } from "./agentFamilySource.js";
const now=Date.parse("2026-11-04T15:00:00Z");
const make=(account:string,quoteAge:number,hbAge=quoteAge)=>({
  account,heartbeat_at:new Date(now-hbAge*1000).toISOString(),
  quote_at:new Date(now-quoteAge*1000).toISOString(),bid:3100,ask:3100.25,
});
describe("pre-existing MT5 broker source selector",()=>{
  it("selects freshest approved connected VPS",()=>{
    expect(selectConnectedMt5Source([make("12345",25),make("67890",3)],now)?.account).toBe("67890");
  });
  it("fails over when the freshest quote came from an offline VPS",()=>{
    expect(selectConnectedMt5Source([make("12345",1,200),make("67890",20)],now)?.account).toBe("67890");
  });
  it("refuses stale, crossed, future and invalid quotes",()=>{
    expect(selectConnectedMt5Source([make("12345",200)],now)).toBeNull();
    expect(selectConnectedMt5Source([make("12345",-120)],now)).toBeNull();
    expect(selectConnectedMt5Source([{...make("12345",1),ask:3099}],now)).toBeNull();
    expect(selectConnectedMt5Source([make("EXTERNAL",1)],now)).toBeNull();
  });
});
