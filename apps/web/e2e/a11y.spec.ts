import { test } from "@playwright/test";
import {
  expectNoViolations,
  formatFindings,
  runAxe,
  setTheme,
  type AxeFinding,
} from "./a11y-helpers";
import { allScenarios, openScenario } from "./a11y-routes";

/*
 * Automated accessibility: axe (WCAG 2.0 and 2.1, A and AA, plus the structure rules in
 * a11y-helpers.ts) on every marketing, legal, auth and dashboard page and on every reachable
 * dialog, sheet, popover, wizard step, empty, error and role state (a11y-routes.ts).
 *
 * Runs at 375 and 1440 (the w375 and w1440 projects; other projects skip), each in light and dark.
 * Reduced motion is on so content is measured in its final state: scroll-triggered reveals would
 * otherwise sit at opacity 0 below the fold and axe would skip them.
 *
 *   PLAYWRIGHT_PORT=3300 pnpm exec playwright test a11y.spec --project=w375 --project=w1440
 *   A11Y_REPORT_DIR=<dir> ... writes every scenario's findings as JSON for a by-rule summary.
 */

const PROJECTS = new Set(["w375", "w1440"]);

test.use({ reducedMotion: "reduce" });
test.describe.configure({ timeout: 120_000 });

const scenarios = allScenarios();

for (const group of Array.from(new Set(scenarios.map((s) => s.group)))) {
  test.describe(`axe ${group}`, () => {
    for (const s of scenarios.filter((x) => x.group === group)) {
      test(`axe ${s.name}`, async ({ page }, info) => {
        test.skip(!PROJECTS.has(info.project.name), "axe runs at 375 and 1440");
        const width = page.viewportSize()?.width ?? 0;
        test.skip(Boolean(s.when && !s.when(width)), "state does not exist at this width");

        await page.emulateMedia({ colorScheme: "light" });
        await openScenario(page, s);

        const all: { theme: string; findings: AxeFinding[] }[] = [];
        for (const theme of ["light", "dark"] as const) {
          await setTheme(page, theme);
          all.push({ theme, findings: await runAxe(page, `${s.name}__${theme}`) });
        }
        const failing = all.filter((r) => r.findings.length);
        expectNoViolations(
          failing.flatMap((r) => r.findings),
          failing.map((r) => `[${r.theme}] ${s.path}\n${formatFindings(r.findings)}`).join("\n"),
        );
      });
    }
  });
}
