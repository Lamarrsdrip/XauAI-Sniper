import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env, IS_PRODUCTION } from "./env.js";
import { connectDb, closeDb } from "./db.js";
import { AuthError } from "./auth.js";
import { LicenseError } from "./services/license.js";
import { registerApiHealthRoutes, registerRootHealthRoute } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPinRoutes } from "./routes/pins.js";
import { registerCloudMonitorRoutes } from "./routes/cloud/monitor.js";
import { registerCloudCommandRoutes } from "./routes/cloud/command.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerMlRoutes } from "./routes/ml.js";
import { registerSmartRoutes } from "./routes/smart.js";
import { registerJournalRoutes } from "./routes/journal.js";
import { registerCloudAuthRoutes } from "./routes/cloud/auth.js";
import { registerTradingUniverseRoutes } from "./routes/cloud/tradingUniverse.js";
import { registerCloudActivityRoutes } from "./routes/cloud/activity.js";
import { registerCloudReservationRoutes } from "./routes/cloud/reservation.js";
import { registerCloudLeaseRoutes, LeaseHttpError } from "./routes/cloud/lease.js";
import { registerCloudThesisStatusRoutes } from "./routes/cloud/thesisStatus.js";
import { registerCloudMonitorStatusRoutes } from "./routes/cloud/monitorStatus.js";
import { registerDecisionFeedRoutes } from "./routes/cloud/decisionFeed.js";
import { registerNotificationRoutes } from "./routes/notificationRoutes.js";
import { registerOutlookCurrentRoutes } from "./routes/outlookCurrent.js";
import { registerOutlookHistoryRoutes } from "./routes/outlookHistory.js";
import { registerPurchaseRoutes } from "./routes/purchase.js";
import { registerMiscRoutes } from "./routes/misc.js";
import { registerPublicMarketFeedRoutes } from "./routes/publicMarketFeed.js";
import { registerAdminSettingsRoutes } from "./routes/admin/settings.js";
import { registerAdminBankTransferRoutes } from "./routes/admin/bankTransfers.js";
import { registerAdminDashboardRoutes } from "./routes/admin/dashboard.js";
import { registerAdminPinsRoutes } from "./routes/admin/pins.js";
import { registerAdminConfigsRoutes } from "./routes/admin/configs.js";
import { registerAdminAccountRoutes } from "./routes/admin/account.js";
import { registerAdminEmailRoutes } from "./routes/admin/email.js";
import { ensureGptEmailActionIndexes, registerGptEmailActionRoutes } from "./routes/admin/gptEmailActions.js";
import { ensureMarketingActionInfrastructure, registerMarketingActionRoutes } from "./routes/admin/marketingActions.js";
import { registerAdminReleasesRoutes } from "./routes/admin/releases.js";
import { registerDownloadRoutes } from "./routes/downloads.js";
import { registerPerformanceRoutes } from "./routes/performance.js";
import { registerAdminPerformancePeriodsRoutes } from "./routes/admin/performancePeriods.js";
import { registerAdminOutlookAuditRoutes } from "./routes/admin/outlookAudit.js";
import { registerAdminMonthlyReportRoutes } from "./routes/admin/monthlyReport.js";
import { registerCloudPerformanceAnalyticsRoutes } from "./routes/cloud/performanceAnalytics.js";
import { registerLocalAiRoutes } from "./routes/localAi.js";
import { hourlyGenerationTick } from "./services/marketOutlookHourlyTick.js";
import { trackOutlookLifecycleTick } from "./services/marketOutlookTick.js";
import { enqueueIfActionable } from "./services/outlookExecution.js";
import { runStartupTasks } from "./services/startup.js";
import { isApplicationReady, markApplicationReady, readinessSnapshot, runReadinessStep } from "./services/readiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read once at startup rather than via reply.sendFile() -- @fastify/static's
// sendFile treats "index.html" served for the "/" URL as a directory-index
// case and attempts an internal redirect, which throws ForbiddenError with
// index:false. Reading the bytes directly sidesteps that entirely. Missing
// in local dev when the frontend hasn't been built into ./public.
let indexHtml: Buffer | null = null;
try {
  indexHtml = readFileSync(path.join(__dirname, "../public/index.html"));
} catch {
  indexHtml = null;
}

const app = Fastify({
  logger: {
    transport: IS_PRODUCTION ? undefined : { target: "pino-pretty" },
  },
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(422).send({ detail: error.issues });
  }
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({ detail: error.message });
  }
  if (error instanceof LicenseError) {
    return reply.code(error.statusCode).send({ detail: error.detail });
  }
  if (error instanceof LeaseHttpError) {
    return reply.code(error.statusCode).send({ detail: error.detail });
  }
  request.log.error(error);
  return reply.code(500).send({ detail: "Internal server error" });
});

async function main(): Promise<void> {
  // Hostinger requires the process to bind its port within three seconds.
  // Keep the health endpoints available during initialization, but fail all
  // application traffic closed until the database and indexes are ready.
  app.addHook("onRequest", async (request, reply) => {
    const pathName = request.url.split("?", 1)[0];
    if (!isApplicationReady() && pathName !== "/health" && pathName !== "/api/health" && pathName !== "/api/readiness") {
      const readiness = readinessSnapshot();
      return reply.code(503).send({
        detail: readiness.state === "FAILED" ? "Service initialization failed." : "Service is starting.",
        readiness: { state: readiness.state, pending_dependencies: readiness.pending_dependencies, failed_dependencies: readiness.failed_dependencies },
      });
    }
  });

  // Capture the raw request body alongside Fastify's normal JSON parsing --
  // required so the Paystack/Nomba webhook handlers can verify HMAC
  // signatures over the exact bytes the provider signed (JSON.stringify of
  // the parsed body would not reliably reproduce the original byte stream).
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    const buf = body as Buffer;
    (req as unknown as { rawBody: Buffer }).rawBody = buf;
    if (buf.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(buf.toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Port of server.py:8617 CORSMiddleware -- allow_credentials only once
  // specific origins are configured (never with a wildcard '*' origin).
  const wildcard = env.CORS_ORIGINS.length === 1 && env.CORS_ORIGINS[0] === "*";
  await app.register(cors, {
    origin: wildcard ? true : env.CORS_ORIGINS,
    credentials: !wildcard,
  });
  await app.register(cookie);

  // Serves the CRA-built frontend (copied into ./public at deploy time).
  // `index: false` -- index.html is served exclusively via the
  // notFoundHandler below so every non-API, non-file path (client-side
  // SPA routes like /dashboard) falls back to it too, not just "/".
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "../public"),
    index: false,
  });

  await registerRootHealthRoute(app);

  // Exact route, not the notFoundHandler fallback below -- @fastify/static
  // registers its own wildcard GET route that intercepts "/" first and
  // throws (its internal directory-redirect logic misfires with
  // index:false); Fastify's router always prefers an exact match over a
  // wildcard, so this takes priority and serves the SPA shell directly.
  app.get("/", async (_request, reply) => {
    if (indexHtml) return reply.type("text/html").send(indexHtml);
    return reply.callNotFound();
  });

  // Port of server.py's `api_router = APIRouter(prefix="/api")` +
  // `app.include_router(api_router)` -- every /api/* route is registered
  // in this prefixed scope so route files stay prefix-agnostic, matching
  // the Python module boundaries 1:1.
  await app.register(
    async (api) => {
      await registerApiHealthRoutes(api);
      await registerAuthRoutes(api);
      await registerPinRoutes(api);
      await registerCloudMonitorRoutes(api);
      await registerCloudCommandRoutes(api);
      await registerAiRoutes(api);
      await registerMlRoutes(api);
      await registerSmartRoutes(api);
      await registerJournalRoutes(api);
      await registerCloudAuthRoutes(api);
      await registerTradingUniverseRoutes(api);
      await registerCloudActivityRoutes(api);
      await registerCloudReservationRoutes(api);
      await registerCloudLeaseRoutes(api);
      await registerCloudThesisStatusRoutes(api);
      await registerCloudMonitorStatusRoutes(api);
      await registerDecisionFeedRoutes(api);
      await registerNotificationRoutes(api);
      await registerOutlookCurrentRoutes(api);
      await registerOutlookHistoryRoutes(api);
      await registerPurchaseRoutes(api);
      await registerMiscRoutes(api);
      await registerPublicMarketFeedRoutes(api);
      await registerAdminSettingsRoutes(api);
      await registerAdminBankTransferRoutes(api);
      await registerAdminDashboardRoutes(api);
      await registerAdminPinsRoutes(api);
      await registerAdminConfigsRoutes(api);
      await registerAdminAccountRoutes(api);
      await registerAdminEmailRoutes(api);
      await api.register(registerGptEmailActionRoutes);
      await registerMarketingActionRoutes(api);
      await registerAdminReleasesRoutes(api);
      await registerDownloadRoutes(api);
      await registerPerformanceRoutes(api);
      await registerAdminPerformancePeriodsRoutes(api);
      await registerAdminOutlookAuditRoutes(api);
      await registerAdminMonthlyReportRoutes(api);
      await registerCloudPerformanceAnalyticsRoutes(api);
      await registerLocalAiRoutes(api);
      // Every server.py + market_outlook_routes.py endpoint now has a
      // Node.js counterpart -- remaining work is Hostinger deployment +
      // the mandated Python-vs-Node regression pass.
    },
    { prefix: "/api" },
  );

  // SPA fallback -- any unmatched GET outside /api and /health serves the
  // frontend's index.html so client-side routing (e.g. /dashboard, /admin)
  // works on a hard refresh. Unmatched /api/* and non-GET requests keep the
  // normal JSON 404 shape.
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/") && request.url !== "/health" && indexHtml) {
      return reply.type("text/html").send(indexHtml);
    }
    return reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: "Not Found",
      statusCode: 404,
    });
  });

  // Port of server.py:4309 `_outlook_hourly_loop` -- sleeps until the next
  // real UTC hour boundary (not a flat 3600s from server-start time), so it
  // fires at :00 every hour regardless of when the process started.
  async function outlookHourlyLoop(): Promise<void> {
    for (;;) {
      try {
        const [published, actionableDocs] = await hourlyGenerationTick();
        if (published) app.log.info(`[outlook-hourly] published ${published} outlook(s)`);
        for (const doc of actionableDocs) await enqueueIfActionable(doc);
      } catch (e) {
        app.log.warn(`[outlook-hourly] ${String(e)}`);
      }
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setUTCMinutes(0, 0, 0);
      nextHour.setUTCHours(nextHour.getUTCHours() + 1);
      const sleepSeconds = Math.max(30, (nextHour.getTime() - now.getTime()) / 1000 + 15);
      await new Promise((resolve) => setTimeout(resolve, sleepSeconds * 1000));
    }
  }

  // Port of server.py:4350 `_outlook_lifecycle_loop`.
  async function outlookLifecycleLoop(): Promise<void> {
    for (;;) {
      try {
        await trackOutlookLifecycleTick();
      } catch (e) {
        app.log.warn(`[outlook-lifecycle] ${String(e)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }

  // NOTE: server.py also runs `_outlook_history_repair_once` at startup
  // (idempotent backfill of legacy signal history from persisted broker
  // quotes) -- deferred; it is a one-shot historical-data repair, not
  // required for live signal generation/tracking, which both loops above
  // already cover.
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`XauCloud Node backend listening on :${env.PORT}`);

  // Keep Hostinger health probes responsive while initializing, but make every
  // readiness dependency observable and bounded. Previously one opaque boolean
  // remained false forever if any Mongo/index operation hung, while /api/health
  // still returned 200 and gave no clue which step was pending.
  await runReadinessStep("database", () => connectDb(), 30_000);
  await runReadinessStep("startup_tasks", () => runStartupTasks(app.log), 45_000);
  await runReadinessStep("gpt_email_actions", () => ensureGptEmailActionIndexes(), 30_000);
  await runReadinessStep("marketing_actions", () => ensureMarketingActionInfrastructure(), 45_000);
  markApplicationReady();
  app.log.info({ readiness: readinessSnapshot() }, "XauCloud startup initialization complete");

  void outlookHourlyLoop();
  void outlookLifecycleLoop();
}

process.on("SIGTERM", async () => {
  await app.close();
  await closeDb();
  process.exit(0);
});

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
