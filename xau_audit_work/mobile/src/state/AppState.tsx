import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react';
// Aliased -- this file's own component/context is also named AppState.
import { AppState as RNAppState } from 'react-native';
import { USE_MOCK_DATA } from '../api/config';
import { CloudUser, Entitlement, LicenseStatusResponse } from '../api/types';
import { cloud } from '../api/cloud';
import { getToken, clearToken, ApiError, setUnauthorizedHandler } from '../api/client';
import { PERSONAS, Persona } from './mockData';
import * as authApi from '../api/auth';
import { unregisterCurrentPushToken } from '../services/push';
import { getBiometricEnabled, isBiometricAvailable, authenticateWithBiometrics } from '../services/biometrics';

interface AppStateValue {
  signedIn: boolean;
  /** True only while restoring a session on cold start (checking stored token / biometric gate). Show a splash, not the sign-in form, while this is true. */
  bootstrapping: boolean;
  /** Set when the cold-start session check fails (network/timeout, or any non-401 error). Non-null means the launch screen should offer Retry instead of silently dropping to sign-in. */
  bootstrapError: string | null;
  retryBootstrap: () => void;
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
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const clearAccountState = useCallback(() => {
    setSignedIn(false);
    setLiveUser(null);
    setLiveEntitlement(null);
    setLiveLicense(null);
    setError(null);
  }, []);

  // Any server-confirmed expired/invalid session returns the customer to the
  // auth flow immediately. This also prevents a previous account's balance or
  // license state being rendered while a different account signs in.
  useEffect(() => {
    setUnauthorizedHandler(clearAccountState);
    return () => setUnauthorizedHandler(null);
  }, [clearAccountState]);

  const loadRealAccountState = useCallback(async () => {
    const [entitlement, license] = await Promise.all([cloud.entitlement(), cloud.licenseStatus()]);
    setLiveEntitlement(entitlement);
    setLiveLicense(license);
  }, []);

  const refreshEntitlement = useCallback(async () => {
    if (USE_MOCK_DATA) return;
    await loadRealAccountState();
  }, [loadRealAccountState]);

  // Real bug found in production use: entitlement was previously only ever
  // refreshed at sign-in, after linking a license, or from Billing's own
  // pull-to-refresh -- a trial/subscription that expired while the app
  // stayed open (foregrounded for days, or simply backgrounded and
  // reopened) left every screen trusting a stale "still entitled" snapshot
  // indefinitely, so a free user whose trial had genuinely ended kept
  // seeing signals/Outlook/etc. Re-check on every foreground return, the
  // same moment a session token would also need re-validating.
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active' && signedInRef.current) void refreshEntitlement();
    });
    return () => sub.remove();
  }, [refreshEntitlement]);

  // Session restoration on cold start: a stored token from a prior real
  // login is only ever trusted after the server itself re-validates it
  // (GET /cloud/auth/me) — biometrics, when enabled, gate whether that
  // check even runs, but never substitute for it.
  const runBootstrap = useCallback(async () => {
    setBootstrapError(null);
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
      if (e instanceof ApiError && e.status === 401) {
        await clearToken();
      } else {
        setBootstrapError(e instanceof ApiError ? e.message : "Can't reach XauCloud right now. Check your connection and try again.");
      }
    } finally {
      setBootstrapping(false);
    }
  }, [loadRealAccountState]);

  useEffect(() => {
    if (USE_MOCK_DATA) return;
    void runBootstrap();
  }, [runBootstrap]);

  const retryBootstrap = useCallback(() => {
    setBootstrapping(true);
    void runBootstrap();
  }, [runBootstrap]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    setLiveUser(null);
    setLiveEntitlement(null);
    setLiveLicense(null);
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
    setLiveUser(null);
    setLiveEntitlement(null);
    setLiveLicense(null);
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
    // Local sign-out is the security boundary. Push deregistration is best
    // effort: a transient network failure must never trap someone in an
    // account or leak its cached entitlement to the next login.
    try {
      await unregisterCurrentPushToken();
    } catch {
      // Token revocation can be retried by the server on the next registration.
    } finally {
      try {
        await authApi.logout();
      } finally {
        try {
          await clearToken();
        } finally {
          clearAccountState();
        }
      }
    }
  };

  const value = useMemo<AppStateValue>(() => {
    if (!USE_MOCK_DATA) {
      return {
        signedIn,
        bootstrapping,
        bootstrapError,
        retryBootstrap,
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
      bootstrapError: null,
      retryBootstrap,
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
  }, [signedIn, bootstrapping, bootstrapError, retryBootstrap, liveUser, liveEntitlement, liveLicense, persona, loading, error]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
