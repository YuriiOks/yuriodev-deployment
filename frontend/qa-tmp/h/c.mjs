// qa-tmp/h/c.ts
import * as __fs_variablesCss from "node:fs";
var results = [];
var describe = (n, f) => f();
var it = (name, f) => {
  try {
    f();
    results.push([name, "ok"]);
  } catch (e) {
    results.push([name, String(e.message).slice(0, 6e3)]);
  }
};
var expect = (v, m) => ({
  toEqual: (w) => {
    if (JSON.stringify(v) !== JSON.stringify(w)) throw new Error((m ? m + ": " : "") + JSON.stringify(v, null, 1));
  },
  toBe: (w) => {
    if (v !== w) throw new Error((m ? m + ": " : "") + v + " !== " + w);
  },
  toBeGreaterThan: (w) => {
    if (!(v > w)) throw new Error(v + " !> " + w);
  },
  toBeLessThanOrEqual: (w) => {
    if (!(v <= w)) throw new Error((m ? m + ": " : "") + v + " !<= " + w);
  },
  toBeGreaterThanOrEqual: (w) => {
    if (!(v >= w)) throw new Error(v + " !>= " + w);
  },
  toMatch: (re) => {
    if (!re.test(v)) throw new Error((m ? m + ": " : "") + v + " !~ " + re);
  },
  toContain: (w) => {
    if (!v.includes(w)) throw new Error("missing " + w);
  },
  toBeCloseTo: (w, d = 2) => {
    if (Math.abs(v - w) >= 10 ** -d / 2) throw new Error(v + " !~ " + w);
  },
  not: { toBe: (w) => {
    if (v === w) throw new Error("equal " + v);
  }, toMatch: (re) => {
    if (re.test(v)) throw new Error(v + " ~ " + re);
  } }
});
var variablesCss = __fs_variablesCss.readFileSync("/Users/yurii_jupus/Documents/Personal/yuriodev-deployment/frontend/src/assets/styles/_variables.css", "utf8");
function blocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let depth = 0;
  let start = 0;
  let selector = "";
  let skip = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) {
        selector = text.slice(start, i).trim();
        skip = selector.startsWith("@");
        start = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        if (!skip) out.push({ selector, body: text.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return out;
}
function tokensFor(theme, space) {
  const tokens = /* @__PURE__ */ new Map();
  const spaceBlocks = space ? [`[data-space="${space}"]`, ...theme === "light" ? [`[data-theme="light"] [data-space="${space}"]`] : []] : [];
  for (const { selector, body } of blocks(variablesCss)) {
    const parts = selector.split(",").map((s) => s.trim());
    const applies = parts.some((p) => p === ":root" || p === `[data-theme="${theme}"]` || spaceBlocks.includes(p));
    if (!applies) continue;
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  }
  return tokens;
}
function resolve(tokens, value, seen = []) {
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => {
    if (seen.includes(name)) throw new Error(`var() cycle: ${[...seen, name].join(" -> ")}`);
    const raw = tokens.get(name);
    if (raw === void 0) throw new Error(`undefined token ${name}`);
    return resolve(tokens, raw, [...seen, name]);
  });
}
function parseColor(value) {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const n = fn[1].split(",").map((s) => Number(s.trim()));
    if (n.length >= 3 && n.every((x) => Number.isFinite(x))) return [n[0], n[1], n[2], n[3] ?? 1];
  }
  throw new Error(`not a colour: ${value}`);
}
function over(top, bottom) {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
}
function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function paint(tokens, layers) {
  const colours = layers.map((l) => parseColor(resolve(tokens, l.startsWith("--") ? `var(${l})` : l)));
  let result = colours[colours.length - 1];
  if (result[3] !== 1) throw new Error(`bottom layer ${layers[layers.length - 1]} is not opaque`);
  for (let i = colours.length - 2; i >= 0; i -= 1) result = over(colours[i], result);
  return result;
}
var TEXT = 4.5;
var LARGE = 3;
var UI = 3;
var cross = (fgs, bgs, min) => fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min })));
var SOLID_DARK = [["--bg-0"], ["--bg-1"], ["--surface-1"], ["--surface-2"], ["--surface-3"]];
var SOLID_LIGHT = [["--bg-0"], ["--bg-1"], ["--surface-1"], ["--surface-2"]];
var TEXT_TOKENS = [
  "--text-1",
  "--text-2",
  "--text-3",
  "--body-ink",
  "--cyan-text",
  "--amber-text",
  "--ok",
  "--err",
  "--info",
  "--syn-key",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
  "--text-muted",
  "--accent-primary",
  "--accent-secondary",
  "--accent-tertiary",
  "--accent-quaternary",
  "--success",
  "--nav-link-text",
  "--nav-link-text-active",
  "--button-nav-text",
  "--cta-button-text",
  // The current page and section (header, More menu, rail) and the rail's labels.
  "--current-ink",
  "--rail-label",
  // Section and card titles, and the small amber labels that remain (status, warnings).
  "--title-ink",
  "--warn"
];
var HUES = ["--hue-violet", "--hue-teal", "--hue-green", "--hue-blue", "--hue-orange", "--hue-pink"];
var GLASS_TEXT = ["--text-1", "--text-2", "--cyan-text", "--amber-text", "--current-ink"];
var DISPLAY = ["--amber-display", "--title-mark"];
var BUTTON_PAIRS = (page) => [
  ...cross(["--cyan-text"], [["rgba(var(--cyan-rgb), 0.1)", page], ["rgba(var(--cyan-rgb), 0.18)", page]], TEXT),
  { fg: "--on-cyan", bg: ["--cyan"], min: TEXT }
];
var AMBER_TINTS = [
  { fg: "--amber-text", bg: ["rgba(var(--amber-rgb), 0.15)", "--surface-1"], min: TEXT },
  { fg: "--amber-text", bg: ["rgba(var(--amber-rgb), 0.2)", "--surface-1"], min: TEXT },
  // A timeline card's type label: teal on its tint, on the header's cyan tint.
  { fg: "--hue-teal", bg: ["rgba(var(--hue-teal-rgb), 0.2)", "rgba(var(--cyan-rgb), 0.08)", "--surface-1"], min: TEXT }
];
var RAIL_UI = ["--rail-tick", "--current-edge"];
var PAIRS = {
  dark: [
    ...cross(TEXT_TOKENS, SOLID_DARK, TEXT),
    ...cross(HUES, [["--bg-0"], ["--surface-1"], ["--surface-3"]], TEXT),
    ...cross(GLASS_TEXT, [["--glass-fill", "--text-1"], ["--glass-fill", "--bg-0"]], TEXT),
    ...cross(DISPLAY, SOLID_DARK, LARGE),
    ...BUTTON_PAIRS("--bg-0"),
    ...BUTTON_PAIRS("--surface-1"),
    ...AMBER_TINTS,
    // Hover and current-item tints.
    { fg: "--cyan-text", bg: ["rgba(var(--cyan-rgb), 0.18)", "--bg-0"], min: TEXT },
    { fg: "--nav-link-text-active", bg: ["--nav-link-bg-active", "--bg-0"], min: TEXT },
    // Text on the neon fills.
    { fg: "--on-cyan", bg: ["--cyan"], min: TEXT },
    { fg: "--on-amber", bg: ["--amber"], min: TEXT },
    { fg: "--text-on-accent-bg", bg: ["--accent-primary"], min: TEXT },
    { fg: "--text-on-accent-bg", bg: ["--accent-secondary"], min: TEXT },
    // UI parts.
    ...cross(["--border-strong"], [["--bg-0"], ["--surface-1"], ["--surface-2"]], UI),
    ...cross(["--focus-ring", "--cyan-edge", "--amber-edge"], SOLID_DARK, UI),
    ...cross(RAIL_UI, SOLID_DARK, UI),
    // A header control's text over its resting and hover tints, on the page.
    ...cross(["--text-2", "--cyan-text", "--current-ink"], [["rgba(var(--cyan-rgb), 0.12)", "--bg-0"]], TEXT)
  ],
  light: [
    ...cross(TEXT_TOKENS, SOLID_LIGHT, TEXT),
    ...cross(HUES, [["--bg-0"], ["--bg-1"], ["--surface-1"]], TEXT),
    ...cross(GLASS_TEXT, [["--glass-fill", "--text-1"], ["--glass-fill", "--bg-0"]], TEXT),
    ...cross(DISPLAY, SOLID_LIGHT, LARGE),
    // The hero name: light theme only (dark keeps --cyan-text). Its plain
    // fallback colour, and both gradient stops (each one is what actually
    // paints, left and right, so each must clear large-text AA on its own).
    ...cross(["--name-ink", "--name-gold", "--name-orange"], SOLID_LIGHT, LARGE),
    ...BUTTON_PAIRS("--bg-0"),
    ...BUTTON_PAIRS("--surface-1"),
    ...AMBER_TINTS,
    { fg: "--text-1", bg: ["rgba(var(--amber-rgb), 0.2)", "--surface-1"], min: TEXT },
    { fg: "--cyan-text", bg: ["rgba(var(--cyan-rgb), 0.18)", "--surface-1"], min: TEXT },
    { fg: "--nav-link-text-active", bg: ["--nav-link-bg-active", "--bg-0"], min: TEXT },
    { fg: "--on-cyan", bg: ["--cyan"], min: TEXT },
    { fg: "--on-amber", bg: ["--amber"], min: TEXT },
    { fg: "--text-on-accent-bg", bg: ["--accent-primary"], min: TEXT },
    { fg: "--text-on-accent-bg", bg: ["--accent-secondary"], min: TEXT },
    ...cross(["--border-strong"], [["--bg-0"], ["--surface-1"], ["--surface-2"]], UI),
    ...cross(["--focus-ring", "--cyan-edge", "--amber-edge"], SOLID_LIGHT, UI),
    ...cross(RAIL_UI, [...SOLID_LIGHT, ["#ffffff"]], UI),
    ...cross(["--text-2", "--cyan-text", "--current-ink"], [["rgba(var(--cyan-rgb), 0.12)", "--surface-1"]], TEXT)
  ]
};
var SPACES = ["personal", "work-1", "work-2"];
var SKINS = [...SPACES, "project"];
var SPACE_INKS = SPACES.map((s) => `--dash-ink-${s}`);
var DASH_SOLID = [["--dash-bg"], ["--dash-surface"], ["--dash-chip"], ["--dash-well"]];
var GLOW = (n) => `rgba(var(--dash-glow-${n}-rgb), var(--dash-glow-${n}))`;
var BACKS = [["--dash-bg"], [GLOW("a"), "--dash-bg"], [GLOW("b"), "--dash-bg"], [GLOW("c"), "--dash-bg"]];
var onGlass = (layers = []) => BACKS.map((back) => [...layers, "--dash-glass", ...back]);
var WEEKEND = "rgba(var(--dash-chip-rgb), 0.4)";
var DASH_PAIRS = [
  // Titles, rows, secondary text and hints on every solid surface (t3: placeholders, zero values, never on events).
  ...cross(["--dash-t1", "--dash-t2", "--dash-t3"], DASH_SOLID, TEXT),
  // Semantic text (overdue, today and conflicts, CI passing) on the solid surfaces.
  ...cross(["--dash-danger", "--dash-warn", "--dash-ok"], DASH_SOLID, TEXT),
  // The same on the glass, over the page and each glow, and on a row's hover plate over the glass.
  ...cross(["--dash-t1", "--dash-t2", "--dash-t3", "--dash-danger", "--dash-warn", "--dash-ok"], onGlass(), TEXT),
  ...cross(["--dash-t1", "--dash-t2", "--dash-t3"], onGlass([WEEKEND]), TEXT),
  // Text straight on the page, over the glows (the strip, the tabs, the footer line).
  ...cross(["--dash-t1", "--dash-t2", "--dash-t3", "--dash-danger", "--dash-warn"], BACKS, TEXT),
  // The heading colour (titles, the active link, priority numbers) and the page's ink (line work, the strip's time,
  // reference links) as text: on every solid, on the glass, on a row's plates and on the page over the glows.
  ...cross(["--dash-heading", "--dash-accent"], [...DASH_SOLID, ...onGlass(), ...BACKS], TEXT),
  ...cross(["--dash-heading"], onGlass(["--dash-heading-tint"]), TEXT),
  ...cross(["--dash-t1", "--dash-t2", "--dash-accent"], onGlass(["--dash-prio-bg"]), TEXT),
  ...cross(["--dash-t1", "--dash-t2", "--dash-t3", "--dash-accent", "--dash-heading"], onGlass(["--dash-chip"]), TEXT),
  // The primary button, the ticked checkbox and the space tile: the ink on the space's fill.
  { fg: "--dash-on-fill", bg: ["--dash-fill"], min: TEXT },
  // A space's ink as the 2px underline of the active tab and link, and its fill beside the text it marks.
  ...cross(["--dash-accent", "--dash-fill"], [...DASH_SOLID, ...onGlass(), ...BACKS], UI),
  // Control borders (the quick-add field, the unticked checkbox, the segmented selected edge).
  ...cross(["--dash-edge"], [...DASH_SOLID, ...onGlass(), ...BACKS], UI)
];
var SHARED_PAIRS = [
  ...cross(SPACE_INKS, [...DASH_SOLID, ...onGlass()], TEXT),
  ...SPACES.map((space) => ({ fg: `--dash-on-fill-${space}`, bg: [`--dash-fill-${space}`], min: TEXT })),
  ...SPACES.flatMap((space) => [
    ...cross(["--dash-t1", "--dash-t2"], [[`--dash-tint-${space}`]], TEXT),
    ...cross(["--dash-warn"], [[`--dash-tint-${space}`]], UI),
    ...cross([`--dash-ink-${space}`], [[`--dash-tint-${space}`]], UI),
    ...cross([`--dash-fill-${space}`], [...DASH_SOLID, ...onGlass()], UI)
  ])
];
var HUB_SCHEMES = ["personal", "work-1", "work-2"];
var HUB_PAIRS = [
  ...HUB_SCHEMES.flatMap((scheme) => [
    ...cross(["--dash-t1", "--dash-t2", "--dash-danger", `--hub-${scheme}-ink`], [[`--hub-${scheme}-a`]], TEXT),
    ...cross([`--hub-${scheme}-ink`], [...BACKS, ...DASH_SOLID], UI),
    // Hover, focus and pressed: the card's own flat steps, with the name and the Next line on them; and the ink on the stat chips.
    ...cross(["--dash-t1", "--dash-t2", `--hub-${scheme}-ink`], [[`--hub-${scheme}-h`], [`--hub-${scheme}-p`]], TEXT),
    ...cross([`--hub-${scheme}-ink`], [["--dash-chip"]], TEXT)
  ]),
  ...cross(["--hub-project-t1", "--hub-project-t2", "--hub-project-ink"], [["--hub-project-a"], ["--hub-project-h"], ["--hub-project-p"]], TEXT),
  ...cross(["--hub-project-t1", "--hub-project-t2", "--hub-project-ink", "--dash-danger"], [["--hub-project-chip"]], TEXT),
  ...cross(["--hub-project-ink"], [...BACKS, ...DASH_SOLID], UI),
  // The tile: the brand clay with the warm black on it.
  { fg: "--hub-project-on", bg: ["--hub-project-clay"], min: TEXT },
  ...cross(["--dash-t1", "--dash-t2", "--hub-personal-ink", "--hub-amber-ink"], [["--hub-head-a"]], TEXT)
];
describe("dashboard palettes meet WCAG AA", () => {
  for (const theme of ["dark", "light"]) {
    for (const space of [void 0, ...SKINS]) {
      it(`${theme} theme, ${space ?? "neutral (hub and calendar)"}: every text and UI pair`, () => {
        const tokens = tokensFor(theme, space);
        const pairs = [...DASH_PAIRS, ...space === void 0 ? [...SHARED_PAIRS, ...HUB_PAIRS] : []];
        const failures = pairs.map(({ fg, bg, min }) => ({ fg, bg, min, got: ratio(paint(tokens, [fg]), paint(tokens, bg)) })).filter(({ got, min }) => got < min).map(({ fg, bg, min, got }) => `${fg} on ${bg.join(" over ")}: ${got.toFixed(2)} < ${min}`);
        expect(pairs.length).toBeGreaterThan(40);
        expect(failures).toEqual([]);
      });
    }
  }
  it("the spaces really differ (the parser picks up each space block)", () => {
    const accent = (theme, space) => resolve(tokensFor(theme, space), "var(--dash-accent)");
    expect(accent("dark", "personal")).toBe("#00d4ff");
    expect(accent("light", "personal")).toBe("#0b6780");
    expect(accent("dark", "work-1")).toBe("#b88cff");
    expect(accent("light", "work-1")).toBe("#7a22d0");
    expect(accent("dark", "work-2")).toBe("#ff6874");
    expect(accent("light", "work-2")).toBe("#c4000f");
    expect(resolve(tokensFor("dark"), "var(--dash-accent)")).toBe("#00d4ff");
    expect(resolve(tokensFor("light"), "var(--dash-accent)")).toBe("#0b6780");
    const heading = (theme, space) => resolve(tokensFor(theme, space), "var(--dash-heading)");
    expect(heading("dark")).toBe("#ffc107");
    expect(heading("dark", "work-1")).toBe("#d3b8ff");
    expect(heading("dark", "work-2")).toBe("#ffffff");
    expect(resolve(tokensFor("dark", "work-1"), "var(--dash-bg)")).toBe("#120e24");
    expect(resolve(tokensFor("dark", "project"), "var(--dash-bg)")).toBe("#141413");
    expect(resolve(tokensFor("light", "project"), "var(--dash-bg)")).toBe("#faf9f5");
    expect(resolve(tokensFor("dark", "project"), "var(--dash-fill)")).toBe("#d97757");
    expect(resolve(tokensFor("light", "project"), "var(--dash-heading)")).toBe("#9a3f24");
    expect(resolve(tokensFor("light", "work-2"), "var(--dash-bg)")).toBe("#f3f3f3");
  });
  it("every skin that changes the surface declares its own glass (a var()-made custom property is computed where it is declared, so the root's would stay navy)", () => {
    const own = blocks(variablesCss).filter((block) => /\[data-space="(work-1|work-2|project)"\]/.test(block.selector));
    expect(own.length).toBe(6);
    for (const block of own) {
      expect(block.body, block.selector).toMatch(/--dash-glass:\s*rgba\(var\(--dash-surface-rgb\), var\(--dash-glass-a\)\)/);
    }
  });
  it("a skin changes only its colour tokens: no size, shape or type token differs between spaces", () => {
    for (const theme of ["dark", "light"]) {
      const base = tokensFor(theme);
      for (const space of SKINS) {
        const own = tokensFor(theme, space);
        const changed = [...own.keys()].filter((key) => own.get(key) !== base.get(key)).sort();
        for (const key of changed) {
          expect(key, `${theme} ${space}`).not.toMatch(/^--dash-(fs|lh|r|h)-|font/);
          expect(key, `${theme} ${space}`).toMatch(/^--dash-/);
        }
      }
    }
  });
  it("an event tint is the space ink at 12% (light) or 22% (dark) over the surface, computed, not stacked alpha", () => {
    const share = { light: 0.12, dark: 0.22 };
    for (const theme of ["dark", "light"]) {
      const tokens = tokensFor(theme);
      const surface = parseColor(resolve(tokens, "var(--dash-surface)"));
      for (const space of SPACES) {
        const ink = parseColor(resolve(tokens, `var(--dash-ink-${space})`));
        const tint = parseColor(resolve(tokens, `var(--dash-tint-${space})`));
        for (let i = 0; i < 3; i += 1) {
          expect(Math.abs(tint[i] - (ink[i] * share[theme] + surface[i] * (1 - share[theme]))), `${theme} ${space} channel ${i}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
describe("colour tokens meet WCAG AA", () => {
  for (const theme of ["dark", "light"]) {
    it(`${theme} theme: every listed text and UI pair`, () => {
      const tokens = tokensFor(theme);
      const failures = PAIRS[theme].map(({ fg, bg, min }) => ({ fg, bg, min, got: ratio(paint(tokens, [fg]), paint(tokens, bg)) })).filter(({ got, min }) => got < min).map(({ fg, bg, min, got }) => `${fg} on ${bg.join(" over ")}: ${got.toFixed(2)} < ${min}`);
      expect(PAIRS[theme].length).toBeGreaterThan(100);
      expect(failures).toEqual([]);
    });
  }
  it("the themes really differ (the parser picks up the light block)", () => {
    expect(resolve(tokensFor("dark"), "var(--text-1)")).not.toBe(resolve(tokensFor("light"), "var(--text-1)"));
    expect(resolve(tokensFor("light"), "var(--accent-primary)")).toBe("#0b6780");
  });
  it("the known ratios come out right (the maths is WCAG 2.x)", () => {
    expect(ratio(parseColor("#000000"), parseColor("#ffffff"))).toBeCloseTo(21, 5);
    expect(ratio(parseColor("#e6f1ff"), parseColor("#0a0f1c"))).toBeCloseTo(16.75, 1);
    expect(ratio(parseColor("#0b6780"), parseColor("#ffffff"))).toBeCloseTo(6.43, 1);
  });
});
for (const [n, r] of results) console.log(r === "ok" ? "ok  " : "FAIL", n, r === "ok" ? "" : "\n" + r);
var rows = [];
for (const theme of ["dark", "light"]) for (const space of [void 0, ...SKINS]) {
  const tokens = tokensFor(theme, space);
  for (const p of [...DASH_PAIRS, ...space === void 0 ? [...SHARED_PAIRS, ...HUB_PAIRS] : []]) {
    const got = ratio(paint(tokens, [p.fg]), paint(tokens, p.bg));
    rows.push({ theme, space: space ?? "neutral", fg: p.fg, bg: p.bg.join(" / "), min: p.min, got, margin: got - p.min });
  }
}
rows.sort((a, b) => a.margin - b.margin);
console.log("pairs checked:", rows.length);
for (const r of rows.slice(0, 14)) console.log(r.margin.toFixed(2), r.got.toFixed(2) + "/" + r.min, r.theme, r.space, r.fg, "on", r.bg);
