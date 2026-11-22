import { useContext } from 'react';
import { DashboardLangContext } from './dashboard-lang-context';

export const useDashboardLang = () => {
  const context = useContext(DashboardLangContext);
  if (context === undefined) {
    throw new Error('useDashboardLang must be used within a DashboardLangProvider');
  }
  return context;
};
