import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Shared accessibility helpers for the axe, keyboard and semantics specs.
 *
 * axe runs the WCAG 2.0 and 2.1 A and AA rule sets (the release target in ARCHITECTURE section 10)
 * plus a few best-practice rules that encode the structure DESIGN_SYSTEM section 11 asks for:
 * one main landmark, an h1 on every page, no skipped heading levels, unique landmark names.
 */

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

/** Best-practice rules that back the semantics requirements; all must pass. */
export const STRUCTURE_RULES = [
  "landmark-one-main",
  "landmark-no-duplicate-main",
  "landmark-unique",
  "landmark-main-is-top-level",
  "landmark-banner-is-top-level",
  "landmark-contentinfo-is-top-level",
  "landmark-complementary-is-top-level",
  "page-has-heading-one",
  "heading-order",
  "empty-heading",
  "region",
] as const;

export interface A11yException {
  /** axe rule id. */
  rule: string;
  /** Matches when any target selector of the offending node contains this string. */
  target?: string;
  /** Only on these routes (substring match); every route when omitted. */
  route?: string;
  /** Matches when the offending element sits inside an element matching this CSS selector. */
  within?: string;
  /** Why this is a false positive and not a defect. Required. */
  reason: string;
}

/**
 * Genuine false positives only. Every entry needs a reason that would convince a reviewer that
 * the page meets the success criterion. Keep this list short; fix at the source instead.
 * Mirrored in docs/DESIGN_SYSTEM.md section 11.3.
 */
export const A11Y_EXCEPTIONS: A11yException[] = [
  {
    rule: "region",
    within: "[data-radix-popper-content-wrapper]",
    reason:
      "An open menu or popover renders its popup in a portal at the end of <body>, outside every " +
      "landmark, as the WAI-ARIA menu button pattern does. The popup exists only while open, is " +
      "reached from its trigger (aria-controls, focus moves into it) and closes on Escape. `region` " +
      "is an axe best-practice rule, not a WCAG success criterion.",
  },
];

export interface AxeFinding {
  rule: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
  html: string[];
  summary: string[];
}

async function excepted(
  page: Page,
  rule: string,
  targets: string[],
  route: string,
): Promise<A11yException | undefined> {
  for (const e of A11Y_EXCEPTIONS) {
    if (e.rule !== rule) continue;
    if (e.route && !route.includes(e.route)) continue;
    if (e.target && !targets.some((t) => t.includes(e.target!))) continue;
    if (e.within) {
      const inside = await page
        .evaluate(
          ({ selector, within }) => Boolean(document.querySelector(selector)?.closest(within)),
          { selector: targets[0] ?? "", within: e.within },
        )
        .catch(() => false);
      if (!inside) continue;
    }
    return e;
  }
  return undefined;
}

/** Lets entrance transitions and route fades settle so axe measures final colours. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = document
      .getAnimations()
      .filter(
        (a) => a.playState === "running" && Number.isFinite(a.effect?.getTiming().iterations ?? 1),
      );
    await Promise.race([
      Promise.all(running.map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  });
}

export type Theme = "light" | "dark";

/** Switches the system colour scheme; next-themes follows it (defaultTheme "system"). */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")), {
      timeout: 5_000,
    })
    .toBe(theme);
}

/**
 * Runs axe on the current page state and returns violations that are not documented exceptions.
 * Writes the raw findings to A11Y_REPORT_DIR (one JSON file per scenario) when set, so a run can
 * be summarised by rule afterwards.
 */
export async function runAxe(page: Page, scenario: string): Promise<AxeFinding[]> {
  await settle(page);
  const full = await new AxeBuilder({ page })
    // Tags select the WCAG rules; the structure rules are best-practice in axe and enabled on top.
    .options({
      rules: Object.fromEntries(STRUCTURE_RULES.map((r) => [r, { enabled: true }])),
      resultTypes: ["violations"],
    })
    .withTags([...WCAG_TAGS])
    .analyze();
  const route = new URL(page.url()).pathname + new URL(page.url()).search;
  const findings: AxeFinding[] = [];
  for (const v of full.violations) {
    const nodes: typeof v.nodes = [];
    for (const n of v.nodes) {
      const targets = n.target.map((t) => String(t));
      if (!(await excepted(page, v.id, targets, route))) nodes.push(n);
    }
    if (!nodes.length) continue;
    findings.push({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: nodes.map((n) => n.target.map(String).join(" ")),
      html: nodes.map((n) => n.html.slice(0, 200)),
      summary: nodes.map((n) => (n.failureSummary ?? "").split("\n").slice(0, 3).join(" ")),
    });
  }
  const dir = process.env.A11Y_REPORT_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const project = test.info().project.name;
    const file = `${project}__${scenario}`.replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 180);
    writeFileSync(
      join(dir, `${file}.json`),
      JSON.stringify({ project, scenario, route, findings }, null, 1),
    );
  }
  return findings;
}

export function formatFindings(findings: AxeFinding[]): string {
  return findings
    .map(
      (f) =>
        `${f.rule} (${f.impact}): ${f.help}\n` +
        f.targets.map((t, i) => `   - ${t}\n     ${f.html[i]}\n     ${f.summary[i]}`).join("\n"),
    )
    .join("\n");
}

export function expectNoViolations(findings: AxeFinding[], where: string): void {
  expect(findings, `${where}\n${formatFindings(findings)}`).toEqual([]);
}
