import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, FinanceAccounts } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import { shownTotals } from '../../../services/dashboards/display';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { creditUse, groupBanks, potParts, sharedNames, splitBank, type Bank } from '../../../services/dashboards/wallet';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import Amount, { ShownAmount } from './Amount';
import BankMark, { brandStyle } from './BankMark';
import BankName from './BankName';
import { dayLabel, whenLabel } from './labels';
import { reconnectPath } from './providers';
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
const BankCard: React.FC<{ bank: Bank; selected: boolean; first: boolean; mode: MoneyDisplay; onSelect: () => void }> = ({ bank, selected, first, mode, onSelect }) => {
  const line = useLinkLine(bank);
  const totals = shownTotals(bank.accounts, mode);
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
        <strong className={styles.bankName}>
          <BankName provider={bank.provider} logo={bank.connection?.logo} />
        </strong>
        <span className={styles.bankState}>
          {warn && <DashIcon name="alert" size={14} />}
          {line}
        </span>
      </span>
      <span className={styles.bankSums}>
        {totals.map((total) => (
          <strong key={total.currency} className={styles.bankSum}>
            <ShownAmount shown={total} />
          </strong>
        ))}
      </span>
    </button>
  );
};

const AccountCard: React.FC<{ account: FinanceAccount; distinguish: boolean; mode: MoneyDisplay }> = ({ account, distinguish, mode }) => {
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
          {use.kind === 'debt' && (
            <>
              {m.debt} <Amount amount={use.used} currency={account.currency} display={account.display ? { amount: -account.display.amount, currency: account.display.currency } : null} mode={mode} />
            </>
          )}
          {use.kind === 'overdrawn' && (
            <>
              <span className={styles.word}>{m.overdrawn}</span> <Amount amount={account.ownBalance} currency={account.currency} display={account.display} mode={mode} />
            </>
          )}
          {use.kind === 'none' && <Amount amount={account.ownBalance} currency={account.currency} display={account.display} mode={mode} />}
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

const PotTile: React.FC<{ account: FinanceAccount; mode: MoneyDisplay }> = ({ account, mode }) => {
  const { emoji, label } = potParts(account.name);
  return (
    <li className={styles.pot}>
      <span aria-hidden="true" className={styles.potPicture}>
        {emoji ?? Array.from(label)[0]?.toLocaleUpperCase()}
      </span>
      <span className={styles.potName}>{label}</span>
      <strong className={styles.potAmount}>
        <Amount amount={account.ownBalance} currency={account.currency} display={account.display} mode={mode} />
      </strong>
    </li>
  );
};

/** The opened bank: its header in the brand colours, the main accounts as cards, the pots as tiles, the empty ones folded. */
const BankDetail: React.FC<{ bank: Bank; mode: MoneyDisplay }> = ({ bank, mode }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const [showEmpty, setShowEmpty] = useState(false);
  const line = useLinkLine(bank);
  const split = splitBank(bank);
  const totals = shownTotals(bank.accounts, mode);
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
              <BankName provider={bank.provider} logo={bank.connection?.logo} />
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
              <ShownAmount shown={total} />
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
                <AccountCard key={account.id} account={account} distinguish={shared.has(account.name.trim().toLowerCase())} mode={mode} />
              ))}
            </ul>
          </section>
        )}
        {pots.length > 0 && (
          <section aria-label={m.pots}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{m.pots}</h4>
              <span className={styles.sectionNote}>
                {fill(m.potsTotal, { n: pots.length, amount: potsSum.map((total) => `${total.approx ? '≈ ' : ''}${formatMinor(total.pots, total.currency, lang)}`).join(' · ') })}
              </span>
            </div>
            <ul className={styles.potGrid}>
              {pots.map((account) => (
                <PotTile key={account.id} account={account} mode={mode} />
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
  mode: MoneyDisplay;
  onSelect: (provider: string) => void;
}

/** The wallet: every bank as a coloured card in a stack, and the selected bank opened beside it (below it on a phone). */
const MoneyWallet: React.FC<MoneyWalletProps> = ({ data, selected, mode, onSelect }) => {
  const { t } = useDashboardLang();
  const banks = groupBanks(data.accounts, data.connections);
  if (banks.length === 0) return <p className={styles.none}>{t.money.noAccounts}</p>;
  const current = banks.find((bank) => bank.provider === selected) ?? banks[0];
  return (
    <div className={styles.wallet}>
      <div role="group" aria-label={t.money.walletLabel} className={styles.stack}>
        {banks.map((bank, index) => (
          <BankCard key={bank.provider} bank={bank} first={index === 0} selected={bank.provider === current.provider} mode={mode} onSelect={() => onSelect(bank.provider)} />
        ))}
      </div>
      <BankDetail key={current.provider} bank={current} mode={mode} />
    </div>
  );
};

export default MoneyWallet;
