import React, { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { ThemeContext, type Theme } from './theme-context';
import {
  applyTheme,
  forgetLegacyTheme,
  getStoredTheme,
  getSystemTheme,
  storeTheme,
  subscribeStoredTheme,
  subscribeSystemTheme,
} from './themeStore';

interface ThemeProviderProps {
  children: React.ReactNode;
}

const noChoice = () => null;
const darkByDefault = (): Theme => 'dark';

/**
 * The theme is the visitor's explicit choice when they have made one, and
 * otherwise follows the operating system, including later OS changes.
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const choice = useSyncExternalStore(subscribeStoredTheme, getStoredTheme, noChoice);
  const system = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, darkByDefault);
  const theme: Theme = choice ?? system;

  useEffect(() => {
    forgetLegacyTheme();
  }, []);

  // Before paint, so a toggle never shows a frame in the old theme.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    storeTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
