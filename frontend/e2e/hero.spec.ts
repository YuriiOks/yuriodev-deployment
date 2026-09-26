import { test, expect, open } from './fixtures';

/*
 * The hero at every reference size: the profile card's code lines never
 * wrap, the two files sit side by side only where both fit (and from
 * 1440px up they do), a phone scrolls the card rather than the page, and
 * the typewriter keeps one box while it types.
 */

test.describe('hero profile card', () => {
  test('code lines never wrap; the files sit side by side only where they fit; only the card scrolls', async ({ page }) => {
    await open(page, '/');
    const card = page.getByRole('region', { name: 'Profile information' });
    await expect(card).toBeVisible();

    const geometry = await card.evaluate((el) => {
      const lines = [...el.querySelectorAll('div')].filter((div) => !div.querySelector('div') && div.textContent?.trim());
      const wrapped = lines
        .filter((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          const tops = new Set([...range.getClientRects()].filter((box) => box.width > 0).map((box) => Math.round(box.top)));
          return tops.size > 1;
        })
        .map((line) => line.textContent!.trim().slice(0, 40));
      const columns = [...el.firstElementChild!.children].map((column) => column.getBoundingClientRect());
      return {
        lines: lines.length,
        wrapped,
        sideBySide: columns.length === 2 && Math.abs(columns[0].top - columns[1].top) < 2,
        columnsInside: columns.every((column) => column.right <= el.getBoundingClientRect().right + 0.5),
        cardScrolls: el.scrollWidth > el.clientWidth + 1,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    expect(geometry.lines).toBeGreaterThan(20);
    expect(geometry.wrapped, 'lines broken inside the card').toEqual([]);
    expect(geometry.pageOverflow, 'the page never scrolls sideways').toBeLessThanOrEqual(0);
    const width = page.viewportSize()!.width;
    if (width >= 1440) expect(geometry.sideBySide, 'two columns from 1440px up').toBe(true);
    if (geometry.sideBySide) {
      expect(geometry.cardScrolls, 'side by side only where both fit').toBe(false);
      expect(geometry.columnsInside).toBe(true);
    }
    if (geometry.cardScrolls) expect(geometry.sideBySide, 'a card that scrolls has its files stacked').toBe(false);
  });

  test('the card can be scrolled from the keyboard where it overflows', async ({ page }) => {
    await open(page, '/');
    const card = page.getByRole('region', { name: 'Profile information' });
    await expect(card).toHaveAttribute('tabindex', '0');
    const scrolls = await card.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    test.skip(!scrolls, 'the card only scrolls on a narrow screen');
    await card.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => card.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });
});

test.describe('hero actions', () => {
  test('one filled primary action first, then two outlined ones, all the same height', async ({ page }) => {
    await open(page, '/');
    const actions = page.locator('#hero a');
    await expect(actions).toHaveText(['Collaborate with Me', 'Explore YuriODev Vision', 'View Research & Projects']);
    const styles = await actions.evaluateAll((links) =>
      links.map((link) => {
        const style = getComputedStyle(link);
        return { height: Math.round(link.getBoundingClientRect().height), background: style.backgroundColor };
      }),
    );
    expect(new Set(styles.map((s) => s.height)).size, 'equal heights').toBe(1);
    // The primary is filled (opaque); the outlined ones sit on a faint tint.
    const alpha = (colour: string) => {
      const parts = colour.match(/rgba?\(([^)]+)\)/)![1].split(',').map((part) => Number(part.trim()));
      return parts.length === 4 ? parts[3] : 1;
    };
    expect(alpha(styles[0].background)).toBe(1);
    expect(alpha(styles[1].background)).toBeLessThan(0.5);
    expect(alpha(styles[2].background)).toBeLessThan(0.5);
  });
});

test.describe('hero typewriter', () => {
  test.describe('while it types', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('keeps one centred box and one left edge', async ({ page }) => {
      // Motion on would also bring the once-per-session loading screen.
      await page.addInitScript(() => sessionStorage.setItem('appLoaded', 'true'));
      await open(page, '/');
      const box = page.locator('#typewriter');
      await expect(box).toHaveAttribute('aria-hidden', 'true');
      const samples: Array<{ left: number; width: number; textLeft: number | null; text: string }> = [];
      for (let i = 0; i < 8; i++) {
        samples.push(
          await box.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(el);
            const first = [...range.getClientRects()].find((r) => r.width > 0);
            return { left: rect.left, width: rect.width, textLeft: first ? first.left : null, text: el.textContent ?? '' };
          }),
        );
        await page.waitForTimeout(250);
      }
      expect(new Set(samples.map((s) => s.text)).size, 'it is typing').toBeGreaterThan(1);
      expect(new Set(samples.map((s) => `${Math.round(s.left)}/${Math.round(s.width)}`)).size, 'one box').toBe(1);
      const edges = new Set(samples.filter((s) => s.textLeft !== null).map((s) => Math.round(s.textLeft!)));
      expect(edges.size, 'the text starts at one edge').toBe(1);
      const { left, width } = samples[0];
      const hero = await page.locator('#hero').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
      });
      expect(Math.abs(left + width / 2 - (hero.left + hero.right) / 2), 'centred').toBeLessThanOrEqual(1);
    });
  });

  test('shows the whole first line at once under reduced motion', async ({ page }) => {
    await open(page, '/');
    await expect(page.locator('#typewriter')).toHaveText('Architecting agentic AI systems (LangGraph, MCP)...');
  });
});
