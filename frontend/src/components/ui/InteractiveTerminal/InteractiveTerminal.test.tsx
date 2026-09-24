import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InteractiveTerminal from './InteractiveTerminal';

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
});
