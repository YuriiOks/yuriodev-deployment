import React from 'react';
import type { IconName } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import styles from './DashIcon.module.css';

/**
 * One stroke set, pasted in (no dependency): the path data of Lucide (https://lucide.dev, ISC licence), 24px
 * grid, round caps and joins. Every icon is drawn at one stroke width (1.5px, held at every size by
 * `vector-effect: non-scaling-stroke`) and one of three sizes. Exhaustive on purpose: a new IconName does not
 * compile until it has paths.
 */
const PATHS: Record<IconName, readonly string[]> = {
  check: ['M20 6 9 17l-5-5'],
  'circle-check': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'm9 12 2 2 4-4'],
  'circle-x': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'm15 9-6 6', 'm9 9 6 6'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  prev: ['m15 18-6-6 6-6'],
  next: ['m9 18 6-6-6-6'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'eye-off': [
    'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
    'M14.084 14.158a3 3 0 0 1-4.242-4.242',
    'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
    'm2 2 20 20',
  ],
};

export interface DashIconProps {
  name: IconName;
  /** Side in px: 14 (inline with text), 16 (controls) or 20. */
  size?: 14 | 16 | 20;
  className?: string;
}

/** A decorative glyph (aria-hidden), in the colour of the text around it: whatever it marks is also said in words. */
const DashIcon: React.FC<DashIconProps> = ({ name, size = 16, className }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    data-icon={name}
    className={cx(styles.icon, className)}
  >
    {PATHS[name].map((d) => (
      <path key={d} d={d} vectorEffect="non-scaling-stroke" />
    ))}
  </svg>
);

export default DashIcon;
