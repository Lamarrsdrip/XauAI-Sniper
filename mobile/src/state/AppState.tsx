import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { USE_MOCK_DATA } from '../api/config';
import { CloudUser, Entitlement, LicenseStatusResponse } from '../api/types';
import { cloud } from '../api/cloud';
import { PERSONAS, Persona } from './mockData';
import * as authApi from '../api/auth';
import { unregisterCurrentPushToken } from '../services/push';

interface AppStateValue {
  signedIn: boolean;
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
  }, [signedIn, liveUser, liveEntitlement, liveLicense, persona, loading, error]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
