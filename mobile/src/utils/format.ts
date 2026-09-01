/** Display helpers for server data. API values may be absent or string-typed
 * during a rollout, so customer UI must never call `toFixed` directly. */
export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatNumber(value: unknown, digits = 0): string {
  const number = asFiniteNumber(value);
  return number == null ? '—' : number.toFixed(digits);
}

export function formatPrice(value: unknown): string {
  return formatNumber(value, 2);
}

export function formatPercent(value: unknown, digits = 0): string {
  const number = asFiniteNumber(value);
  return number == null ? '—' : `${number.toFixed(digits)}%`;
}

export function formatMoney(value: unknown, digits = 2, signed = false): string {
  const number = asFiniteNumber(value);
  if (number == null) return '—';
  const prefix = signed && number >= 0 ? '+' : number < 0 ? '-' : '';
  return `${prefix}$${Math.abs(number).toFixed(digits)}`;
}

/** Never call new Date(x).toLocaleString() directly on server data -- an absent/malformed timestamp renders "Invalid Date" instead of failing safely. */
export function formatDateTime(value: unknown, fallback = 'Date unavailable'): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}

/** Time-only variant of formatDateTime, same safety guard. */
export function formatTime(value: unknown, fallback = '—'): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : fallback;
}
