import React from 'react';
import type { DashTone, IconName } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import styles from './DashIcon.module.css';

const SCALES = 'M12 3v18 M7 21h10 M5 7h14 M5 7l-3 7a3 3 0 0 0 6 0z M19 7l-3 7a3 3 0 0 0 6 0z';

/**
 * Simple single-path stroke glyphs, one per tool or area. They are generic
 * shapes, not the tools' own logos. Exhaustive on purpose: a new IconName
 * does not compile until it has a path.
 */
const PATHS: Record<IconName, string> = {
  overview: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  areas: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  payments: 'M3 7h18v10H3z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  court: SCALES,
  work: 'M3 8h18v11H3z M9 8V5h6v3 M3 13h18',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  telegram: 'M21 4 3 11l6 2 2 6 3-4 4 3z M9 13l6-5',
  github:
    'M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M6 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M6 8.5v7 M18 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18 15.5V10a3 3 0 0 0-3-3h-3 M14 4.5 11.5 7 14 9.5',
  linear: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M5 10l9 9 M4.5 14.5l5 5 M7 6.5l10.5 10.5',
  slack: 'M9 3v18 M15 3v18 M3 9h18 M3 15h18',
  notion: 'M5 4h14v16H5z M9 16V8l6 8V8',
  posthog: 'M3 20h18 M6 20v-8 M11 20V5 M16 20v-11',
  grafana: 'M3 16l5-6 4 3 5-8 4 5 M3 21h18',
  meetings: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M6 11a6 6 0 0 0 12 0 M12 17v4',
  jira: 'M12 3l9 9-9 9-9-9z M12 8l4 4-4 4-4-4z',
  teams: 'M3 6h10 M8 6v12 M17.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M14 12h7v4a3.5 3.5 0 0 1-7 0z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  scales: SCALES,
  building: 'M3 9l9-6 9 6z M5 9v9 M10 9v9 M14 9v9 M19 9v9 M3 21h18',
  flag: 'M5 21V4h13l-3 5 3 5H5',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 3l10 18H2z M12 10v5 M12 18v0.5',
};

export interface DashIconProps {
  name: IconName;
  /** Side in px; default 18. */
  size?: number;
  tone?: DashTone;
  strokeWidth?: number;
  /** Filled as well as stroked (the priority flag). */
  filled?: boolean;
  className?: string;
}

/** A decorative glyph (aria-hidden): whatever it marks is always also said in text. */
const DashIcon: React.FC<DashIconProps> = ({ name, size = 18, tone, strokeWidth = 1.8, filled = false, className }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    data-tone={tone}
    data-icon={name}
    className={cx(styles.icon, className)}
  >
    <path d={PATHS[name]} />
  </svg>
);

export default DashIcon;
