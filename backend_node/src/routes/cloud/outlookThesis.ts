import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { normalizeLicenseKey, resolveEaMonitorLicense } from "../../services/license.js";

const ThesisQuerySchema = z.object({
  pin: z.string().optional().default(""), license_key: z.string().optional().default(""),
  account: z.string().trim().min(1), symbol: z.string().optional().default("XAUUSD"),
});

export async function registerCloudOutlookThesisRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cloud/outlook/thesis", async (request) => {
    const q = ThesisQuerySchema.parse(request.query);
    const raw = normalizeLicenseKey(q.license_key || q.pin || "");
    const lic = await resolveEaMonitorLicense(raw, q.account);
    const db = getDb(); const nowIso = new Date().toISOString();
    const pointerId = `${q.account}:${q.symbol}`;
    const pointers = db.collection("cloud_outlook_current");
    let pointer = await pointers.findOne({ _id: pointerId as unknown as never });
    if (!pointer) {
      const legacy = await db.collection("cloud_outlook_thesis").findOne(
        { account: q.account, symbol: q.symbol, status: "ACTIVE", license_key: String(lic["pin"] ?? ""), expires_at: { $gt: nowIso } },
        { projection: { _id: 0 }, sort: { generated_at: -1 } },
      );
      if (legacy) {
        try {
          await pointers.updateOne(
            { _id: pointerId as unknown as never },
            { $setOnInsert: { account: q.account, symbol: q.symbol, outlook_id: legacy["outlook_id"], license_key: lic["pin"], generated_at: legacy["generated_at"], ordering_key: `${legacy["generated_at"]}|${legacy["outlook_id"]}`, expires_at: legacy["expires_at"], updated_at: nowIso } },
            { upsert: true },
          );
        } catch (error) {
          if ((error as { code?: number }).code !== 11000) throw error;
        }
        pointer = await pointers.findOne({ _id: pointerId as unknown as never });
      }
    }
    const outlookId = String(pointer?.["outlook_id"] ?? "");
    if (!outlookId) return { ok: true, thesis: null, server_time: nowIso };
    const terminal = await db.collection("cloud_market_outlook_outcomes").findOne({ outlook_id: outlookId }, { projection: { _id: 1 } });
    if (terminal || String(pointer?.["expires_at"] ?? "") <= nowIso) {
      const status = terminal ? "RESOLVED" : "EXPIRED";
      await db.collection("cloud_outlook_thesis").updateOne({ account: q.account, symbol: q.symbol, outlook_id: outlookId }, { $set: { status, terminal_at: nowIso, updated_at: nowIso } });
      await db.collection("cloud_outlook_current").deleteOne({ _id: pointerId as unknown as never, outlook_id: outlookId });
      return { ok: true, thesis: null, server_time: nowIso };
    }
    const thesis = await db.collection("cloud_outlook_thesis").findOne(
      { account: q.account, symbol: q.symbol, outlook_id: outlookId, status: "ACTIVE", license_key: String(lic["pin"] ?? ""), expires_at: { $gt: nowIso } },
      { projection: { _id: 0 } },
    );
    if (!thesis) await db.collection("cloud_outlook_current").deleteOne({ _id: pointerId as unknown as never, outlook_id: outlookId });
    return { ok: true, thesis: thesis ?? null, server_time: nowIso };
  });
} // ASTRA_REPAIR_V2_6287 / 007,023
