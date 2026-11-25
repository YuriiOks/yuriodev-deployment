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
  const inline = (uri: string | null) => (uri !== null && uri.startsWith('data:') ? uri : null);
  const merged: Record<string, ProviderLogo> = {};
  for (const [id, logo] of Object.entries(logos)) {
    const variants = bundle?.logos[id];
    // Without the bundle (not here yet, or it failed) the page draws tiles: no picture is asked for one by one. An id the bundle lacks keeps its own address.
    merged[id] = variants ? { ...logo, onLight: variants.onLight ?? logo.onLight, onDark: variants.onDark ?? logo.onDark, mark: variants.mark ?? logo.mark } : bundle ? logo : { ...logo, onLight: inline(logo.onLight), onDark: inline(logo.onDark), mark: inline(logo.mark) };
  }
  return merged;
}

/** The logos of the providers answer, from the logo bundle when the answer names a version. */
export function useLogoBundle(logos: Record<string, ProviderLogo> | null, version: string | null): Record<string, ProviderLogo> | null {
  const bundle = useBundle(logoBundles, version);
  return useMemo(() => (logos ? (version ? mergeLogos(logos, bundle) : logos) : null), [logos, bundle, version]);
}

/** The payments with their icons from the icon bundle (an icon the bundle lacks keeps its own address). */
export function useIconBundle<T extends RecurringList | Upcoming>(list: T | null): T | null {
  const bundle: IconBundle | null = useBundle(iconBundles, list?.iconsVersion ?? null);
  return useMemo(() => {
    // The listing names a version: its icons come from the bundle. Until the bundle is here (or if it fails) a payment shows its tile; only an id the bundle lacks keeps its own address.
    if (!list || !list.iconsVersion) return list;
    const pick = (id: string, own: string | null) => (bundle ? (bundle.icons[id] ?? own) : own !== null && own.startsWith('data:') ? own : null);
    if ('recurring' in list) return { ...list, recurring: list.recurring.map((row) => ({ ...row, iconUrl: pick(row.id, row.iconUrl) })) } as T;
    return { ...list, items: list.items.map((item) => ({ ...item, iconUrl: pick(item.recurringId, item.iconUrl) })) } as T;
  }, [list, bundle]);
}

/** The logos and icons held (the stored copies, and a request for the versions an answer names, when it names them): what a view that loads no listing draws its pictures from. */
export function useStoredImages(logosVersion: string | null, iconsVersion: string | null): { logos: Record<string, ProviderLogo>; icons: Readonly<Record<string, string>> } {
  const logoBundle = useBundle(logoBundles, logosVersion);
  const iconBundle = useBundle(iconBundles, iconsVersion);
  // Whatever is held is drawn, whether or not a version was named (a version only decides what is fetched).
  const heldLogos = useSyncExternalStore(logoBundles.subscribe, logoBundles.get, logoBundles.get);
  const heldIcons = useSyncExternalStore(iconBundles.subscribe, iconBundles.get, iconBundles.get);
  const logos = useMemo(() => {
    const source = logoBundle ?? heldLogos;
    const out: Record<string, ProviderLogo> = {};
    for (const [id, variants] of Object.entries(source?.logos ?? {})) out[id] = { ...variants, name: null, colors: null, entry: null, reconnect: null, reconnectPath: null };
    return out;
  }, [logoBundle, heldLogos]);
  const icons = (iconBundle ?? heldIcons)?.icons ?? NO_ICONS;
  return { logos, icons };
}

const NO_ICONS: Readonly<Record<string, string>> = {};
