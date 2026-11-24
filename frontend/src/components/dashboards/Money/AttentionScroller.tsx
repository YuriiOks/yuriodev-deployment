import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, ProviderLogo } from '../../../services/dashboards/financeApi';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { AttentionItem, Recurring } from '../../../services/dashboards/recurringApi';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import BankMark from './BankMark';
import RecurringIcon from './RecurringIcon';
import { useCardFact, useSubject } from './attentionText';
import styles from './Attention.module.css';

interface Context {
  recurring: readonly Recurring[];
  accounts: readonly FinanceAccount[];
  logos: Readonly<Record<string, ProviderLogo>>;
  mode: MoneyDisplay;
}

/** One item as a small card that is one button: the bank's mark or the payment's picture, the subject in bold, the fact in a few words, and its severity in a word (and an edge tint). */
const AttentionCard: React.FC<Context & { item: AttentionItem; onOpen: (item: AttentionItem, trigger: HTMLElement) => void }> = ({ item, recurring, accounts, logos, mode, onOpen }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const subject = useSubject(item, recurring, accounts, logos);
  const fact = useCardFact(item, mode);
  const payment = subject.payment;
  const provider = subject.provider;
  return (
    <button type="button" className={styles.card} data-key={item.key} data-kind={item.kind} data-severity={item.severity} aria-haspopup="dialog" onClick={(event) => onOpen(item, event.currentTarget)}>
      <span className={styles.cardIcon}>
        {payment ? <RecurringIcon name={payment.name} iconUrl={payment.iconUrl} color={payment.color} /> : provider ? <BankMark provider={provider} logo={logos[provider]} /> : <DashIcon name="alert" size={16} />}
      </span>
      <span className={styles.cardText}>
        <strong className={styles.cardSubject}>{subject.name}</strong>
        <span className={styles.cardFact}>{fact}</span>
      </span>
      <span className={styles.cardSeverity}>
        {item.severity === 'high' && <DashIcon name="alert" size={14} />}
        {r.severityWord[item.severity]}
      </span>
    </button>
  );
};

export interface AttentionScrollerProps extends Context {
  /** The items in the order to show them (active ones, by the server's severity). */
  items: readonly AttentionItem[];
  /** Where "All N" goes. */
  allHref: string;
  onOpen: (item: AttentionItem, trigger: HTMLElement) => void;
}

/**
 * One horizontal row of small cards, one per item, in the server's severity order: a quiet label before it and "All N" after it, both fixed outside the scrolling area. It scrolls with no snap points and no scroll anchoring, so it moves only when the person scrolls it. It has arrow buttons (only toward what is left to scroll to) on a desktop and swipes on touch, and the cards are buttons, so the keyboard reaches them (the arrow keys move
 * between them). It never wraps, so it is one line high whatever the count.
 */
const AttentionScroller: React.FC<AttentionScrollerProps> = ({ items, allHref, onOpen, ...context }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length, measure]);

  const scrollBy = (direction: 1 | -1) => {
    const el = scroller.current;
    el?.scrollBy?.({ left: direction * Math.max(el.clientWidth * 0.8, 220), behavior: 'smooth' });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const cards = Array.from(scroller.current?.querySelectorAll<HTMLElement>('button[data-key]') ?? []);
    const index = cards.findIndex((card) => card === document.activeElement);
    if (index < 0) return;
    const next = cards[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <section aria-label={r.attentionTitle} className={styles.row} id="money-attention-row">
      <span className={styles.rowLabel}>{fill(r.rowLabel, { n: items.length })}</span>
      <button type="button" className={cx(styles.arrow, styles.arrowLeft)} data-edge={edge.start ? 'true' : 'false'} aria-label={r.scrollLeft} onClick={() => scrollBy(-1)}>
        <DashIcon name="prev" size={16} />
      </button>
      <div ref={scroller} className={styles.scroller} onScroll={measure} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <AttentionCard key={item.key} item={item} onOpen={onOpen} {...context} />
        ))}
      </div>
      <button type="button" className={cx(styles.arrow, styles.arrowRight)} data-edge={edge.end ? 'true' : 'false'} aria-label={r.scrollRight} onClick={() => scrollBy(1)}>
        <DashIcon name="next" size={16} />
      </button>
      <Link className={styles.rowAll} to={allHref}>
        {fill(r.rowAll, { n: items.length })}
      </Link>
    </section>
  );
};

export default AttentionScroller;
