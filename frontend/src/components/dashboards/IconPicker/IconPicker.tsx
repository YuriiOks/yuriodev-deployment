import React, { useId } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { PROJECT_ICON_KEYS } from '../../../services/dashboards/projectIcons';
import DashIcon from '../DashIcon/DashIcon';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import styles from './IconPicker.module.css';

export interface IconPickerProps {
  /** The current icon key, or null for none. */
  value: string | null;
  onChange: (icon: string | null) => void;
  disabled?: boolean;
}

/**
 * The icon choice as a group of radio buttons drawn as a grid: Tab enters it, the arrow keys move through the choices,
 * the current one is marked (checked, and filled in the clay), and the first is "no icon" (the name's letter is shown).
 */
const IconPicker: React.FC<IconPickerProps> = ({ value, onChange, disabled }) => {
  const { t } = useDashboardLang();
  const group = useId();
  const choices: ReadonlyArray<readonly [string | null, string]> = [[null, t.iconNone], ...PROJECT_ICON_KEYS.map((key) => [key, t.projectIcons[key]] as const)];
  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend className={styles.legend}>{t.iconPicker}</legend>
      <div className={styles.grid}>
        {choices.map(([key, label]) => (
          <label key={key ?? 'none'} className={styles.option} title={label}>
            <input
              type="radio"
              name={group}
              className={styles.radio}
              checked={(value ?? null) === key}
              onChange={() => onChange(key)}
            />
            <span className={styles.face}>{key === null ? <DashIcon name="circle-x" size={16} /> : <ProjectIcon name={key as (typeof PROJECT_ICON_KEYS)[number]} size={20} />}</span>
            <span className="sr-only">{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

export default IconPicker;
