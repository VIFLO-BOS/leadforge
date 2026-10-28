#!/usr/bin/env node
/**
 * WCAG 2.x contrast gate for packages/ui/src/tokens.css.
 *
 * Reads the light (:root) and dark (:root[data-theme="dark"]) token blocks, checks that the
 * prefers-color-scheme dark block matches the data-theme dark block, and verifies every text pair
 * (4.5:1) and UI-boundary pair (3:1) listed below in both themes. Exits 1 on any failure.
 *
 * Usage: node scripts/check-contrast.mjs [--verbose]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../src/tokens.css"), "utf8");
const verbose = process.argv.includes("--verbose");

function block(source, startPattern) {
  const start = source.search(startPattern);
  if (start < 0) throw new Error(`Block not found: ${startPattern}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`Unbalanced block: ${startPattern}`);
}

function parseVars(body) {
  const vars = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) vars[m[1]] = m[2].trim();
  return vars;
}

const lightBody = block(css, /^:root\s*\{/m);
const darkBody = block(css, /^:root\[data-theme="dark"\]\s*\{/m);
const mediaBody = block(block(css, /@media \(prefers-color-scheme: dark\)/), /:root:not/);

const light = parseVars(lightBody);
const darkOverrides = parseVars(darkBody);
const mediaOverrides = parseVars(mediaBody);
const dark = { ...light, ...darkOverrides };

let failures = 0;

// The two dark blocks must be identical so system dark and explicit dark render the same.
const keys = new Set([...Object.keys(darkOverrides), ...Object.keys(mediaOverrides)]);
for (const key of keys) {
  if (darkOverrides[key] !== mediaOverrides[key]) {
    failures += 1;
    console.error(
      `DRIFT --${key}: media=${mediaOverrides[key] ?? "(missing)"} data-theme=${darkOverrides[key] ?? "(missing)"}`,
    );
  }
}

function resolveValue(vars, name, seen = new Set()) {
  const raw = vars[name];
  if (raw === undefined) throw new Error(`Unknown token --${name}`);
  const ref = raw.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (ref) {
    if (seen.has(name)) throw new Error(`Cycle at --${name}`);
    seen.add(name);
    return resolveValue(vars, ref[1], seen);
  }
  return raw;
}

function toRgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (!hex) throw new Error(`Only #rrggbb is supported for checked tokens, got "${value}"`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = [
  "background",
  "surface",
  "surface-elevated",
  "surface-tint",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
];

/** [foreground, background[], minimum, note] */
const PAIRS = [
  // Body and secondary text on every surface it can sit on.
  [
    "foreground",
    [...SURFACES, "surface-container-highest", "muted", "primary-subtle", "secondary"],
    4.5,
  ],
  ["muted-foreground", [...SURFACES, "muted", "primary-subtle"], 4.5],
  // Brand text (links, active nav labels, text buttons).
  ["primary", [...SURFACES, "primary-subtle"], 4.5],
  ["primary-foreground", ["primary", "primary-hover"], 4.5],
  ["primary-container-foreground", ["primary-container"], 4.5],
  ["secondary-foreground", ["secondary"], 4.5],
  ["tertiary", ["background", "surface", "surface-container-low"], 4.5],
  ["tertiary-foreground", ["tertiary"], 4.5],
  ["tertiary-container-foreground", ["tertiary-container"], 4.5],
  // Snackbars and tooltips.
  ["inverse-foreground", ["inverse-surface"], 4.5],
  ["inverse-primary", ["inverse-surface"], 4.5],
  // Status text on surfaces, on its own subtle container, and labels on the solid tone.
  ...["success", "warning", "destructive", "info"].flatMap((s) => [
    [s, [...SURFACES, `${s}-subtle`], 4.5],
    [`${s}-foreground`, [s], 4.5],
    ["foreground", [`${s}-subtle`], 4.5],
    ["muted-foreground", [`${s}-subtle`], 4.5],
  ]),
  // UI boundaries and focus indicators (WCAG 1.4.11).
  ["input", [...SURFACES], 3],
  ["ring", [...SURFACES, "primary-subtle"], 3],
  ["primary", ["background", "surface", "surface-container-low"], 3, "filled control vs page"],
];

const report = [];
for (const [themeName, vars] of [
  ["light", light],
  ["dark", dark],
]) {
  for (const [fg, bgs, min, note] of PAIRS) {
    for (const bg of bgs) {
      const value = ratio(toRgb(resolveValue(vars, fg)), toRgb(resolveValue(vars, bg)));
      const ok = value >= min;
      if (!ok) failures += 1;
      report.push({
        theme: themeName,
        pair: `${fg} on ${bg}`,
        ratio: value.toFixed(2),
        min,
        result: ok ? "pass" : "FAIL",
        note: note ?? "",
      });
    }
  }
  // Chart slots: informational. Light slots below 3:1 rely on the mandatory table view and labels.
  for (let i = 1; i <= 8; i += 1) {
    const value = ratio(
      toRgb(resolveValue(vars, `chart-${i}`)),
      toRgb(resolveValue(vars, "surface")),
    );
    report.push({
      theme: themeName,
      pair: `chart-${i} on surface`,
      ratio: value.toFixed(2),
      min: "info",
      result: value >= 3 ? "pass" : "relief: table view",
      note: "categorical mark",
    });
  }
}

const checked = report.filter((r) => r.min !== "info");
if (verbose) console.table(report);
else console.table(report.filter((r) => r.result !== "pass"));

const worst = (theme) =>
  checked
    .filter((r) => r.theme === theme)
    .reduce((acc, r) =>
      Number(r.ratio) / Number(r.min) < Number(acc.ratio) / Number(acc.min) ? r : acc,
    );

for (const theme of ["light", "dark"]) {
  const w = worst(theme);
  console.log(`${theme}: tightest pair ${w.pair} at ${w.ratio}:1 (minimum ${w.min}:1)`);
}
console.log(
  `${checked.length} pairs checked across light and dark, ${failures} failure${failures === 1 ? "" : "s"}.`,
);
process.exit(failures > 0 ? 1 : 0);
