import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { getDb } from "../db.js";
import { env } from "../env.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { ensureLocalAiIndexes } from "./localAiRelay.js";

/**
 * Port of server.py's `@app.on_event("startup")` handler (lines 4139-4283):
 * one-time-per-boot admin seeding and MongoDB index creation. Every index
 * failure is caught and logged individually (matching Python's per-index
 * try/except), never aborting the rest of startup or the process.
 */
export async function runStartupTasks(log: FastifyBaseLogger): Promise<void> {
  const db = getDb();

  const adminEmail = (env.ADMIN_EMAIL || "admin@aisniper.com").toLowerCase();
  const adminPasswordEnv = env.ADMIN_PASSWORD;
  let generatedPassword: string | null = null;
  const adminPassword = adminPasswordEnv || (generatedPassword = randomBytes(18).toString("base64url"));

  const existing = await db.collection("users").findOne({ email: adminEmail });
  // Never seed a second admin: if the owner has changed their login email in
  // the Account tab (e.g. to admin@ai.xaucloud.io), the seed-email lookup above
  // won't match, but an admin still exists — seeding again would create a
  // duplicate account with a random password. Only seed when NO admin exists.
  const anyAdmin = existing ?? (await db.collection("users").findOne({ role: "admin" }));
  if (!anyAdmin) {
    await db.collection("users").insertOne({
      email: adminEmail,
      password_hash: await hashPassword(adminPassword),
      name: "Admin",
      role: "admin",
      created_at: new Date().toISOString(),
    });
    if (generatedPassword) {
      log.warn(
        `Admin seeded: ${adminEmail} — ADMIN_PASSWORD env var not set, generated one-time password: ${generatedPassword} (set ADMIN_PASSWORD to avoid a new random password on next restart)`,
      );
    } else {
      log.info(`Admin seeded: ${adminEmail}`);
    }
  } else if (existing && adminPasswordEnv && !(await verifyPassword(adminPassword, String(existing["password_hash"] ?? "")))) {
    await db.collection("users").updateOne({ email: adminEmail }, { $set: { password_hash: await hashPassword(adminPassword) } });
    log.info("Admin password updated");
  }

  const tryIndex = async (label: string, fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return `${label}: OK`;
    } catch (e) {
      log.warn(`[startup] index ${label} failed: ${String(e)}`);
      return `${label}: FAILED (${String(e)})`;
    }
  };

  await db.collection("users").createIndex("email", { unique: true }).catch((e) => log.warn(`[startup] users.email index: ${String(e)}`));
  await db
    .collection("payment_transactions")
    .createIndex("reference", { unique: true })
    .catch((e) => log.warn(`[payments] could not create payment_transactions.reference index: ${String(e)}`));
  await db
    .collection("pin_licenses")
    .createIndex("payment_ref", { unique: true, partialFilterExpression: { payment_ref: { $type: "string" } } })
    .catch((e) => log.warn(`[payments] could not create pin_licenses.payment_ref index: ${String(e)}`));
  await db
    .collection("cloud_notification_log")
    .createIndex("idempotency_key", { unique: true })
    .catch((e) => log.warn(`[outlook-notifications] could not create idempotency_key index: ${String(e)}`));

  try {
    await db.collection("cloud_market_outlooks").createIndex("id", { unique: true });
    await db.collection("cloud_market_outlooks").createIndex({ account: 1, generated_at: -1 });
    await db.collection("cloud_market_outlooks").createIndex({ monitoring_closed: 1, primary_direction: 1, account: 1 });
    await db.collection("cloud_market_outlook_outcomes").createIndex("outlook_id", { unique: true });
    await db.collection("cloud_bot_activity").createIndex({ account: 1, ts: 1 });
    await db.collection("cloud_notification_prefs").createIndex("user_id", { unique: true });
    await db.collection("cloud_push_subscriptions").createIndex({ user_id: 1, opted_in: 1 });
    await db.collection("cloud_outlook_signal_events").createIndex(
      { account: 1, candidate_id: 1, event_type: 1, event_version: 1 },
      { unique: true },
    );
    await db.collection("cloud_outlook_signal_events").createIndex({ account: 1, symbol: 1, signal_bar_time: -1, event_time: -1 });
  } catch (e) {
    log.warn(`[signal-outlook] could not create lifecycle indexes: ${String(e)}`);
  }

  await db
    .collection("cloud_bot_commands")
    .createIndex("dedupe_key", { unique: true, sparse: true })
    .catch((e) => log.warn(`[remote-command] could not create dedupe_key index: ${String(e)}`));

  await ensureLocalAiIndexes().catch((e) => log.warn(`[local-ai-remote] could not create queue indexes: ${String(e)}`));

  const indexReport: string[] = [];
  indexReport.push(await tryIndex("cloud_users.email: unique", () => db.collection("cloud_users").createIndex("email", { unique: true })));
  indexReport.push(await tryIndex("pin_licenses.pin: unique", () => db.collection("pin_licenses").createIndex("pin", { unique: true })));
  indexReport.push(
    await tryIndex("trade_journal.trade_identity: unique sparse", () =>
      db.collection("trade_journal").createIndex("trade_identity", { unique: true, sparse: true }),
    ),
  );
  indexReport.push(
    await tryIndex("trade_journal.closed_at network results", () =>
      db.collection("trade_journal").createIndex({ closed_at: -1, account_login: 1, ticket: 1 }),
    ),
  );
  indexReport.push(await tryIndex("admin_email_drafts.id: unique", () => db.collection("admin_email_drafts").createIndex("id", { unique: true })));
  indexReport.push(await tryIndex("admin_email_templates.id: unique", () => db.collection("admin_email_templates").createIndex("id", { unique: true })));
  indexReport.push(await tryIndex("admin_email_log.at", () => db.collection("admin_email_log").createIndex({ at: -1 })));
  indexReport.push(
    await tryIndex("login_audit_log.ts: TTL(180d)", () => db.collection("login_audit_log").createIndex("ts", { expireAfterSeconds: 180 * 86400 })),
  );
  indexReport.push(
    await tryIndex("used_password_reset_tokens: unique+TTL", async () => {
      await db.collection("used_password_reset_tokens").createIndex("jti", { unique: true });
      await db.collection("used_password_reset_tokens").createIndex("used_at", { expireAfterSeconds: 3600 });
    }),
  );
  log.info(`[startup] index report: ${indexReport.join(" | ")}`);
}
