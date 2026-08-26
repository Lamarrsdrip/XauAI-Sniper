import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { USE_MOCK_DATA } from '../api/config';
import { CloudUser, Entitlement, LicenseStatusResponse } from '../api/types';
import { cloud } from '../api/cloud';
import { getToken, clearToken, ApiError } from '../api/client';
import { PERSONAS, Persona } from './mockData';
import * as authApi from '../api/auth';
import { unregisterCurrentPushToken } from '../services/push';
import { getBiometricEnabled, isBiometricAvailable, authenticateWithBiometrics } from '../services/biometrics';

interface AppStateValue {
  signedIn: boolean;
  /** True only while restoring a session on cold start (checking stored token / biometric gate). Show a splash, not the sign-in form, while this is true. */
  bootstrapping: boolean;
  user: CloudUser | null;
  entitlement: Entitlement | null;
  license: LicenseStatusResponse | null;
  /** __DEV__-only local preview persona — see Settings. Has no effect when USE_MOCK_DATA is false (real builds always show the real account's real entitlement). */
  persona: Persona;
  setPersona: (p: Persona) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshEntitlement: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [signedIn, setSignedIn] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(!USE_MOCK_DATA);
  const [persona, setPersona] = useState<Persona>('subscriber');
  const [liveUser, setLiveUser] = useState<CloudUser | null>(null);
  const [liveEntitlement, setLiveEntitlement] = useState<Entitlement | null>(null);
  const [liveLicense, setLiveLicense] = useState<LicenseStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRealAccountState = useCallback(async () => {
    const [entitlement, license] = await Promise.all([cloud.entitlement(), cloud.licenseStatus()]);
    setLiveEntitlement(entitlement);
    setLiveLicense(license);
  }, []);

  const refreshEntitlement = useCallback(async () => {
    if (USE_MOCK_DATA) return;
    await loadRealAccountState();
  }, [loadRealAccountState]);

  // Session restoration on cold start: a stored token from a prior real
  // login is only ever trusted after the server itself re-validates it
  // (GET /cloud/auth/me) — biometrics, when enabled, gate whether that
  // check even runs, but never substitute for it.
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        if (await getBiometricEnabled()) {
          const available = await isBiometricAvailable();
          if (available) {
            const ok = await authenticateWithBiometrics('Unlock XauCloud');
            if (!ok) return; // stay signed out; token remains stored for the next attempt
          }
        }

        const user = await cloud.me();
        setLiveUser(user);
        await loadRealAccountState();
        setSignedIn(true);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await clearToken();
      } finally {
        setBootstrapping(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      if (USE_MOCK_DATA) {
        await new Promise((r) => setTimeout(r, 500));
        setLiveUser(PERSONAS[persona].user);
      } else {
        const user = await authApi.login(email, password);
        setLiveUser(user);
        await loadRealAccountState();
      }
      setSignedIn(true);
    } catch (e: any) {
      setError(e?.message ?? 'Sign in failed');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    setLoading(true);
    setError(null);
    try {
      if (USE_MOCK_DATA) {
        await new Promise((r) => setTimeout(r, 500));
        setLiveUser({ ...PERSONAS.free.user, email, full_name: name });
      } else {
        const user = await authApi.signup(email, password, name);
        setLiveUser(user);
        await loadRealAccountState();
      }
      setSignedIn(true);
    } catch (e: any) {
      setError(e?.message ?? 'Sign up failed');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await unregisterCurrentPushToken();
    await authApi.logout();
    setSignedIn(false);
    setLiveUser(null);
    setLiveEntitlement(null);
    setLiveLicense(null);
  };

  const value = useMemo<AppStateValue>(() => {
    if (!USE_MOCK_DATA) {
      return {
        signedIn,
        bootstrapping,
        user: liveUser,
        entitlement: liveEntitlement,
        license: liveLicense,
        persona,
        setPersona,
        signIn,
        signUp,
        signOut,
        refreshEntitlement,
        loading,
        error,
      };
    }
    const activePersona = PERSONAS[persona];
    return {
      signedIn,
      bootstrapping: false,
      user: liveUser ?? activePersona.user,
      entitlement: activePersona.entitlement,
      license: activePersona.license,
      persona,
      setPersona,
      signIn,
      signUp,
      signOut,
      refreshEntitlement,
      loading,
      error,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, bootstrapping, liveUser, liveEntitlement, liveLicense, persona, loading, error]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
