import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useTheme } from '../../../context/useTheme';
import { cx } from '../../../utils/cx';
import header from '../../layout/Header/Header.module.css';

/** The dashboards' theme switch, the site header's own button (and its glyph): drives the site's theme context and its stored choice. */
const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useDashboardLang();
  const dark = theme === 'dark';
  const label = dark ? t.themeToLight : t.themeToDark;
  return (
    <button type="button" className={cx(header.navControl, header.iconButton)} onClick={toggleTheme} aria-label={label} title={label}>
      <span aria-hidden="true">{dark ? '☾' : '☀'}</span>
    </button>
  );
};

export default ThemeToggle;
