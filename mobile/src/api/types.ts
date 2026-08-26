// Mirrors backend_node/src/services/entitlements.ts Entitlement interface exactly.
export interface Entitlement {
  signals_access: boolean;
  outlook_access: boolean;
  engine_10m_access: boolean;
  signal_notifications: boolean;
  bot_license: boolean;
  bot_operations: boolean;
  bot_activity: boolean;
  performance_access: boolean;
  automation_access: boolean;
  source: 'lifetime' | 'trial' | 'subscription' | 'none';
  trial: { days_remaining: number; status: string } | null;
  subscription: { active: boolean } | null;
}

export interface CloudUser {
  id: string;
  email: string;
  full_name?: string;
  country?: string;
  created_at: string;
  email_verified: boolean;
}

// Mirrors backend_node/src/routes/cloud/auth.ts GET /cloud/license/status
export interface LicenseStatusResponse {
  linked: boolean;
  license: {
    license_id: string;
    activation_key: string;
    status: 'active' | 'inactive';
    is_used: boolean;
    activated_at: string;
    mt5_account: string;
    account_binding: string;
    vps_binding: string;
    ea_version: string;
    buyer_email: string;
    created_at: string;
    expiry: string;
  } | null;
  message?: string;
}

// Mirrors backend_node/src/services/subscriberSignalFeed.ts SubscriberSignalInput
// (the exact doc shape stored in `subscriber_signals`, served by /cloud/signals/*)
export type SubscriberSignalStatus = 'WATCHING' | 'ACTIONABLE' | 'BLOCKED' | 'EXPIRED';
export type SubscriberSignalEngine = 'OUTLOOK' | 'M10_ENGINE';

export interface SubscriberSignal {
  signal_id: string;
  engine: SubscriberSignalEngine;
  symbol: string;
  direction: string; // "BUY" | "SELL" | "BLOCKED" | "" etc — server does not constrain this to an enum
  status: SubscriberSignalStatus;
  confidence: number | null;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  rationale: string | null;
  effective_at: string;
  expires_at: string | null;
  updated_at: string;
}

export interface SourceHealth {
  configured: boolean;
  account: string | null;
  online: boolean;
}

export interface OutlookOrEngineResponse {
  available: boolean;
  signal: SubscriberSignal | null;
  health: SourceHealth;
  reason?: string;
}

export interface RecentSignalsResponse {
  signals: SubscriberSignal[];
}

// Mirrors backend_node/src/services/academyProgress.ts AcademyProgressSummary
export interface AcademyProgressSummary {
  curriculum_version: string;
  completed_lesson_ids: string[];
  required_lesson_ids: string[];
  completed_count: number;
  required_count: number;
  is_complete: boolean;
}

// Mirrors backend_node/src/routes/cloud/support.ts safeTicket()
export interface SupportTicketMessage {
  id: string;
  author_type: string;
  body: string;
  created_at: string | null;
}
export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: 'open' | 'answered' | 'waiting_for_you' | 'closed' | string;
  created_at: string | null;
  updated_at: string | null;
  assigned_admin: string | null;
  messages: SupportTicketMessage[];
}

// Mirrors backend_node/src/services/notifications.ts cloud_notification_log row + getNotificationCenterPage()
export interface NotificationLogItem {
  id: string;
  category: string;
  title: string;
  body: string;
  scheduled_time: string;
  read_at: string | null;
  delivery_status: 'PENDING' | 'SENT' | 'FAILED' | 'NO_DEVICE';
}
export interface NotificationCenterPage {
  items: NotificationLogItem[];
  page: number;
  limit: number;
  total: number;
  unread_total: number;
  has_more: boolean;
  category_counts: Record<string, { total: number; unread: number }>;
}

// Mirrors backend_node/src/routes/cloud/performanceAnalytics.ts GET /cloud/performance/analytics
export interface PerformanceInsufficientData {
  sufficient_data: false;
  verified_trade_count: number;
  minimum_required: number;
  message: string;
}
export interface PerformanceAnalytics {
  sufficient_data: true;
  total_trades: number;
  closed_wins: number;
  win_rate: number;
  gross_profit: number;
  gross_loss: number;
  net_profit: number;
  profit_factor: number;
  max_drawdown: number;
  equity_curve: { closed_at: number; ticket: number; cumulative_profit: number }[];
}
export type PerformanceAnalyticsResponse = PerformanceInsufficientData | PerformanceAnalytics;

// Mirrors backend_node/src/routes/notificationRoutes.ts GET/POST /outlook/notifications/prefs
export interface NotificationPrefs {
  user_id: string;
  tier: 'OFF' | 'HOURLY_ONLY' | 'HOURLY_PLUS_RESULTS' | 'ALL_UPDATES';
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  notify_all_devices: boolean;
  muted_categories: string[];
}

// Mirrors backend_node/src/routes/cloud/signals.ts GET /cloud/billing
export interface BillingResponse {
  entitlement: Entitlement;
  payment_history: Record<string, unknown>[];
  plans: {
    trial: { plan_id: string; price_kobo: number };
    signals_weekly: { plan_id: string; price_kobo: number };
    signals_monthly: { plan_id: string; price_kobo: number };
    bot_lifetime: { plan_id: string; price_kobo: number };
  };
}
