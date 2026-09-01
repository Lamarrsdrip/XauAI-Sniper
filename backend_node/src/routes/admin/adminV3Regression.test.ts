import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const gateway = readFileSync(new URL("./adminGatewayActions.ts", import.meta.url), "utf8");
const cloudSupport = readFileSync(new URL("../cloud/support.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../../auth.ts", import.meta.url), "utf8");
const telemetry = readFileSync(new URL("../../services/customerTradingTelemetry.ts", import.meta.url), "utf8");

describe("XauCloud Admin v3 safety regressions", () => {
  it("keeps support replies in the canonical Command Center messages array", () => {
    expect(gateway).toContain('author_type:"support"');
    expect(gateway).toContain('$push:{messages:message as never}');
    expect(gateway).not.toContain('$push:{conversation_messages:');
  });

  it("keeps the customer-facing support route on the same messages array", () => {
    expect(cloudSupport).toContain('const messages = Array.isArray(row["messages"])');
  });

  it("does not use public replay data as customer P&L", () => {
    expect(telemetry).toContain("cloud_bot_heartbeats");
    expect(telemetry).toContain("cloud_bot_activity");
    expect(telemetry).not.toContain("replayData");
    expect(telemetry).toContain("No position rows are fabricated");
  });

  it("uses token/session versioning for cloud session revocation", () => {
    expect(auth).toContain("session_version");
  });
});
