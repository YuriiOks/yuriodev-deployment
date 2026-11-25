import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iconBundles, logoBundles, parseIconBundle, parseLogoBundle } from './imageBundles';
import { resetStorageFallback } from '../../utils/safeStorage';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
const V1 = 'e6140d0d0a1b2c3d';
const V2 = '0123456789abcdef';

const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  resetStorageFallback();
  logoBundles.reset();
  iconBundles.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bundle answers', () => {
  it('reads the exact shapes: a version of 16 hex, and only png or svg data URIs', () => {
    expect(parseLogoBundle({ version: V1, logos: { aqua: { on_light: SVG, on_dark: SVG, mark: PNG }, odd: { on_light: 'https://example.com/x.png', on_dark: null, mark: null }, none: {} } })).toEqual({ version: V1, logos: { aqua: { onLight: SVG, onDark: SVG, mark: PNG } } });
    expect(parseLogoBundle({ version: 'short', logos: {} })).toBeNull();
    expect(parseLogoBundle({ version: V1 })).toBeNull();
    expect(parseIconBundle({ version: V1, icons: { 'r-1': PNG, 'r-2': 'https://example.com/x.png', 'r-3': 'data:text/html;base64,PGI+' } })).toEqual({ version: V1, icons: { 'r-1': PNG } });
    expect(parseIconBundle(null)).toBeNull();
  });
});

describe('the bundle store', () => {
  it('does nothing without a version (an older server), fetches once for a version it does not hold, and draws from the stored copy after a reload without a request', async () => {
    const fetchMock = vi.fn(async () => answer({ version: V1, icons: { 'r-1': PNG } }));
    vi.stubGlobal('fetch', fetchMock);
    iconBundles.ensure(null);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    iconBundles.ensure(V1);
    iconBundles.ensure(V1);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/finance/recurring/icons');
    expect(iconBundles.get()?.icons['r-1']).toBe(PNG);
    // A reload: nothing in memory, the stored copy is there, and the same version asks for nothing.
    iconBundles.reset();
    expect(iconBundles.get()?.version).toBe(V1);
    iconBundles.ensure(V1);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches again when the version changes, replaces the stored copy and tells its listeners', async () => {
    const fetchMock = vi.fn(async () => answer({ version: V2, logos: { aqua: { on_light: PNG, on_dark: null, mark: null } } }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('dashboards-finance-logos-bundle', JSON.stringify({ version: V1, logos: { aqua: { onLight: SVG, onDark: null, mark: null } } }));
    const listener = vi.fn();
    logoBundles.subscribe(listener);
    // The stored copy is what is drawn until the new one arrives.
    expect(logoBundles.get()?.logos.aqua.onLight).toBe(SVG);
    logoBundles.ensure(V2);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    expect(logoBundles.get()?.version).toBe(V2);
    expect(JSON.parse(localStorage.getItem('dashboards-finance-logos-bundle') ?? '{}').version).toBe(V2);
  });

  it('keeps a bundle too big to store in memory only, and survives a failed request', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(60_000);
    const icons = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`r-${index}`, big]));
    vi.stubGlobal('fetch', vi.fn(async () => answer({ version: V1, icons })));
    iconBundles.ensure(V1);
    await flush();
    expect(Object.keys(iconBundles.get()?.icons ?? {})).toHaveLength(40);
    expect(localStorage.getItem('dashboards-finance-icons-bundle')).toBeNull();
    iconBundles.reset();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    iconBundles.ensure(V2);
    await flush();
    expect(iconBundles.get()).toBeNull();
  });
});
