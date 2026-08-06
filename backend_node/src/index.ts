import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
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
import { registerAdminSettingsRoutes } from "./routes/admin/settings.js";
import { registerAdminBankTransferRoutes } from "./routes/admin/bankTransfers.js";
import { registerAdminDashboardRoutes } from "./routes/admin/dashboard.js";
import { registerAdminPinsRoutes } from "./routes/admin/pins.js";
import { registerAdminConfigsRoutes } from "./routes/admin/configs.js";
import { registerAdminAccountRoutes } from "./routes/admin/account.js";
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
  await connectDb();
  await runStartupTasks(app.log);

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

  await registerRootHealthRoute(app);

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
      await registerAdminSettingsRoutes(api);
      await registerAdminBankTransferRoutes(api);
      await registerAdminDashboardRoutes(api);
      await registerAdminPinsRoutes(api);
      await registerAdminConfigsRoutes(api);
      await registerAdminAccountRoutes(api);
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
  void outlookHourlyLoop();
  void outlookLifecycleLoop();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`XauCloud Node backend listening on :${env.PORT}`);
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
