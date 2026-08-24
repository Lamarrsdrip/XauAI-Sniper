import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "../backend/ea_releases/manifest.json"), "utf8")) as {
  current_version: string;
  releases: Record<string, { source_filename?: string }>;
};
const sourceFilename = manifest.releases[manifest.current_version]?.source_filename;
if (!sourceFilename) throw new Error(`Current EA release ${manifest.current_version} has no source_filename`);
const ea = readFileSync(resolve(process.cwd(), "../backend/ea_code", sourceFilename), "utf8");

describe("production EA Manual Trading Intelligence contract", () => {
  it("tests the exact source selected by the current production manifest", () => {
    expect(sourceFilename).toBe("XauCloud-60pips.mq5");
  });

  it("puts its own fresh broker quote on every monitoring heartbeat", () => {
    expect(ea).toContain("string BotMonitorLiveQuoteJson()");
    expect(ea).toContain('\\"market_thesis\\":%s');
    expect(ea).toContain("InpExhaustionCounterTargetPips, BotMonitorLiveQuoteJson()");
  });

  it("does not emit a zero realised profit for an opening event", () => {
    expect(ea).toContain('string profitJson = (ev == "TRADE_CLOSED") ? DoubleToString(profit, 2) : "null";');
    expect(ea).toContain('\\"profit\\":%s,\\"price\\":%.5f');
  });
});
