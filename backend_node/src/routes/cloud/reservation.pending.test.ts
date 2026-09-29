import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../../testUtils/fakeDb.js";

vi.hoisted(() => {
  process.env["ENVIRONMENT"] = "test";
});

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  resolveLicense: vi.fn(async (_pin: string, account: string, brokerServer: string) => ({
    id: "lic-1",
    pin: "ASE-TEST-0001",
    mt5_account: account,
    broker_server: brokerServer,
  })),
}));

vi.mock("../../db.js", () => ({ getDb: () => state.db }));
vi.mock("../../services/license.js", () => ({
  resolveEaMonitorLicense: (...args: [string, string, string]) => state.resolveLicense(...args),
}));

const { registerCloudReservationRoutes } = await import("./reservation.js");

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCloudReservationRoutes(app);
  return app;
}

describe("accepted-pending direction reservation renewal", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.db = new FakeDb();
    state.resolveLicense.mockClear();
    app = await createApp();
    state.db.collection("cloud_direction_reservations").docs.push({
      _id: "Broker-Live:1001:XAUUSD",
      reservationId: "reservation-1",
      executionKey: "exec-1",
      licenseId: "lic-1",
      brokerServer: "Broker-Live",
      account: "1001",
      symbol: "XAUUSD",
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
    });
  });

  it("renews only the existing reservation owner and authenticates broker server", async () => {
    const before = String(state.db.collection("cloud_direction_reservations").docs[0]?.["expiresAt"]);
    const res = await app.inject({
      method: "POST",
      url: "/cloud/reservation/renew",
      payload: {
        pin: "ASE-TEST-0001",
        broker_server: "Broker-Live",
        account: "1001",
        symbol: "XAUUSD",
        reservation_id: "reservation-1",
        execution_key: "exec-1",
        ttl_seconds: 120,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ renewed: true, reservationId: "reservation-1" });
    const after = String(state.db.collection("cloud_direction_reservations").docs[0]?.["expiresAt"]);
    expect(after > before).toBe(true);
    expect(state.resolveLicense).toHaveBeenCalledWith("ASE-TEST-0001", "1001", "Broker-Live");
  });

  it("cannot renew with a different reservation id or execution identity", async () => {
    for (const payload of [
      { reservation_id: "other-reservation", execution_key: "exec-1" },
      { reservation_id: "reservation-1", execution_key: "other-exec" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/cloud/reservation/renew",
        payload: {
          pin: "ASE-TEST-0001",
          broker_server: "Broker-Live",
          account: "1001",
          symbol: "XAUUSD",
          ttl_seconds: 120,
          ...payload,
        },
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ renewed: false, reason: "RESERVATION_OWNERSHIP_NOT_CONFIRMED" });
    }
  });
});
