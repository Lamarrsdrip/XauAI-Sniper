import { api } from './client';
import {
  AcademyProgressSummary,
  BillingResponse,
  Entitlement,
  LicenseStatusResponse,
  NotificationCenterPage,
  OutlookOrEngineResponse,
  PerformanceAnalyticsResponse,
  RecentSignalsResponse,
  SupportTicket,
} from './types';

/** Every function here calls the SAME production XauCloud API the website uses — no mobile-only backend, no client-invented entitlement state. */
export const cloud = {
  entitlement: () => api.get<Entitlement>('/cloud/entitlement'),
  licenseStatus: () => api.get<LicenseStatusResponse>('/cloud/license/status'),
  billing: () => api.get<BillingResponse>('/cloud/billing'),

  outlook: () => api.get<OutlookOrEngineResponse>('/cloud/signals/outlook'),
  engine: () => api.get<OutlookOrEngineResponse>('/cloud/signals/engine'),
  recentSignals: () => api.get<RecentSignalsResponse>('/cloud/signals/recent'),

  performanceAnalytics: () => api.get<PerformanceAnalyticsResponse>('/cloud/performance/analytics'),

  academyProgress: () => api.get<AcademyProgressSummary>('/cloud/academy/progress'),
  completeLesson: (lessonId: string) => api.post<AcademyProgressSummary>(`/cloud/academy/lessons/${lessonId}/complete`),
  uncompleteLesson: (lessonId: string) => api.post<AcademyProgressSummary>(`/cloud/academy/lessons/${lessonId}/uncomplete`),

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
};

/** Derives a customer-facing status label from the real ticket fields — the backend only tracks open/closed plus a messages[] thread, so "answered" / "waiting for you" are computed client-side from who sent the last message, not invented server state. */
export function ticketDisplayStatus(ticket: SupportTicket): 'Closed' | 'Waiting for you' | 'Answered' | 'Open' {
  if (ticket.status === 'closed') return 'Closed';
  const last = ticket.messages[ticket.messages.length - 1];
  if (!last) return 'Open';
  return last.author_type === 'customer' ? 'Waiting for you' : 'Answered';
}
