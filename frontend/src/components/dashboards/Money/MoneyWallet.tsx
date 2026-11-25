import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, FinanceAccounts, ProviderLogo } from '../../../services/dashboards/financeApi';
import { APPROX, formatMinor } from '../../../services/dashboards/money';
import { shownTotals } from '../../../services/dashboards/display';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { creditUse, groupBanks, potParts, sharedNames, splitBank, type Bank } from '../../../services/dashboards/wallet';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import Amount, { ShownAmount } from './Amount';
import Last4 from './Last4';
import { brandStyle } from './brandStyle';
import BankName from './BankName';
import HeroAmount from './HeroAmount';
import { dayLabel, freshLabel } from './labels';
import { AddAccountForm, AddBankForm } from './ManualCreate';
import ManualTools from './ManualTools';
import { bankLabel, reconnectPath } from './providers';
import styles from './Money.module.css';

/** The link's state in words, with when it last worked (for a bank entered by hand: the date its balance is as of). */
function useLinkLine(bank: Bank): string {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  // A bank entered by hand has no link to describe: its data is as of a date.
  if (bank.connection?.manual) return bank.connection.lastOkAt ? fill(m.manual.balanceAsOf, { date: dayLabel(bank.connection.lastOkAt, lang) }) : m.linkNone;
  const status = bank.connection?.status;
  const label = status === 'ok' ? m.linkOk : status === 'needs_reconsent' ? m.linkNeedsReconsent : status === 'paused' ? m.linkPaused : m.linkNone;
  const when = bank.connection?.lastOkAt ? freshLabel(bank.connection.lastOkAt, lang) : '';
  return when ? `${label} · ${fill(m.lastOk, { when })}` : label;
}

/** The quiet facts of a bank's main account: its overdraft or credit limit, and its last four digits. */
function useBankFacts(bank: Bank): { limit: string; last4: string | null } {
  const { t, lang } = useDashboardLang();
  const main = splitBank(bank).accounts[0] ?? bank.accounts[0];
  if (!main) return { limit: '', last4: null };
  const m = t.money;
  const overdraft = main.overdraftLimit ?? 0;
  const limit = overdraft > 0 ? fill(m.overdraftLimit, { amount: formatMinor(overdraft, main.currency, lang) }) : main.creditLimit > 0 ? fill(m.creditLimit, { amount: formatMinor(main.creditLimit, main.currency, lang) }) : '';
  return { limit, last4: main.maskLast4 || null };
}

/**
 * One bank in the stack: a big solid card in the bank's colour, overlapping the one above. The wordmark is the only label at the left, the
 * balance the hero at the right. The selected card is the last of the stack and taller: a quiet line of facts, the link's state, and its
 * actions as pills. A card that needs attention carries a small warning mark.
 */
const BankCard: React.FC<{ bank: Bank; logo: ProviderLogo | undefined; selected: boolean; first: boolean; mode: MoneyDisplay; onSelect: () => void }> = ({ bank, logo, selected, first, mode, onSelect }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const line = useLinkLine(bank);
  const facts = useBankFacts(bank);
  const totals = shownTotals(bank.accounts, mode);
  const [lead, ...rest] = totals;
  const warn = bank.connection?.status === 'needs_reconsent';
  const reconnect = warn ? reconnectPath(logo) : null;
  const id = `money-bank-${bank.provider}`;
  return (
    <div className={cx(styles.bank, first && styles.bankFirst, selected && styles.bankSelected)} style={brandStyle(bank.provider, logo)}>
      <button type="button" className={styles.bankHead} aria-pressed={selected} onClick={onSelect}>
        <span className={styles.bankName}>
          <BankName provider={bank.provider} logo={logo} />
          {warn && (
            <span className={styles.warnMark} title={m.linkNeedsReconsent}>
              <DashIcon name="alert" size={14} />
              <span className="sr-only">{m.linkNeedsReconsent}</span>
            </span>
          )}
        </span>
        <span className={styles.bankSums}>
          {lead && (
            <>
              <HeroAmount amount={lead.amount} currency={lead.currency} approx={lead.approx} />
              {lead.approx && lead.originals.length > 0 && (
                <span className={styles.bankSub}>{lead.originals.map((original) => formatMinor(original.amount, original.currency, lang)).join(' \u00b7 ')}</span>
              )}
            </>
          )}
          {rest.map((total) => (
            <span key={total.currency} className={styles.bankSub}>
              <ShownAmount shown={total} />
            </span>
          ))}
        </span>
      </button>
      {selected && (
        <div className={styles.bankFoot}>
          <div className={styles.bankFacts}>
            <span>
              {facts.last4 && <Last4 mask={facts.last4} />}
              {facts.last4 && facts.limit ? ' \u00b7 ' : ''}
              {facts.limit}
            </span>
            <span>{line}</span>
          </div>
          <div className={styles.bankActions}>
            <a className={styles.pill} href={`#${id}-name`}>
              {m.actionAccounts}
            </a>
            <a className={styles.pill} href="#money-transactions-title">
              {m.actionTransactions}
            </a>
            {reconnect && (
              <a className={styles.pill} href={reconnect}>
                {m.reconnect}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const AccountCard: React.FC<{ account: FinanceAccount; distinguish: boolean; mode: MoneyDisplay; manual?: boolean; onChanged?: () => void }> = ({ account, distinguish, mode, manual = false, onChanged }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const use = creditUse(account);
  const notes = [
    account.label ?? '',
    account.maskLast4 ? <Last4 key="last4" mask={account.maskLast4} /> : '',
    distinguish && account.historyFrom ? fill(m.historyFrom, { date: dayLabel(account.historyFrom, lang) }) : '',
    account.creditLimit > 0 && use.kind === 'none' ? fill(m.creditLimit, { amount: formatMinor(account.creditLimit, account.currency, lang) }) : '',
  ].filter(Boolean);
  return (
    <li className={styles.account} data-kind={use.kind}>
      <div className={styles.accountRow}>
        <div className={styles.accountText}>
          <strong className={styles.accountName}>{account.name}</strong>
          {notes.length > 0 && (
            <span className={styles.accountNote}>
              {notes.map((note, index) => (
                <React.Fragment key={index}>
                  {index > 0 ? ' \u00b7 ' : ''}
                  {note}
                </React.Fragment>
              ))}
            </span>
          )}
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
      {use.kind === 'debt' && use.limit === 0 && <span className={styles.accountNote}>{m.limitUnknown}</span>}
      {((use.kind === 'debt' && use.limit > 0) || (use.kind === 'overdrawn' && use.limit > 0)) && (
        <>
          <div aria-hidden="true" className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${use.percent}%` }} />
          </div>
          <span className={styles.accountNote} data-over={use.over > 0 ? 'true' : undefined}>
            {account.overdraftSource === 'owner' && use.kind === 'overdrawn' && `${m.ownLimit} · `}
            {use.over > 0 ? (
              <>
                <DashIcon name="alert" size={14} /> {fill(m.overLimit, { limit: formatMinor(use.limit, account.currency, lang), over: formatMinor(use.over, account.currency, lang) })}
              </>
            ) : (
              fill(use.kind === 'debt' ? m.usedOfLimit : m.usedOfOverdraft, {
                percent: use.percent,
                limit: formatMinor(use.limit, account.currency, lang),
                free: formatMinor(use.free, account.currency, lang),
              })
            )}
          </span>
        </>
      )}
      {manual && onChanged && <ManualTools account={account} onChanged={onChanged} />}
    </li>
  );
};

const PotTile: React.FC<{ account: FinanceAccount; mode: MoneyDisplay }> = ({ account, mode }) => {
  const { t, lang } = useDashboardLang();
  const { emoji, label } = potParts(account.name);
  const goal = account.goalAmount !== null && account.goalAmount > 0 ? account.goalAmount : null;
  // Floored, so a pot a little short of its goal never reads 100%; money in a pot shows at least 1%; the goal reached says so in words.
  const reached = goal !== null && account.ownBalance >= goal;
  const percent = goal ? (reached ? 100 : Math.max(account.ownBalance > 0 ? 1 : 0, Math.min(99, Math.floor((account.ownBalance / goal) * 100)))) : 0;
  return (
    <li className={styles.pot}>
      <span aria-hidden="true" className={styles.potPicture}>
        {emoji ?? Array.from(label)[0]?.toLocaleUpperCase()}
      </span>
      <span className={styles.potName} title={label}>
        {label}
      </span>
      <strong className={styles.potAmount}>
        <Amount amount={account.ownBalance} currency={account.currency} display={account.display} mode={mode} />
      </strong>
      {goal && (
        <>
          <div aria-hidden="true" className={styles.goalBar}>
            <div className={styles.goalFill} style={{ width: `${percent}%` }} />
          </div>
          <span className={styles.accountNote}>{fill(reached ? t.money.goalReached : t.money.goalOf, { percent, goal: formatMinor(goal, account.currency, lang) })}</span>
        </>
      )}
    </li>
  );
};

/** The opened bank: its header in the brand colours, the main accounts as cards, the pots as tiles, the empty ones folded. */
const BankDetail: React.FC<{ bank: Bank; logo: ProviderLogo | undefined; mode: MoneyDisplay; onChanged: () => void }> = ({ bank, logo, mode, onChanged }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const [showEmpty, setShowEmpty] = useState(false);
  const [showBusiness, setShowBusiness] = useState(false);
  const line = useLinkLine(bank);
  const split = splitBank(bank);
  const totals = shownTotals(bank.accounts, mode);
  const shared = sharedNames(bank.accounts);
  const emptyCount = split.emptyAccounts.length + split.emptyPots.length;
  const accounts = showEmpty ? [...split.accounts, ...split.emptyAccounts] : split.accounts;
  const pots = showEmpty ? [...split.pots, ...split.emptyPots] : split.pots;
  const potsSum = pots.length > 0 ? totals.filter((total) => total.pots !== 0) : [];
  const reconnect = bank.connection?.status === 'needs_reconsent' ? reconnectPath(logo) : null;
  const manual = bank.connection?.manual === true;
  const connectionId = bank.connection?.id ?? null;
  const [addingAccount, setAddingAccount] = useState(false);
  const id = `money-bank-${bank.provider}`;

  return (
    <article aria-labelledby={`${id}-name`} className={styles.detail} style={brandStyle(bank.provider, logo)}>
      <header className={styles.detailHead} style={brandStyle(bank.provider, logo)}>
        <div className={styles.detailTitle}>
          <div className={styles.detailTitleText}>
            <h3 id={`${id}-name`} className={styles.detailName}>
              <BankName provider={bank.provider} logo={logo} />
            </h3>
            <span className={styles.detailState}>
              {bank.connection?.status === 'needs_reconsent' && <DashIcon name="alert" size={14} />}
              {line}
            </span>
          </div>
        </div>
        <div className={styles.detailSums}>
          <span className={styles.detailState}>{m.ownMoney}</span>
          {totals.map((total) => (
            <strong key={total.currency} className={styles.detailSum}>
              <ShownAmount shown={total} />
            </strong>
          ))}
        </div>
      </header>
      <div className={styles.detailBody}>
        {manual && connectionId && (
          <div className={styles.addAccount}>
            <button type="button" className={styles.addButton} aria-expanded={addingAccount} onClick={() => setAddingAccount((open) => !open)}>
              {m.manual.addAccount}
            </button>
            {addingAccount && (
              <AddAccountForm
                connectionId={connectionId}
                onDone={(saved) => {
                  setAddingAccount(false);
                  if (saved) onChanged();
                }}
              />
            )}
          </div>
        )}
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
                <AccountCard key={account.id} account={account} distinguish={shared.has(account.name.trim().toLowerCase())} mode={mode} manual={manual} onChanged={onChanged} />
              ))}
            </ul>
          </section>
        )}
        {pots.length > 0 && (
          <section aria-label={m.pots}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{m.pots}</h4>
              <span className={styles.sectionNote}>
                {fill(m.potsTotal, { n: pots.length, amount: potsSum.map((total) => `${total.approx ? APPROX : ''}${formatMinor(total.pots, total.currency, lang)}`).join(' · ') })}
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
        {split.business.length > 0 && (
          <section aria-label={m.businessFold.replace(': {n}', '')}>
            <button type="button" className={styles.fold} aria-expanded={showBusiness} onClick={() => setShowBusiness((open) => !open)}>
              {showBusiness ? m.hideBusiness : fill(m.businessFold, { n: split.business.length })}
            </button>
            {showBusiness && (
              <ul className={styles.accountList}>
                {split.business.map((account) => (
                  <AccountCard key={account.id} account={account} distinguish={shared.has(account.name.trim().toLowerCase())} mode={mode} manual={manual} onChanged={onChanged} />
                ))}
              </ul>
            )}
          </section>
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
  /** The banks' wordmarks by provider id (empty until the server sends them: the text names show). */
  logos: Readonly<Record<string, ProviderLogo>>;
  onSelect: (provider: string) => void;
  /** The balance of a bank entered by hand was set, or a statement imported: the page asks for the accounts again. */
  onChanged: () => void;
}

/** The wallet: every bank as a coloured card in a stack, and the selected bank opened beside it (below it on a phone). */
const MoneyWallet: React.FC<MoneyWalletProps> = ({ data, selected, mode, logos, onSelect, onChanged }) => {
  const { t } = useDashboardLang();
  const [adding, setAdding] = useState(false);
  const banks = groupBanks(data.accounts, data.connections);
  // The banks the server lists as ones to enter by hand and that are not in the wallet yet, then "another bank".
  const taken = new Set([...banks.map((bank) => bank.provider), ...Object.keys(logos)]);
  const candidates = Object.entries(logos)
    .filter(([provider, info]) => info.entry === 'manual' && !banks.some((bank) => bank.provider === provider))
    .map(([provider, info]) => ({ id: provider, name: bankLabel(provider, info) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tools = (
    <div className={styles.walletTools}>
      <button type="button" className={styles.addButton} aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
        {t.money.manual.addBank}
      </button>
      {adding && (
        <AddBankForm
          candidates={candidates}
          taken={taken}
          onDone={(provider) => {
            setAdding(false);
            if (provider) {
              onSelect(provider);
              onChanged();
            }
          }}
        />
      )}
    </div>
  );
  if (banks.length === 0) {
    return (
      <>
        {tools}
        <p className={styles.none}>{t.money.noAccounts}</p>
      </>
    );
  }
  const current = banks.find((bank) => bank.provider === selected) ?? banks[0];
  // The open bank sits at the bottom of the stack, fully shown; the others keep their order above it.
  const stacked = [...banks.filter((bank) => bank !== current), current];
  return (
    <>
      {tools}
      <div className={styles.wallet}>
        <div role="group" aria-label={t.money.walletLabel} className={styles.stack}>
          {stacked.map((bank, index) => (
            <BankCard key={bank.provider} bank={bank} logo={logos[bank.provider]} first={index === 0} selected={bank.provider === current.provider} mode={mode} onSelect={() => onSelect(bank.provider)} />
          ))}
        </div>
        <BankDetail key={current.provider} bank={current} logo={logos[current.provider]} mode={mode} onChanged={onChanged} />
      </div>
    </>
  );
};

export default MoneyWallet;
