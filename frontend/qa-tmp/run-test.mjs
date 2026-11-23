// Runs a simple vitest file (describe/it/expect + import.meta.glob raw) under plain node via esbuild.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const file = process.argv[2];
let code = fs.readFileSync(file, 'utf8').replace(/import \{[^}]*\} from 'vitest';/, '');
code = code.replace(/import\.meta\.glob\(/g, '__glob(');
const shim = `
import * as __fs from 'node:fs'; import * as __path from 'node:path';
const __walk = (d) => __fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? __walk(__path.join(d, e.name)) : [__path.join(d, e.name)]));
const __glob = (pattern) => { const pats = [].concat(pattern); const ext = pats.some((p) => /css/.test(p)) ? (pats.some((p) => /ts/.test(p)) ? /\\.(css|ts|tsx)$/ : /\\.css$/) : /\\.woff2$/;
  const out = {}; for (const f of __walk(${JSON.stringify(process.cwd() + '/src')})) { if (!ext.test(f)) continue; if (/\\.test\\.tsx?$/.test(f) && pats.some((p) => p.startsWith('!'))) continue; const key = '/src' + f.split('/src').pop(); out[key] = __fs.readFileSync(f, 'utf8'); } return out; };
const __results = []; const describe = (n, f) => f(); const it = (n, f) => { try { f(); __results.push(['ok  ', n]); } catch (e) { __results.push(['FAIL', n + '\\n' + String(e.message).slice(0, 3000)]); } };
const expect = (v) => ({ toEqual: (w) => { if (JSON.stringify(v) !== JSON.stringify(w)) throw new Error(JSON.stringify(v, null, 1)); }, toBe: (w) => { if (v !== w) throw new Error(v + ' !== ' + w); }, toBeGreaterThan: (w) => { if (!(v > w)) throw new Error(v + ' !> ' + w); }, not: { toMatch: (r) => { if (r.test(v)) throw new Error('matches ' + r); } } });
`;
fs.mkdirSync('qa-tmp/h', { recursive: true });
fs.writeFileSync('qa-tmp/h/t.ts', shim + code + '\nfor (const [s, n] of __results) console.log(s, n);');
await build({ entryPoints: ['qa-tmp/h/t.ts'], outfile: 'qa-tmp/h/t.mjs', bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
await import(process.cwd() + '/qa-tmp/h/t.mjs?' + Date.now());
