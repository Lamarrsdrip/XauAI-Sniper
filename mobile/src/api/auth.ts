import { api, setToken, clearToken } from './client';
import { CloudUser } from './types';

interface AuthResponse {
  ok: boolean;
  user: CloudUser;
  token: string; // requires the additive backend patch — see api/config.ts
}

export async function login(email: string, password: string): Promise<CloudUser> {
  const res = await api.post<AuthResponse>('/cloud/auth/login', { email, password });
  await setToken(res.token);
  return res.user;
}

export async function signup(email: string, password: string, full_name?: string): Promise<CloudUser> {
  const res = await api.post<AuthResponse>('/cloud/auth/signup', { email, password, full_name });
  await setToken(res.token);
  return res.user;
}

export async function logout(): Promise<void> {
  await clearToken();
}
