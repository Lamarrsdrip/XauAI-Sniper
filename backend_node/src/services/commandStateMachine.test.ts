import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST 9 from the Outlook+Aurum Unified Coordination mission spec: a stale
 * OUTLOOK_SIGNAL_OPEN command left over from the OLD (pre-fix) code path
 * must not unexpectedly trigger a live order after this deploy. Since we
 * do not change the currently-deployed production EA in this fix, the
 * only backend-side guarantee available is to retire the backlog so a
 * still-connected EA never receives one to execute.
 */

type Doc = Record<string, unknown>;

class FakeCollection {
  docs: Doc[] = [];

  async updateMany(query: Doc, update: { $set?: Doc }) {
    const matches = this.docs.filter((d) => Object.entries(query).every(([k, v]) => d[k] === v));
    for (const d of matches) Object.assign(d, structuredClone(update.$set ?? {}));
    return { matchedCount: matches.length, modifiedCount: matches.length };
  }

  find(query: Doc = {}) {
    return this.docs.filter((d) => Object.entries(query).every(([k, v]) => d[k] === v));
  }
}

class FakeDb {
  private map = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    if (!this.map.has(name)) this.map.set(name, new FakeCollection());
    return this.map.get(name)!;
  }
}

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { retireStaleOutlookSignalOpenCommands } = await import("./commandStateMachine.js");

beforeEach(() => {
  state.db = new FakeDb();
});

describe("retireStaleOutlookSignalOpenCommands", () => {
  it("TEST 9: a stale PENDING OUTLOOK_SIGNAL_OPEN command is retired to SKIPPED, never left executable", async () => {
    const commands = state.db.collection("cloud_bot_commands");
    commands.docs.push({
      id: "cmd-1",
      action: "OUTLOOK_SIGNAL_OPEN",
      status: "PENDING",
      payload: { direction: "BUY", signal_id: "old-signal" },
    });

    const retired = await retireStaleOutlookSignalOpenCommands();
    expect(retired).toBe(1);

    const row = commands.find({ id: "cmd-1" })[0];
    expect(row["status"]).toBe("SKIPPED");
    expect(row["ack_status"]).toBe("SKIPPED");
    expect(String(row["ack_message"])).toMatch(/no longer an execution command/i);
  });

  it("does not touch a command already in a terminal state (never overwrites real history)", async () => {
    const commands = state.db.collection("cloud_bot_commands");
    commands.docs.push({ id: "cmd-2", action: "OUTLOOK_SIGNAL_OPEN", status: "EXECUTED", ack_status: "EXECUTED" });
    await retireStaleOutlookSignalOpenCommands();
    expect(commands.find({ id: "cmd-2" })[0]["status"]).toBe("EXECUTED");
  });

  it("does not touch PENDING commands of a different action (e.g. MANUAL_OPEN_NOW)", async () => {
    const commands = state.db.collection("cloud_bot_commands");
    commands.docs.push({ id: "cmd-3", action: "MANUAL_OPEN_NOW", status: "PENDING" });
    await retireStaleOutlookSignalOpenCommands();
    expect(commands.find({ id: "cmd-3" })[0]["status"]).toBe("PENDING");
  });

  it("is idempotent -- running it again with nothing left PENDING retires zero", async () => {
    const commands = state.db.collection("cloud_bot_commands");
    commands.docs.push({ id: "cmd-4", action: "OUTLOOK_SIGNAL_OPEN", status: "PENDING" });
    await retireStaleOutlookSignalOpenCommands();
    const second = await retireStaleOutlookSignalOpenCommands();
    expect(second).toBe(0);
  });
});
