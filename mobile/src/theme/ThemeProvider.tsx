import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeColors, ThemeName, darkColors, lightColors, radius, spacing, typography, shadow } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  colors: ThemeColors;
  scheme: ThemeName;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadow: typeof shadow;
}

const STORAGE_KEY = 'xaucloud.theme.preference';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === 'light' || val === 'dark' || val === 'system') {
        setPreferenceState(val);
      }
      setHydrated(true);
    });
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
  }, []);

  const scheme: ThemeName = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: scheme === 'dark' ? darkColors : lightColors,
      scheme,
      preference,
      setPreference,
      spacing,
      radius,
      typography,
      shadow,
    }),
    [scheme, preference, setPreference]
  );

  if (!hydrated) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
