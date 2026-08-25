import {
  AcademyProgressSummary,
  CloudUser,
  Entitlement,
  LicenseStatusResponse,
  NotificationCenterPage,
  OutlookOrEngineResponse,
  PerformanceAnalyticsResponse,
  RecentSignalsResponse,
  SubscriberSignal,
  SupportTicket,
} from '../api/types';

export type Persona = 'free' | 'subscriber' | 'bot_owner';

export const PERSONAS: Record<Persona, { user: CloudUser; entitlement: Entitlement; license: LicenseStatusResponse }> = {
  free: {
    user: { id: 'u_free', email: 'jordan@example.com', full_name: 'Jordan', created_at: '2026-06-01', email_verified: true },
    entitlement: {
      signals_access: false, outlook_access: false, engine_10m_access: false, signal_notifications: false,
      bot_license: false, bot_operations: false, bot_activity: false, performance_access: false, automation_access: false,
      source: 'none', trial: null, subscription: null,
    },
    license: { linked: false, license: null },
  },
  subscriber: {
    user: { id: 'u_sub', email: 'amara@example.com', full_name: 'Amara', created_at: '2026-05-12', email_verified: true },
    entitlement: {
      signals_access: true, outlook_access: true, engine_10m_access: true, signal_notifications: true,
      bot_license: false, bot_operations: false, bot_activity: false, performance_access: false, automation_access: false,
      source: 'subscription', trial: null, subscription: { active: true },
    },
    license: { linked: false, license: null },
  },
  bot_owner: {
    user: { id: 'u_bot', email: 'chen@example.com', full_name: 'Chen', created_at: '2026-02-20', email_verified: true },
    entitlement: {
      signals_access: true, outlook_access: true, engine_10m_access: true, signal_notifications: true,
      bot_license: true, bot_operations: true, bot_activity: true, performance_access: true, automation_access: true,
      source: 'lifetime', trial: null, subscription: null,
    },
    license: {
      linked: true,
      license: {
        license_id: 'lic_1', activation_key: 'ASE-1YVR-GSEJ', status: 'active', is_used: true,
        activated_at: '2026-02-20T00:00:00Z', mt5_account: '••••4471', account_binding: '••••4471',
        vps_binding: 'VPS-1', ea_version: '6.26.3', buyer_email: 'chen@example.com',
        created_at: '2026-02-20T00:00:00Z', expiry: 'Lifetime / manual',
      },
    },
  },
};

const minsAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

export const mockOutlook: OutlookOrEngineResponse = {
  available: true,
  health: { configured: true, account: 'demo', online: true },
  signal: {
    signal_id: 'outlook-1', engine: 'OUTLOOK', symbol: 'XAUUSD', direction: 'BUY', status: 'ACTIONABLE',
    confidence: 72, entry: 3361.4, stop: 3352.0, tp1: 3373.0, tp2: 3384.0, tp3: 3396.0,
    rationale: 'Gold is holding above short-term support with steady buying pressure through the London session.',
    effective_at: minsAgo(4), expires_at: hoursFromNow(6), updated_at: minsAgo(4),
  },
};

export const mockEngine: OutlookOrEngineResponse = {
  available: true,
  health: { configured: true, account: 'demo', online: true },
  signal: {
    signal_id: 'm10-1', engine: 'M10_ENGINE', symbol: 'XAUUSD', direction: 'BUY', status: 'WATCHING',
    confidence: 64, entry: null, stop: null, tp1: null, tp2: null, tp3: null,
    rationale: 'Price swept the prior session low and is reclaiming it with rising momentum — watching for confirmation before entry.',
    effective_at: minsAgo(1), expires_at: null, updated_at: minsAgo(1),
  },
};

function sig(id: string, direction: string, status: SubscriberSignal['status'], entry: number, stop: number, tp1: number, minsBack: number): SubscriberSignal {
  return {
    signal_id: id, engine: 'OUTLOOK', symbol: 'XAUUSD', direction, status,
    confidence: 70, entry, stop, tp1, tp2: null, tp3: null,
    rationale: 'Bullish structure break on M15 with outlook alignment.',
    effective_at: minsAgo(minsBack), expires_at: null, updated_at: minsAgo(minsBack),
  };
}

export const mockRecentSignals: RecentSignalsResponse = {
  signals: [
    sig('s1', 'BUY', 'ACTIONABLE', 3361.4, 3352.0, 3384.0, 40),
    sig('s2', 'SELL', 'EXPIRED', 3372.8, 3380.5, 3358.0, 300),
    sig('s3', 'BUY', 'EXPIRED', 3340.1, 3332.0, 3355.0, 1560),
    sig('s4', 'BUY', 'EXPIRED', 3319.6, 3311.0, 3335.0, 3000),
  ],
};

export const mockPerformance: PerformanceAnalyticsResponse = {
  sufficient_data: true,
  total_trades: 17,
  closed_wins: 10,
  win_rate: 61.2,
  gross_profit: 3204.8,
  gross_loss: 1242.4,
  net_profit: 1962.4,
  profit_factor: 1.8,
  max_drawdown: 412.6,
  equity_curve: [],
};

export const mockAcademyProgress: AcademyProgressSummary = {
  curriculum_version: 'v1',
  completed_lesson_ids: ['forex-1', 'forex-2', 'forex-3', 'forex-4', 'forex-5', 'forex-6', 'forex-7', 'forex-8', 'gold-1', 'gold-2', 'gold-3', 'gold-4', 'gold-5', 'gold-6'],
  required_lesson_ids: Array.from({ length: 40 }, (_, i) => `lesson-${i}`),
  completed_count: 14,
  required_count: 40,
  is_complete: false,
};

export const mockTickets: SupportTicket[] = [
  {
    id: 't1', subject: 'Bot not showing recent trade', category: 'bot', priority: 'normal', status: 'open',
    created_at: minsAgo(180), updated_at: minsAgo(60), assigned_admin: 'support',
    messages: [
      { id: 'm1', author_type: 'customer', body: "My bot hasn't shown a trade in the app for 6 hours but MT5 shows it's connected.", created_at: minsAgo(180) },
      { id: 'm2', author_type: 'support', body: 'Found it — your terminal had lost its connection to our relay overnight. It reconnected automatically and is reporting normally now.', created_at: minsAgo(60) },
    ],
  },
  {
    id: 't2', subject: 'Question about lifetime license transfer', category: 'billing', priority: 'normal', status: 'open',
    created_at: minsAgo(1600), updated_at: minsAgo(1560), assigned_admin: null,
    messages: [{ id: 'm3', author_type: 'customer', body: 'Can I transfer my lifetime license to a new MT5 account?', created_at: minsAgo(1560) }],
  },
  {
    id: 't3', subject: 'Billing receipt request', category: 'billing', priority: 'normal', status: 'closed',
    created_at: minsAgo(14400), updated_at: minsAgo(14000), assigned_admin: 'support',
    messages: [{ id: 'm4', author_type: 'support', body: 'Receipt sent to your email on file.', created_at: minsAgo(14000) }],
  },
];

export const mockNotifications: NotificationCenterPage = {
  items: [
    { id: 'n1', category: 'SIGNALS', title: 'New BUY signal on XAUUSD', body: 'Entry 3361.40 · SL 3352.00 · TP 3384.00', scheduled_time: minsAgo(40), read_at: null, delivery_status: 'SENT' },
    { id: 'n2', category: 'MARKET_OUTLOOK', title: 'Outlook updated', body: 'XauCloud published a new Gold Outlook.', scheduled_time: minsAgo(90), read_at: null, delivery_status: 'SENT' },
    { id: 'n3', category: 'BOT_UPDATES', title: 'XauCloud Bot connected', body: 'MT5 ••••4471 linked successfully.', scheduled_time: minsAgo(1560), read_at: minsAgo(1500), delivery_status: 'SENT' },
    { id: 'n4', category: 'PAYMENTS', title: 'Payment received', body: 'Your Signal Subscription renewal was successful.', scheduled_time: minsAgo(5760), read_at: minsAgo(5700), delivery_status: 'SENT' },
  ],
  page: 1, limit: 20, total: 4, unread_total: 2, has_more: false,
  category_counts: {},
};
