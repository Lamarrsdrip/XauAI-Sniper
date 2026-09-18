import { describe, expect, it } from "vitest";
import { hourlyLicenseKeyFromActivity } from "./marketOutlookHourlyTick.js";

describe("hourly Outlook identity", () => {
  it("uses the canonical top-level normalized license key", () => {
    expect(hourlyLicenseKeyFromActivity({
      license_key: "PIN-TOP",
      details: { license_key: "PIN-OLD" },
    })).toBe("PIN-TOP");
  });

  it("supports pre-canonical activity rows that only carried the PIN in details", () => {
    expect(hourlyLicenseKeyFromActivity({ details: { license_key: "PIN-LEGACY" } })).toBe("PIN-LEGACY");
  });

  it("does not manufacture a license when neither source has one", () => {
    expect(hourlyLicenseKeyFromActivity({ details: {} })).toBe("");
  });
});
