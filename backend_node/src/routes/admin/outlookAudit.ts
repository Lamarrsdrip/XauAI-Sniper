import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireAdmin, verifyPassword } from "../../auth.js";
import {
  ANALYTICS_TERMINAL_OUTCOMES,
  MAX_HISTORICAL_QUOTE_GAP_SECONDS,
  OUTLOOK_EVALUATION_MINUTES,
  OUTLOOK_HORIZON_HOURS,
  SIGNAL_TRACKING,
  XAUCLOUD_R_UNIT_GOLD_MOVES,
} from "../../services/marketOutlookCore.js";
import { asUtc } from "../../services/marketOutlookEvidence.js";
import { advancePersistedSignal } from "../../services/marketOutlookLifecycle.js";
import { fixedTpPrices } from "../../services/marketOutlookSignal.js";
import { persistSignalOutcome, recordRevision } from "../../services/marketOutlookTick.js";

const OutlookReclassificationAuditRequestSchema = z.object({
  apply: z.boolean().optional().default(false),
  limit: z.number().int().optional().default(500),
  current_password: z.string().nullable().optional(),
});

/** Port of market_outlook.py:2466 `_quote_from_activity`. */
function quoteFromActivity(row: Record<string, unknown>): [number, number] | [null, null] {
  const thesis = ((row["details"] as Record<string, unknown> | undefined)?.["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const bid = Number(thesis["live_bid"] ?? 0) || 0;
  const ask = Number(thesis["live_ask"] ?? 0) || 0;
  return bid > 0 && ask >= bid ? [bid, ask] : [null, null];
}

interface AuditCorrection {
  id: unknown;
  account: string;
  published_at: unknown;
  direction: unknown;
  stored_outcome: unknown;
  stored_r: unknown;
  stored_highest_tp_reached: unknown;
  replayed_outcome: unknown;
  replayed_r: unknown;
  replayed_highest_tp_reached: unknown;
  replayed_tp1_price: number;
  replayed_tp2_price: number;
  reason: string;
}

/**
 * Port of market_outlook.py:2642 `audit_v2_signal_classifications`, exposed
 * via server.py:8566 `POST /admin/outlook/reclassification-audit`.
 *
 * Re-derives already-resolved v2 Outlook signal classifications from their
 * own stored broker quote history under the current (post SL/TP-priority-fix,
 * fixed-TP-grid) rules and reports every disagreement with what is
 * currently stored. Dry-run by default; apply=true requires re-entering the
 * admin password and only ever corrects a record whose own stored quote
 * history reliably supports it -- everything else is left untouched and
 * reported as insufficient_evidence, never guessed in either direction.
 */
export async function registerAdminOutlookAuditRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/outlook/reclassification-audit", { preHandler: requireAdmin }, async (request, reply) => {
    const req = OutlookReclassificationAuditRequestSchema.parse(request.body ?? {});
    const admin = (request as typeof request & { admin: Record<string, unknown> }).admin;
    const db = getDb();

    if (req.apply) {
      if (!req.current_password) return reply.code(401).send({ detail: "Current password required to apply corrections." });
      const full = await db.collection("users").findOne({ email: admin["email"] });
      if (!full || !(await verifyPassword(req.current_password, String(full["password_hash"] ?? "")))) {
        return reply.code(401).send({ detail: "Incorrect password." });
      }
    }

    const now = new Date();
    const auditRunId = randomUUID();
    const resolved = await db
      .collection("cloud_market_outlooks")
      .find(
        {
          signal_tracking_version: 2,
          primary_direction: { $in: ["BUY", "SELL"] },
          analytics_outcome: { $in: Array.from(ANALYTICS_TERMINAL_OUTCOMES) },
        },
        { projection: { _id: 0 } },
      )
      .sort({ published_at: 1 })
      .limit(req.limit)
      .toArray();

    const report = {
      examined: resolved.length,
      confirmed_correct: 0,
      insufficient_evidence: 0,
      corrections_found: 0,
      corrections_applied: 0,
      corrections: [] as AuditCorrection[],
    };

    for (const old of resolved) {
      const published = asUtc(old["published_at"] ?? old["generated_at"]);
      const account = String(old["account"] ?? "");
      const direction = String(old["primary_direction"] ?? "");
      const entry = Number(old["tracking_entry_price"] ?? 0) || 0;
      const risk = Number(old["risk_distance"] ?? 0) || 0;
      const sl = Number(old["original_sl"] ?? old["suggested_sl"] ?? 0) || 0;
      const deadline = asUtc(old["evaluation_deadline"]) ?? (published ? new Date(published.getTime() + OUTLOOK_EVALUATION_MINUTES * 60_000) : null);
      if (!published || !account || entry <= 0 || risk <= 0 || sl <= 0 || !deadline) {
        report.insufficient_evidence += 1;
        continue;
      }

      const end = new Date(Math.min(now.getTime(), published.getTime() + OUTLOOK_HORIZON_HOURS * 3_600_000));
      const rows = await db
        .collection("cloud_bot_activity")
        .find(
          {
            account,
            ts: { $gte: published.toISOString(), $lte: end.toISOString() },
            "details.market_thesis.live_bid": { $gt: 0 },
            "details.market_thesis.live_ask": { $gt: 0 },
          },
          {
            projection: { _id: 0, ts: 1, "details.market_thesis.live_bid": 1, "details.market_thesis.live_ask": 1 },
          },
        )
        .sort({ ts: 1 })
        .limit(5000)
        .toArray();

      const usable = rows
        .map((row): [Record<string, unknown>, Date | null] => [row, asUtc(row["ts"])])
        .filter(([row, ts]) => ts !== null && quoteFromActivity(row).every((v) => v !== null)) as [Record<string, unknown>, Date][];
      const inWindow = usable.filter(([, ts]) => ts >= published && ts <= deadline);
      if (inWindow.length === 0) {
        report.insufficient_evidence += 1;
        continue;
      }

      const times = inWindow.map(([, ts]) => ts);
      let maxGap = 0;
      for (let i = 1; i < times.length; i++) {
        const gap = (times[i]!.getTime() - times[i - 1]!.getTime()) / 1000;
        if (gap > maxGap) maxGap = gap;
      }
      const coverageReliable =
        times[0]!.getTime() <= published.getTime() + MAX_HISTORICAL_QUOTE_GAP_SECONDS * 1000 &&
        times[times.length - 1]!.getTime() >= deadline.getTime() - MAX_HISTORICAL_QUOTE_GAP_SECONDS * 1000 &&
        maxGap <= MAX_HISTORICAL_QUOTE_GAP_SECONDS;
      if (!coverageReliable) {
        report.insufficient_evidence += 1;
        continue;
      }

      const [fixedTp1, fixedTp2, fixedTp3] = fixedTpPrices(direction, entry);
      let working: Record<string, unknown> = {
        primary_direction: direction,
        tracking_entry_price: entry,
        original_sl: sl,
        risk_distance: XAUCLOUD_R_UNIT_GOLD_MOVES,
        evaluation_deadline: deadline.toISOString(),
        tp1_price: fixedTp1,
        tp2_price: fixedTp2,
        tp3_price: fixedTp3,
        signal_state: SIGNAL_TRACKING,
        analytics_outcome: null,
        analytics_r: null,
        current_r: 0.0,
        mfe_r: 0.0,
        mae_r: 0.0,
        highest_tracked_price: entry,
        lowest_tracked_price: entry,
        first_half_r_at: null,
        tp1_hit_at: null,
        tp2_hit_at: null,
        tp3_hit_at: null,
        sl_hit_at: null,
        classification_at: null,
        latest_path_event: "TRACKING_STARTED",
        monitoring_closed: false,
        milestones_hit: [],
        event_snapshots: {},
        highest_tp_reached: 0,
      };
      for (const [row, ts] of inWindow) {
        const [qBid, qAsk] = quoteFromActivity(row);
        const [update] = advancePersistedSignal(working, qBid, qAsk, ts);
        working = { ...working, ...update };
        if (working["monitoring_closed"]) break;
      }
      if (working["analytics_outcome"] === null || working["analytics_outcome"] === undefined) {
        const [update] = advancePersistedSignal(working, null, null, deadline);
        working = { ...working, ...update };
      }

      const replayedOutcome = working["analytics_outcome"];
      if (replayedOutcome === null || replayedOutcome === undefined) {
        report.insufficient_evidence += 1;
        continue;
      }

      const storedOutcome = old["analytics_outcome"];
      if (replayedOutcome === storedOutcome) {
        report.confirmed_correct += 1;
        continue;
      }

      const replayedR = working["analytics_r"];
      const correction: AuditCorrection = {
        id: old["id"],
        account,
        published_at: old["published_at"],
        direction,
        stored_outcome: storedOutcome,
        stored_r: old["analytics_r"],
        stored_highest_tp_reached: old["highest_tp_reached"],
        replayed_outcome: replayedOutcome,
        replayed_r: replayedR,
        replayed_highest_tp_reached: working["highest_tp_reached"],
        replayed_tp1_price: fixedTp1,
        replayed_tp2_price: fixedTp2,
        reason:
          "stored classification disagrees with a re-derivation from the same stored quotes under the current (post-fix) TP/SL priority rule and the owner-approved fixed TP1(+0.50R)/TP2(+1.00R) grid, calculated from this record's own entry price",
      };
      report.corrections_found += 1;
      report.corrections.push(correction);

      if (req.apply) {
        const persist = {
          analytics_outcome: replayedOutcome,
          analytics_r: replayedR,
          highest_tp_reached: working["highest_tp_reached"],
          current_r: working["current_r"],
          mfe_r: working["mfe_r"],
          mae_r: working["mae_r"],
          first_half_r_at: working["first_half_r_at"],
          tp1_hit_at: working["tp1_hit_at"],
          tp2_hit_at: working["tp2_hit_at"],
          tp3_hit_at: working["tp3_hit_at"],
          sl_hit_at: working["sl_hit_at"],
          classification_at: working["classification_at"],
          latest_path_event: working["latest_path_event"],
          monitoring_closed: working["monitoring_closed"],
          event_snapshots: working["event_snapshots"],
          milestones_hit: working["milestones_hit"],
          signal_state: working["signal_state"],
          tp1_price: fixedTp1,
          tp2_price: fixedTp2,
          tp3_price: fixedTp3,
          risk_distance: XAUCLOUD_R_UNIT_GOLD_MOVES,
          legacy_tp1_price_before_reclassification_audit: old["tp1_price"],
          legacy_tp2_price_before_reclassification_audit: old["tp2_price"],
          legacy_risk_distance_before_reclassification_audit: old["risk_distance"],
          reclassification_audit_run_id: auditRunId,
          legacy_classification_before_reclassification_audit: storedOutcome,
          legacy_r_before_reclassification_audit: old["analytics_r"],
          reclassified_at: now.toISOString(),
        };
        await db.collection("cloud_market_outlooks").updateOne({ id: old["id"] }, { $set: persist });
        await recordRevision(
          String(old["id"]),
          "analytics_outcome",
          storedOutcome,
          replayedOutcome,
          "reclassification audit: re-derived from stored quotes under the corrected TP/SL priority rule",
        );
        await persistSignalOutcome({ ...old, ...persist, id: old["id"] });
        report.corrections_applied += 1;
      }
    }

    await db.collection("cloud_market_outlook_reclassification_runs").insertOne({
      id: auditRunId,
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      applied: req.apply,
      summary: { examined: report.examined, confirmed_correct: report.confirmed_correct, insufficient_evidence: report.insufficient_evidence, corrections_found: report.corrections_found, corrections_applied: report.corrections_applied },
    });

    app.log.info(
      `OUTLOOK_RECLASSIFICATION_AUDIT admin=${admin["email"]} apply=${req.apply} examined=${report.examined} corrections_found=${report.corrections_found} corrections_applied=${report.corrections_applied} insufficient_evidence=${report.insufficient_evidence}`,
    );
    return report;
  });
}
