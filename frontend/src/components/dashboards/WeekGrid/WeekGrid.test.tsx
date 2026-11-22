import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import type { CalEvent } from '../../../services/dashboards/types';
import { findConflicts } from '../../../services/dashboards/weekLayout';
import { resetStorageFallback } from '../../../utils/safeStorage';
import WeekGrid from './WeekGrid';

const ev = (id: string, start: string, end: string, space: CalEvent['space'] = 'personal'): CalEvent => ({
  id,
  date: '2026-11-23',
  start,
  end,
  title: { ru: `Событие ${id}`, en: `Event ${id}` },
  space,
});

const DATES = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
const HOURS = Array.from({ length: 12 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`);

function renderGrid(events: CalEvent[], now?: Date) {
  return render(
    <DashboardLangProvider>
      <WeekGrid
        dates={DATES}
        today="2026-11-23"
        hours={HOURS}
        events={events}
        conflicts={findConflicts(events.map((e) => ({ ...e, day: e.date })))}
        now={now}
      />
    </DashboardLangProvider>,
  );
}

const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);

describe('WeekGrid', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageFallback();
  });

  it('three overlapping events are a cascade: each later start one step further in, every title and time readable', () => {
    renderGrid([ev('a', '15:00', '17:00'), ev('b', '15:30', '16:30'), ev('c', '16:00', '16:45')]);
    const blocks = ['a', 'b', 'c'].map((id) => screen.getByText(`Событие ${id}`).closest('li')!);
    expect(blocks.map((block) => prop(block, '--level'))).toEqual(['0', '1', '2']);
    expect(blocks.every((block) => prop(block, '--slots') === '1')).toBe(true);
    expect(blocks.every((block) => !block.hasAttribute('data-dense'))).toBe(true);
    // The range is under the title; the tooltip has it too.
    expect(within(blocks[0]).getByText('15:00–17:00')).toBeInTheDocument();
    expect(blocks[0]).toHaveAttribute('title', expect.stringContaining('15:00–17:00'));
  });

  it('events that start together stay side by side up to two; the rest fold into one "+N" chip that names them', () => {
    renderGrid([ev('a', '15:00', '17:00'), ev('b', '15:00', '16:45'), ev('c', '15:00', '16:30'), ev('d', '15:00', '16:00')]);
    const stack = screen.getAllByRole('listitem').find((li) => li.hasAttribute('data-stack'))!;
    expect(stack).toHaveTextContent('+2');
    expect(stack).toHaveAttribute('title', expect.stringContaining('Событие c'));
    expect(stack).toHaveAttribute('title', expect.stringContaining('Событие d'));
    expect(within(stack).getByText(/Ещё событий: 2/)).toHaveClass('sr-only');
    // The two visible events stay beside each other and the chip; the folded ones are not blocks of their own.
    expect(prop(screen.getByText('Событие a').closest('li')!, '--slots')).toBe('3');
    expect(prop(screen.getByText('Событие b').closest('li')!, '--slot')).toBe('1');
    expect(screen.queryByText('Событие c')).toBeNull();
  });

  it('two overlapping events are two equal columns at no indent', () => {
    renderGrid([ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30')]);
    const [a, b] = ['a', 'b'].map((id) => screen.getByText(`Событие ${id}`).closest('li')!);
    expect([prop(a, '--level'), prop(a, '--slot'), prop(a, '--slots')]).toEqual(['0', '0', '2']);
    expect([prop(b, '--level'), prop(b, '--slot'), prop(b, '--slots')]).toEqual(['0', '1', '2']);
  });

  it('a conflict is a ring and an icon in the block, not in the title, and is said in words', () => {
    renderGrid([ev('a', '15:00', '17:00'), ev('b', '15:30', '16:30', 'work-1'), ev('c', '16:00', '16:45', 'work-2')]);
    const block = screen.getByText('Событие b').closest('li')!;
    expect(block).toHaveAttribute('data-conflict', 'true');
    expect(block.querySelector('svg[data-icon="alert"]')).not.toBeNull();
    expect(screen.getByText('Событие b')).not.toContainElement(block.querySelector('svg'));
    expect(within(block).getByText(/Конфликт/)).toHaveClass('sr-only');
  });

  it('the title comes first; a block of 45 minutes or more shows its range, a shorter one its start on one line', () => {
    renderGrid([ev('short', '12:15', '12:30'), ev('long', '13:00', '14:00')]);
    const short = screen.getByText('Событие short').closest('li')!;
    const long = screen.getByText('Событие long').closest('li')!;
    expect(short).toHaveAttribute('data-short', 'true');
    expect(within(short).getByText('12:15')).toBeInTheDocument();
    expect(long).not.toHaveAttribute('data-short');
    expect(within(long).getByText('13:00–14:00')).toBeInTheDocument();
    expect(long.querySelector('[class*="name"]')!.compareDocumentPosition(long.querySelector('[class*="time"]')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('a note (the Focus-time line) is not drawn, only in the tooltip and the screen-reader text', () => {
    renderGrid([{ ...ev('f', '11:00', '12:00'), note: { ru: 'Фокус-время', en: 'Focus time' } }]);
    const block = screen.getByText('Событие f').closest('li')!;
    expect(block).toHaveAttribute('data-note', 'true');
    expect(block).toHaveAttribute('title', expect.stringContaining('Фокус-время'));
    expect(within(block).getByText('Фокус-время')).toHaveClass('sr-only');
  });

  it('draws the now line on today only, inside the grid hours', () => {
    const { container, rerender } = renderGrid([], new Date(2026, 10, 23, 10, 30));
    const line = container.querySelector('[class*="now"]') as HTMLElement;
    expect(line).not.toBeNull();
    expect(prop(line, '--now')).toBe('1.5');
    expect(line).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('[class*="now"]')).toHaveLength(1);
    const again = (now?: Date) =>
      rerender(
        <DashboardLangProvider>
          <WeekGrid dates={DATES} today="2026-11-23" hours={HOURS} events={[]} conflicts={findConflicts([])} now={now} />
        </DashboardLangProvider>,
      );
    again(new Date(2026, 10, 23, 22, 0));
    expect(container.querySelector('[class*="now"]')).toBeNull();
    again(undefined);
    expect(container.querySelector('[class*="now"]')).toBeNull();
  });
});
