import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { resolveEaMonitorLicense, LicenseError } = await import("./license.js");

describe("resolveEaMonitorLicense broker-server boundary", () => {
  beforeEach(() => {
    state.db = new FakeDb();
    state.db.uniqueIndexes.pin_licenses = ["pin"];
  });

  async function seed(extra: Record<string, unknown> = {}) {
    await state.db.collection("pin_licenses").insertOne({
      id: "lic-1",
      pin: "ASE-TEST-0001",
      is_active: true,
      mt5_account: "1001",
      ...extra,
    });
  }

  it("atomically binds an unbound license to the first broker server", async () => {
    await seed({ broker_server: "" });
    const lic = await resolveEaMonitorLicense("ASE-TEST-0001", "1001", "Exness-MT5Trial9");
    expect(lic["broker_server"]).toBe("Exness-MT5Trial9");
    const stored = await state.db.collection("pin_licenses").findOne({ pin: "ASE-TEST-0001" });
    expect(stored?.["broker_server"]).toBe("Exness-MT5Trial9");
    expect(stored?.["broker_server_bound_at"]).toBeTruthy();
  });

  it("accepts the same broker server case-insensitively", async () => {
    await seed({ broker_server: "Exness-MT5Trial9" });
    const lic = await resolveEaMonitorLicense("ASE-TEST-0001", "1001", "  exness-mt5trial9 ");
    expect(lic["id"]).toBe("lic-1");
  });

  it("fails closed when the same account presents a different broker server", async () => {
    await seed({ broker_server: "Exness-MT5Trial9" });
    await expect(resolveEaMonitorLicense("ASE-TEST-0001", "1001", "OtherBroker-Live"))
      .rejects.toMatchObject({
        statusCode: 403,
        detail: {
          reason: "LICENSE_BOUND_TO_DIFFERENT_BROKER_SERVER",
          bound_broker_server: "Exness-MT5Trial9",
          broker_server: "OtherBroker-Live",
          account: "1001",
        },
      });
  });
});
