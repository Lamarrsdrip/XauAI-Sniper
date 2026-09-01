import type { NotificationPrefs } from './types';

const NOTIFICATION_TIERS = ['OFF', 'HOURLY_ONLY', 'HOURLY_PLUS_RESULTS', 'ALL_UPDATES'] as const;
const NOTIFICATION_CATEGORIES = new Set([
  'TRADES', 'MARKET_OUTLOOK', 'M10_ENGINE', 'NEW_SIGNALS', 'SIGNAL_OUTCOMES',
  'SIGNALS', 'LICENSE', 'BOT_UPDATES', 'PAYMENTS', 'ACADEMY', 'MARKETING', 'SYSTEM', 'SUPPORT',
]);

type NotificationTier = NotificationPrefs['tier'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validHour(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : null;
}

/**
 * The notification service intentionally accepts legacy preference documents.
 * Normalize them once at the mobile API boundary so every consuming screen can
 * rely on a complete, safe model rather than independently guarding fields.
 */
export function normalizeNotificationPrefs(value: unknown, fallbackUserId = ''): NotificationPrefs {
  const raw = isRecord(value) ? value : {};
  const tier = NOTIFICATION_TIERS.includes(raw.tier as NotificationTier)
    ? raw.tier as NotificationTier
    : 'OFF';
  const muted = Array.isArray(raw.muted_categories)
    ? raw.muted_categories.filter((category): category is string => typeof category === 'string' && NOTIFICATION_CATEGORIES.has(category))
    : [];

  return {
    user_id: typeof raw.user_id === 'string' ? raw.user_id : fallbackUserId,
    tier,
    quiet_hours_start: validHour(raw.quiet_hours_start),
    quiet_hours_end: validHour(raw.quiet_hours_end),
    notify_all_devices: typeof raw.notify_all_devices === 'boolean' ? raw.notify_all_devices : true,
    muted_categories: [...new Set(muted)],
  };
}
