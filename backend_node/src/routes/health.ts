import type { FastifyInstance } from "fastify";
import { readinessSnapshot } from "../services/readiness.js";

/**
 * Port of server.py `GET /api/` (line 1025) and `GET /api/health` (line 1029).
 * Registered under the /api prefix scope in index.ts, matching api_router.
 */
export async function registerApiHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({ message: "XauCloud EA API v2.0" }));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/readiness", async (_request, reply) => {
    const snapshot = readinessSnapshot();
    return reply.code(snapshot.state === "READY" ? 200 : 503).send(snapshot);
  });
}

/**
 * Port of server.py's root-level `GET /health` (line 8611) -- for load
 * balancers / Cloud Run health checks, deliberately outside the /api prefix.
 */
export async function registerRootHealthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
}
