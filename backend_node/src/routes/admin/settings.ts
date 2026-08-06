import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { env } from "../../env.js";
import { requireAdmin, verifyPassword } from "../../auth.js";
import { getSettings } from "../../services/settings.js";
import { getOnesignalStatus } from "../../services/notifications.js";
import {
  getNombaConfig,
  logNombaConfigAudit,
  decryptNombaEnvBlock,
  emptyNombaEnvBlock,
  type NombaEnvBlock,
} from "../../services/nombaConfig.js";
import { getAccessToken, NombaError } from "../../services/nombaService.js";
import { encryptSecret, decryptSecret, maskPreview, isConfigured } from "../../services/paymentCrypto.js";
import {
  getBankTransferSettings,
  getPaymentMethodsSettings,
  PAYMENT_METHOD_COPY,
} from "../../services/paymentMethods.js";

const AdminSettingsUpdateSchema = z.object({
  paystack_secret_key: z.string().nullable().optional(),
  pin_price_kobo: z.number().int().nullable().optional(),
  smtp_email: z.string().nullable().optional(),
  smtp_password: z.string().nullable().optional(),
  onesignal_app_id: z.string().nullable().optional(),
  onesignal_api_key: z.string().nullable().optional(),
  email_sender_name: z.string().nullable().optional(),
  admin_notification_email: z.string().nullable().optional(),
  support_email: z.string().nullable().optional(),
  support_phone: z.string().nullable().optional(),
  community_link: z.string().nullable().optional(),
  mt5_download_url: z.string().nullable().optional(),
  vps_guide_url: z.string().nullable().optional(),
  installation_guide_url: z.string().nullable().optional(),
  command_center_url: z.string().nullable().optional(),
});

const NombaConfigUpdateSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  environment: z.string().nullable().optional(),
  sandbox_client_id: z.string().nullable().optional(),
  sandbox_client_secret: z.string().nullable().optional(),
  sandbox_account_id: z.string().nullable().optional(),
  sandbox_webhook_signature_key: z.string().nullable().optional(),
  production_client_id: z.string().nullable().optional(),
  production_client_secret: z.string().nullable().optional(),
  production_account_id: z.string().nullable().optional(),
  production_webhook_signature_key: z.string().nullable().optional(),
  allowed_payment_methods: z.array(z.string()).nullable().optional(),
  currency: z.string().nullable().optional(),
  payment_description: z.string().nullable().optional(),
  current_password: z.string().nullable().optional(),
});

const AdminBankTransferSettingsUpdateSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  timeout_minutes: z.number().int().nullable().optional(),
  proof_required: z.boolean().nullable().optional(),
  support_contact: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
});

const AdminPaymentMethodsSettingsUpdateSchema = z.object({
  paystack_enabled: z.boolean().nullable().optional(),
  nomba_enabled: z.boolean().nullable().optional(),
  default_payment_method: z.string().nullable().optional(),
  payment_method_order: z.array(z.string()).nullable().optional(),
});

const AdminMarketModeSettingsSchema = z.object({
  platform_gold_mode_enabled: z.boolean().default(true),
  platform_index_mode_enabled: z.boolean().default(false),
  allowed_index_symbols: z.array(z.string()).default([]),
  default_trading_universe: z.string().default("GOLD_ONLY"),
});

/** Port of server.py:3124 `_nomba_env_view`. */
function nombaEnvView(envBlock: NombaEnvBlock): Record<string, unknown> {
  const preview = (enc: NombaEnvBlock[keyof NombaEnvBlock]): { configured: boolean; preview: string } => {
    if (!enc || typeof enc !== "object") return { configured: false, preview: "" };
    try {
      const plain = decryptSecret(enc as Parameters<typeof decryptSecret>[0]);
      return { configured: Boolean(plain), preview: maskPreview(plain) };
    } catch {
      return { configured: true, preview: "‹decrypt error›" };
    }
  };
  return {
    client_id: preview(envBlock.client_id_enc),
    client_secret: preview(envBlock.client_secret_enc),
    account_id: preview(envBlock.account_id_enc),
    webhook_signature_key: preview(envBlock.webhook_signature_key_enc),
    last_validated_at: envBlock.last_validated_at,
    last_validation_ok: envBlock.last_validation_ok,
    last_validation_error: envBlock.last_validation_error,
  };
}

/** Port of server.py's admin Settings routes (GET/PUT /admin/settings, Nomba, bank-transfer, payment-methods, market-mode). */
export async function registerAdminSettingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/settings -- server.py:3028
  app.get("/admin/settings", { preHandler: requireAdmin }, async () => {
    const s = await getSettings();
    const pk = String(s["paystack_secret_key"] ?? "");
    const sp = String(s["smtp_password"] ?? "");
    const osk = String(s["onesignal_api_key"] ?? "");
    const priceKobo = Number(s["pin_price_kobo"] ?? 30_000_000);
    return {
      paystack_configured: Boolean(pk),
      paystack_key_preview: pk.length > 12 ? `${pk.slice(0, 8)}...${pk.slice(-4)}` : pk ? "set" : "not set",
      pin_price_kobo: priceKobo,
      pin_price_naira: priceKobo / 100,
      smtp_email: s["smtp_email"] ?? "",
      smtp_configured: Boolean(sp),
      onesignal_app_id: s["onesignal_app_id"] ?? "",
      onesignal_api_key_configured: Boolean(osk),
      onesignal_api_key_preview: osk.length > 10 ? `${osk.slice(0, 6)}...${osk.slice(-4)}` : osk ? "set" : "not set",
      email_sender_name: s["email_sender_name"] || "XauCloud",
      admin_notification_email: s["admin_notification_email"] ?? "",
      support_email: s["support_email"] ?? "",
      support_phone: s["support_phone"] ?? "",
      community_link: s["community_link"] ?? "",
      mt5_download_url: s["mt5_download_url"] ?? "",
      vps_guide_url: s["vps_guide_url"] ?? "",
      installation_guide_url: s["installation_guide_url"] ?? "",
      command_center_url: s["command_center_url"] ?? "",
    };
  });

  // GET /admin/notifications/health -- server.py:3061
  app.get("/admin/notifications/health", { preHandler: requireAdmin }, async () => {
    const db = getDb();
    const onesignalStatus = await getOnesignalStatus();
    const deviceCount = await db.collection("cloud_push_subscriptions").countDocuments({ opted_in: true });
    const lastSent = await db
      .collection("cloud_notification_log")
      .findOne({ delivery_status: "SENT" }, { projection: { _id: 0, scheduled_time: 1, user_id: 1 }, sort: { scheduled_time: -1 } });
    const lastFailed = await db
      .collection("cloud_notification_log")
      .findOne(
        { delivery_status: { $ne: "SENT" } },
        { projection: { _id: 0, scheduled_time: 1, delivery_status: 1, failure_reason: 1 }, sort: { scheduled_time: -1 } },
      );
    const remediation = !onesignalStatus["configured"]
      ? "Not configured. Create a free OneSignal account at onesignal.com, add a Web Push app, copy its App ID and REST API Key from Settings -> Keys & IDs, and paste both into Settings on this admin dashboard."
      : "Configured. If sends are still failing, check the failure reason on the last failed send below -- AUTHENTICATION_FAILED means the REST API Key is wrong, NO_DEVICE_REGISTERED means no user has granted browser permission yet.";
    return {
      onesignal: { ...onesignalStatus, remediation },
      subscribed_devices: deviceCount,
      last_successful_send: lastSent,
      last_failed_send: lastFailed,
    };
  });

  // PUT /admin/settings -- server.py:3097
  app.put("/admin/settings", { preHandler: requireAdmin }, async (request) => {
    const req = AdminSettingsUpdateSchema.parse(request.body ?? {});
    const updates: Record<string, unknown> = {};
    if (req.paystack_secret_key !== undefined && req.paystack_secret_key !== null) updates["paystack_secret_key"] = req.paystack_secret_key;
    if (req.pin_price_kobo !== undefined && req.pin_price_kobo !== null) updates["pin_price_kobo"] = req.pin_price_kobo;
    if (req.smtp_email !== undefined && req.smtp_email !== null) updates["smtp_email"] = req.smtp_email;
    if (req.smtp_password !== undefined && req.smtp_password !== null) updates["smtp_password"] = req.smtp_password;
    if (req.onesignal_app_id !== undefined && req.onesignal_app_id !== null) updates["onesignal_app_id"] = req.onesignal_app_id.trim();
    if (req.onesignal_api_key !== undefined && req.onesignal_api_key !== null) updates["onesignal_api_key"] = req.onesignal_api_key.trim();
    if (req.email_sender_name !== undefined && req.email_sender_name !== null) updates["email_sender_name"] = req.email_sender_name.trim();
    if (req.admin_notification_email !== undefined && req.admin_notification_email !== null)
      updates["admin_notification_email"] = req.admin_notification_email.trim().toLowerCase();
    if (req.support_email !== undefined && req.support_email !== null) updates["support_email"] = req.support_email.trim().toLowerCase();
    if (req.support_phone !== undefined && req.support_phone !== null) updates["support_phone"] = req.support_phone.trim();
    if (req.community_link !== undefined && req.community_link !== null) updates["community_link"] = req.community_link.trim();
    if (req.mt5_download_url !== undefined && req.mt5_download_url !== null) updates["mt5_download_url"] = req.mt5_download_url.trim();
    if (req.vps_guide_url !== undefined && req.vps_guide_url !== null) updates["vps_guide_url"] = req.vps_guide_url.trim();
    if (req.installation_guide_url !== undefined && req.installation_guide_url !== null)
      updates["installation_guide_url"] = req.installation_guide_url.trim();
    if (req.command_center_url !== undefined && req.command_center_url !== null) updates["command_center_url"] = req.command_center_url.trim();
    if (Object.keys(updates).length > 0) {
      await getDb().collection("admin_settings").updateOne({ key: "main" }, { $set: updates }, { upsert: true });
    }
    return { updated: true };
  });

  // GET /admin/settings/nomba -- server.py:3146
  app.get("/admin/settings/nomba", { preHandler: requireAdmin }, async () => {
    const cfg = await getNombaConfig();
    return {
      enabled: cfg["enabled"] ?? false,
      environment: cfg["environment"] ?? "sandbox",
      sandbox: nombaEnvView((cfg["sandbox"] as NombaEnvBlock | undefined) ?? emptyNombaEnvBlock()),
      production: nombaEnvView((cfg["production"] as NombaEnvBlock | undefined) ?? emptyNombaEnvBlock()),
      allowed_payment_methods: cfg["allowed_payment_methods"] ?? ["card", "transfer", "ussd", "qr"],
      currency: cfg["currency"] ?? "NGN",
      payment_description: cfg["payment_description"] ?? "",
      callback_url: `${env.PUBLIC_SITE_URL}/purchase/success`,
      webhook_url: `${env.PUBLIC_SITE_URL}/api/webhook/nomba`,
      encryption_configured: isConfigured(),
    };
  });

  // PUT /admin/settings/nomba -- server.py:3164
  app.put("/admin/settings/nomba", { preHandler: requireAdmin }, async (request, reply) => {
    const req = NombaConfigUpdateSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    if (!isConfigured()) {
      return reply.code(503).send({
        detail:
          "PAYMENT_CONFIG_ENCRYPTION_KEY is not set on the server -- Nomba credentials cannot be saved until it is. See audits/nomba_migration/ for setup instructions.",
      });
    }

    const cfg = await getNombaConfig();
    const changedFields: string[] = [];
    const updates: Record<string, unknown> = {};

    const productionTouched =
      req.production_client_id != null ||
      req.production_client_secret != null ||
      req.production_account_id != null ||
      req.production_webhook_signature_key != null ||
      (req.environment === "production" && cfg["environment"] !== "production");
    if (productionTouched) {
      if (!req.current_password) {
        return reply.code(401).send({ detail: "Current admin password required to change production settings." });
      }
      const full = await getDb().collection("users").findOne({ email: admin["email"] });
      if (!full || !(await verifyPassword(req.current_password, String(full["password_hash"] ?? "")))) {
        return reply.code(401).send({ detail: "Incorrect password." });
      }
    }

    if (req.enabled != null) {
      updates["enabled"] = req.enabled;
      changedFields.push("enabled");
    }
    if (req.environment != null) {
      if (!["sandbox", "production"].includes(req.environment)) {
        return reply.code(400).send({ detail: "environment must be 'sandbox' or 'production'" });
      }
      updates["environment"] = req.environment;
      changedFields.push("environment");
    }
    if (req.allowed_payment_methods != null) {
      updates["allowed_payment_methods"] = req.allowed_payment_methods;
      changedFields.push("allowed_payment_methods");
    }
    if (req.currency != null) {
      updates["currency"] = req.currency;
      changedFields.push("currency");
    }
    if (req.payment_description != null) {
      updates["payment_description"] = req.payment_description;
      changedFields.push("payment_description");
    }

    const applyEnvField = (envName: "sandbox" | "production", value: string | null | undefined, subKey: string, label: string): void => {
      if (value != null) {
        updates[`${envName}.${subKey}`] = encryptSecret(value);
        changedFields.push(`${envName}.${label}`);
      }
    };
    applyEnvField("sandbox", req.sandbox_client_id, "client_id_enc", "client_id");
    applyEnvField("sandbox", req.sandbox_client_secret, "client_secret_enc", "client_secret");
    applyEnvField("sandbox", req.sandbox_account_id, "account_id_enc", "account_id");
    applyEnvField("sandbox", req.sandbox_webhook_signature_key, "webhook_signature_key_enc", "webhook_signature_key");
    applyEnvField("production", req.production_client_id, "client_id_enc", "client_id");
    applyEnvField("production", req.production_client_secret, "client_secret_enc", "client_secret");
    applyEnvField("production", req.production_account_id, "account_id_enc", "account_id");
    applyEnvField("production", req.production_webhook_signature_key, "webhook_signature_key_enc", "webhook_signature_key");

    if (Object.keys(updates).length > 0) {
      await getDb().collection("payment_nomba_config").updateOne({ key: "main" }, { $set: updates }, { upsert: true });
      await logNombaConfigAudit(String(admin["email"]), changedFields, req.environment ?? String(cfg["environment"] ?? "sandbox"), null);
    }
    return { updated: true, changed_fields: changedFields };
  });

  // POST /admin/settings/nomba/test-connection -- server.py:3231
  app.post("/admin/settings/nomba/test-connection", { preHandler: requireAdmin }, async (request, reply) => {
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const cfg = await getNombaConfig();
    const environment = (cfg["environment"] as "sandbox" | "production" | undefined) ?? "sandbox";
    const envBlock = (cfg[environment] as NombaEnvBlock | undefined) ?? emptyNombaEnvBlock();
    const creds = decryptNombaEnvBlock(envBlock, environment);
    if (!creds) {
      return reply.code(400).send({ detail: `${environment} credentials are not fully configured (client ID, client secret, and account ID are all required).` });
    }

    const nowIso = new Date().toISOString();
    let ok = true;
    let errorMsg: string | null = null;
    try {
      await getAccessToken(creds, true);
    } catch (err) {
      if (err instanceof NombaError) {
        ok = false;
        errorMsg = err.message;
      } else {
        throw err;
      }
    }

    await getDb().collection("payment_nomba_config").updateOne(
      { key: "main" },
      { $set: { [`${environment}.last_validated_at`]: nowIso, [`${environment}.last_validation_ok`]: ok, [`${environment}.last_validation_error`]: errorMsg } },
    );
    await logNombaConfigAudit(String(admin["email"]), ["test_connection"], environment, ok);
    if (!ok) return { success: false, environment, message: `Connection failed: ${errorMsg}` };
    return { success: true, environment, message: "Successfully authenticated with Nomba.", validated_at: nowIso };
  });

  // GET /admin/settings/nomba/audit-log -- server.py:3267
  app.get("/admin/settings/nomba/audit-log", { preHandler: requireAdmin }, async (request) => {
    const q = z.object({ limit: z.coerce.number().int().optional().default(50) }).parse(request.query);
    const entries = await getDb()
      .collection("payment_config_audit_log")
      .find({ provider: "NOMBA" }, { projection: { _id: 0 } })
      .sort({ at: -1 })
      .limit(Math.min(q.limit, 200))
      .toArray();
    return { entries };
  });

  // GET /admin/settings/bank-transfer -- server.py:3280
  app.get("/admin/settings/bank-transfer", { preHandler: requireAdmin }, async () => getBankTransferSettings());

  // PUT /admin/settings/bank-transfer -- server.py:3284
  app.put("/admin/settings/bank-transfer", { preHandler: requireAdmin }, async (request) => {
    const req = AdminBankTransferSettingsUpdateSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const fieldMap: Record<string, string> = {
      enabled: "bank_transfer_enabled",
      bank_name: "bank_transfer_bank_name",
      account_name: "bank_transfer_account_name",
      account_number: "bank_transfer_account_number",
      timeout_minutes: "bank_transfer_timeout_minutes",
      proof_required: "bank_transfer_proof_required",
      support_contact: "bank_transfer_support_contact",
      instructions: "bank_transfer_instructions",
    };
    const updates: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const [field, dbKey] of Object.entries(fieldMap)) {
      const val = (req as Record<string, unknown>)[field];
      if (val !== undefined && val !== null) {
        updates[dbKey] = val;
        changedFields.push(field);
      }
    }
    if (Object.keys(updates).length > 0) {
      await getDb().collection("admin_settings").updateOne({ key: "main" }, { $set: updates }, { upsert: true });
      await getDb().collection("payment_config_audit_log").insertOne({
        id: randomUUID(),
        provider: "BANK_TRANSFER",
        admin_email: admin["email"],
        changed_fields: changedFields,
        at: new Date().toISOString(),
      });
    }
    return getBankTransferSettings();
  });

  // GET /admin/settings/payment-methods -- server.py:3307
  app.get("/admin/settings/payment-methods", { preHandler: requireAdmin }, async () => getPaymentMethodsSettings());

  // PUT /admin/settings/payment-methods -- server.py:3311
  app.put("/admin/settings/payment-methods", { preHandler: requireAdmin }, async (request, reply) => {
    const req = AdminPaymentMethodsSettingsUpdateSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const updates: Record<string, unknown> = {};
    const changedFields: string[] = [];
    if (req.paystack_enabled != null) {
      updates["payment_paystack_enabled"] = req.paystack_enabled;
      changedFields.push("paystack_enabled");
    }
    if (req.nomba_enabled != null) {
      updates["payment_nomba_enabled"] = req.nomba_enabled;
      changedFields.push("nomba_enabled");
    }
    if (req.default_payment_method != null) {
      if (!(req.default_payment_method in PAYMENT_METHOD_COPY)) {
        return reply.code(400).send({ detail: `default_payment_method must be one of ${Object.keys(PAYMENT_METHOD_COPY)}` });
      }
      updates["payment_default_method"] = req.default_payment_method;
      changedFields.push("default_payment_method");
    }
    if (req.payment_method_order != null) {
      const invalid = req.payment_method_order.filter((m) => !(m in PAYMENT_METHOD_COPY));
      if (invalid.length > 0) {
        return reply.code(400).send({ detail: `Unknown payment method(s) in order: ${invalid}` });
      }
      updates["payment_method_order"] = req.payment_method_order;
      changedFields.push("payment_method_order");
    }
    if (Object.keys(updates).length > 0) {
      await getDb().collection("admin_settings").updateOne({ key: "main" }, { $set: updates }, { upsert: true });
      await getDb().collection("payment_config_audit_log").insertOne({
        id: randomUUID(),
        provider: "PAYMENT_METHODS",
        admin_email: admin["email"],
        changed_fields: changedFields,
        at: new Date().toISOString(),
      });
    }
    return getPaymentMethodsSettings();
  });

  // GET /admin/market-mode-settings -- server.py:3468
  app.get("/admin/market-mode-settings", { preHandler: requireAdmin }, async () => {
    const s = (await getDb().collection("admin_settings").findOne({ key: "main" }, { projection: { _id: 0 } })) ?? {};
    return AdminMarketModeSettingsSchema.parse(s);
  });

  // PUT /admin/market-mode-settings -- server.py:3473
  app.put("/admin/market-mode-settings", { preHandler: requireAdmin }, async (request) => {
    const req = AdminMarketModeSettingsSchema.parse(request.body ?? {});
    await getDb().collection("admin_settings").updateOne({ key: "main" }, { $set: req }, { upsert: true });
    return { updated: true, settings: req };
  });
}
