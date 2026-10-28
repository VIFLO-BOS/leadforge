import { expect, test, type Page } from "@playwright/test";
import { expectControlsFit, expectNoOverflow } from "./assertions";
import {
  BUSINESS_ID,
  BUSINESS_ROUTES,
  DISCOVERY_ROUTES,
  MARKETING_ROUTES,
  PHASE4_ROUTES,
  PHASE5_ROUTES,
  PHASE6_ROUTES,
  SHELL_ROUTES,
  mockWorkspaceApi,
} from "./fixtures";
import { CANDIDATE_ID } from "./fixtures-phase4";
import { BULK_DONE_ID, EXPORT_READY_ID, LIST_ID } from "./fixtures-phase5";

/*
 * Reduced motion, 200% zoom and text spacing.
 *
 * - Reduced motion: every page renders its final state at once. No Lenis (the `lenis` class on
 *   <html>), no running animations once the page settles, no scroll-linked transforms, and no
 *   content left at reveal opacity. With motion allowed, marketing pages do mount Lenis and the
 *   dashboard never does.
 * - 200% zoom at 1280: browser zoom halves the CSS viewport, so 1280x720 at 200% is a 640x360 CSS
 *   viewport at device scale 2. Key dashboard pages reflow without sideways scrolling or clipped
 *   controls (WCAG 1.4.4, 1.4.10).
 * - Text spacing (WCAG 1.4.12): line height 1.5, paragraph spacing 2em, letter spacing 0.12em and
 *   word spacing 0.16em injected; controls must not clip their labels and nothing may overflow.
 *
 * Runs on the w1440 project (it sets its own viewports where needed).
 */

test.describe.configure({ timeout: 90_000 });
test.beforeEach(() => {
  test.skip(test.info().project.name !== "w1440", "runs once, on the w1440 project");
});

const DASHBOARD_ROUTES = [
  ...SHELL_ROUTES,
  ...BUSINESS_ROUTES,
  ...DISCOVERY_ROUTES,
  ...PHASE4_ROUTES,
  ...PHASE5_ROUTES,
  ...PHASE6_ROUTES,
];

/** Text-bearing elements in #main that are still faded out (a reveal that never finished). */
async function fadedContent(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("#main *"))) {
      if (el.closest("[aria-hidden=true], .sr-only, [data-state=closed]")) continue;
      if (
        !el.childNodes.length ||
        !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim())
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Disabled controls sit at the Material 38% tone on purpose (exempt from contrast).
      if (el.closest(":disabled, [aria-disabled=true], [data-disabled]")) continue;
      // A reveal that never finished leaves an inline animation opacity on the text or an
      // ancestor (framer-motion writes style="opacity: …"), or the text near invisible. Softened
      // copy set by a class (opacity-80) is design, not motion.
      let o = 1;
      let inline = false;
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        o *= Number(getComputedStyle(n).opacity);
        if (n.style.opacity !== "" && Number(n.style.opacity) < 0.99) inline = true;
      }
      if (inline || o < 0.3)
        out.push(`${(el.textContent ?? "").trim().slice(0, 40)} (opacity ${o.toFixed(2)})`);
    }
    return out.slice(0, 10);
  });
}

async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      // Indeterminate progress and spinners loop by design and are not entrance motion.
      .filter((a) => Number.isFinite(a.effect?.getTiming().iterations ?? 1))
      .map((a) =>
        a.effect instanceof KeyframeEffect && a.effect.target instanceof Element
          ? a.effect.target.className.toString().slice(0, 60)
          : "?",
      ),
  );
}

test.describe("reduced motion renders final states", () => {
  test.use({ reducedMotion: "reduce" });

  for (const route of MARKETING_ROUTES) {
    test(`marketing ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(
        false,
      );
      // Scroll the whole page: under reduced motion nothing waits for scroll to appear.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      expect(await runningAnimations(page)).toEqual([]);
      expect(await fadedContent(page)).toEqual([]);
      const transforms = await page
        .locator('[data-motion="scroll-linked"]')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));
      for (const t of transforms) expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(t);
    });
  }

  for (const route of DASHBOARD_ROUTES) {
    test(`dashboard ${route}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(
        false,
      );
      expect(await runningAnimations(page)).toEqual([]);
      expect(await fadedContent(page)).toEqual([]);
    });
  }
});

test.describe("with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  test("marketing mounts Lenis; the dashboard keeps native scroll", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis")))
      .toBe(true);
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(
      false,
    );
  });
});

/** Key dashboard pages for the zoom and text-spacing checks. */
const KEY_PAGES = [
  "/app",
  "/app/businesses",
  `/app/businesses/${BUSINESS_ID}`,
  "/app/businesses/import",
  `/app/businesses/duplicates/${CANDIDATE_ID}`,
  "/app/discovery",
  "/app/discovery/new",
  "/app/analysis",
  "/app/usage",
  "/app/settings?tab=scoring",
  "/app/team",
  "/app/pipeline",
  "/app/lists",
  `/app/lists/${LIST_ID}`,
  "/app/activities",
  "/app/outreach",
  "/app/reports",
  `/app/jobs/exports/${EXPORT_READY_ID}`,
  `/app/jobs/bulk/${BULK_DONE_ID}`,
  "/app/billing",
  "/app/billing?tab=plans",
  "/app/billing?tab=payments",
  "/app/settings?tab=pipeline",
  "/app/settings?tab=organization",
] as const;

test.describe("200% zoom at 1280", () => {
  test.use({
    viewport: { width: 640, height: 360 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });

  for (const route of KEY_PAGES) {
    test(`${route}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoOverflow(page, `${route} at 200%`);
      await expectControlsFit(page, `${route} at 200%`);
      // The navigation is still reachable (a drawer behind the menu button at this width).
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expectNoOverflow(page, `${route} at 200%, scrolled`);
    });
  }
});

const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

/** Buttons, links, inputs and tabs whose label no longer fits their box. */
async function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const sel =
      "button, a[href], [role=tab], [role=button], input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest("[aria-hidden=true], .sr-only")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      // Single-line controls that truncate on purpose show the full text in a tooltip or title.
      if (s.textOverflow === "ellipsis") continue;
      const toggle = /^(checkbox|radio|switch)$/.test(el.getAttribute("role") ?? "");
      if (toggle) continue;
      // A typed value longer than its single-line field scrolls under the caret, as every text
      // input does, so nothing is lost (Stage 10: a long organization name in Settings). Only the
      // value can overflow an input; its label is a separate element and is never skipped.
      if (
        el instanceof HTMLInputElement &&
        el.type === "text" &&
        el.value &&
        el.scrollWidth > el.clientWidth + 1
      )
        continue;
      const clipsX = s.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1;
      const clipsY = s.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 2;
      if (clipsX || clipsY) {
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
        out.push(
          `${name}: ${clipsX ? `width ${el.scrollWidth}>${el.clientWidth}` : ""}${clipsY ? ` height ${el.scrollHeight}>${el.clientHeight}` : ""}`,
        );
      }
    }
    return out;
  });
}

for (const width of [1440, 375] as const) {
  test.describe(`text spacing at ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, reducedMotion: "reduce" });

    for (const route of KEY_PAGES) {
      test(`${route}`, async ({ page }) => {
        await mockWorkspaceApi(page);
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.addStyleTag({ content: TEXT_SPACING });
        await page.waitForTimeout(100);
        await expectNoOverflow(page, `${route} with text spacing`);
        expect(await clippedControls(page), `${route}: controls clipped with text spacing`).toEqual(
          [],
        );
      });
    }
  });
}
