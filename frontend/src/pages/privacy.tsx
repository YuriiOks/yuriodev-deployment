import { usePageTitle } from '../hooks/usePageTitle';
import styles from './text-page.module.css';

const CONTACT_EMAIL = 'yurii.oksamytnyi@yuriodev.co.uk';

const Privacy = () => {
  usePageTitle('Privacy');

  return (
    <section className={styles.page} aria-labelledby="privacy-title">
      <article className={styles.card}>
        <h1 id="privacy-title" className={styles.title}>Privacy notice</h1>
        <p className={styles.updated}>
          Last updated: <time dateTime="2026-09-25">25 September 2026</time>
        </p>

        <h2>Who is responsible</h2>
        <p>
          This is the personal website of Yurii Oksamytnyi, London, UK, who is the controller of
          the personal data described here. Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>What is stored on your device</h2>
        <ul>
          <li>Your light or dark theme choice, in your browser's local storage, so the site remembers it.</li>
          <li>A flag in session storage so the intro animation plays only once per visit. Your browser deletes it when you close the tab.</li>
        </ul>
        <p>
          The site sets no cookies of its own and runs no analytics, advertising or tracking
          scripts.
        </p>

        <h2>Hosting, security and logs</h2>
        <p>
          Cloudflare provides the site's content delivery and security, so every request passes
          through Cloudflare. It processes your IP address and request details (such as the page
          and your browser) to deliver and protect the site, and it may set a strictly necessary
          security cookie if it has to check that a visitor is not a bot. See{' '}
          <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">
            Cloudflare's privacy policy
          </a>.
        </p>
        <p>
          The server keeps short technical logs of requests, including IP addresses, for security
          and troubleshooting. They are rotated automatically and are not used to profile anyone.
          The lawful basis is legitimate interests: running a secure, working website.
        </p>

        <h2>Fonts</h2>
        {/* Replace this paragraph once the font is self-hosted. */}
        <p>
          The site's font is currently loaded from Google Fonts, so your browser sends your IP
          address to Google when a page loads. See{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            Google's privacy policy
          </a>.
        </p>

        <h2>Links to other sites</h2>
        <p>
          Links to LinkedIn, X, GitHub and other profiles are plain links. Nothing is loaded from
          those sites until you follow one, and then their own privacy policies apply.
        </p>

        <h2>Your rights</h2>
        <p>
          Under UK data protection law you can ask for a copy of personal data about you, ask for
          it to be corrected or deleted, or object to its use. If you are named on this site and
          would like that changed or removed, just ask. Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. You can also complain to the{' '}
          <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">
            Information Commissioner's Office
          </a>.
        </p>
      </article>
    </section>
  );
};

export default Privacy;
