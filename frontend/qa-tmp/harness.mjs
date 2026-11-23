// Full recomputation of every contrast.test.ts pair, outside vitest: prints failures and tightest margins.
import { build } from 'esbuild';
import fs from 'node:fs';
const src = fs.readFileSync('src/assets/styles/contrast.test.ts', 'utf8');
const ABS = process.cwd() + '/src/assets/styles/';
let code = src
  .replace(/import \{[^}]*\} from 'vitest';/, '')
  .replace(/import (\w+) from '([^']+\.css)\?raw';/g, (_, n, p) => `import * as __fs_${n} from 'node:fs'; const ${n} = __fs_${n}.readFileSync(${JSON.stringify(ABS)} + ${JSON.stringify(p.replace('./', ''))}, 'utf8');`);
const shim = `
const results = [];
const describe = (n, f) => f();
const it = (name, f) => { try { f(); results.push([name, 'ok']); } catch (e) { results.push([name, String(e.message).slice(0, 6000)]); } };
const expect = (v, m) => ({
  toEqual: (w) => { if (JSON.stringify(v) !== JSON.stringify(w)) throw new Error((m ? m + ': ' : '') + JSON.stringify(v, null, 1)); },
  toBe: (w) => { if (v !== w) throw new Error((m ? m + ': ' : '') + v + ' !== ' + w); },
  toBeGreaterThan: (w) => { if (!(v > w)) throw new Error(v + ' !> ' + w); },
  toBeLessThanOrEqual: (w) => { if (!(v <= w)) throw new Error((m ? m + ': ' : '') + v + ' !<= ' + w); },
  toBeGreaterThanOrEqual: (w) => { if (!(v >= w)) throw new Error(v + ' !>= ' + w); },
  toMatch: (re) => { if (!re.test(v)) throw new Error((m ? m + ': ' : '') + v + ' !~ ' + re); },
  toContain: (w) => { if (!v.includes(w)) throw new Error('missing ' + w); },
  toBeCloseTo: (w, d = 2) => { if (Math.abs(v - w) >= 10 ** -d / 2) throw new Error(v + ' !~ ' + w); },
  not: { toBe: (w) => { if (v === w) throw new Error('equal ' + v); }, toMatch: (re) => { if (re.test(v)) throw new Error(v + ' ~ ' + re); } },
});
`;
code =
  shim +
  code +
  `
for (const [n, r] of results) console.log(r === 'ok' ? 'ok  ' : 'FAIL', n, r === 'ok' ? '' : '\\n' + r);
// Tightest margins over every dashboards pair, per theme and space.
const rows = [];
for (const theme of ['dark', 'light']) for (const space of [undefined, ...SKINS]) {
  const tokens = tokensFor(theme, space);
  for (const p of [...DASH_PAIRS, ...(space === undefined ? [...SHARED_PAIRS, ...HUB_PAIRS] : [])]) {
    const got = ratio(paint(tokens, [p.fg]), paint(tokens, p.bg));
    rows.push({ theme, space: space ?? 'neutral', fg: p.fg, bg: p.bg.join(' / '), min: p.min, got, margin: got - p.min });
  }
}
rows.sort((a, b) => a.margin - b.margin);
console.log('pairs checked:', rows.length);
for (const r of rows.slice(0, 14)) console.log(r.margin.toFixed(2), r.got.toFixed(2) + '/' + r.min, r.theme, r.space, r.fg, 'on', r.bg);
`;
fs.mkdirSync('qa-tmp/h', { recursive: true });
fs.writeFileSync('qa-tmp/h/c.ts', code);
await build({ entryPoints: ['qa-tmp/h/c.ts'], outfile: 'qa-tmp/h/c.mjs', bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
await import(process.cwd() + '/qa-tmp/h/c.mjs');
