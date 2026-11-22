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

function renderGrid(events: CalEvent[]) {
  return render(
    <DashboardLangProvider>
      <WeekGrid
        dates={DATES}
        today="2026-11-23"
        hours={HOURS}
        events={events}
        conflicts={findConflicts(events.map((e) => ({ ...e, day: e.date })))}
      />
    </DashboardLangProvider>,
  );
}

describe('WeekGrid', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageFallback();
  });

  it('three overlapping events are dense blocks with no visible time', () => {
    renderGrid([ev('a', '15:00', '17:00'), ev('b', '15:30', '16:30'), ev('c', '16:00', '16:45')]);
    const blocks = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-dense'));
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block.querySelector('[aria-hidden="true"][class*="time"]')).toBeNull();
    // The time is still in the accessible text and the tooltip.
    expect(blocks[0]).toHaveAttribute('title', expect.stringContaining('15:00–17:00'));
  });

  it('four overlapping events fold the extra ones into a "+N" chip that names them', () => {
    renderGrid([ev('a', '15:00', '17:00'), ev('b', '15:15', '16:45'), ev('c', '15:30', '16:30'), ev('d', '16:00', '16:45')]);
    const stack = screen.getAllByRole('listitem').find((li) => li.hasAttribute('data-stack'))!;
    expect(stack).toHaveTextContent('+2');
    expect(stack).toHaveAttribute('title', expect.stringContaining('Событие c'));
    expect(stack).toHaveAttribute('title', expect.stringContaining('Событие d'));
    expect(within(stack).getByText(/Ещё событий: 2/)).toHaveClass('sr-only');
    // The two visible events stay; the folded ones are not blocks of their own.
    expect(screen.getByText('Событие a')).toBeInTheDocument();
    expect(screen.getByText('Событие b')).toBeInTheDocument();
    expect(screen.queryByText('Событие c')).toBeNull();
  });

  it('a conflict mark is in the corner row, not in the title', () => {
    renderGrid([ev('a', '15:00', '17:00'), ev('b', '15:30', '16:30', 'work-1'), ev('c', '16:00', '16:45', 'work-2')]);
    const block = screen.getByText('Событие b').closest('li')!;
    expect(block).toHaveAttribute('data-conflict', 'true');
    expect(block.querySelector('svg[data-icon="alert"]')).not.toBeNull();
    expect(screen.getByText('Событие b')).not.toContainElement(block.querySelector('svg'));
  });
});
