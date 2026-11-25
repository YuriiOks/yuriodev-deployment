import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { pagePath } from '../../../data/site';
import { useStoredImages } from '../../../hooks/useImageBundles';
import { fill } from '../../../services/dashboards/calendarLabels';
import { converted, isCategory, type Category, type ProviderLogo } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { ATTENTION_KINDS, markPaid, movedOn, snoozeAttention, updateRecurring, type AttentionItem, type AttentionKind } from '../../../services/dashboards/recurringApi';
import type { TodayData, TodayQueueEntry, TodaySoonEntry } from '../../../services/dashboards/todayApi';
import DashIcon from '../DashIcon/DashIcon';
import AskCard from '../Today/AskCard';
import StreakCard from '../Today/StreakCard';
import TodayLayout, { SideCard, SideRow, TodayCard, TodaySoonRow, type TodayAction } from '../Today/TodayLayout';
import BankMark from './BankMark';
import CategoryMark from './CategoryMark';
import RecurringIcon from './RecurringIcon';
import { useCardFact } from './attentionText';
import { dayLabel, monthName } from './labels';
import { bankLabel } from './providers';
import { dueWhen } from './recurringLabels';
import { partOfDay } from './todayModel';

const DUE_DAYS = 14;

const EMPTY_LOGO: ProviderLogo = { onLight: null, onDark: null, mark: null, name: null, colors: null, entry: null, reconnect: null, reconnectPath: null };
const isColors = (value: unknown): value is { background: string; foreground: string } => typeof value === 'object' && value !== null && typeof (value as { background?: unknown }).background === 'string' && typeof (value as { foreground?: unknown }).foreground === 'string';
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** How long ago a moment was, in the page's language ("5 minutes ago"). */
function ago(iso: string, lang: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  if (minutes < 60 * 24) return formatter.format(-Math.round(minutes / 60), 'hour');
  return formatter.format(-Math.round(minutes / (60 * 24)), 'day');
}

/** An attention item rebuilt from a queue entry of the Today answer, so the wording of the attention list (the fact line of a card) is the same everywhere. */
function itemOf(entry: TodayQueueEntry, displayCurrency: string | null): AttentionItem | null {
  const kind = ATTENTION_KINDS.find((candidate): candidate is AttentionKind => candidate === entry.kind);
  if (!kind) return null;
  const f = entry.facts;
  const severity = f.severity === 'high' || f.severity === 'medium' || f.severity === 'info' ? f.severity : 'medium';
  const type = entry.subject.type === 'payment' ? 'recurring' : entry.subject.type === 'account' ? 'account' : 'connection';
  const facts: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(f)) if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') facts[key] = value;
  return {
    key: entry.key,
    kind,
    severity,
    title: '',
    subjectType: type,
    subjectId: entry.subject.id ?? '',
    subjectName: entry.subject.name,
    provider: text(f.provider),
    dueDate: text(f.due_date),
    amount: num(f.amount),
    currency: text(f.currency),
    display: converted(f.display_amount, displayCurrency),
    converted: f.converted === true,
    facts,
    state: 'active',
    snoozedUntil: null,
  };
}

/** One decision of the queue: what the item asks, phrased as a question, one line of fact, and exactly two actions. Everything it needs came with the answer. */
const QueueCard: React.FC<{ entry: TodayQueueEntry; displayCurrency: string | null; mode: MoneyDisplay; images: ReturnType<typeof useStoredImages>; onChanged: () => Promise<void> }> = ({ entry, displayCurrency, mode, images, onChanged }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const td = t.money.today;
  const item = itemOf(entry, displayCurrency);
  const fact = useCardFact(item ?? FALLBACK_ITEM, mode);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const id = entry.subject.id;
  const name = entry.subject.name ?? '';
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      if (movedOn(error)) await onChanged().catch(() => undefined);
      setNote(movedOn(error) ? r.alreadyMoved : r.actionFailed);
    } finally {
      setBusy(false);
    }
  };
  const list: TodayAction = { label: td.actions.details, to: '?view=attention' };
  const snooze: TodayAction = { label: td.actions.snooze, onClick: () => void act(() => snoozeAttention(entry.key, 7)), busy };
  const charged = num(entry.facts.charged_amount);
  let primary = list;
  let secondary = snooze;
  if (entry.kind === 'amount_changed' && id && charged !== null && charged > 0) {
    primary = { label: td.actions.accept, onClick: () => void act(() => updateRecurring(id, { amount: charged })), busy };
    secondary = { label: td.actions.openPayment, to: `?view=recurring&edit=${encodeURIComponent(id)}` };
  } else if ((entry.kind === 'missed_payment' || entry.kind === 'due_not_covered') && id) {
    primary = { label: td.actions.markPaid, onClick: () => void act(() => markPaid(id, item.dueDate)), busy };
    secondary = list;
  }
  const provider = item.provider;
  const icon = entry.subject.type === 'payment' && id ? <RecurringIcon name={name} iconUrl={images.icons[id] ?? null} color={null} /> : provider ? <BankMark provider={provider} logo={images.logos[provider]} /> : <DashIcon name="alert" size={16} />;
  return <TodayCard item={{ key: entry.key, icon, title: fill(td.decision[item.kind], { name }), fact: note ? `${fact} · ${note}` : `${r.severityWord[item.severity]} · ${fact}`, primary, secondary, severity: item.severity }} />;
};

const FALLBACK_ITEM: AttentionItem = { key: '', kind: 'overdraft', severity: 'info', title: '', subjectType: 'account', subjectId: '', subjectName: null, provider: null, dueDate: null, amount: null, currency: null, display: null, converted: false, facts: {}, state: 'active', snoozedUntil: null };

/** One row of "due soon": the payment, its amount and when, and one action: "Paid". */
const SoonRow: React.FC<{ entry: TodaySoonEntry; displayCurrency: string | null; mode: MoneyDisplay; images: ReturnType<typeof useStoredImages>; onChanged: () => Promise<void> }> = ({ entry, displayCurrency, mode, images, onChanged }) => {
  const { t, lang } = useDashboardLang();
  const td = t.money.today;
  const [busy, setBusy] = useState(false);
  const f = entry.facts;
  const due = text(f.due_date) ?? '';
  const days = num(f.days_until) ?? 0;
  const id = entry.subject.id;
  const paid = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await markPaid(id, due);
      await onChanged();
    } catch (error) {
      if (movedOn(error)) await onChanged().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const amount = num(f.amount);
  const code = text(f.currency);
  const shown = converted(f.display_amount, displayCurrency);
  const amountText = mode === 'base' && f.converted === true && shown ? `≈ ${formatMinor(shown.amount, shown.currency, lang)}` : amount !== null && code ? formatMinor(amount, code, lang) : '';
  const when = days <= 1 ? dueWhen(days, t.money.rec) : dayLabel(due, lang);
  return <TodaySoonRow item={{ key: entry.key, icon: <RecurringIcon name={entry.subject.name ?? ''} iconUrl={id ? (images.icons[id] ?? null) : null} color={null} />, name: entry.subject.name ?? '', chips: [amountText, when].filter(Boolean), action: { label: td.paid, onClick: () => void paid(), busy } }} />;
};

export interface MoneyTodayProps {
  /** The server's one Today answer for Money (`GET /today?scope=money`): everything below is read from it, no other list is loaded. */
  data: TodayData | null;
  /** The answer could not be read (and there is none to show). */
  failed: boolean;
  /** The section tabs, as the page builds them. */
  nav: React.ReactNode;
  /** How fresh the data is, Refresh and the display switch: quiet controls at the far right of the header row. */
  controls: React.ReactNode;
  /** The answer is asked again. */
  onChanged: () => Promise<void>;
  /** Pounds, or each account's own currency (the page's switch). */
  mode: MoneyDisplay;
}

/**
 * The Today view of the Money page, on the shared Today structure, from one answer (`GET /today?scope=money`): one sentence of what matters
 * now, the queue ("First this": at most three decisions, each with two actions, and "One at a time" which walks through all of them in the
 * attention list), what is due soon, two figures, where the money went with its finding, the banks with how fresh each one's data is, the streak
 * and Ask. Nothing else is fetched for it (the lists load only when their tab is opened); pictures are drawn from the stored bundles.
 */
const MoneyToday: React.FC<MoneyTodayProps> = ({ data, failed, nav, controls, onChanged, mode }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const td = m.today;
  const images = useStoredImages(data?.logosVersion ?? null, data?.iconsVersion ?? null);
  const facts = data?.summary.facts ?? {};
  const displayCurrency = text(facts.currency);
  const totalMinor = num(facts.total);
  const queue = data?.queue ?? [];
  const soon = data?.soon ?? [];

  // The one sentence.
  const next = soon[0];
  const parts = [
    totalMinor !== null && displayCurrency ? fill(td.summary.total, { amount: `${facts.complete === false ? '≈ ' : ''}${formatMinor(totalMinor, displayCurrency, lang)}` }) : '',
    (data?.queueTotal ?? 0) > 0 ? fill(td.summary.waiting, { n: data?.queueTotal ?? 0 }) : data ? td.summary.nothingWaiting : '',
    next ? fill(td.summary.nextPayment, { when: dueWhen(num(next.facts.days_until) ?? 0, m.rec) }) : '',
  ].filter(Boolean);

  // The two figures.
  const spentStat = data?.stats.find((stat) => stat.code === 'spent_month_to_date');
  const dueStat = data?.stats.find((stat) => stat.code === 'due_in_14_days');
  const spentCode = text(spentStat?.facts.currency) ?? displayCurrency ?? 'GBP';
  const month = text(spentStat?.facts.month) ?? '';
  const previousDay = text(spentStat?.facts.previous_to_date_day);
  const before = spentStat?.compare?.value ?? null;
  let spentNote = td.stats.spentFirst;
  if (spentStat && before !== null && before > 0 && previousDay && spentStat.value !== null) {
    const percent = Math.round((Math.abs(spentStat.value - before) / before) * 100);
    const date = dayLabel(previousDay, lang);
    spentNote = percent === 0 ? fill(td.stats.spentSame, { date }) : fill(spentStat.value < before ? td.stats.spentLess : td.stats.spentMore, { percent, date });
  }
  const dueCode = text(dueStat?.facts.currency) ?? displayCurrency ?? 'GBP';
  const dueCount = num(dueStat?.facts.count) ?? 0;
  const approx = (stat: typeof spentStat) => (stat?.facts.complete === false ? '≈ ' : '');
  const stats = [
    { key: 'spent', label: fill(td.stats.spentIn, { month: month ? monthName(month, lang) : '' }), value: spentStat?.value != null ? `${approx(spentStat)}${formatMinor(spentStat.value, spentCode, lang)}` : '—', note: spentStat ? spentNote : '' },
    { key: 'due', label: fill(td.stats.dueIn, { days: DUE_DAYS }), value: dueStat?.value != null && dueCount > 0 ? `${approx(dueStat)}${formatMinor(dueStat.value, dueCode, lang)}` : td.stats.dueEmpty, note: fill(td.stats.dueConfirmed, { amount: formatMinor(num(dueStat?.facts.confirmed_by_bank) ?? 0, dueCode, lang) }) },
  ];

  // Where the money went, and what rose.
  const rows = (data?.breakdown.rows ?? []).filter((row) => isCategory(row.key) && row.value > 0);
  const largest = rows[0]?.value ?? 0;
  const found = data?.breakdown.insight;
  let insight: { title: string; text: string } | null = null;
  if (found?.code === 'category_rise' && isCategory(found.facts.category) && previousDay) {
    const category: Category = found.facts.category;
    const code = text(found.facts.currency) ?? spentCode;
    insight = { title: fill(td.insight.rose, { category: m.categories[category] }), text: fill(td.insight.roseText, { date: dayLabel(previousDay, lang), previous: formatMinor(num(found.facts.before) ?? 0, code, lang), spent: formatMinor(num(found.facts.spent) ?? 0, code, lang) }) };
  } else if (rows[0] && spentStat?.value) {
    insight = { title: fill(td.insight.top, { category: m.categories[rows[0].key as Category] }), text: fill(td.insight.topText, { percent: Math.round((rows[0].value / Math.max(spentStat.value, 1)) * 100) }) };
  }

  const owner = text(facts.owner_name);
  const greeting = td.greeting[partOfDay(new Date().getHours())];
  const connections = (data?.today ?? []).filter((row) => row.kind === 'connection');
  return (
    <TodayLayout
      mark="£"
      place={m.title}
      placeIsHeading
      markTo={{ to: pagePath('dashboards-personal'), label: m.back }}
      controls={controls}
      nav={nav}
      hello={owner ? `${greeting}, ${owner}` : greeting}
      summary={parts.join(' ')}
      queue={{
        title: td.queueTitle,
        count: data?.queueTotal ?? 0,
        countLabel: fill(td.queueOpen, { n: data?.queueTotal ?? 0 }),
        countTo: '?view=attention',
        cards: queue.map((entry) => <QueueCard key={entry.key} entry={entry} displayCurrency={displayCurrency} mode={mode} images={images} onChanged={onChanged} />),
        shown: queue.length,
        empty: td.queueEmpty,
        oneAtATime: (data?.queueTotal ?? 0) > 1 ? { label: td.oneAtATime, to: '?view=attention&walk=1' } : null,
      }}
      soon={{ title: td.soonTitle, linkLabel: td.soonLink, linkTo: '?view=payments', rows: soon.map((entry) => <SoonRow key={entry.key} entry={entry} displayCurrency={displayCurrency} mode={mode} images={images} onChanged={onChanged} />), shown: soon.length, empty: td.soonEmpty }}
      stats={stats}
      breakdown={{ title: td.breakdown.title, period: month ? monthName(month, lang) : '', rows: rows.map((row) => ({ key: row.key, icon: <CategoryMark category={row.key as Category} />, name: m.categories[row.key as Category], value: formatMinor(row.value, text(row.facts.currency) ?? spentCode, lang), width: largest > 0 ? Math.round((row.value / largest) * 100) : 0 })), insight, empty: td.breakdown.empty }}
      side={
        <>
          {failed && <p role="alert">{td.failed}</p>}
          {data?.assistantEnabled && <AskCard scope="money" />}
          <SideCard title={td.banksTitle} linkLabel={td.banksLink} linkTo="?view=wallet">
            {connections.length === 0 ? (
              <p>{td.banksEmpty}</p>
            ) : (
              connections.map((row) => {
                const f = row.facts;
                const provider = text(f.provider) ?? '';
                const lastOk = text(f.last_ok_at);
                const look = f.stale === true || (typeof f.status === 'string' && f.status !== 'ok');
                const balances = Array.isArray(f.balances) ? (f.balances as { currency?: unknown; amount?: unknown }[]) : [];
                const lead = balances.find((balance) => typeof balance.currency === 'string' && typeof balance.amount === 'number');
                const base = f.manual === true ? (lastOk ? fill(td.bank.byHand, { date: dayLabel(lastOk, lang) }) : td.bank.never) : lastOk ? fill(td.bank.updated, { when: ago(lastOk, lang) }) : td.bank.never;
                const amount = lead ? formatMinor(lead.amount as number, lead.currency as string, lang) : '';
                // The row carries the bank's own colours and name, so its mark needs no logo to be drawn.
                const colors = isColors(f.colors) ? f.colors : null;
                const logo = images.logos[provider] ?? (colors ? { ...EMPTY_LOGO, colors } : undefined);
                const name = row.subject.name ?? text(f.provider_name) ?? bankLabel(provider, logo);
                return <SideRow key={row.subject.id ?? provider} icon={<BankMark provider={provider} logo={logo} />} when={look ? `${td.bank.look} · ${base}` : base} what={`${name}${amount ? ` · ${amount}` : ''}`} />;
              })
            )}
          </SideCard>
          {data?.streak && <StreakCard streak={data.streak} today={data.date} />}
        </>
      }
    />
  );
};

export default MoneyToday;
