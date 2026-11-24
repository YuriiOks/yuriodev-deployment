/** The views of the Money page: Today (the default), Wallet, Payments, Spending and Transactions are the tabs; `attention` and `recurring` are reached from Today's queue and from Payments; `all` shows every section on one page. */
export const MONEY_VIEWS = ['today', 'wallet', 'payments', 'spending', 'transactions', 'attention', 'recurring', 'all'] as const;
export type MoneyView = (typeof MONEY_VIEWS)[number];
