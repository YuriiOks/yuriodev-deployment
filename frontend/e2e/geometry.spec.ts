import type { Page } from '@playwright/test';
import { test, expect, open, settle, navSurfaces, railWidth, scrollToSection, SECTION_IDS } from './fixtures';

/*
 * Layout checks that jsdom cannot make: where things actually land on screen
 * at each of the reference sizes (one Playwright project per size).
 */

const ROUTES = ['/', '/courses', '/dashboard', '/community', '/privacy', '/no-such-page'];

/** Where the section's heading sits relative to the fixed header, after a jump. */
async function headingPlacement(page: Page, id: string) {
  return page.evaluate((sectionId) => {
    const section = document.getElementById(sectionId);
    const heading = section?.querySelector('h1, h2') ?? section;
    const header = document.querySelector('header');
    if (!heading || !header) return null;
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      headingTop: heading.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    };
  }, id);
}

async function expectHeadingClear(page: Page, id: string) {
  const placement = await headingPlacement(page, id);
  expect(placement, `#${id} and its heading exist`).not.toBeNull();
  const { headerBottom, headingTop, viewportHeight } = placement!;
  expect(headingTop, `#${id}: heading below the fixed header`).toBeGreaterThanOrEqual(headerBottom - 1);
  expect(headingTop, `#${id}: heading on screen after the jump`).toBeLessThan(viewportHeight);
}

test.describe('section jumps', () => {
  test('the header never covers a section heading after a jump from the navigation', async ({ page }) => {
    await open(page, '/');
    const wide = await railWidth(page);
    for (const id of SECTION_IDS) {
      if (wide) {
        // From the keyboard: the rail may be faded out over the hero, and
        // focusing one of its links brings it back.
        const link = page.locator(`#sectionRail a[href="#${id}"]`);
        await link.focus();
        await expect(page.locator('#sectionRail')).toHaveCSS('opacity', '1');
        await page.keyboard.press('Enter');
      } else {
        await page.locator('header [data-opens="menu"]').click();
        await page.locator(`#navMenu a[href="#${id}"]`).click();
        await expect(page.locator('header [data-opens="menu"]')).toHaveAttribute('aria-expanded', 'false');
      }
      await settle(page);
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expectHeadingClear(page, id);
    }
  });

  test('the header never covers a section heading when the page opens at it', async ({ page }) => {
    for (const id of SECTION_IDS) {
      // A new document each time: going from /#a to /#b would only change the hash.
      await page.goto('about:blank');
      await open(page, `/#${id}`);
      await expectHeadingClear(page, id);
    }
  });

  test('the header never covers a section heading when only the hash changes', async ({ page }) => {
    await open(page, '/');
    for (const id of SECTION_IDS) {
      await page.goto(`/#${id}`);
      await settle(page);
      await expectHeadingClear(page, id);
    }
  });
});

// Production starts here: the backend has no posts route yet, or the feed is switched off.
for (const posts of ['disabled', 'missing'] as const) {
  test.describe(`posts feed ${posts}`, () => {
    test.use({ posts });

    test('the home page has no posts section and the navigation no Posts entry', async ({ page }) => {
      await open(page, '/', { posts: false });
      await expect(page.locator('section#posts')).toHaveCount(0);

      const wide = await railWidth(page);
      if (wide) await scrollToSection(page, 'about');
      const nav = wide ? page.locator('#sectionRail') : page.locator('#navMenu');
      if (!wide) await page.locator('header [data-opens="menu"]').click();
      await expect(nav.locator('a[href="#connect"]')).toBeVisible();
      await expect(nav.locator('a[href="#posts"]')).toHaveCount(0);
    });

    test('the header never covers a section heading when the page opens at it', async ({ page }) => {
      for (const id of SECTION_IDS.filter((section) => section !== 'posts')) {
        await page.goto('about:blank');
        await open(page, `/#${id}`, { posts: false });
        await expectHeadingClear(page, id);
      }
    });
  });
}

test.describe('navigation surfaces', () => {
  for (const path of ['/', '/privacy']) {
    test(`exactly one section-navigation surface is visible on ${path} once scrolled`, async ({ page }) => {
      await open(page, path);
      if (path === '/') await scrollToSection(page, 'about');
      else await page.evaluate(() => window.scrollTo(0, 200));
      await settle(page);
      await page.waitForTimeout(150);
      const { sidebar, menuButton } = await navSurfaces(page);
      expect(Number(sidebar) + Number(menuButton), 'section rail or menu button, never both, never neither').toBe(1);
      expect(sidebar, 'the rail exactly from 88rem up').toBe(await railWidth(page));

      if (sidebar) {
        // The header lists no sections of its own while the rail does.
        await expect(page.locator('header a[href*="#"]')).toHaveCount(0);
      } else {
        await page.locator('header [data-opens="menu"]').click();
        await expect(page.locator('#navMenu a[href*="#hero"]')).toBeVisible();
        expect((await navSurfaces(page)).sidebar, 'no rail behind the open menu').toBe(false);
      }
    });
  }

  test('the section rail stays away while the hero fills the screen, and comes back for the keyboard', async ({ page }) => {
    await open(page, '/');
    test.skip(!(await railWidth(page)), 'the rail exists from 88rem up');
    const rail = page.locator('#sectionRail');

    await expect(rail).toHaveAttribute('data-state', 'away');
    await expect(rail).toHaveCSS('opacity', '0');
    expect((await navSurfaces(page)).sidebar).toBe(false);

    // A focused rail link shows the rail at once, over the hero too.
    await rail.locator('a[href="#about"]').focus();
    await expect(rail).toHaveCSS('opacity', '1');
    await page.locator('body').focus();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(rail).toHaveCSS('opacity', '0');

    await scrollToSection(page, 'about');
    await expect(rail).toHaveAttribute('data-state', 'shown');
    await expect(rail).toHaveCSS('opacity', '1');
    await expect(rail.locator('a[aria-current="location"]')).toHaveAttribute('href', '#about');

    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await expect(rail).toHaveAttribute('data-state', 'away');
  });

  test('the rail never flashes visible over the hero on load', async ({ page }) => {
    // A repeat visit (sessionStorage already set, as a same-session reload
    // would leave it) or reduced motion (the project default) both skip the
    // loading screen, so the hero is on screen from the very first commit.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.addInitScript(() => {
      sessionStorage.setItem('appLoaded', 'true');
      const w = window as unknown as { __railOpacities: string[] };
      w.__railOpacities = [];
      const sample = () => {
        const rail = document.getElementById('sectionRail');
        if (rail) w.__railOpacities.push(getComputedStyle(rail).opacity);
        if (w.__railOpacities.length < 30) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await open(page, '/');
    const opacities = await page.evaluate(() => (window as unknown as { __railOpacities: string[] }).__railOpacities);
    expect(opacities.length, 'sampled some frames before settling').toBeGreaterThan(0);
    expect(new Set(opacities), 'never shown while the hero fills the screen').toEqual(new Set(['0']));
  });
});

test.describe('section rail clearance', () => {
  // One project resizes its page through the widths that matter; the
  // clearance depends on the width only (and the root font size, which
  // follows it).
  test('never overlaps the content, the header or the edge of the window', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920x1080', 'runs once, in the 1920x1080 project');
    for (const width of [1408, 1600, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, '/');
      await scrollToSection(page, 'skills');
      const rail = page.locator('#sectionRail');
      await expect(rail, `${width}px: rail shown`).toHaveAttribute('data-state', 'shown');
      // Its widest state: labels showing (below 100rem they need a hover).
      await rail.hover();
      await expect(rail.locator('a').first().locator('span').last()).toHaveCSS('opacity', '1');

      const geometry = await page.evaluate(() => {
        const railBox = document.getElementById('sectionRail')!.getBoundingClientRect();
        const links = [...document.querySelectorAll('#sectionRail a')].map((a) => a.getBoundingClientRect());
        const right = Math.max(railBox.right, ...links.map((box) => box.right));
        // The leftmost text or control of the page's content, over its whole length.
        let contentLeft = Infinity;
        let what = '';
        for (const root of [document.querySelector('main'), document.querySelector('footer')]) {
          if (!root) continue;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue;
            const parent = node.parentElement;
            if (!parent || parent.closest('.sr-only, [hidden]')) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const box of range.getClientRects()) {
              if (box.width > 0 && box.left < contentLeft) {
                contentLeft = box.left;
                what = `"${node.textContent.trim().slice(0, 30)}"`;
              }
            }
          }
          for (const el of root.querySelectorAll('a, button, input, textarea, img, svg')) {
            const box = el.getBoundingClientRect();
            if (box.width > 0 && box.height > 0 && box.left < contentLeft) {
              contentLeft = box.left;
              what = el.tagName.toLowerCase();
            }
          }
        }
        const header = document.querySelector('header')!.getBoundingClientRect();
        return {
          left: railBox.left,
          right,
          top: railBox.top,
          bottom: railBox.bottom,
          contentLeft,
          what,
          headerBottom: header.bottom,
          innerHeight: window.innerHeight,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      expect(geometry.left, `${width}px: rail inside the window`).toBeGreaterThanOrEqual(16);
      expect(geometry.right + 16, `${width}px: rail clear of the content (${geometry.what})`).toBeLessThanOrEqual(geometry.contentLeft);
      expect(geometry.top, `${width}px: rail below the header`).toBeGreaterThanOrEqual(geometry.headerBottom);
      expect(geometry.bottom, `${width}px: rail above the bottom`).toBeLessThanOrEqual(geometry.innerHeight);
      expect(geometry.overflow, `${width}px: no horizontal overflow`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('header', () => {
  test('the prompt is never cut short from 1024px up', async ({ page }) => {
    await open(page, '/');
    const prompt = await page.evaluate(() => {
      const el = document.querySelector('header nav > div')!;
      const full = el.querySelector('span')!;
      return {
        width: window.innerWidth,
        clipped: el.scrollWidth > el.clientWidth + 1,
        fullShown: getComputedStyle(full).display !== 'none',
        text: el.textContent,
      };
    });
    test.skip(prompt.width < 1024, 'narrower screens may shorten it');
    expect(prompt.fullShown).toBe(true);
    expect(prompt.clipped, `prompt "${prompt.text}" fits`).toBe(false);
  });

  test('the More menu opens, closes on Escape and outside clicks, and never stays open with a dialog', async ({ page }) => {
    await open(page, '/');
    test.skip(!(await railWidth(page)), 'the More menu is the wide header\'s');
    const more = page.getByRole('button', { name: '--more' });
    const courses = page.getByRole('link', { name: '--courses' });
    const openDialogs = page.locator('dialog[open]');

    await expect(courses).toBeHidden();
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(courses).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();

    await more.click();
    await page.mouse.click(10, 500);
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    // The palette replaces it.
    await more.click();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await expect(openDialogs).toHaveCount(1);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(courses).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(openDialogs).toHaveCount(0);

    // So does the help panel.
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');

    // Following one of its links opens the page and closes it.
    await more.click();
    await courses.click();
    await expect(page).toHaveURL(/\/courses$/);
    await expect(page.getByRole('button', { name: '--more' })).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('floating controls', () => {
  test('overlap neither each other nor the footer text near and at the bottom of the page', async ({ page }) => {
    await open(page, '/');
    const { scrollHeight, innerHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    const bottom = scrollHeight - innerHeight;
    // From two screens above the bottom, in quarter-screen steps, to the bottom itself.
    const stops = new Set<number>();
    for (let y = Math.max(0, bottom - 2 * innerHeight); y < bottom; y += Math.round(innerHeight / 4)) stops.add(y);
    stops.add(bottom);

    for (const y of stops) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await settle(page);
      // Visibility follows an IntersectionObserver; give it a frame or two.
      await page.waitForTimeout(100);
      const clashes = await page.evaluate(findFloatingClashes);
      expect(clashes, `floating controls at scrollY=${y}`).toEqual([]);
    }
  });
});

test.describe('dialogs', () => {
  test('the command palette and the help panel are never open together', async ({ page }) => {
    await open(page, '/');
    const openDialogs = page.locator('dialog[open]');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const help = page.getByRole('dialog', { name: 'Help' });

    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette).toBeVisible();
    await page.keyboard.press('?'); // typed into the palette's field, not a shortcut
    await expect(openDialogs).toHaveCount(1);
    await expect(help).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(openDialogs).toHaveCount(0);

    await page.keyboard.press('?');
    await expect(help).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k'); // replaces help with the palette
    await expect(palette).toBeVisible();
    await expect(openDialogs).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(openDialogs).toHaveCount(0);

    // Below the sidebar width the header menu is a third overlay: opening the palette closes it.
    const menuButton = page.locator('header [data-opens="menu"]');
    if (await menuButton.isVisible()) {
      await menuButton.click();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('ControlOrMeta+k');
      await expect(palette).toBeVisible();
      await expect(openDialogs).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    }
  });
});

test.describe('page width', () => {
  for (const path of ROUTES) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await open(page, path);
      const overflow = await page.evaluate(findHorizontalOverflow);
      expect(overflow.scrollWidth, 'document scroll width').toBeLessThanOrEqual(overflow.width);
      // html and body clip overflow-x, so content too wide for the screen is
      // cut off rather than scrollable: look for it element by element.
      expect(overflow.offenders, 'elements running past the sides of the viewport').toEqual([]);
    });
  }
});

test.describe('console', () => {
  // The page fixture fails any test on a console error; this one only has to visit.
  for (const path of ROUTES) {
    test(`${path} renders and scrolls through without console errors`, async ({ page }) => {
      await open(page, path);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await settle(page);
    });
  }
});

/**
 * Runs in the page. Visible elements that reach past the left or right edge
 * of the viewport, unless a component box clips them (a scroll container, or
 * a box with overflow hidden that itself fits on screen). html, body and main
 * all clip overflow-x, which hides such content instead of fixing it, so they
 * do not count.
 */
function findHorizontalOverflow() {
  const width = window.innerWidth;
  const outside = (box: DOMRect) => box.right > width + 1 || box.left < -1;
  const pageLevel = new Set<Element | null>([document.body, document.querySelector('main')]);
  const clippedByAncestor = (el: Element) => {
    for (let parent = el.parentElement; parent && !pageLevel.has(parent); parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX !== 'visible' && !outside(parent.getBoundingClientRect())) return true;
    }
    return false;
  };
  const offenders = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || !outside(box)) return false;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      return !clippedByAncestor(el);
    })
    .map((el) => {
      const box = el.getBoundingClientRect();
      const cls = String(el.className).split(' ')[0];
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${Math.round(box.left)}, ${Math.round(box.right)}]`;
    });
  return { scrollWidth: document.documentElement.scrollWidth, width, offenders: offenders.slice(0, 8) };
}

/**
 * Runs in the page. Visible fixed or sticky elements, other than the header
 * and full-screen layers (the canvas), that overlap one another or any text,
 * link or button in the footer.
 */
function findFloatingClashes(): string[] {
  const shown = (el: Element) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && box.width > 0 && box.height > 0;
  };
  const name = (el: Element) =>
    el.getAttribute('aria-label') ?? (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
  const overlap = (a: DOMRect, b: DOMRect) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

  const fixed = [...document.querySelectorAll('body *')].filter(
    (el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position) && shown(el),
  );
  const floating = fixed.filter((el) => {
    const box = el.getBoundingClientRect();
    const fullScreen = box.width >= window.innerWidth * 0.95 && box.height >= window.innerHeight * 0.95;
    const nested = fixed.some((other) => other !== el && other.contains(el));
    return el.tagName !== 'HEADER' && !fullScreen && !nested;
  });

  const clashes: string[] = [];
  for (let i = 0; i < floating.length; i++) {
    for (let j = i + 1; j < floating.length; j++) {
      if (overlap(floating[i].getBoundingClientRect(), floating[j].getBoundingClientRect())) {
        clashes.push(`${name(floating[i])} overlaps ${name(floating[j])}`);
      }
    }
  }

  const footer = document.querySelector('footer');
  if (!footer) return clashes;
  const footerBoxes: Array<{ what: string; box: DOMRect }> = [];
  const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (!text) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) footerBoxes.push({ what: `"${text.slice(0, 30)}"`, box });
  }
  for (const control of footer.querySelectorAll('a, button')) {
    footerBoxes.push({ what: name(control), box: control.getBoundingClientRect() });
  }
  for (const el of floating) {
    const box = el.getBoundingClientRect();
    for (const target of footerBoxes) {
      if (overlap(box, target.box)) clashes.push(`${name(el)} covers footer ${target.what}`);
    }
  }
  return clashes;
}
