import { describe, expect, it } from "vitest";
import { buildMonitorHeartbeatQuery } from "./monitorStatus.js";

describe("buildMonitorHeartbeatQuery", () => {
  it("requires the bound account inside the authenticated license scope", () => {
    expect(buildMonitorHeartbeatQuery("lic-123", "ASE-TEST-123", "555111")).toEqual({
      $and: [
        {
          $or: [
            { license_id: "lic-123" },
            { license_key: "ASE-TEST-123" },
            { pin: "ASE-TEST-123" },
          ],
        },
        { account_number: "555111" },
      ],
    });
  });

  it("allows an unbound license to discover only its own heartbeat for first binding", () => {
    expect(buildMonitorHeartbeatQuery("lic-123", "ASE-TEST-123", "")).toEqual({
      $or: [
        { license_id: "lic-123" },
        { license_key: "ASE-TEST-123" },
        { pin: "ASE-TEST-123" },
      ],
    });
  });

  it("never falls back to account-only heartbeat lookup without a license identity", () => {
    expect(buildMonitorHeartbeatQuery("", "", "555111")).toBeNull();
  });
});
