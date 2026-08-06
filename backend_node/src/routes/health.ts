import type { FastifyInstance } from "fastify";

/**
 * Port of server.py `GET /api/` (line 1025) and `GET /api/health` (line 1029).
 * Registered under the /api prefix scope in index.ts, matching api_router.
 */
export async function registerApiHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({ message: "XauCloud EA API v2.0" }));
  app.get("/health", async () => ({ status: "ok" }));
}

/**
 * Port of server.py's root-level `GET /health` (line 8611) -- for load
 * balancers / Cloud Run health checks, deliberately outside the /api prefix.
 */
export async function registerRootHealthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
}
