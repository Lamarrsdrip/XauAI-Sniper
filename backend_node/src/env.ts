import "dotenv/config";

/**
 * Port of backend/server.py's environment loading, including the
 * IS_PRODUCTION fail-closed default and the JWT_SECRET refuse-to-start
 * behavior (server.py:_load_or_create_jwt_secret). Unset/unknown
 * ENVIRONMENT must be treated as production, not development -- this is a
 * deliberate v6.25.3 owner-directive security fix in the Python source and
 * must not regress in the port.
 */

const DEV_ENV_VALUES = new Set(["development", "dev", "local", "test", "testing"]);

export const ENVIRONMENT = (process.env["ENVIRONMENT"] ?? "production").trim().toLowerCase();
export const IS_PRODUCTION = !DEV_ENV_VALUES.has(ENVIRONMENT);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (IS_PRODUCTION) {
    throw new Error(
      `${name} environment variable is not set. Refusing to start in production with a ` +
        `missing/auto-generated value -- this mirrors backend/server.py's fail-closed startup ` +
        `check. Set ${name} explicitly, or set ENVIRONMENT=development for local work only.`,
    );
  }
  return "";
}

export const env = {
  MONGO_URL: process.env["MONGO_URL"] ?? "mongodb://localhost:27017",
  DB_NAME: process.env["DB_NAME"] ?? "xaucloud",
  JWT_SECRET: requireEnv("JWT_SECRET"),
  ADMIN_EMAIL: process.env["ADMIN_EMAIL"] ?? "",
  ADMIN_PASSWORD: process.env["ADMIN_PASSWORD"] ?? "",
  COOKIE_SECURE: (process.env["COOKIE_SECURE"] ?? "true").toLowerCase() !== "false",
  CORS_ORIGINS: (process.env["CORS_ORIGINS"] ?? "*").split(",").map((s) => s.trim()).filter(Boolean),
  PUBLIC_SITE_URL: process.env["PUBLIC_SITE_URL"] ?? "https://xaucloud.io",
  PAYMENT_CONFIG_ENCRYPTION_KEY: process.env["PAYMENT_CONFIG_ENCRYPTION_KEY"] ?? "",
  PAYSTACK_SECRET_KEY: process.env["PAYSTACK_SECRET_KEY"] ?? "",
  PAYSTACK_PIN_PRICE_KOBO: Number(process.env["PAYSTACK_PIN_PRICE_KOBO"] ?? "30000000"),
  SMTP_EMAIL: process.env["SMTP_EMAIL"] ?? "",
  SMTP_PASSWORD: process.env["SMTP_PASSWORD"] ?? "",
  EMERGENT_LLM_KEY: process.env["EMERGENT_LLM_KEY"] ?? "",
  AI_COST_DAILY_CALL_LIMIT: Number(process.env["AI_COST_DAILY_CALL_LIMIT"] ?? "0"),
  AI_COST_MIN_SECONDS: Number(process.env["AI_COST_MIN_SECONDS"] ?? "0"),
  AI_COST_CACHE_TTL_SECONDS: Number(process.env["AI_COST_CACHE_TTL_SECONDS"] ?? "0"),
  AI_COST_DUAL_AI_CONFIDENCE_GAP: Number(process.env["AI_COST_DUAL_AI_CONFIDENCE_GAP"] ?? "0"),
  AI_COST_TOKEN_PRICE_PER_1K: Number(process.env["AI_COST_TOKEN_PRICE_PER_1K"] ?? "0"),
  CLOUD_AGENT_TOKEN: process.env["CLOUD_AGENT_TOKEN"] ?? "",
  XAU_PUBLIC_BACKEND_URL: process.env["XAU_PUBLIC_BACKEND_URL"] ?? "",
  XAUCLOUD_LEASE_SIGNING_KEY_ID: process.env["XAUCLOUD_LEASE_SIGNING_KEY_ID"] ?? "",
  XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY: process.env["XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY"] ?? "",
  XAUCLOUD_LEASE_VALIDITY_SECONDS: Number(process.env["XAUCLOUD_LEASE_VALIDITY_SECONDS"] ?? "3600"),
  XAUCLOUD_LEASE_RENEWAL_SECONDS: Number(process.env["XAUCLOUD_LEASE_RENEWAL_SECONDS"] ?? "1800"),
  XAUCLOUD_LEASE_MAX_OFFLINE_CAMPAIGNS: Number(process.env["XAUCLOUD_LEASE_MAX_OFFLINE_CAMPAIGNS"] ?? "1"),
  PORT: Number(process.env["PORT"] ?? "8000"),
  EXCHANGE_RATE_API_KEY: process.env["EXCHANGE_RATE_API_KEY"] ?? "",
  XAU_LOCAL_AI_WORKER_SECRET: (process.env["XAU_LOCAL_AI_WORKER_SECRET"] ?? "").trim(),
  XAU_LOCAL_AI_WORKER_LEASE_SECONDS: Number(process.env["XAU_LOCAL_AI_WORKER_LEASE_SECONDS"] ?? "60"),
  XAU_LOCAL_AI_JOB_DEADLINE_SECONDS: Number(process.env["XAU_LOCAL_AI_JOB_DEADLINE_SECONDS"] ?? "300"),
  XAU_LOCAL_AI_RESULT_RETENTION_SECONDS: Number(process.env["XAU_LOCAL_AI_RESULT_RETENTION_SECONDS"] ?? "86400"),
  XAU_LOCAL_AI_MAX_ATTEMPTS: Number(process.env["XAU_LOCAL_AI_MAX_ATTEMPTS"] ?? "3"),
  XAU_LOCAL_AI_GLOBAL_QUEUE_LIMIT: Number(process.env["XAU_LOCAL_AI_GLOBAL_QUEUE_LIMIT"] ?? "100"),
  XAU_LOCAL_AI_CONFIDENCE_THRESHOLD: Number(process.env["XAU_LOCAL_AI_CONFIDENCE_THRESHOLD"] ?? "70"),
};
