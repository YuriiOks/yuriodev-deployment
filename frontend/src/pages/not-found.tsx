import { Link, useLocation } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import styles from './text-page.module.css';

const NotFound = () => {
  const { pathname } = useLocation();
  usePageTitle('Page not found');

  return (
    <section className={styles.page} aria-labelledby="not-found-title">
      {/* React hoists this into <head> and removes it again on unmount. */}
      <meta name="robots" content="noindex" />
      <div className={styles.card}>
        <p className={styles.prompt}>
          <span className={styles.promptSign} aria-hidden="true">$</span>cd {pathname}
        </p>
        <p className={styles.error}>bash: cd: {pathname}: No such file or directory</p>
        <h1 id="not-found-title" className={styles.title}>404: page not found</h1>
        <p>This page doesn't exist or has moved.</p>
        <Link to="/" className={styles.button}>cd ~ (back to the home page)</Link>
      </div>
    </section>
  );
};

export default NotFound;
