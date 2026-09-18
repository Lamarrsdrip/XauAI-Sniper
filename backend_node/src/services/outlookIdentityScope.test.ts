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

  it("treats historical numeric and current string MT5 account representations as the same account", async () => {
    const db = new FakeDb();
    const c = db.collection("cloud_market_outlooks");
    await c.insertOne({ id: "numeric-exact", account: 111, license_key: "PIN-A" });
    await c.insertOne({ id: "numeric-account-only", account: 111 });
    await c.insertOne({ id: "numeric-wrong-pin", account: 111, license_key: "PIN-B" });
    await c.insertOne({ id: "other-number", account: 222, license_key: "PIN-A" });

    const rows = await c.find(outlookReadScope("111", "PIN-A")).toArray();
    expect(rows.map((r) => r.id).sort()).toEqual(["numeric-account-only", "numeric-exact"]);
  });

  it("keeps current live/event identity strict while accepting the same account in BSON numeric form", async () => {
    const db = new FakeDb();
    const c = db.collection("events");
    await c.insertOne({ id: "exact-string", account: "111", license_key: "PIN-A" });
    await c.insertOne({ id: "exact-number", account: 111, license_key: "PIN-A" });
    await c.insertOne({ id: "legacy", account: "111" });
    await c.insertOne({ id: "wrong-pin", account: 111, license_key: "PIN-B" });
    expect((await c.find(exactOutlookIdentityScope("111", "PIN-A")).toArray()).map((r) => r.id).sort()).toEqual(["exact-number", "exact-string"]);
  });
});
