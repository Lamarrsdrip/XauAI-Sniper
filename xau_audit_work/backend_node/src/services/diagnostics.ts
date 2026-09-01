import { randomUUID } from "node:crypto";

export interface DiagnosticEvent { id: string; at: string; level: "error" | "warning"; service: string; route?: string; request_id?: string; message: string; code?: string; }
const events: DiagnosticEvent[] = [];
const MAX_EVENTS = 250;
function sanitize(value: unknown): string { return String(value ?? "").replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[REDACTED]").replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi, "$1=[REDACTED]").slice(0, 800); }
export function recordDiagnostic(level: "error" | "warning", service: string, error: unknown, meta: { route?: string; requestId?: string; code?: string } = {}): void {
  const message = error instanceof Error ? error.message : error;
  events.unshift({ id: randomUUID(), at: new Date().toISOString(), level, service, route: meta.route, request_id: meta.requestId, code: meta.code, message: sanitize(message) });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}
export function recentDiagnostics(level?: "error" | "warning", limit = 50): DiagnosticEvent[] { return events.filter((e) => !level || e.level === level).slice(0, Math.min(limit, 200)); }
export function diagnosticByRequest(id: string): DiagnosticEvent[] { return events.filter((e) => e.request_id === id || e.id === id).slice(0, 50); }
