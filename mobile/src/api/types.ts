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
/** Signal lifecycle states are assigned by the server's authoritative outcome
 * reconciler. Do not infer an outcome from price movement on the device. */
export type SubscriberSignalStatus =
  | 'WATCHING' | 'ACTIONABLE' | 'BLOCKED' | 'EXPIRED'
  | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'INVALIDATED' | 'CLOSED';
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
  source_status?: string | null;
  analytics_outcome?: string | null;
  signal_state?: string | null;
  tp1_hit_at?: string | null;
  tp2_hit_at?: string | null;
  tp3_hit_at?: string | null;
  sl_hit_at?: string | null;
  outcome_time?: string | null;
  outcome_timeline?: Array<{ event: string; at: string }>;
  latest_update_at?: string | null;
  /** M10 evidence fields are intentionally optional: Outlooks do not carry them. */
  decision?: string | null;
  preferred_direction?: string | null;
  freshness_state?: string | null;
  buy_evidence?: number | null;
  sell_evidence?: number | null;
  buy_case_score?: number | null;
  sell_case_score?: number | null;
  reason?: string | null;
  trend_state?: string | null;
  structure_state?: string | null;
  location_state?: string | null;
  exhaustion_decision?: string | null;
  evidence_id?: string | null;
  bar_time?: string | null;
  last_evaluated_at?: string | null;
  last_state_change_at?: string | null;
  last_actionable_at?: string | null;
  automated_entry_approved?: boolean | null;
  entry_zone_low?: number | null;
  entry_zone_high?: number | null;
  expected_path?: string | null;
  invalidation_reason?: string | null;
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

export interface SignalDetailResponse {
  signal: SubscriberSignal | null;
}

/** Customer-safe MT5 heartbeat returned by /cloud/monitor/status. */
export interface BotHeartbeat {
  account_number?: string | number | null;
  broker_server?: string | null;
  equity?: number | null;
  balance?: number | null;
  daily_pnl?: number | null;
  open_positions?: number | null;
  ea_version?: string | null;
  bot_state?: string | null;
  mt5_connected?: boolean | null;
  algo_trading?: boolean | null;
  trading_allowed?: boolean | null;
  spread?: number | null;
  drawdown?: number | null;
  last_heartbeat?: string | null;
  ts?: string | null;
  symbol?: string | null;
  [key: string]: string | number | boolean | null | undefined;
}

export interface CloudMonitorStatus {
  status: string;
  offline: boolean;
  heartbeat_age_sec: number | null;
  heartbeat: BotHeartbeat;
  release?: { version?: string | null; [key: string]: unknown } | null;
  production_status?: string | null;
  license: { linked: boolean; activation_key?: string | null; status?: string | null; mt5_account?: string | null; expiry?: string | null };
  alerts: Array<{ title?: string; message?: string; severity?: string; [key: string]: unknown }>;
  setup_checks: Array<{ label?: string; passed?: boolean; message?: string; [key: string]: unknown }>;
  open_trades: number | null;
  last_trade?: Record<string, unknown> | null;
  last_blocked_trade?: Record<string, unknown> | null;
  last_signal?: Record<string, unknown> | null;
  last_error?: string | null;
  intelligence_sync_state?: string | null;
  equity_protection_state?: string | null;
}

export interface BotActivityEvent {
  id: string;
  kind: string;
  title?: string | null;
  message?: string | null;
  reason?: string | null;
  created_at?: string | null;
  ts?: string | null;
  symbol?: string | null;
  direction?: string | null;
  [key: string]: unknown;
}

export interface BotActivityResponse {
  events: BotActivityEvent[];
  count: number;
  kind: string;
  reason?: string;
}

export interface CurrentOpinion {
  open: boolean;
  reason?: string;
  symbol?: string | null;
  direction?: string | null;
  lot_size?: number | null;
  entry_price?: number | null;
  current_price?: number | null;
  sl?: number | null;
  tp?: number | null;
  floating_pl?: number | null;
  protected_profit?: number | null;
  trade_age_minutes?: number | null;
  ai_confidence?: number | null;
  current_bot_decision?: string | null;
  current_reason?: string | null;
  what_would_close?: string | null;
  what_would_keep_holding?: string | null;
  distance_to_sl?: number | null;
  distance_to_tp?: number | null;
  updated_at?: string | null;
}

export interface BotStatusResponse {
  available: boolean;
  category?: string | null;
  status_text?: string | null;
  reason?: string | null;
  ts?: string | null;
  age_sec?: number | null;
  stale?: boolean;
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

export interface AcademyCertificateStatus {
  eligible: boolean;
  issued: boolean;
  needs_name: boolean;
  certificate?: { certificate_id: string; recipient_name: string; issued_at?: string };
}

/**
 * These catalog shapes mirror the backend's public Academy response. Quiz
 * answers are intentionally absent: grading remains server-authoritative.
 */
export type CourseLevel = 'beginner' | 'foundation' | 'intermediate' | 'advanced' | 'specialist';
export type QuizQuestionType = 'single' | 'multi' | 'true_false' | 'scenario' | 'calculation' | 'chart';

export interface QuizOption {
  id: string;
  text: string;
}

export interface PublicQuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  options: QuizOption[];
}

export interface KnowledgeCheckQuestion extends PublicQuizQuestion {
  correctOptionIds: string[];
  explanation: string;
}

export interface PublicQuiz {
  id: string;
  title: string;
  passingScorePct: number;
  questionCount: number;
  questions: PublicQuizQuestion[];
}

export interface CatalogLesson {
  id: string;
  title: string;
  estimatedMinutes: number;
  objectives: string[];
  sections: Array<[string, string]>;
  commonMistakes: string[];
  keyTakeaways: string[];
  knowledgeCheck?: KnowledgeCheckQuestion[];
}

export interface CatalogModule {
  id: string;
  title: string;
  lessons: CatalogLesson[];
  quiz?: PublicQuiz;
}

export interface CatalogCourse {
  id: string;
  title: string;
  level: CourseLevel;
  summary: string;
  tags: string[];
  modules: CatalogModule[];
  finalAssessment?: PublicQuiz;
  legacyLessonIds?: string[];
  certificateEligible: boolean;
}

export interface AcademyCatalogResponse {
  courses: CatalogCourse[];
}

export interface ModuleProgressView {
  module_id: string;
  title: string;
  lesson_count: number;
  completed_lesson_count: number;
  lessons_complete: boolean;
  quiz_id: string | null;
  quiz_passed: boolean;
  module_complete: boolean;
}

export interface CourseProgressView {
  course_id: string;
  completed_lesson_ids: string[];
  completed_lesson_count: number;
  total_lesson_count: number;
  modules: ModuleProgressView[];
  final_assessment_id: string | null;
  final_assessment_passed: boolean;
  course_complete: boolean;
  progress_pct: number;
}

export interface QuizSubmitResult {
  quiz_id: string;
  score_pct: number;
  passed: boolean;
  passing_score_pct: number;
  attempt_number: number;
  correct_count: number;
  total_count: number;
  per_question: Array<{ question_id: string; correct: boolean; correct_option_ids: string[]; explanation: string }>;
}

export interface CourseCertificateStatus {
  eligible: boolean;
  issued: boolean;
  needs_name: boolean;
  certificate?: {
    certificate_id: string;
    recipient_name: string;
    completed_at: string;
    issued_at: string;
    status: string;
    course_id: string;
    course_title: string;
    verify_url?: string;
  };
  progress_pct: number;
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
  verified_trade_count: number;
  realized_pnl: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  avg_r: number | null;
  avg_mae_r: number | null;
  avg_mfe_r: number | null;
  avg_pips: number | null;
  avg_mae_pips: number | null;
  avg_mfe_pips: number | null;
  avg_win: number;
  avg_loss: number;
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

export interface CheckoutResponse {
  authorization_url: string;
  reference: string;
}

// Mirrors backend_node/src/routes/purchase.ts GET /purchase/payment-methods.
// Nigeria Bank Transfer is the owner-set default checkout method, not a
// secondary option -- see paymentMethods.ts DEFAULT_PAYMENT_METHOD_ORDER.
export interface PaymentMethodInfo {
  method: string;
  label: string;
  description: string;
  instant: boolean;
  available: boolean;
}
export interface PaymentMethodsResponse {
  methods: PaymentMethodInfo[];
  default_method: string | null;
  detected_country: string | null;
}

// Mirrors POST /purchase/(signals/)?bank-transfer/initiate response.
export interface BankTransferOrder {
  reference: string;
  amount_naira: number;
  amount_formatted: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  expires_at: string;
  timeout_minutes: number;
  proof_required: boolean;
  instructions: string;
  support_contact: string;
}

// Mirrors GET /purchase/bank-transfer/:reference/status.
export interface BankTransferStatusResponse {
  reference: string;
  status: 'BANK_TRANSFER_PENDING' | 'BANK_TRANSFER_SUBMITTED' | 'UNDER_ADMIN_REVIEW' | 'FULFILLED' | 'BANK_TRANSFER_EXPIRED' | 'REJECTED' | string;
  pin: string | null;
  expires_at: string | null;
  rejection_reason: string | null;
  has_proof: boolean;
}

// Mirrors backend_node/src/routes/cloud/command.ts + services/commandStateMachine.ts.
// Only the two customer-safe actions Bot Control exposes on mobile -- see
// SAFE_REMOTE_COMMANDS for the full (larger, owner-override-capable) set the
// backend accepts; mobile intentionally never sends FORCE_CLOSE_TRADE /
// CLOSE_ALL_TRADES / FORCE_OPEN_TRADE / MANUAL_OPEN_NOW / STOP_TRADING /
// FORCE_SYNC / FORCE_REPORT_UPLOAD, matching web's own ControlPage scope.
export type BotControlAction = 'PAUSE_NEW_TRADES' | 'RESUME_TRADING' | 'UPDATE_PROP_FIRM_CONFIG';
export type CommandStatus = 'PENDING' | 'ACKED' | 'EXECUTED' | 'FAILED' | 'SKIPPED' | string;

export interface BotCommand {
  id: string;
  action: string;
  label?: string;
  status: CommandStatus;
  requested_at: string;
  ack_at?: string;
  ack_status?: string;
  ack_message?: string;
  payload?: Record<string, unknown>;
}

export interface RecentCommandsResponse {
  commands: BotCommand[];
  count: number;
}

export interface CommandRequestResponse {
  ok: true;
  command_id: string;
  status: CommandStatus;
  action: string;
  duplicate: boolean;
}

// Mirrors backend_node/src/services/propFirmConfig.ts normalizePropFirmConfig()
export interface PropFirmConfig {
  enabled: boolean;
  starting_balance: number;
  daily_loss_pct: number;
  max_loss_pct: number;
  safety_buffer_pct: number;
  risk_per_trade_pct: number;
  max_basket_risk_pct: number;
  allow_retest_add: boolean;
  retest_add_lot_multi: number;
}

// Mirrors backend_node/src/routes/misc.ts GET /cloud/prop-firm/config
export interface PropFirmConfigResponse {
  linked: boolean;
  license_key?: string;
  defaults: PropFirmConfig;
  requested: PropFirmConfig;
  requested_at?: string;
  applied: PropFirmConfig;
  applied_at?: string;
  apply_status: 'NOT_LINKED' | 'NOT_CONFIGURED' | CommandStatus;
  apply_message?: string;
  heartbeat_at?: string;
  ea_version?: string;
}

// Loosely typed on purpose -- these mirror raw `cloud_market_outlooks` Mongo
// documents (see backend_node/src/routes/outlookCurrent.ts /
// outlookHistory.ts), which carry many optional analytics/lifecycle fields
// that vary by outlook stage. Known fields are named so screens can read
// them safely; anything else passes through the index signature.
export interface MarketOutlookDoc {
  id?: string;
  primary_direction?: string | null;
  color_state?: string | null;
  status?: string | null;
  confidence_pct?: number | null;
  reasoning?: string | null;
  uncertainty?: string | null;
  directional_conflict?: string | null;
  price_source?: string | null;
  data_integrity_status?: string | null;
  data_integrity_note?: string | null;
  preferred_entry_zone_low?: number | null;
  preferred_entry_zone_high?: number | null;
  suggested_sl?: number | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp3_price?: number | null;
  tracking_entry_price?: number | null;
  original_sl?: number | null;
  risk_distance?: number | null;
  current_r?: number | null;
  current_pips?: number | null;
  current_gold_moves?: number | null;
  mfe_r?: number | null;
  mfe_pips?: number | null;
  mfe_gold_moves?: number | null;
  mae_r?: number | null;
  mae_pips?: number | null;
  mae_gold_moves?: number | null;
  expected_path?: string | null;
  setup_type?: string | null;
  chase_limit?: number | null;
  structure_state?: string | null;
  trend_state?: string | null;
  market_regime?: string | null;
  buy_pressure?: number | string | null;
  sell_pressure?: number | string | null;
  exhaustion_pct?: number | null;
  movement_consumed_pct?: number | null;
  remaining_room_r?: number | null;
  confidence_components?: Record<string, number | string> | null;
  raw_structural_sl?: number | null;
  raw_sl_distance?: number | null;
  sl_widening_factor?: number | null;
  final_structural_sl?: number | null;
  final_sl_distance?: number | null;
  configured_risk_pct?: number | null;
  published_at?: string | null;
  generated_at?: string | null;
  classification_at?: string | null;
  evaluation_deadline?: string | null;
  last_monitored_at?: string | null;
  first_half_r_at?: string | null;
  tp1_hit_at?: string | null;
  tp2_hit_at?: string | null;
  tp3_hit_at?: string | null;
  sl_hit_at?: string | null;
  latest_path_event?: string | null;
  signal_state?: string | null;
  analytics_outcome?: string | null;
  analytics_r?: number | null;
  historical_data_unavailable_reason?: string | null;
  [key: string]: unknown;
}

export interface OutlookCurrentResponse {
  contract: Record<string, unknown>;
  freshness: Record<string, unknown>;
  outlook: MarketOutlookDoc | null;
  hourly_context: MarketOutlookDoc | null;
  diagnostics: Record<string, unknown>;
  reason?: string;
}

export interface OutlookHistoryResponse {
  outlooks: MarketOutlookDoc[];
  timeline: unknown[];
  signal_events: Record<string, unknown>[];
  stats: Record<string, unknown>;
  reason?: string;
}

export interface OutlookDetailResponse {
  outlook: MarketOutlookDoc;
  revisions: Record<string, unknown>[];
}
