import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import type { CalEvent } from '../../../services/dashboards/types';
import MonthGrid from './MonthGrid';

const ev = (id: string, start: string, space: CalEvent['space'], extra: Partial<CalEvent> = {}): CalEvent => ({
  id,
  date: '2026-11-24',
  start,
  end: '23:00',
  title: { ru: `Событие ${id}`, en: `Event ${id}` },
  space,
  ...extra,
});

function renderMonth(events: CalEvent[], conflicts: string[] = [], onPickDay = vi.fn()) {
  render(
    <DashboardLangProvider>
      <MonthGrid year={2026} month={11} today="2026-11-23" events={events} conflicts={{ ids: new Set(conflicts), count: conflicts.length }} onPickDay={onPickDay} />
    </DashboardLangProvider>,
  );
  return onPickDay;
}

describe('the month view uses the week view\'s event design', () => {
  it('draws each event as a chip with its space, title and start time; a conflict and a busy-only event are marked', () => {
    renderMonth([ev('a', '09:00', 'personal'), ev('b', '10:00', 'work-1', { note: { ru: 'Фокус-время', en: 'Focus time' } }), ev('c', '11:00', 'work-2')], ['c']);
    const day = screen.getByRole('button', { name: /^24 ноября, событий: 3/ });
    const chips = Array.from(day.querySelectorAll('[data-for]:not([aria-hidden="true"])'));
    expect(chips.map((chip) => chip.getAttribute('data-for'))).toEqual(['personal', 'work-1', 'work-2']);
    expect(chips.map((chip) => chip.hasAttribute('data-conflict'))).toEqual([false, false, true]);
    expect(chips.map((chip) => chip.hasAttribute('data-note'))).toEqual([false, true, false]);
    expect(within(chips[0] as HTMLElement).getByText('Событие a')).toBeInTheDocument();
    expect(within(chips[0] as HTMLElement).getByText('09:00')).toBeInTheDocument();
  });

  it('shows three chips then "+N", and picking the day opens it', async () => {
    const onPick = renderMonth(['a', 'b', 'c', 'd', 'e'].map((id, i) => ev(id, `0${i + 1}:00`, 'personal')));
    const day = screen.getByRole('button', { name: /^24 ноября, событий: 5/ });
    expect(day.querySelectorAll('[data-for]:not([aria-hidden="true"])')).toHaveLength(3);
    expect(within(day).getByText('+2 ещё')).toBeInTheDocument();
    await userEvent.setup().click(day);
    expect(onPick).toHaveBeenCalledWith('2026-11-24');
  });
});
