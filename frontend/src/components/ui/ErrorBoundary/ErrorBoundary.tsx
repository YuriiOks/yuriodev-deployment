import { Component, type MouseEvent, type ReactNode } from 'react';
import styles from '../../../pages/text-page.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** When this value changes (for example the route path), a shown fallback is cleared. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  failed: boolean;
  resetKey?: string;
}

function reload(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  window.location.reload();
}

/**
 * Catches a render error below it and shows a friendly message with a reload
 * link instead of a blank page.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { failed: false, resetKey: props.resetKey };
    return null;
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section className={styles.page} role="alert" aria-labelledby="error-boundary-title">
        <div className={styles.card}>
          <p className={styles.prompt}>
            <span className={styles.promptSign} aria-hidden="true">$</span>./render --page
          </p>
          <p className={styles.error}>error: something went wrong while showing this page</p>
          <h1 id="error-boundary-title" className={styles.title}>Something went wrong</h1>
          <p>This page failed to load. Reloading usually fixes it.</p>
          <a href={window.location.href} className={styles.button} onClick={reload}>
            Reload the page
          </a>{' '}
          <a href="/" className={styles.button}>
            Go to the home page
          </a>
        </div>
      </section>
    );
  }
}
