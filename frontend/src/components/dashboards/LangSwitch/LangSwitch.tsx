import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { LANGS } from '../../../services/dashboards/strings';
import { cx } from '../../../utils/cx';
import header from '../../layout/Header/Header.module.css';
import styles from './LangSwitch.module.css';

/** RU / EN, two real buttons in a group in the site header's control style; the pressed one is the language in use. */
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
          className={cx(header.navControl, code === lang && header.current)}
          onClick={() => setLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

export default LangSwitch;
