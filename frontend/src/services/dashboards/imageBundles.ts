import { readStorage, removeStorage, writeStorage } from '../../utils/safeStorage';
import { isObject, logoDataUri } from './financeApi';
import { request } from './liveApi';
import { iconUrl } from './recurringApi';

/*
 * Pictures come in two bundles, one request each, never one per picture: every bank logo variant (GET /finance/providers/logos) and every payment
 * icon (GET /finance/recurring/icons), each as data URIs under a version. The listings (providers, recurring, upcoming) carry the version they
 * expect; a bundle is fetched only when it differs from the copy held (in memory and in localStorage under its version), so a reload draws every
 * picture from the stored copy and makes no picture request at all. When the fields are absent (an older server) nothing here runs.
 */

const VERSION = /^[0-9a-f]{16}$/;
/** A bundle bigger than this is kept in memory only (localStorage is about 5 MB for the whole site). */
const MAX_STORED_CHARS = 2_000_000;

/** A version as the server writes it (16 hex), or null. */
export const bundleVersion = (value: unknown): string | null => (typeof value === 'string' && VERSION.test(value) ? value : null);

export interface LogoVariants {
  readonly onLight: string | null;
  readonly onDark: string | null;
  readonly mark: string | null;
}

export interface LogoBundle {
  readonly version: string;
  readonly logos: Readonly<Record<string, LogoVariants>>;
}

export interface IconBundle {
  readonly version: string;
  readonly icons: Readonly<Record<string, string>>;
}

/** `{"version", "logos": {"<provider>": {"on_light", "on_dark", "mark"}}}`: every variant must be a png or svg data URI, else it is left out. */
export function parseLogoBundle(body: unknown): LogoBundle | null {
  if (!isObject(body)) return null;
  const version = bundleVersion(body.version);
  if (!version || !isObject(body.logos)) return null;
  const logos: Record<string, LogoVariants> = {};
  for (const [id, raw] of Object.entries(body.logos)) {
    if (!isObject(raw)) continue;
    const entry = { onLight: logoDataUri(raw.on_light), onDark: logoDataUri(raw.on_dark), mark: logoDataUri(raw.mark) };
    if (entry.onLight || entry.onDark || entry.mark) logos[id] = entry;
  }
  return { version, logos };
}

/** `{"version", "icons": {"<payment id>": "<data URI>"}}`. */
export function parseIconBundle(body: unknown): IconBundle | null {
  if (!isObject(body)) return null;
  const version = bundleVersion(body.version);
  if (!version || !isObject(body.icons)) return null;
  const icons: Record<string, string> = {};
  for (const [id, raw] of Object.entries(body.icons)) {
    const uri = iconUrl(raw);
    if (uri && uri.startsWith('data:')) icons[id] = uri;
  }
  return { version, icons };
}

export interface BundleStore<T extends { readonly version: string }> {
  /** What is held now (the stored copy until a newer one arrives), or null. */
  get: () => T | null;
  subscribe: (listener: () => void) => () => void;
  /** The listing says this version is the current one: fetch the bundle when it is not the one held. A missing version does nothing. */
  ensure: (version: string | null) => void;
  /** Forgets what is held in memory (tests; the stored copy stays until replaced). */
  reset: () => void;
}

export function createBundleStore<T extends { readonly version: string }>(storageKey: string, parse: (body: unknown) => T | null, address: string): BundleStore<T> {
  let current: T | null = null;
  let loaded = false;
  let inflight: string | null = null;
  const listeners = new Set<() => void>();

  const get = (): T | null => {
    if (!loaded) {
      loaded = true;
      const stored = readStorage('local', storageKey);
      if (stored) {
        try {
          current = parse(JSON.parse(stored));
        } catch {
          current = null;
        }
      }
    }
    return current;
  };

  return {
    get,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensure: (version) => {
      if (!version || get()?.version === version || inflight === version) return;
      inflight = version;
      request(address).then(
        (body) => {
          inflight = null;
          const bundle = parse(body);
          if (!bundle) return;
          current = bundle;
          // What is stored is the answer as the server wrote it, so the same parser reads it back.
          const text = JSON.stringify(body);
          if (text.length <= MAX_STORED_CHARS) writeStorage('local', storageKey, text);
          else removeStorage('local', storageKey);
          for (const listener of listeners) listener();
        },
        () => {
          inflight = null;
        },
      );
    },
    reset: () => {
      current = null;
      loaded = false;
      inflight = null;
    },
  };
}

export const logoBundles = createBundleStore<LogoBundle>('dashboards-finance-logos-bundle', parseLogoBundle, '/finance/providers/logos');
export const iconBundles = createBundleStore<IconBundle>('dashboards-finance-icons-bundle', parseIconBundle, '/finance/recurring/icons');
