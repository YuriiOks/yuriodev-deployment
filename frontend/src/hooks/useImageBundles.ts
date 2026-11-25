import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ProviderLogo } from '../services/dashboards/financeApi';
import { iconBundles, logoBundles, type BundleStore, type IconBundle, type LogoBundle } from '../services/dashboards/imageBundles';
import type { RecurringList, Upcoming } from '../services/dashboards/recurringApi';

/** The bundle held (the stored copy first), and a request for the one the listing expects when it differs. */
function useBundle<T extends { readonly version: string }>(store: BundleStore<T>, version: string | null): T | null {
  const held = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => store.ensure(version), [store, version]);
  return version ? held : null;
}

/** The logos of the providers answer with every variant the bundle holds drawn from its data URIs; a variant it lacks keeps the listing's own address. */
export function mergeLogos(logos: Record<string, ProviderLogo>, bundle: LogoBundle | null): Record<string, ProviderLogo> {
  if (!bundle) return logos;
  const merged: Record<string, ProviderLogo> = {};
  for (const [id, logo] of Object.entries(logos)) {
    const variants = bundle.logos[id];
    merged[id] = variants ? { ...logo, onLight: variants.onLight ?? logo.onLight, onDark: variants.onDark ?? logo.onDark, mark: variants.mark ?? logo.mark } : logo;
  }
  return merged;
}

/** The logos of the providers answer, from the logo bundle when the answer names a version. */
export function useLogoBundle(logos: Record<string, ProviderLogo> | null, version: string | null): Record<string, ProviderLogo> | null {
  const bundle = useBundle(logoBundles, version);
  return useMemo(() => (logos ? mergeLogos(logos, bundle) : null), [logos, bundle]);
}

/** The payments with their icons from the icon bundle (an icon the bundle lacks keeps its own address). */
export function useIconBundle<T extends RecurringList | Upcoming>(list: T | null): T | null {
  const bundle: IconBundle | null = useBundle(iconBundles, list?.iconsVersion ?? null);
  return useMemo(() => {
    if (!list || !bundle) return list;
    if ('recurring' in list) return { ...list, recurring: list.recurring.map((row) => ({ ...row, iconUrl: bundle.icons[row.id] ?? row.iconUrl })) } as T;
    return { ...list, items: list.items.map((item) => ({ ...item, iconUrl: bundle.icons[item.recurringId] ?? item.iconUrl })) } as T;
  }, [list, bundle]);
}
