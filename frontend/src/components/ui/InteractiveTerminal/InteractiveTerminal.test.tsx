import type { ReactElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../../context/ThemeContext';
import InteractiveTerminal from './InteractiveTerminal';

const render = (ui: ReactElement) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>);
const field = () => screen.getByLabelText('Terminal command input');
/** The rendered output lines' text, in order (the fixed welcome lines excluded). */
const outputLines = () =>
  [...document.querySelectorAll('[data-line-type]')].map((el) => el.textContent ?? '');

// The terminal colours emoji-prefixed header lines as 'info'. This locks in the
// rendered result of the emoji classifier (utils/headerEmoji) inside the real
// component, including multi-codepoint emoji such as the building-construction
// sign with its variation selector.
const lineWithText = (text: string) =>
  screen.getAllByText((_, el) => el?.textContent === text && el.className.includes('terminalLine'))[0];

const hasType = (el: HTMLElement, type: string) =>
  el.className.split(/\s+/).some((c) => c === type || c.includes(`_${type}_`) || c.endsWith(`_${type}`));

describe('InteractiveTerminal colouring', () => {
  test('emoji header lines render as info, plain section titles as warning', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(screen.getByLabelText('Terminal command input'), 'skills{Enter}');

    const singleCodepoint = lineWithText('🤖 AI & Agentic Engineering:');
    const multiCodepoint = lineWithText('🏗️  System Architecture:');
    const plainTitle = lineWithText('Technical Skills Matrix:');

    expect(hasType(singleCodepoint, 'info')).toBe(true);
    expect(hasType(multiCodepoint, 'info')).toBe(true);
    expect(hasType(plainTitle, 'warning')).toBe(true);
    expect(hasType(plainTitle, 'info')).toBe(false);
  });

  test('an unknown command is reported as an error line', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(screen.getByLabelText('Terminal command input'), 'definitely-not-a-command{Enter}');

    const errorLine = screen.getAllByText((_, el) =>
      !!el?.className.includes('terminalLine') && /not found/i.test(el.textContent ?? ''),
    )[0];
    expect(hasType(errorLine, 'error')).toBe(true);
  });

  test.each(['constructor', '__proto__'])(
    'typing %s reports an unknown command instead of crashing',
    async (name) => {
      const user = userEvent.setup();
      render(<InteractiveTerminal />);

      await user.type(screen.getByLabelText('Terminal command input'), `${name}{Enter}`);

      expect(screen.getByText(`Command not found: ${name}. Type "help" for available commands.`)).toBeInTheDocument();
    },
  );

  test('Enter that confirms an IME composition does not run the command', () => {
    render(<InteractiveTerminal />);
    const input = screen.getByLabelText('Terminal command input');
    fireEvent.change(input, { target: { value: 'help' } });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryByText('Available commands:')).not.toBeInTheDocument();
    expect(input).toHaveValue('help');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Available commands:')).toBeInTheDocument();
  });

  test('the teacher emoji header renders intact and coloured as a header', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(screen.getByLabelText('Terminal command input'), 'skills{Enter}');

    expect(hasType(lineWithText('👨‍🏫 Leadership & Education:'), 'info')).toBe(true);
  });
});

describe('InteractiveTerminal input', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('every output line carries its type', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'help{Enter}');

    const command = document.querySelector('[data-line-type="command"]');
    expect(command).toHaveTextContent('visitor@yuriodev:~$ help');
    expect(document.querySelector('[data-line-type="warning"]')).toHaveTextContent('Available commands:');
  });

  test('ArrowUp and ArrowDown walk the history and restore the half-typed line', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'skills{Enter}');
    await user.type(field(), 'contact{Enter}');
    await user.type(field(), 'ab');

    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('contact');
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('skills');
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('skills');
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveValue('contact');
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveValue('ab');
  });

  test('Tab completes a command name', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'proj');
    await user.keyboard('{Tab}');

    expect(field()).toHaveValue('projects ');
    expect(field()).toHaveFocus();
  });

  test('Tab lists the candidates when several commands fit', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'e');
    await user.keyboard('{Tab}');

    expect(field()).toHaveValue('e');
    expect(outputLines()).toContain('experience  education');
  });

  test('Tab with nothing to complete moves focus on, so the field never traps the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <>
        <InteractiveTerminal />
        <button type="button">after</button>
      </>,
    );

    field().focus();
    await user.keyboard('{Tab}');

    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  test('clear empties the output', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'skills{Enter}');
    expect(outputLines().length).toBeGreaterThan(5);
    await user.type(field(), 'clear{Enter}');

    expect(outputLines()).toEqual([]);
  });

  test('theme switches the site theme', async () => {
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'theme light{Enter}');

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(outputLines()).toContain('Theme switched to light.');
  });

  test('status shows the API environment and revision once the answer arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: 'healthy', environment: 'stage', revision: 'abcdef1234567890' }), {
            status: 200,
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'status{Enter}');

    expect(await screen.findByText('Environment: stage')).toBeInTheDocument();
    expect(outputLines()).toContain('Revision:    abcdef1');
    // The answer takes the place of the placeholder shown while waiting.
    expect(outputLines()).not.toContain('Working...');
  });

  test('status says the API is unreachable instead of failing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const user = userEvent.setup();
    render(<InteractiveTerminal />);

    await user.type(field(), 'status{Enter}');

    const line = await screen.findByText('Could not reach the API (network error).');
    expect(line).toHaveAttribute('data-line-type', 'error');
  });

  test('the field does not autocorrect or capitalise', () => {
    render(<InteractiveTerminal />);
    expect(field()).toHaveAttribute('autocapitalize', 'off');
    expect(field()).toHaveAttribute('autocorrect', 'off');
    expect(field()).toHaveAttribute('spellcheck', 'false');
  });
});
