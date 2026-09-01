import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from './config';
import { looksCustomerSafe } from '../utils/presentation';

const TOKEN_KEY = 'xaucloud.cloud_token';

/**
 * The API layer is intentionally unaware of React state. The provider installs
 * this tiny bridge so an expired token can never leave a customer in a signed-
 * in-looking shell with every request failing underneath it.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Real bug found in production use: this previously discarded the backend's
 * `detail` for every status outside 401/403/404/429, even when the backend
 * had already written a clean, customer-safe sentence -- e.g. Billing's
 * checkout returning "Payment system not configured yet." on a genuine
 * config gap surfaced as the same generic "could not complete that request"
 * as a real network failure, making a real, actionable, already-safe error
 * indistinguishable from a transient one. Only suppress `detail` when it
 * fails the same customer-safety heuristic used to translate every other
 * backend string in this app (see utils/presentation.ts).
 */
function customerErrorMessage(status: number, detail?: unknown): string {
  if (status === 0) return "Can't reach XauCloud right now. Check your connection and try again.";
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'This feature is not included in your current access.';
  if (status === 404) return 'That item is no longer available.';
  if (status === 429) return 'Please wait a moment before trying again.';
  if (typeof detail === 'string' && looksCustomerSafe(detail)) return detail;
  return 'XauCloud could not complete that request. Please try again.';
}

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Thin fetch wrapper matching backend_node's contract: Bearer auth
 * (auth.ts's extractToken checks Authorization before falling back to the
 * web cookie), JSON in/out, `{ detail }` on error responses.
 *
 * Real bug found in production use: an unreachable API host (DNS resolves
 * but the server never accepts the connection) left `fetch` pending
 * indefinitely -- nothing ever rejected, so a cold-start session check
 * never left `bootstrapping`, freezing the launch screen forever instead
 * of failing visibly. A hard client-side timeout guarantees every request
 * eventually settles.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new ApiError(0, customerErrorMessage(0));
  } finally {
    clearTimeout(timer);
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401) {
      await clearToken();
      unauthorizedHandler?.();
    }
    const detail = isJson && body && typeof body === 'object' ? (body as Record<string, unknown>)['detail'] : undefined;
    throw new ApiError(res.status, customerErrorMessage(res.status, detail));
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
};
