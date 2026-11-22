import { createContext } from 'react';
import type { Lang, Localized } from '../services/dashboards/types';
import type { Strings } from '../services/dashboards/strings';

export interface DashboardLangContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** The interface texts in the chosen language. */
  t: Strings;
  /** A sample-content text in the chosen language. */
  text: (value: Localized) => string;
}

export const DashboardLangContext = createContext<DashboardLangContextType | undefined>(undefined);
