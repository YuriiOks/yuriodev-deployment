import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, FinanceAccounts } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import { bankTotals, creditUse, groupBanks, potParts, sharedNames, splitBank, type Bank } from '../../../services/dashboards/wallet';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import BankMark, { brandStyle } from './BankMark';
import { dayLabel, whenLabel } from './labels';
import { providerName, reconnectPath } from './providers';
import styles from './Money.module.css';

/** The link's state in words, with when it last worked. */
function useLinkLine(bank: Bank): string {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const status = bank.connection?.status;
  const label = status === 'ok' ? m.linkOk : status === 'needs_reconsent' ? m.linkNeedsReconsent : status === 'paused' ? m.linkPaused : m.linkNone;
  const when = bank.connection?.lastOkAt ? whenLabel(bank.connection.lastOkAt, lang) : '';
  return when ? `${label} · ${fill(m.lastOk, { when })}` : label;
}

/** One bank in the stack: a coloured card, the name at the left and its money at the right; a button that opens the bank. */
const BankCard: React.FC<{ bank: Bank; selected: boolean; first: boolean; onSelect: () => void }> = ({ bank, selected, first, onSelect }) => {
  const { lang } = useDashboardLang();
  const line = useLinkLine(bank);
  const totals = bankTotals(bank);
  const warn = bank.connection?.status === 'needs_reconsent';
  return (
    <button
      type="button"
      className={cx(styles.bank, first && styles.bankFirst, selected && styles.bankSelected)}
      style={brandStyle(bank.provider)}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.bankText}>
        <strong className={styles.bankName}>{providerName(bank.provider)}</strong>
        <span className={styles.bankState}>
          {warn && <DashIcon name="alert" size={14} />}
          {line}
        </span>
      </span>
      <span className={styles.bankSums}>
        {totals.map((total) => (
          <strong key={total.currency} className={styles.bankSum}>
            {formatMinor(total.own, total.currency, lang)}
          </strong>
        ))}
      </span>
    </button>
  );
};

const AccountCard: React.FC<{ account: FinanceAccount; distinguish: boolean }> = ({ account, distinguish }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const use = creditUse(account);
  const notes = [
    account.maskLast4 ? `•••• ${account.maskLast4}` : '',
    distinguish && account.historyFrom ? fill(m.historyFrom, { date: dayLabel(account.historyFrom, lang) }) : '',
    account.creditLimit > 0 && use.kind === 'none' ? fill(m.creditLimit, { amount: formatMinor(account.creditLimit, account.currency, lang) }) : '',
  ].filter(Boolean);
  return (
    <li className={styles.account} data-kind={use.kind}>
      <div className={styles.accountRow}>
        <div className={styles.accountText}>
          <strong className={styles.accountName}>{account.name}</strong>
          {notes.length > 0 && <span className={styles.accountNote}>{notes.join(' · ')}</span>}
        </div>
        <strong className={styles.accountAmount}>
          {use.kind === 'debt' && `${m.debt} ${formatMinor(use.used, account.currency, lang)}`}
          {use.kind === 'overdrawn' && (
            <>
              <span className={styles.word}>{m.overdrawn}</span> {formatMinor(account.ownBalance, account.currency, lang)}
            </>
          )}
          {use.kind === 'none' && formatMinor(account.ownBalance, account.currency, lang)}
        </strong>
      </div>
      {use.kind === 'debt' && (
        <>
          <div aria-hidden="true" className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${use.percent}%` }} />
          </div>
          <span className={styles.accountNote}>
            {fill(m.usedOfLimit, {
              percent: use.percent,
              limit: formatMinor(use.limit, account.currency, lang),
              free: formatMinor(use.free, account.currency, lang),
            })}
          </span>
        </>
      )}
    </li>
  );
};

const PotTile: React.FC<{ account: FinanceAccount }> = ({ account }) => {
  const { lang } = useDashboardLang();
  const { emoji, label } = potParts(account.name);
  return (
    <li className={styles.pot}>
      <span aria-hidden="true" className={styles.potPicture}>
        {emoji ?? Array.from(label)[0]?.toLocaleUpperCase()}
      </span>
      <span className={styles.potName}>{label}</span>
      <strong className={styles.potAmount}>{formatMinor(account.ownBalance, account.currency, lang)}</strong>
    </li>
  );
};

/** The opened bank: its header in the brand colours, the main accounts as cards, the pots as tiles, the empty ones folded. */
const BankDetail: React.FC<{ bank: Bank }> = ({ bank }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const [showEmpty, setShowEmpty] = useState(false);
  const line = useLinkLine(bank);
  const split = splitBank(bank);
  const totals = bankTotals(bank);
  const shared = sharedNames(bank.accounts);
  const emptyCount = split.emptyAccounts.length + split.emptyPots.length;
  const accounts = showEmpty ? [...split.accounts, ...split.emptyAccounts] : split.accounts;
  const pots = showEmpty ? [...split.pots, ...split.emptyPots] : split.pots;
  const potsSum = pots.length > 0 ? totals.filter((total) => total.pots !== 0) : [];
  const reconnect = bank.connection?.status === 'needs_reconsent' ? reconnectPath(bank.provider) : null;
  const id = `money-bank-${bank.provider}`;

  return (
    <article aria-labelledby={`${id}-name`} className={styles.detail}>
      <header className={styles.detailHead} style={brandStyle(bank.provider)}>
        <div className={styles.detailTitle}>
          <BankMark provider={bank.provider} />
          <div className={styles.bankText}>
            <h3 id={`${id}-name`} className={styles.detailName}>
              {providerName(bank.provider)}
            </h3>
            <span className={styles.bankState}>
              {bank.connection?.status === 'needs_reconsent' && <DashIcon name="alert" size={14} />}
              {line}
            </span>
          </div>
        </div>
        <div className={styles.detailSums}>
          <span className={styles.bankState}>{m.ownMoney}</span>
          {totals.map((total) => (
            <strong key={total.currency} className={styles.detailSum}>
              {formatMinor(total.own, total.currency, lang)}
            </strong>
          ))}
        </div>
      </header>
      <div className={styles.detailBody}>
        {bank.connection?.status === 'needs_reconsent' && (
          <div role="alert" className={styles.reconsent}>
            <span>{m.reconnectHint}</span>
            {reconnect && (
              <a className={styles.reconnect} href={reconnect}>
                {m.reconnect}
              </a>
            )}
          </div>
        )}
        {bank.accounts.length === 0 && <p className={styles.none}>{m.noAccounts}</p>}
        {accounts.length > 0 && (
          <section aria-label={m.accountsTitle}>
            <ul className={styles.accountList}>
              {accounts.map((account) => (
                <AccountCard key={account.id} account={account} distinguish={shared.has(account.name.trim().toLowerCase())} />
              ))}
            </ul>
          </section>
        )}
        {pots.length > 0 && (
          <section aria-label={m.pots}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{m.pots}</h4>
              <span className={styles.sectionNote}>
                {fill(m.potsTotal, { n: pots.length, amount: potsSum.map((total) => formatMinor(total.pots, total.currency, lang)).join(' · ') })}
              </span>
            </div>
            <ul className={styles.potGrid}>
              {pots.map((account) => (
                <PotTile key={account.id} account={account} />
              ))}
            </ul>
          </section>
        )}
        {emptyCount > 0 && (
          <button type="button" className={styles.fold} aria-expanded={showEmpty} onClick={() => setShowEmpty((open) => !open)}>
            {showEmpty ? m.hideEmpty : fill(m.foldEmpty, { n: emptyCount })}
          </button>
        )}
        {split.archived.length > 0 && (
          <section aria-label={m.archivedTitle}>
            <h4 className={styles.sectionTitle}>{m.archivedTitle}</h4>
            <ul className={styles.accountList}>
              {split.archived.map((account) => (
                <li key={account.id} className={styles.account} data-archived="true">
                  <div className={styles.accountRow}>
                    <span className={styles.accountName}>
                      {account.name} <span className={styles.accountNote}>· {m.archivedMark}</span>
                    </span>
                    <span className={styles.accountAmount}>{formatMinor(account.ownBalance, account.currency, lang)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
};

export interface MoneyWalletProps {
  data: FinanceAccounts;
  /** The bank the page has open (the transactions' bank chip follows it when it is chosen there). */
  selected: string | null;
  onSelect: (provider: string) => void;
}

/** The wallet: every bank as a coloured card in a stack, and the selected bank opened beside it (below it on a phone). */
const MoneyWallet: React.FC<MoneyWalletProps> = ({ data, selected, onSelect }) => {
  const { t } = useDashboardLang();
  const banks = groupBanks(data.accounts, data.connections);
  if (banks.length === 0) return <p className={styles.none}>{t.money.noAccounts}</p>;
  const current = banks.find((bank) => bank.provider === selected) ?? banks[0];
  return (
    <div className={styles.wallet}>
      <div role="group" aria-label={t.money.walletLabel} className={styles.stack}>
        {banks.map((bank, index) => (
          <BankCard key={bank.provider} bank={bank} first={index === 0} selected={bank.provider === current.provider} onSelect={() => onSelect(bank.provider)} />
        ))}
      </div>
      <BankDetail key={current.provider} bank={current} />
    </div>
  );
};

export default MoneyWallet;
