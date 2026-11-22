import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from './DashboardLangProvider';
import { useDashboardLang } from './useDashboardLang';
import { LANG_STORAGE_KEY } from '../services/dashboards/strings';
import { resetStorageFallback } from '../utils/safeStorage';

const Probe = () => {
  const { lang, setLang, t, text } = useDashboardLang();
  return (
    <>
      <p data-testid="lang">{lang}</p>
      <p data-testid="title">{t.hubTitle}</p>
      <p data-testid="text">{text({ ru: 'привет', en: 'hello' })}</p>
      <button type="button" onClick={() => setLang('en')}>to-en</button>
    </>
  );
};

const renderProbe = () =>
  render(
    <DashboardLangProvider>
      <Probe />
    </DashboardLangProvider>,
  );

describe('DashboardLangProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageFallback();
  });

  it('starts in Russian', () => {
    renderProbe();
    expect(screen.getByTestId('lang')).toHaveTextContent('ru');
    expect(screen.getByTestId('title')).toHaveTextContent('Дашборды');
    expect(screen.getByTestId('text')).toHaveTextContent('привет');
  });

  it('switches to English and keeps the choice for the next visit', async () => {
    const user = userEvent.setup();
    const first = renderProbe();
    await user.click(screen.getByRole('button', { name: 'to-en' }));
    expect(screen.getByTestId('title')).toHaveTextContent('Dashboards');
    expect(screen.getByTestId('text')).toHaveTextContent('hello');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');

    first.unmount();
    renderProbe();
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('ignores a stored value that is not a language', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'klingon');
    renderProbe();
    expect(screen.getByTestId('lang')).toHaveTextContent('ru');
  });

  it('the hook refuses to run outside the provider', () => {
    expect(() => render(<Probe />)).toThrow(/DashboardLangProvider/);
  });
});
