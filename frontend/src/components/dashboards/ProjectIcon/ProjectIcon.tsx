import React from 'react';
import { PATHS, type DrawnIconName } from './iconPaths';

/** The dashboards' own icon set (iconPaths.ts), drawn by hand on a 24px grid: one 1.75px stroke, round caps and joins, no fill, in the text colour. */
export interface ProjectIconProps {
  name: DrawnIconName;
  /** Side in px (default 20). */
  size?: number;
  className?: string;
}

/** A decorative drawing (aria-hidden): whatever it marks is also said in words next to it. */
const ProjectIcon: React.FC<ProjectIconProps> = ({ name, size = 20, className }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    data-icon={name}
    className={className}
  >
    {(PATHS[name] as readonly string[]).map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

export default ProjectIcon;
