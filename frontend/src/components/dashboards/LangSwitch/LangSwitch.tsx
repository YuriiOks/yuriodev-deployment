import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { LANGS } from '../../../services/dashboards/strings';
import { cx } from '../../../utils/cx';
import styles from './LangSwitch.module.css';

/** RU / EN, two real buttons in a group; the pressed one is the language in use. */
const LangSwitch: React.FC = () => {
  const { lang, setLang, t } = useDashboardLang();
  return (
    <div role="group" aria-label={t.langLabel} className={styles.group}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === lang}
          className={cx(styles.option, code === lang && styles.on)}
          onClick={() => setLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

export default LangSwitch;
