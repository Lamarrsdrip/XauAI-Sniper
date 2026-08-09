export type ReadinessState = "STARTING" | "READY" | "DEGRADED" | "FAILED";
export type DependencyState = "PENDING" | "READY" | "FAILED";

export interface DependencyReadiness {
  state: DependencyState;
  started_at: string | null;
  ready_at: string | null;
  failed_at: string | null;
  last_error: string | null;
}

const startedAt = new Date().toISOString();
const dependencies = new Map<string, DependencyReadiness>();
let overallState: ReadinessState = "STARTING";
let readyAt: string | null = null;
let lastInitializationError: string | null = null;

function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/(?:mongodb(?:\+srv)?:\/\/)[^\s]+/gi, "[redacted-mongodb-url]").slice(0, 500);
}

export function beginDependency(name: string): void {
  dependencies.set(name, { state: "PENDING", started_at: new Date().toISOString(), ready_at: null, failed_at: null, last_error: null });
}

export function markDependencyReady(name: string): void {
  const current = dependencies.get(name) ?? { state: "PENDING" as const, started_at: startedAt, ready_at: null, failed_at: null, last_error: null };
  dependencies.set(name, { ...current, state: "READY", ready_at: new Date().toISOString(), failed_at: null, last_error: null });
}

export function markDependencyFailed(name: string, error: unknown): void {
  const current = dependencies.get(name) ?? { state: "PENDING" as const, started_at: startedAt, ready_at: null, failed_at: null, last_error: null };
  lastInitializationError = safeError(error);
  dependencies.set(name, { ...current, state: "FAILED", failed_at: new Date().toISOString(), last_error: lastInitializationError });
  overallState = "FAILED";
}

export function markApplicationReady(): void {
  overallState = "READY";
  readyAt = new Date().toISOString();
  lastInitializationError = null;
}

export function isApplicationReady(): boolean { return overallState === "READY"; }

export function readinessSnapshot() {
  const entries = Object.fromEntries(dependencies.entries());
  const pending = Object.entries(entries).filter(([, value]) => value.state === "PENDING").map(([name]) => name);
  const failed = Object.entries(entries).filter(([, value]) => value.state === "FAILED").map(([name]) => name);
  return {
    state: overallState,
    initialized_at: startedAt,
    ready_at: readyAt,
    pending_dependencies: pending,
    failed_dependencies: failed,
    last_initialization_error: lastInitializationError,
    dependencies: entries,
  };
}

export async function runReadinessStep<T>(name: string, fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  beginDependency(name);
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} initialization timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    });
    const value = await Promise.race([fn(), timeout]);
    markDependencyReady(name);
    return value;
  } catch (error) {
    markDependencyFailed(name, error);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
