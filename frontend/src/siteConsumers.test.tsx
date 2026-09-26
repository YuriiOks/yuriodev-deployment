import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from './context/ThemeContext';
import App from './App';
import { EMAILS, IDENTITY, PROJECT_LINKS, displayUrl, socialsFor } from './data/site';
import { terminalCommands } from './services/terminalService';

function renderHome() {
  window.history.pushState({}, '', '/');
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

const hrefs = (root: Element) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('every surface links what data/site.ts says', () => {
  beforeEach(() => {
    sessionStorage.setItem('appLoaded', 'true');
  });

  it('footer: the footer profiles in order, the personal address and the location', () => {
    renderHome();
    const footer = screen.getByRole('contentinfo');
    const links = hrefs(footer);
    expect(links).toContain(`mailto:${EMAILS.personal}`);
    expect(links.filter((href) => href?.startsWith('https://'))).toEqual(socialsFor('footer').map(({ url }) => url));
    expect(footer).toHaveTextContent(IDENTITY.location);
  });

  it('connect: a labelled button per Connect profile, GitHub (YuriODev) included', () => {
    renderHome();
    const list = screen.getByRole('list', { name: 'Profiles' });
    expect(hrefs(list)).toEqual(socialsFor('connect').map(({ url }) => url));
    expect(within(list).getByRole('link', { name: 'GitHub (YuriODev)' })).toHaveAttribute(
      'href',
      'https://github.com/YuriODev',
    );
  });

  it('hero: the collaborate button mails the contact address', () => {
    renderHome();
    expect(screen.getByRole('link', { name: 'Collaborate with Me' })).toHaveAttribute('href', `mailto:${EMAILS.contact}`);
  });

  it('terminal: contact prints the personal address and each terminal profile', () => {
    const contact = terminalCommands.contact();
    expect(contact).toContain(EMAILS.personal);
    for (const { url } of socialsFor('terminal')) expect(contact).toContain(displayUrl(url));
    expect(contact).toContain(displayUrl(IDENTITY.website));
    expect(terminalCommands.projects()).toContain(displayUrl(PROJECT_LINKS.pythonCourse));
  });

  it('the Python course links use the YuriODev casing everywhere they render', () => {
    const { container } = renderHome();
    const course = [...container.querySelectorAll('a')].filter((a) => /python-course/i.test(a.href));
    expect(course.length).toBeGreaterThan(0);
    for (const a of course) expect(a.getAttribute('href')).toBe(PROJECT_LINKS.pythonCourse);
  });
});
