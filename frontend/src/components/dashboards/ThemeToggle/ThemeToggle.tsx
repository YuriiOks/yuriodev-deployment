import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useTheme } from '../../../context/useTheme';
import DashIcon from '../DashIcon/DashIcon';
import styles from './ThemeToggle.module.css';

/** The dashboards' theme switch: drives the site's own theme context (and its stored choice). */
const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useDashboardLang();
  const dark = theme === 'dark';
  return (
    <button type="button" className={styles.toggle} onClick={toggleTheme} aria-label={dark ? t.themeToLight : t.themeToDark}>
      <DashIcon name={dark ? 'sun' : 'moon'} size={16} />
    </button>
  );
};

export default ThemeToggle;
