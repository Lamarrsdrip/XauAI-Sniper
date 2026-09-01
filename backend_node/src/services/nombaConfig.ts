import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { decryptSecret, type EncryptedSecret } from "./paymentCrypto.js";
import type { NombaCredentials } from "./nombaService.js";

const NOMBA_CONFIG_DEFAULT_METHODS = ["card", "transfer", "ussd", "qr"];

export interface NombaEnvBlock {
  client_id_enc: EncryptedSecret | null;
  client_secret_enc: EncryptedSecret | null;
  account_id_enc: EncryptedSecret | null;
  webhook_signature_key_enc: EncryptedSecret | null;
  last_validated_at: string | null;
  last_validation_ok: boolean | null;
  last_validation_error: string | null;
}

/** Port of server.py:680 `_empty_nomba_env_block`. */
export function emptyNombaEnvBlock(): NombaEnvBlock {
  return {
    client_id_enc: null,
    client_secret_enc: null,
    account_id_enc: null,
    webhook_signature_key_enc: null,
    last_validated_at: null,
    last_validation_ok: null,
    last_validation_error: null,
  };
}

/** Port of server.py:688 `get_nomba_config`. */
export async function getNombaConfig(): Promise<Record<string, unknown>> {
  const db = getDb();
  const existing = await db.collection("payment_nomba_config").findOne({ key: "main" }, { projection: { _id: 0 } });
  if (existing) return existing;

  const fresh: Record<string, unknown> = {
    key: "main",
    enabled: false,
    environment: "sandbox",
    sandbox: emptyNombaEnvBlock(),
    production: emptyNombaEnvBlock(),
    allowed_payment_methods: NOMBA_CONFIG_DEFAULT_METHODS,
    currency: "NGN",
    payment_description: "XauCloud EA Lifetime License",
  };
  await db.collection("payment_nomba_config").insertOne({ ...fresh });
  return fresh;
}

/** Port of server.py:701 `_decrypt_nomba_env_block`. */
export function decryptNombaEnvBlock(envBlock: NombaEnvBlock, environment: "sandbox" | "production"): NombaCredentials | null {
  let clientId: string, clientSecret: string, accountId: string, webhookKey: string;
  try {
    clientId = decryptSecret(envBlock.client_id_enc);
    clientSecret = decryptSecret(envBlock.client_secret_enc);
    accountId = decryptSecret(envBlock.account_id_enc);
    webhookKey = decryptSecret(envBlock.webhook_signature_key_enc);
  } catch {
    return null;
  }
  if (!(clientId && clientSecret && accountId)) return null;
  return { client_id: clientId, client_secret: clientSecret, account_id: accountId, webhook_signature_key: webhookKey, environment };
}

/** Port of server.py:721 `get_active_nomba_credentials` -- never throws; "not configured" is a normal, handled state. */
export async function getActiveNombaCredentials(): Promise<[Record<string, unknown>, NombaCredentials | null]> {
  const cfg = await getNombaConfig();
  if (!cfg["enabled"]) return [cfg, null];
  const environment = (cfg["environment"] as "sandbox" | "production") ?? "sandbox";
  const envBlock = (cfg[environment] as NombaEnvBlock | undefined) ?? emptyNombaEnvBlock();
  const creds = decryptNombaEnvBlock(envBlock, environment);
  return [cfg, creds];
}

/** Port of server.py:735 `_log_nomba_config_audit`. */
export async function logNombaConfigAudit(adminEmail: string, changedFields: string[], environment: string, testPassed: boolean | null): Promise<void> {
  await getDb().collection("payment_config_audit_log").insertOne({
    id: randomUUID(),
    provider: "NOMBA",
    admin_email: adminEmail,
    changed_fields: changedFields,
    environment,
    test_connection_passed: testPassed,
    at: new Date().toISOString(),
  });
}
