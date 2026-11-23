import { chromium } from '@playwright/test';
const OUT = process.argv[2]; const BASE = 'http://127.0.0.1:5198';
const b = await chromium.launch();
for (const s of ['dark', 'light']) {
  for (const [W, name, clip] of [[1440, 'bar-zoom-1440', { x: 0, y: 0, width: 760, height: 66 }], [1440, 'bar-zoom-1440-right', { x: 680, y: 0, width: 760, height: 66 }], [390, 'bar-zoom-390', { x: 0, y: 0, width: 390, height: 60 }]]) {
    const c = await b.newContext({ viewport: { width: W, height: 844 }, colorScheme: s, deviceScaleFactor: 3 });
    await c.addInitScript(() => { sessionStorage.setItem('appLoaded', 'true'); localStorage.setItem('dashboards-lang', 'ru'); });
    const p = await c.newPage();
    await p.goto(BASE + '/dashboards/projects/garden', { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
    if (name.endsWith('right')) await p.evaluate(() => { const n = document.querySelector('nav'); n.scrollLeft = 0; });
    await p.screenshot({ path: `${OUT}/${name}-${s}.png`, clip });
    await c.close();
  }
}
await b.close();
