import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { normalizeLicenseKey, resolveMonitorLicense } from "../../services/license.js";

const ThesisQuerySchema = z.object({
  pin: z.string().optional().default(""),
  license_key: z.string().optional().default(""),
  account: z.string().optional().default(""),
  symbol: z.string().optional().default("XAUUSD"),
});

/**
 * Read-only Outlook thesis feed for the EA (Outlook+Aurum Unified
 * Coordination fix, 2026-09-02). Deliberately NOT part of the
 * cloud_bot_commands channel -- there is nothing here for the EA to
 * "acknowledge" or "execute"; it is directional context Aurum polls and
 * evaluates on its own terms (XAU_TimingAuthorityAllows/
 * XAU_FinalEntryArbiter), exactly like it evaluates any other candidate.
 * See services/outlookExecution.ts's publishOutlookThesis for how rows
 * here get written.
 */
export async function registerCloudOutlookThesisRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cloud/outlook/thesis", async (request) => {
    const q = ThesisQuerySchema.parse(request.query);
    const raw = normalizeLicenseKey(q.license_key || q.pin || "");
    const lic = await resolveMonitorLicense(raw, q.account || "");

    const db = getDb();
    const query: Record<string, unknown> = { status: "ACTIVE", symbol: q.symbol };
    if (lic?.["pin"]) query["license_key"] = lic["pin"];
    if (q.account) query["account"] = String(q.account);

    const nowIso = new Date().toISOString();
    const thesis = await db
      .collection("cloud_outlook_thesis")
      .find({ ...query, expires_at: { $gt: nowIso } }, { projection: { _id: 0 } })
      .sort({ generated_at: -1 })
      .limit(1)
      .next();

    return { ok: true, thesis: thesis ?? null, server_time: nowIso };
  });
}
