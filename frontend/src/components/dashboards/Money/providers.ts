import type { ProviderLogo } from '../../../services/dashboards/financeApi';

/** A bank's name for the page: the server's name for it when it sends one, else its id made readable. */
export function bankLabel(id: string, info?: Pick<ProviderLogo, 'name'> | null): string {
  return info?.name ?? providerName(id);
}

/** A provider's name as the page shows it: its id with the separators as spaces and a capital ("some-bank" is "Some bank"). */
export function providerName(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words === '' ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where a provider's consent starts, for the ones that have such a route (a reconnect link); the rest show the hint only. */
const CONNECT_PATH: Readonly<Record<string, string>> = { monzo: '/api/dashboards/v1/finance/monzo/connect' };

export function reconnectPath(provider: string): string | null {
  return Object.prototype.hasOwnProperty.call(CONNECT_PATH, provider) ? CONNECT_PATH[provider] : null;
}
