import { getDb } from "../db.js";
import { env } from "../env.js";

/** Port of server.py:642 `get_settings` -- lazily creates the singleton admin_settings doc from env defaults. */
export async function getSettings(): Promise<Record<string, unknown>> {
  const db = getDb();
  const existing = await db.collection("admin_settings").findOne({ key: "main" }, { projection: { _id: 0 } });
  if (existing) return existing;

  const fresh: Record<string, unknown> = {
    key: "main",
    paystack_secret_key: env.PAYSTACK_SECRET_KEY,
    pin_price_kobo: env.PAYSTACK_PIN_PRICE_KOBO,
    smtp_email: env.SMTP_EMAIL,
    smtp_password: env.SMTP_PASSWORD,
  };
  await db.collection("admin_settings").insertOne({ ...fresh });
  return fresh;
}
