/** The words of the "Queue cleared" card (both languages): the days of the week the list was closed. */
export interface StreakStrings {
  readonly title: string;
  readonly subtitle: string;
  readonly row: string;
  readonly week: string;
  readonly none: string;
  readonly states: { readonly cleared: string; readonly open: string; readonly future: string; readonly no_data: string };
  readonly dayLetters: readonly string[];
}

export const STREAK_RU: StreakStrings = {
  title: 'Разбор очереди',
  subtitle: 'закрытые дни',
  row: '{n} дн. подряд',
  week: '{cleared} из {total} дней на этой неделе',
  none: 'Пока нет закрытых дней',
  states: { cleared: 'очередь закрыта', open: 'очередь не закрыта', future: 'ещё впереди', no_data: 'нет данных' },
  dayLetters: ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'],
};

export const STREAK_EN: StreakStrings = {
  title: 'Queue cleared',
  subtitle: 'closed days',
  row: '{n} d in a row',
  week: '{cleared} of {total} days this week',
  none: 'No cleared days yet',
  states: { cleared: 'queue cleared', open: 'queue not cleared', future: 'still ahead', no_data: 'no data' },
  dayLetters: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
};
