import { api } from './client';
import { normalizeNotificationPrefs } from './notificationPrefs';
import {
  AcademyCatalogResponse,
  AcademyCertificateStatus,
  AcademyProgressSummary,
  BotActivityResponse,
  BotControlAction,
  BotStatusResponse,
  BankTransferOrder,
  BankTransferStatusResponse,
  BillingResponse,
  CloudMonitorStatus,
  CommandRequestResponse,
  CourseCertificateStatus,
  CourseProgressView,
  Entitlement,
  LicenseStatusResponse,
  NotificationCenterPage,
  NotificationPrefs,
  OutlookCurrentResponse,
  OutlookDetailResponse,
  OutlookHistoryResponse,
  OutlookOrEngineResponse,
  PerformanceAnalyticsResponse,
  PropFirmConfig,
  PropFirmConfigResponse,
  QuizSubmitResult,
  RecentCommandsResponse,
  RecentSignalsResponse,
  SignalDetailResponse,
  SupportTicket,
  CurrentOpinion,
  CheckoutResponse,
  PaymentMethodsResponse,
} from './types';

/** Every function here calls the SAME production XauCloud API the website uses — no mobile-only backend, no client-invented entitlement state. */
export const cloud = {
  me: () => api.get<import('./types').CloudUser>('/cloud/auth/me'),
  entitlement: () => api.get<Entitlement>('/cloud/entitlement'),
  licenseStatus: () => api.get<LicenseStatusResponse>('/cloud/license/status'),
  billing: () => api.get<BillingResponse>('/cloud/billing'),
  startSignalCheckout: (plan_id: 'SIGNALS_WEEKLY' | 'SIGNALS_MONTHLY') =>
    api.post<CheckoutResponse>('/purchase/signals/paystack/initialize', { plan_id, origin_url: 'https://xaucloud.io' }),
  startBotCheckout: (buyer_name: string, buyer_email: string) =>
    api.post<CheckoutResponse>('/purchase/paystack/initialize', { buyer_name, buyer_email, origin_url: 'https://xaucloud.io', display_currency: null }),
  paymentMethods: () => api.get<PaymentMethodsResponse>('/purchase/payment-methods'),
  // Nigeria Bank Transfer -- the owner-configured default checkout method
  // (see backend_node/src/services/paymentMethods.ts DEFAULT_PAYMENT_METHOD_ORDER).
  startSignalBankTransfer: (plan_id: 'SIGNALS_WEEKLY' | 'SIGNALS_MONTHLY') =>
    api.post<BankTransferOrder>('/purchase/signals/bank-transfer/initiate', { plan_id, origin_url: 'https://xaucloud.io' }),
  startBotBankTransfer: (buyer_name: string, buyer_email: string) =>
    api.post<BankTransferOrder>('/purchase/bank-transfer/initiate', { buyer_name, buyer_email }),
  submitBankTransfer: (reference: string) => api.post<{ status: string }>(`/purchase/bank-transfer/${encodeURIComponent(reference)}/submitted`),
  uploadBankTransferProof: (reference: string, proof_image: string) =>
    api.post<{ status: string }>(`/purchase/bank-transfer/${encodeURIComponent(reference)}/proof`, { proof_image }),
  bankTransferStatus: (reference: string) => api.get<BankTransferStatusResponse>(`/purchase/bank-transfer/${encodeURIComponent(reference)}/status`),

  outlook: () => api.get<OutlookOrEngineResponse>('/cloud/signals/outlook'),
  engine: () => api.get<OutlookOrEngineResponse>('/cloud/signals/engine'),
  recentSignals: () => api.get<RecentSignalsResponse>('/cloud/signals/recent'),
  signalDetail: (signalId: string) => api.get<SignalDetailResponse>(`/cloud/signals/recent/${encodeURIComponent(signalId)}`),

  monitorStatus: () => api.get<CloudMonitorStatus>('/cloud/monitor/status'),
  monitorActivity: (kind = 'all', limit = 30) =>
    api.get<BotActivityResponse>(`/cloud/monitor/activity?kind=${encodeURIComponent(kind)}&limit=${Math.min(Math.max(limit, 1), 200)}`),
  currentOpinion: () => api.get<CurrentOpinion>('/cloud/monitor/current-opinion'),
  botStatus: () => api.get<BotStatusResponse>('/cloud/monitor/bot-status'),
  startSignalsTrial: () => api.post<{ entitlement: Entitlement; trial?: Entitlement['trial'] }>('/cloud/signals/trial/start'),

  performanceAnalytics: () => api.get<PerformanceAnalyticsResponse>('/cloud/performance/analytics'),

  academyProgress: () => api.get<AcademyProgressSummary>('/cloud/academy/progress'),
  completeLesson: (lessonId: string) => api.post<AcademyProgressSummary>(`/cloud/academy/lessons/${lessonId}/complete`),
  uncompleteLesson: (lessonId: string) => api.post<AcademyProgressSummary>(`/cloud/academy/lessons/${lessonId}/uncomplete`),
  academyCertificate: () => api.get<AcademyCertificateStatus>('/cloud/academy/certificate'),
  confirmAcademyCertificateName: (name: string) =>
    api.post<{ issued: boolean; certificate: NonNullable<AcademyCertificateStatus['certificate']> }>(
      '/cloud/academy/certificate/confirm-name',
      { name },
    ),

  // The Academy catalog and its progress, quiz, and certificate flows are
  // shared with the web product. Mobile neither creates a parallel learner
  // record nor grades assessments on-device.
  academyCatalog: () => api.get<AcademyCatalogResponse>('/cloud/academy/catalog'),
  courseProgress: (courseId: string) =>
    api.get<CourseProgressView>(`/cloud/academy/courses/${encodeURIComponent(courseId)}/progress`),
  completeCourseLesson: (courseId: string, lessonId: string) =>
    api.post<CourseProgressView>(
      `/cloud/academy/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
    ),
  uncompleteCourseLesson: (courseId: string, lessonId: string) =>
    api.post<CourseProgressView>(
      `/cloud/academy/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/uncomplete`,
    ),
  submitQuiz: (courseId: string, quizId: string, answers: Record<string, string[]>) =>
    api.post<QuizSubmitResult>(`/cloud/academy/quizzes/${encodeURIComponent(quizId)}/submit`, { courseId, answers }),
  courseCertificate: (courseId: string) =>
    api.get<CourseCertificateStatus>(`/cloud/academy/courses/${encodeURIComponent(courseId)}/certificate`),
  confirmCourseCertificateName: (courseId: string, name: string) =>
    api.post<{ issued: boolean; certificate: NonNullable<CourseCertificateStatus['certificate']> }>(
      `/cloud/academy/courses/${encodeURIComponent(courseId)}/certificate/confirm-name`,
      { name },
    ),

  supportTickets: () => api.get<{ tickets: SupportTicket[] }>('/cloud/support/tickets'),
  supportTicket: (id: string) => api.get<{ ticket: SupportTicket }>(`/cloud/support/tickets/${id}`),
  createSupportTicket: (data: { subject: string; category?: string; message: string }) =>
    api.post<{ ok: true; ticket: SupportTicket }>('/cloud/support/tickets', data),
  replySupportTicket: (id: string, message: string) =>
    api.post<{ ok: true; ticket: SupportTicket }>(`/cloud/support/tickets/${id}/reply`, { message }),

  notifications: (params: { category?: string; unread_only?: boolean; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.unread_only) q.set('unread_only', 'true');
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get<NotificationCenterPage>(`/notifications/center${qs ? `?${qs}` : ''}`);
  },
  markNotificationRead: (id: string) => api.post<{ ok: true; marked: boolean }>(`/notifications/${id}/read`),
  markAllNotificationsRead: () => api.post<{ ok: true; marked: number }>('/notifications/read-all'),

  linkLicense: (license_key: string) => api.post<{ ok: true; license: Record<string, unknown> }>('/cloud/license/link', { license_key }),
  deleteAccount: (password: string) => api.post<{ ok: true; message: string }>('/cloud/account/delete', { password, confirm: true }),

  // Bot Control -- ON/OFF only (PAUSE_NEW_TRADES / RESUME_TRADING) and Prop
  // Firm Protection (UPDATE_PROP_FIRM_CONFIG), the same two customer-safe
  // actions web's ControlPage exposes. `pin` is always the account's own
  // license activation key (see LicenseStatusResponse), never typed by the
  // user -- it authenticates the command to the linked EA, it is not a
  // secondary customer credential.
  recentCommands: (limit = 20) => api.get<RecentCommandsResponse>(`/cloud/command/recent?limit=${Math.min(Math.max(limit, 1), 50)}`),
  requestBotCommand: (action: BotControlAction, pin: string, payload?: Record<string, unknown>) =>
    api.post<CommandRequestResponse>('/cloud/command/request', {
      action,
      pin,
      confirm: true,
      payload: payload ?? null,
      idempotency_key: `${action}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    }),

  propFirmConfig: () => api.get<PropFirmConfigResponse>('/cloud/prop-firm/config'),
  applyPropFirmConfig: (pin: string, config: PropFirmConfig) =>
    api.post<CommandRequestResponse>('/cloud/command/request', {
      action: 'UPDATE_PROP_FIRM_CONFIG',
      pin,
      confirm: true,
      payload: config,
      idempotency_key: `UPDATE_PROP_FIRM_CONFIG:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    }),

  // Full-parity Market Outlook -- the richer authoritative doc web's
  // /ai-market-outlook page reads, distinct from the lighter
  // /cloud/signals/outlook shape `cloud.outlook()` above already covers.
  outlookCurrent: () => api.get<OutlookCurrentResponse>('/outlook/current'),
  outlookHistory: (limit = 50) => api.get<OutlookHistoryResponse>(`/outlook/history?limit=${Math.min(Math.max(limit, 1), 200)}`),
  outlookDetail: (outlookId: string) => api.get<OutlookDetailResponse>(`/outlook/${encodeURIComponent(outlookId)}`),

  notificationPrefs: async () => {
    const result = await api.get<{ prefs?: unknown }>('/outlook/notifications/prefs');
    return { prefs: normalizeNotificationPrefs(result.prefs) };
  },
  updateNotificationPrefs: (body: { tier: NotificationPrefs['tier']; muted_categories?: string[]; notify_all_devices?: boolean }) =>
    api.post<{ prefs?: unknown }>('/outlook/notifications/prefs', body)
      .then((result) => ({ prefs: normalizeNotificationPrefs(result.prefs) })),
};

/** Derives a customer-facing status label from the real ticket fields — the backend only tracks open/closed plus a messages[] thread, so "answered" / "waiting for you" are computed client-side from who sent the last message, not invented server state. */
export function ticketDisplayStatus(ticket: SupportTicket): 'Closed' | 'Waiting for you' | 'Answered' | 'Open' {
  if (ticket.status === 'closed') return 'Closed';
  const last = ticket.messages[ticket.messages.length - 1];
  if (!last) return 'Open';
  return last.author_type === 'customer' ? 'Waiting for you' : 'Answered';
}
