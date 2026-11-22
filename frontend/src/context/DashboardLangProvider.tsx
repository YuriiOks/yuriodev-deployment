import React, { useCallback, useMemo, useState } from 'react';
import { DashboardLangContext } from './dashboard-lang-context';
import { DEFAULT_LANG, LANG_STORAGE_KEY, STRINGS, isLang, pick } from '../services/dashboards/strings';
import type { Lang } from '../services/dashboards/types';
import { readStorage, writeStorage } from '../utils/safeStorage';

function initialLang(): Lang {
  const stored = readStorage('local', LANG_STORAGE_KEY);
  return isLang(stored) ? stored : DEFAULT_LANG;
}

interface DashboardLangProviderProps {
  children: React.ReactNode;
}

/** Russian by default; the visitor's choice is kept in the browser. */
export const DashboardLangProvider: React.FC<DashboardLangProviderProps> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeStorage('local', LANG_STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, t: STRINGS[lang], text: (v: { ru: string; en: string }) => pick(v, lang) }),
    [lang, setLang],
  );

  return <DashboardLangContext.Provider value={value}>{children}</DashboardLangContext.Provider>;
};
