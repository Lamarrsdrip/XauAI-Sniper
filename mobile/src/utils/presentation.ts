import type { SubscriberSignal, SubscriberSignalStatus } from '../api/types';

const CUSTOMER_COPY: Record<string, string> = {
  NO_VALID_OUTLOOK: 'No confirmed Gold setup yet',
  LOCATION_RESET_CONFIRMED: 'Price has returned to a more favorable area',
  STRUCTURE_OPPOSES: 'Market structure is still pushing against the setup',
  WAITING_FOR_NEW_PRIMARY_BAR: 'Waiting for the next confirmed market bar',
  INSUFFICIENT_EVIDENCE: 'Not enough verified history yet',
  WAITING_FOR_CONFIRMATION: 'Waiting for confirmation',
  NO_TRADE: 'No trade is confirmed yet',
  RANGE_BOUND: 'Gold is trading in a range',
  TRENDING_UP: 'Upward momentum is present',
  TRENDING_DOWN: 'Downward momentum is present',
  BOT_STATUS_HEARTBEAT: 'Bot connection update',
};

const SIGNAL_STATUS_COPY: Record<SubscriberSignalStatus, string> = {
  WATCHING: 'Watching',
  ACTIONABLE: 'Ready to act',
  BLOCKED: 'Not actionable',
  EXPIRED: 'Setup expired',
  TP1_HIT: 'First target hit',
  TP2_HIT: 'Second target hit',
  TP3_HIT: 'Final target hit',
  SL_HIT: 'Risk limit reached',
  INVALIDATED: 'Setup invalidated',
  CLOSED: 'Setup closed',
};

/**
 * True when a string already reads as a clean, customer-safe sentence
 * rather than a raw backend code/enum -- used to decide whether an error
 * response's own `detail` is safe to show as-is (see api/client.ts) instead
 * of always falling back to a generic message.
 */
export function looksCustomerSafe(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // A single token with no whitespace reads as an identifier/code, not a
  // sentence, once it's longer than a short word.
  if (!/\s/.test(trimmed) && trimmed.length > 3) return false;
  // ALL CAPS (with digits/underscores/hyphens/spaces) reads as an enum even
  // when it happens to contain spaces (e.g. "INVALID PLAN ID").
  if (/[A-Z]/.test(trimmed) && /^[A-Z0-9_\-\s]+$/.test(trimmed)) return false;
  return true;
}

/** Converts server codes into professional customer copy without changing the API contract. */
export function presentCode(value: unknown, fallback = 'Not available'): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const clean = value.trim();
  const normalized = clean.toUpperCase();
  if (CUSTOMER_COPY[normalized]) return CUSTOMER_COPY[normalized];
  if (!/[_-]/.test(clean) && !/^[A-Z0-9 ]+$/.test(clean)) return clean;
  return clean
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Converts codes embedded inside an otherwise normal server sentence too. */
export function presentCustomerText(value: unknown, fallback = 'Not available'): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (code) => presentCode(code, code));
}

export function signalStatusLabel(signal: Pick<SubscriberSignal, 'status' | 'tp1_hit_at' | 'tp2_hit_at' | 'tp3_hit_at'>): string {
  if (signal.status === 'SL_HIT') {
    if (signal.tp2_hit_at) return 'Second target hit · remainder stopped';
    if (signal.tp1_hit_at) return 'First target hit · remainder stopped';
  }
  return SIGNAL_STATUS_COPY[signal.status] ?? presentCode(signal.status);
}

export function signalProgressLabel(signal: Pick<SubscriberSignal, 'status' | 'tp1_hit_at' | 'tp2_hit_at' | 'tp3_hit_at'>): string {
  if (signal.status === 'SL_HIT' && signal.tp2_hit_at) return 'TP1 hit · TP2 hit · remainder stopped';
  if (signal.status === 'SL_HIT' && signal.tp1_hit_at) return 'TP1 hit · remainder stopped';
  return `TP1 ${signal.tp1_hit_at ? 'hit' : 'pending'} · TP2 ${signal.tp2_hit_at ? 'hit' : 'pending'} · TP3 ${signal.tp3_hit_at ? 'hit' : 'pending'}`;
}

/** Shared badge tone for a signal's lifecycle status — previously duplicated (and drifted slightly) across SignalsScreen, SignalDetailsScreen and ActivityScreen. */
export function signalStatusTone(signal: Pick<SubscriberSignal, 'status' | 'direction'>): 'buy' | 'sell' | 'info' | 'warn' | 'neutral' {
  if (signal.status.startsWith('TP')) return 'buy';
  if (signal.status === 'SL_HIT' || signal.status === 'INVALIDATED') return 'sell';
  if (signal.status === 'ACTIONABLE') return signal.direction === 'SELL' ? 'sell' : 'buy';
  if (signal.status === 'BLOCKED') return 'sell';
  if (signal.status === 'EXPIRED' || signal.status === 'CLOSED') return 'neutral';
  return signal.status === 'WATCHING' ? 'info' : 'info';
}

const COMMAND_STATUS_COPY: Record<string, string> = {
  PENDING: 'Requested',
  ACKED: 'Acknowledged',
  EXECUTED: 'Executed',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

/** Bot Control / Prop Firm command lifecycle -- REQUESTED -> ACKNOWLEDGED -> EXECUTED|FAILED, read straight from the server's own command doc, never inferred locally. */
export function commandStatusLabel(status: unknown): string {
  if (typeof status !== 'string') return 'Unknown';
  return COMMAND_STATUS_COPY[status.toUpperCase()] ?? presentCode(status);
}

export function commandStatusTone(status: unknown): 'buy' | 'sell' | 'warn' | 'info' | 'neutral' {
  const s = typeof status === 'string' ? status.toUpperCase() : '';
  if (s === 'EXECUTED') return 'buy';
  if (s === 'FAILED') return 'sell';
  if (s === 'ACKED') return 'info';
  if (s === 'PENDING') return 'warn';
  return 'neutral';
}

export function signalEngineLabel(value: unknown): string {
  return value === 'M10_ENGINE' ? 'M10 Engine' : value === 'OUTLOOK' ? 'Market Outlook' : presentCode(value, 'XauCloud');
}
