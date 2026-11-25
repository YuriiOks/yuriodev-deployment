import type { ProviderLogo } from '../../../services/dashboards/financeApi';

/** A bank's name for the page: the server's name for it when it sends one, else its id made readable. */
export function bankLabel(id: string, info?: Pick<ProviderLogo, 'name'> | null): string {
  // A name that is only the id repeated is no name: the id is made readable instead.
  return info?.name && info.name !== id ? info.name : providerName(id);
}

/** A provider's name as the page shows it: its id with the separators as spaces and a capital ("some-bank" is "Some bank"). */
export function providerName(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words === '' ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where a provider's consent starts (a reconnect link), from what the server says about it (`reconnect` oauth and its path); a bank with
 * no other way (a token to replace on the server) shows the hint only. Before the providers have arrived nothing is guessed.
 */
export function reconnectPath(info?: Pick<ProviderLogo, 'reconnect' | 'reconnectPath'> | null): string | null {
  return info?.reconnect === 'oauth' ? info.reconnectPath : null;
}
