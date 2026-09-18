import { describe, expect, it } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";
import { exactOutlookIdentityScope, outlookReadScope } from "./outlookIdentityScope.js";

describe("outlookReadScope", () => {
  it("reads exact and one-sided legacy rows without admitting conflicting identities", async () => {
    const db = new FakeDb();
    const c = db.collection("cloud_market_outlooks");
    await c.insertOne({ id: "exact", account: "111", license_key: "PIN-A" });
    await c.insertOne({ id: "account-only", account: "111" });
    await c.insertOne({ id: "license-only", license_key: "PIN-A" });
    await c.insertOne({ id: "wrong-pin", account: "111", license_key: "PIN-B" });
    await c.insertOne({ id: "wrong-account", account: "222", license_key: "PIN-A" });

    const rows = await c.find(outlookReadScope("111", "PIN-A")).toArray();
    expect(rows.map((r) => r.id).sort()).toEqual(["account-only", "exact", "license-only"]);
  });

  it("keeps current live/event identity strict", async () => {
    const db = new FakeDb();
    const c = db.collection("events");
    await c.insertOne({ id: "exact", account: "111", license_key: "PIN-A" });
    await c.insertOne({ id: "legacy", account: "111" });
    expect((await c.find(exactOutlookIdentityScope("111", "PIN-A")).toArray()).map((r) => r.id)).toEqual(["exact"]);
  });
});
