import { chromium } from '@playwright/test';
const OUT = process.argv[2]; const BASE = 'http://127.0.0.1:5198';
const b = await chromium.launch();
for (const s of ['dark', 'light']) {
  for (const W of [1440, 390]) {
    const H = W === 1440 ? 900 : 844;
    const c = await b.newContext({ viewport: { width: W, height: H }, colorScheme: s, deviceScaleFactor: W === 1440 ? 1 : 2 });
    await c.addInitScript((t) => { sessionStorage.setItem('appLoaded', 'true'); localStorage.setItem('dashboards-lang', 'ru'); localStorage.setItem('theme', t); }, s);
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    const shot = async (n, extra = {}) => { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${n}-${W}-${s}.png`, ...extra }); };
    const go = (path) => p.goto(BASE + path, { waitUntil: 'networkidle' });
    await go('/dashboards'); await shot('hub', { fullPage: true });
    if (W === 1440) {
      await p.getByRole('region', { name: 'Court case' }).hover(); await p.waitForTimeout(250); await shot('hub-hover-project', { fullPage: true });
      await p.mouse.move(5, 5);
    }
    await p.getByRole('button', { name: 'Новый проект' }).click();
    await p.getByLabel('Название проекта').fill('Trip to Lisbon');
    await p.getByRole('radio', { name: 'Самолёт' }).check({ force: true });
    await p.getByRole('radio', { name: 'Самолёт' }).focus();
    await shot('hub-new-project-picker-open', { fullPage: true });
    await go('/dashboards/projects/garden'); await shot('project-garden', { fullPage: true });
    await p.getByRole('button', { name: 'Значок' }).click(); await shot('project-garden-picker-open', { fullPage: true });
    await go('/dashboards/projects/court'); await shot('project-court', { fullPage: true });
    await go('/dashboards/personal'); await shot('personal', { fullPage: true });
    await go('/dashboards/work-1'); await shot('work1', { fullPage: true });
    if (W === 1440) {
      await go('/dashboards/projects/garden');
      await shot('bar-crop-garden', { clip: { x: 0, y: 0, width: 1440, height: 70 } });
      await go('/dashboards/personal');
      await shot('bar-crop-personal', { clip: { x: 0, y: 0, width: 1440, height: 70 } });
    }
    if (errs.length) console.log(s, W, errs.slice(0, 3));
    await c.close();
  }
}
await b.close();
