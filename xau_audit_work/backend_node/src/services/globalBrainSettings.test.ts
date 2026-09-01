import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../testUtils/fakeDb.js";

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("../db.js", () => ({ getDb: () => state.db }));

const { getGlobalBrainSettings, updateGlobalBrainSettings, emergencyDisableGlobalBrain } = await import("./globalBrainSettings.js");

describe("globalBrainSettings", () => {
  beforeEach(() => {
    state.db = new FakeDb();
  });

  it("defaults every shadow-safe capability to ON and every learned-influence flag to OFF when no settings doc exists yet", async () => {
    const settings = await getGlobalBrainSettings();
    expect(settings.global_learning_enabled).toBe(true);
    expect(settings.scheduled_cycle_enabled).toBe(true);
    expect(settings.auto_training_enabled).toBe(true);
    expect(settings.auto_promotion_enabled).toBe(true);
    expect(settings.shadow_serving_enabled).toBe(true);
    expect(settings.advisory_integration_enabled).toBe(true);
    expect(settings.bot_learned_influence_enabled).toBe(false);
    expect(settings.m10_learned_influence_enabled).toBe(false);
    expect(settings.outlook_learned_influence_enabled).toBe(false);
  });

  it("persists a partial update and leaves every other flag untouched", async () => {
    await updateGlobalBrainSettings({ auto_promotion_enabled: false }, "admin@xaucloud.io");
    const settings = await getGlobalBrainSettings();
    expect(settings.auto_promotion_enabled).toBe(false);
    expect(settings.global_learning_enabled).toBe(true); // untouched
    expect(settings.updated_by).toBe("admin@xaucloud.io");
    expect(settings.updated_at).not.toBeNull();
  });

  it("emergencyDisableGlobalBrain turns off every capability in one write, including the three live production-influence flags", async () => {
    await updateGlobalBrainSettings(
      { bot_learned_influence_enabled: true, m10_learned_influence_enabled: true, outlook_learned_influence_enabled: true },
      "admin@xaucloud.io",
    );
    const settings = await emergencyDisableGlobalBrain("admin@xaucloud.io");
    expect(settings.global_learning_enabled).toBe(false);
    expect(settings.scheduled_cycle_enabled).toBe(false);
    expect(settings.auto_training_enabled).toBe(false);
    expect(settings.auto_promotion_enabled).toBe(false);
    expect(settings.shadow_serving_enabled).toBe(false);
    expect(settings.advisory_integration_enabled).toBe(false);
    expect(settings.bot_learned_influence_enabled).toBe(false);
    expect(settings.m10_learned_influence_enabled).toBe(false);
    expect(settings.outlook_learned_influence_enabled).toBe(false);

    const reread = await getGlobalBrainSettings();
    expect(reread).toEqual(settings); // durably persisted, not just returned
  });

  it("re-enabling after an emergency disable restores exactly the flags flipped back on, nothing more", async () => {
    await emergencyDisableGlobalBrain("admin@xaucloud.io");
    await updateGlobalBrainSettings({ global_learning_enabled: true }, "admin@xaucloud.io");
    const settings = await getGlobalBrainSettings();
    expect(settings.global_learning_enabled).toBe(true);
    expect(settings.auto_promotion_enabled).toBe(false); // still off -- re-enable is explicit per-flag
  });

  it("fails safe to defaults if the settings read itself throws, never crashing the caller", async () => {
    state.db = { collection: () => { throw new Error("boom"); } } as unknown as FakeDb;
    const settings = await getGlobalBrainSettings();
    expect(settings.global_learning_enabled).toBe(true); // safe default, not a crash
  });
});
