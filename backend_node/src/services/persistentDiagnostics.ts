import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { recordDiagnostic } from "./diagnostics.js";

const COLLECTION = "cloud_intelligence_diagnostics";
const RETENTION_DAYS = 30;

export interface PersistentDiagnosticMeta {
  code: string;
  account?: string;
  source_event_id?: string;
  evidence_id?: string;
  stage?: string;
  route?: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

export async function ensurePersistentDiagnosticIndexes(): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).createIndex({ at: -1 });
  await db.collection(COLLECTION).createIndex({ service: 1, code: 1, at: -1 });
  await db.collection(COLLECTION).createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
}

function safeMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error ?? "unknown error").slice(0, 1200);
}

/**
 * Records a durable diagnostic without ever allowing observability failure to
 * affect trading/heartbeat acknowledgement. The in-memory diagnostic stream
 * is also populated for the existing admin/debug endpoints.
 */
export async function recordPersistentDiagnostic(
  level: "error" | "warning",
  service: string,
  error: unknown,
  meta: PersistentDiagnosticMeta,
): Promise<void> {
  recordDiagnostic(level, service, error, { route: meta.route, requestId: meta.request_id, code: meta.code });
  try {
    const now = new Date();
    await getDb().collection(COLLECTION).insertOne({
      id: randomUUID(),
      at: now.toISOString(),
      expires_at: new Date(now.getTime() + RETENTION_DAYS * 86_400_000),
      level,
      service,
      code: meta.code,
      stage: meta.stage ?? "",
      account: meta.account ?? "",
      source_event_id: meta.source_event_id ?? "",
      evidence_id: meta.evidence_id ?? "",
      route: meta.route ?? "",
      request_id: meta.request_id ?? "",
      message: safeMessage(error),
      details: meta.details ?? {},
    });
  } catch {
    // The durable diagnostic store may be the thing that is unhealthy.
    // recordDiagnostic above still preserves an in-process trace.
  }
}
