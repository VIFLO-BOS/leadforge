import { expect, test, type Page } from "@playwright/test";
import { MARKETING_ROUTES, horizontalOverflow } from "./fixtures";

/*
 * Marketing pages with reduced motion on and off. Both modes must paint the hero heading at full
 * opacity on load (LCP never waits on an animation), stay free of horizontal overflow while
 * scrolled through, and raise no runtime errors. Under reduced motion, scroll-linked elements
 * (data-motion="scroll-linked") must sit in their final, untransformed state.
 */

/** Browser noise from the deliberately unreachable API is not an application error. */
function isIgnorable(text: string): boolean {
  // Next also logs when an in-flight RSC prefetch is aborted because the test navigates or ends.
  return /Failed to load resource|ERR_CONNECTION_REFUSED|\/api\/v1\/|Failed to fetch RSC payload/i.test(
    text,
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isIgnorable(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

async function effectiveOpacity(page: Page): Promise<number> {
  return page
    .getByRole("heading", { level: 1 })
    .first()
    .evaluate((el) => {
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity);
      }
      return opacity;
    });
}

async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => Math.max(200, Math.round(window.innerHeight * 0.6)));
  for (let y = 0; y <= height; y += step) {
    await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: "instant" }), y);
    await page.waitForTimeout(60);
    const o = await horizontalOverflow(page);
    expect(o.scrollWidth, `overflow at scrollY=${y}`).toBeLessThanOrEqual(o.innerWidth);
  }
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: "instant" }),
  );
}

for (const mode of ["reduce", "no-preference"] as const) {
  test.describe(`marketing with reduced motion: ${mode}`, () => {
    test.use({ reducedMotion: mode });

    for (const route of MARKETING_ROUTES) {
      test(`${route}`, async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto(route);
        const h1 = page.getByRole("heading", { level: 1 }).first();
        await expect(h1).toBeVisible();
        expect(await effectiveOpacity(page)).toBe(1);

        const o = await horizontalOverflow(page);
        expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth);

        await scrollThrough(page);

        if (mode === "reduce") {
          const transforms = await page
            .locator('[data-motion="scroll-linked"]')
            .evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));
          for (const t of transforms) {
            expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(t);
          }
        }

        expect(errors, errors.join("\n")).toEqual([]);
      });
    }
  });
}
