import { test, expect, open } from './fixtures';

/*
 * Text contrast measured from computed styles. axe leaves a node
 * "incomplete" instead of failing it when it cannot be sure of the
 * background (pseudo-elements, gradients, text shadows), and on this site
 * that is most of the page. This walks every visible text node instead:
 * it composites the background colours of the element's ancestors, applies
 * the opacity of the whole chain to the text colour and holds the result to
 * WCAG AA, 4.5:1, or 3:1 for large text (24px and up, or bold 18.66px and
 * up). Background images and gradients are not composited, so the page's
 * own colours stand in for them.
 */

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'privacy', path: '/privacy' },
  { name: '404', path: '/no-such-page' },
];

interface Failure {
  element: string;
  text: string;
  ratio: number;
  min: number;
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const { name, path } of PAGES) {
      test(`${name}: every visible text meets AA contrast`, async ({ page }) => {
        await open(page, path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const failures: Failure[] = await page.evaluate(() => {
          type Rgba = [number, number, number, number];
          const parse = (value: string): Rgba | null => {
            const m = value.match(/rgba?\(([^)]+)\)/);
            if (!m) return null;
            const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
            return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
          };
          const over = (top: Rgba, bottom: Rgba): Rgba => [
            top[0] * top[3] + bottom[0] * (1 - top[3]),
            top[1] * top[3] + bottom[1] * (1 - top[3]),
            top[2] * top[3] + bottom[2] * (1 - top[3]),
            1,
          ];
          const lin = (c: number) => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          const lum = (c: Rgba) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
          const ratio = (a: Rgba, b: Rgba) => {
            const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          };

          const root = parse(getComputedStyle(document.documentElement).backgroundColor);
          const body = parse(getComputedStyle(document.body).backgroundColor);
          const canvas: Rgba = body && body[3] >= 1 ? body : root && root[3] >= 1 ? root : [255, 255, 255, 1];
          const backgroundOf = (el: Element): Rgba => {
            const layers: Rgba[] = [];
            for (let a: Element | null = el; a; a = a.parentElement) {
              const c = parse(getComputedStyle(a).backgroundColor);
              if (c && c[3] > 0) {
                layers.push(c);
                if (c[3] >= 1) break;
              }
            }
            let result = canvas;
            for (let i = layers.length - 1; i >= 0; i -= 1) result = over(layers[i], result);
            return result;
          };

          const out: Failure[] = [];
          const seen = new Set<string>();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent?.trim() ?? '';
            // Letters or digits only: an emoji or an arrow drawn in its own colours has nothing to measure.
            if (!/[\p{L}\p{N}]/u.test(text)) continue;
            const el = node.parentElement;
            if (!el) continue;
            if (el.closest('[aria-hidden="true"], canvas, dialog:not([open]), .sr-only, :disabled')) continue;
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            if (style.visibility === 'hidden' || style.display === 'none' || box.width === 0 || box.height === 0) continue;
            // Gradient text (background-clip: text) is drawn by its background, not its colour.
            if (/,\s*0\)$/.test(style.webkitTextFillColor)) continue;
            let opacity = 1;
            for (let a: Element | null = el; a; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
            if (opacity < 0.05) continue;
            const fg = parse(style.color);
            if (!fg) continue;
            const bg = backgroundOf(el);
            const got = ratio(over([fg[0], fg[1], fg[2], fg[3] * opacity], bg), bg);
            const size = parseFloat(style.fontSize);
            const large = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66);
            const min = large ? 3 : 4.5;
            if (got >= min) continue;
            const element = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
            const key = `${element}|${style.color}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ element, text: text.slice(0, 40), ratio: Math.round(got * 100) / 100, min });
          }
          return out;
        });

        expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
      });
    }
  });
}
