import {
  AcademyCatalogResponse,
  AcademyProgressSummary,
  BotActivityResponse,
  CloudMonitorStatus,
  CurrentOpinion,
  CloudUser,
  CourseCertificateStatus,
  CourseProgressView,
  Entitlement,
  LicenseStatusResponse,
  NotificationCenterPage,
  OutlookCurrentResponse,
  OutlookOrEngineResponse,
  PerformanceAnalyticsResponse,
  PropFirmConfigResponse,
  RecentCommandsResponse,
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
  verified_trade_count: 17,
  realized_pnl: 1962.4,
  win_rate: 61.2,
  profit_factor: 1.8,
  max_drawdown: 412.6,
  avg_r: 0.72,
  avg_mae_r: -0.31,
  avg_mfe_r: 1.14,
  avg_pips: 42.6,
  avg_mae_pips: -18.4,
  avg_mfe_pips: 67.8,
  avg_win: 320.48,
  avg_loss: -177.49,
  equity_curve: [612, 480, 890, 1050, 940, 1220, 1180, 1460, 1390, 1610, 1520, 1740, 1690, 1850, 1780, 1900, 1962.4].map((cumulative_profit, index) => ({
    closed_at: Date.now() - (17 - index) * 86_400_000,
    ticket: 1000 + index,
    cumulative_profit,
  })),
};

export const mockMonitorStatus: CloudMonitorStatus = {
  status: 'online', offline: false, heartbeat_age_sec: 18,
  heartbeat: {
    account_number: '••••4471', broker_server: 'XauCloud-Demo', equity: 12_480.55, balance: 12_212.05,
    daily_pnl: 268.5, open_positions: 1, ea_version: '6.26.3', bot_state: 'Monitoring', mt5_connected: true,
    algo_trading: true, trading_allowed: true, drawdown: 1.8, last_heartbeat: minsAgo(0), symbol: 'XAUUSD',
  },
  license: { linked: true, mt5_account: '••••4471', status: 'active', expiry: 'Lifetime / manual' },
  alerts: [], setup_checks: [], open_trades: 1, production_status: 'ready', intelligence_sync_state: 'synced', equity_protection_state: 'protected',
};

export const mockBotActivity: BotActivityResponse = {
  kind: 'all', count: 2,
  events: [
    { id: 'demo-entry', kind: 'entries', title: 'Gold position opened', message: 'BUY XAUUSD is being monitored against its risk plan.', created_at: minsAgo(26), symbol: 'XAUUSD', direction: 'BUY' },
    { id: 'demo-check', kind: 'ai', title: 'Market review complete', message: 'The bot remains selective while it watches the active setup.', created_at: minsAgo(8), symbol: 'XAUUSD' },
  ],
};

export const mockCurrentOpinion: CurrentOpinion = {
  open: true, symbol: 'XAUUSD', direction: 'BUY', lot_size: 0.1, entry_price: 3361.4, current_price: 3365.1,
  sl: 3352, tp: 3373, floating_pl: 37, protected_profit: 0, trade_age_minutes: 26, ai_confidence: 72,
  current_bot_decision: 'Monitoring', current_reason: 'The position remains within its defined risk plan.', updated_at: minsAgo(1),
};

export const mockRecentCommands: RecentCommandsResponse = {
  count: 2,
  commands: [
    { id: 'cmd-2', action: 'RESUME_TRADING', label: 'Turn Bot On', status: 'EXECUTED', requested_at: minsAgo(180), ack_at: minsAgo(179), ack_message: 'Resumed by EA' },
    { id: 'cmd-1', action: 'PAUSE_NEW_TRADES', label: 'Turn Bot Off', status: 'EXECUTED', requested_at: minsAgo(400), ack_at: minsAgo(399), ack_message: 'Paused by EA' },
  ],
};

const mockPropFirmDefaults = {
  enabled: true, starting_balance: 10000, daily_loss_pct: 4, max_loss_pct: 8, safety_buffer_pct: 0.5,
  risk_per_trade_pct: 0.15, max_basket_risk_pct: 0.75, allow_retest_add: true, retest_add_lot_multi: 0.25,
};
export const mockPropFirmConfig: PropFirmConfigResponse = {
  linked: true,
  defaults: mockPropFirmDefaults,
  requested: mockPropFirmDefaults,
  requested_at: minsAgo(180),
  applied: mockPropFirmDefaults,
  applied_at: minsAgo(179),
  apply_status: 'EXECUTED',
  apply_message: 'Applied by EA',
  heartbeat_at: minsAgo(0),
  ea_version: '6.26.3',
};

export const mockOutlookCurrent: OutlookCurrentResponse = {
  contract: {},
  freshness: {},
  diagnostics: {},
  outlook: {
    id: 'outlook-current-1', primary_direction: 'BUY', color_state: 'GREEN', status: 'ACTIONABLE',
    confidence_pct: 72, reasoning: 'Gold is holding above short-term support with steady buying pressure through the London session.',
    uncertainty: 'A confirmed close back below 3352 would invalidate this bias.',
    preferred_entry_zone_low: 3359.0, preferred_entry_zone_high: 3362.5, suggested_sl: 3352.0,
    tp1_price: 3373.0, tp2_price: 3384.0, tp3_price: 3396.0, tracking_entry_price: 3361.4, risk_distance: 9.4,
    current_r: 0.6, mfe_r: 1.1, mae_r: -0.2, expected_path: 'GRIND_HIGHER', setup_type: 'TREND_CONTINUATION',
    structure_state: 'STRUCTURE_SUPPORTS', trend_state: 'TRENDING_UP', market_regime: 'TRENDING',
    buy_pressure: 64, sell_pressure: 36, exhaustion_pct: 22, movement_consumed_pct: 38, remaining_room_r: 1.6,
    raw_structural_sl: 3350.0, raw_sl_distance: 11.4, sl_widening_factor: 1.15, final_structural_sl: 3352.0,
    final_sl_distance: 9.4, configured_risk_pct: 0.5,
    published_at: minsAgo(4), generated_at: minsAgo(4), evaluation_deadline: hoursFromNow(4), last_monitored_at: minsAgo(1),
    tp1_hit_at: null, tp2_hit_at: null, tp3_hit_at: null, sl_hit_at: null,
  },
  hourly_context: null,
};

export const mockAcademyProgress: AcademyProgressSummary = {
  curriculum_version: 'v1',
  completed_lesson_ids: ['forex-1', 'forex-2', 'forex-3', 'forex-4', 'forex-5', 'forex-6', 'forex-7', 'forex-8', 'gold-1', 'gold-2', 'gold-3', 'gold-4', 'gold-5', 'gold-6'],
  required_lesson_ids: Array.from({ length: 40 }, (_, i) => `lesson-${i}`),
  completed_count: 14,
  required_count: 40,
  is_complete: false,
};

/** Compact but structurally real preview of /cloud/academy/catalog -- same shape as the live backend, trimmed to a couple of courses/lessons for design-review builds (USE_MOCK_DATA). */
export const mockAcademyCatalog: AcademyCatalogResponse = {
  courses: [
    {
      id: 'financial-markets-foundations', title: 'Financial Markets & Trading Foundations', level: 'beginner',
      summary: 'Build a working model of assets, participants, quotes, orders and the risk taken when a trade is placed.',
      tags: ['beginner', 'markets', 'pips', 'risk'], certificateEligible: true, legacyLessonIds: ['foundation', 'quotes'],
      modules: [
        {
          id: 'financial-markets-foundations-m1', title: 'How markets work',
          lessons: [
            { id: 'foundation', title: 'Forex Foundations', estimatedMinutes: 10,
              objectives: ['Understand the core ideas behind Forex Foundations', 'Apply this lesson before your next live or demo trade'],
              sections: [['What forex actually is', 'Foreign exchange is the global market where one currency is exchanged for another.'], ['Currency pairs', 'A pair compares two currencies. In EURUSD, EUR is the base and USD is the quote.']],
              commonMistakes: ['Treating "Forex Foundations" as background reading instead of a rule you apply before entering a trade.'],
              keyTakeaways: ['What forex actually is', 'Currency pairs'] },
            { id: 'quotes', title: 'Quotes, Pips & Lots', estimatedMinutes: 10,
              objectives: ['Understand the core ideas behind Quotes, Pips & Lots', 'Apply this lesson before your next live or demo trade'],
              sections: [['Bid and ask', 'You sell at the bid and buy at the ask. The difference is the spread.'], ['Pips and points', 'A pip is a standardized unit of price movement.']],
              commonMistakes: ['Treating "Quotes, Pips & Lots" as background reading instead of a rule you apply before entering a trade.'],
              keyTakeaways: ['Bid and ask', 'Pips and points'] },
            { id: 'financial-markets-foundations-m1-concept', title: 'How markets work: Core Concepts', estimatedMinutes: 9,
              objectives: ['Explain the governing concepts in plain language', 'Identify the assumptions that make the concept useful'],
              sections: [['The model', 'Primary versus secondary markets, liquidity, bid/ask pricing.'], ['Why it matters', 'This matters because you read a two-sided quote correctly before risking money.']],
              commonMistakes: ['Treating the chart’s last price as the exact price every order will receive.'],
              keyTakeaways: ['A market buy order executes against the available ask, not the last chart price.'] },
          ],
          quiz: { id: 'financial-markets-foundations-m1-quiz', title: 'How markets work — Module Quiz', passingScorePct: 70, questionCount: 2,
            questions: [
              { id: 'fmf-q1', type: 'single', prompt: 'What determines the price you actually pay on a market buy order?', options: [{ id: 'a', text: 'The last chart price' }, { id: 'b', text: 'The available ask' }] },
              { id: 'fmf-q2', type: 'true_false', prompt: 'Margin availability makes a position size appropriate.', options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] },
            ] },
        },
      ],
      finalAssessment: { id: 'financial-markets-foundations-final', title: 'Financial Markets & Trading Foundations — Final Assessment', passingScorePct: 75, questionCount: 1,
        questions: [{ id: 'fmf-final-1', type: 'scenario', prompt: 'A learner is unsure whether a setup is safe to act on. What should they do?', options: [{ id: 'a', text: 'Verify the rule with the relevant specification, context and documented evidence before acting.' }, { id: 'b', text: 'Act immediately because it feels familiar.' }] }] },
    },
    {
      id: 'xauusd-masterclass', title: 'Gold / XAUUSD Masterclass', level: 'advanced',
      summary: 'Gold market structure and sessions, macro and real-yield drivers, and gold-specific risk management.',
      tags: ['gold', 'xauusd', 'macro'], certificateEligible: true, legacyLessonIds: ['xau'],
      modules: [
        {
          id: 'xau-m1-understanding', title: 'Understanding Gold',
          lessons: [
            { id: 'xau', title: 'Trading Gold (XAUUSD)', estimatedMinutes: 10,
              objectives: ['Understand the core ideas behind Trading Gold (XAUUSD)', 'Apply this lesson before your next live or demo trade'],
              sections: [['Gold moves fast', 'XAUUSD can travel large distances quickly and can reverse sharply.'], ['Liquidity sweeps', 'Gold frequently probes obvious highs and lows before expanding.']],
              commonMistakes: ['Treating "Trading Gold (XAUUSD)" as background reading instead of a rule you apply before entering a trade.'],
              keyTakeaways: ['Gold moves fast', 'Liquidity sweeps'] },
            { id: 'xau-l1-what-is-xauusd', title: 'What Is XAUUSD?', estimatedMinutes: 9,
              objectives: ['Define XAUUSD as a cash-settled spot instrument', 'Explain why broker prices for gold differ slightly'],
              sections: [['Spot gold', 'XAUUSD is a cash-settled speculation on the spot gold price, not physical delivery.']],
              commonMistakes: ['Assuming XAUUSD means owning a physical gold bar.'],
              keyTakeaways: ['XAUUSD is cash-settled, not physical delivery.'],
              knowledgeCheck: [{ id: 'xau-l1-kc', type: 'single', prompt: 'What is XAUUSD?', options: [{ id: 'a', text: 'Owning a physical gold bar in a vault' }, { id: 'b', text: 'A cash-settled speculation on the spot gold price' }], correctOptionIds: ['b'], explanation: 'XAUUSD is cash-settled, not physical delivery.' }] },
          ],
          quiz: { id: 'xau-m1-quiz', title: 'Module 1 Quiz: Understanding Gold', passingScorePct: 70, questionCount: 1,
            questions: [{ id: 'xau-m1-q1', type: 'single', prompt: 'XAUUSD is best described as:', options: [{ id: 'a', text: 'Owning a physical gold bar in a vault' }, { id: 'b', text: 'A cash-settled speculation on the spot gold price' }] }] },
        },
      ],
      finalAssessment: { id: 'xauusd-masterclass-final', title: 'Gold / XAUUSD Masterclass — Final Assessment', passingScorePct: 75, questionCount: 1,
        questions: [{ id: 'xau-final-q1', type: 'single', prompt: 'A stronger US dollar is typically what for gold?', options: [{ id: 'a', text: 'No effect' }, { id: 'b', text: 'A headwind' }] }] },
    },
  ],
};

const mockCourseProgress: Record<string, CourseProgressView> = {
  'financial-markets-foundations': {
    course_id: 'financial-markets-foundations', completed_lesson_ids: ['foundation', 'quotes'], completed_lesson_count: 2, total_lesson_count: 4,
    modules: [{ module_id: 'financial-markets-foundations-m1', title: 'How markets work', lesson_count: 4, completed_lesson_count: 2, lessons_complete: false, quiz_id: 'financial-markets-foundations-m1-quiz', quiz_passed: false, module_complete: false }],
    final_assessment_id: 'financial-markets-foundations-final', final_assessment_passed: false, course_complete: false, progress_pct: 50,
  },
  'xauusd-masterclass': {
    course_id: 'xauusd-masterclass', completed_lesson_ids: [], completed_lesson_count: 0, total_lesson_count: 2,
    modules: [{ module_id: 'xau-m1-understanding', title: 'Understanding Gold', lesson_count: 2, completed_lesson_count: 0, lessons_complete: false, quiz_id: 'xau-m1-quiz', quiz_passed: false, module_complete: false }],
    final_assessment_id: 'xauusd-masterclass-final', final_assessment_passed: false, course_complete: false, progress_pct: 0,
  },
};

export function mockCourseProgressFor(courseId: string): CourseProgressView {
  return mockCourseProgress[courseId] ?? { course_id: courseId, completed_lesson_ids: [], completed_lesson_count: 0, total_lesson_count: 0, modules: [], final_assessment_id: null, final_assessment_passed: false, course_complete: false, progress_pct: 0 };
}

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
