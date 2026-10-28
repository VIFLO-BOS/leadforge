import { expect, test, type Page } from "@playwright/test";
import { allScenarios, openScenario } from "./a11y-routes";
import { BUSINESS_ID, RUNNING_JOB_ID, mockWorkspaceApi } from "./fixtures";
import { COMPLETED_IMPORT_ID, PROCESSING_IMPORT_ID } from "./fixtures-businesses";
import { RUNNING_ANALYSIS_ID } from "./fixtures-phase4";

/*
 * Screen-reader semantics on every scenario of a11y-routes.ts (at 1440; landmarks and headings do
 * not change with width except where a scenario says so):
 * - one h1, no skipped heading levels (counting only headings exposed to assistive technology);
 * - one main landmark, a banner, named navigation landmarks;
 * - every button and link has an accessible name (icon buttons included);
 * - every table has a caption and scoped column headers;
 * - every status indicator shows an icon and text (never colour alone);
 * - every invalid field points at a non-empty description (form errors via aria-describedby).
 * Plus the live regions for job, import, analysis, enrichment and recompute status, and toasts.
 */

const PROJECTS = new Set(["w1440"]);
test.use({ reducedMotion: "reduce" });
test.describe.configure({ timeout: 90_000 });

interface Audit {
  modal: boolean;
  h1: number;
  skipped: string[];
  mains: number;
  banners: number;
  unnamedNavs: number;
  unnamed: string[];
  tables: string[];
  statuses: string[];
  invalid: string[];
}

/** Collects the semantics problems on the current page state. */
async function audit(page: Page): Promise<Audit> {
  return page.evaluate(() => {
    const exposed = (el: Element) => {
      if (el.closest("[aria-hidden=true], [hidden], [inert]")) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden";
    };
    const nameOf = (el: Element): string => {
      const labelled = el.getAttribute("aria-labelledby");
      if (labelled) {
        return labelled
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
      }
      const own = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "";
      if (own.trim()) return own.trim();
      // Text content that is not hidden, plus alt text of images.
      let text = "";
      const walk = (n: Node) => {
        if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? "";
        else if (n instanceof Element) {
          if (n.getAttribute("aria-hidden") === "true") return;
          if (n instanceof HTMLImageElement) text += n.alt;
          n.childNodes.forEach(walk);
        }
      };
      walk(el);
      // <label for> names any labelable element: inputs, textareas, selects and the <button>s
      // Radix renders for checkboxes, radios and switches.
      const labels = (el as HTMLInputElement).labels;
      if (labels?.length)
        text += Array.from(labels)
          .map((l) => l.textContent ?? "")
          .join(" ");
      return text.trim();
    };
    /** Landmarks are named only by aria-label or aria-labelledby, never by their content. */
    const landmarkName = (el: Element): string =>
      (
        el.getAttribute("aria-label") ??
        (el.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      ).trim();

    // An open modal dialog or sheet locks page scroll (data-scroll-locked) and hides the rest of the
    // page; audit the modal itself. Radix keeps aria-live regions (and their ancestors) exposed, so
    // `main` can stay in the tree while its heading is hidden.
    const modal = document.body.hasAttribute("data-scroll-locked")
      ? Array.from(document.querySelectorAll("[role=dialog], [role=alertdialog]")).find(exposed)
      : undefined;
    const scope: Element = modal ?? document.body;

    const headings = Array.from(
      scope.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]"),
    ).filter(exposed);
    const levels = headings.map((h) => Number(h.getAttribute("aria-level") ?? h.tagName.slice(1)));
    const skipped: string[] = [];
    let prev = modal ? 1 : 0;
    levels.forEach((lvl, i) => {
      if (lvl > prev + 1)
        skipped.push(`h${prev}->h${lvl} "${headings[i]?.textContent?.trim().slice(0, 40)}"`);
      prev = lvl;
    });

    const unnamed = Array.from(
      scope.querySelectorAll(
        "button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=radio], [role=combobox], input:not([type=hidden]), select, textarea",
      ),
    )
      .filter(exposed)
      .filter((el) => !nameOf(el))
      .map((el) => el.outerHTML.slice(0, 120));

    const tables = Array.from(scope.querySelectorAll("table"))
      .filter(exposed)
      .flatMap((t) => {
        const out: string[] = [];
        const caption =
          t.querySelector("caption")?.textContent?.trim() ||
          t.getAttribute("aria-label") ||
          t.getAttribute("aria-labelledby");
        if (!caption) out.push(`table without caption: ${t.outerHTML.slice(0, 80)}`);
        t.querySelectorAll("thead th").forEach((th) => {
          if (th.getAttribute("scope") !== "col")
            out.push(`th without scope=col: ${th.textContent?.trim().slice(0, 30)}`);
        });
        return out;
      });

    const statuses = Array.from(scope.querySelectorAll("[data-status-tone]"))
      .filter(exposed)
      .filter((el) => !el.querySelector("svg") || !(el.textContent ?? "").trim())
      .map((el) => el.outerHTML.slice(0, 120));

    const invalid = Array.from(scope.querySelectorAll("[aria-invalid=true]"))
      .filter(exposed)
      .flatMap((el) => {
        const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        const text = ids
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        return text ? [] : [`${el.getAttribute("id") ?? el.tagName}: no linked error text`];
      });

    return {
      modal: Boolean(modal),
      h1: headings.filter((h, i) => levels[i] === 1).length,
      skipped,
      mains: modal
        ? 1
        : Array.from(document.querySelectorAll("main, [role=main]")).filter(exposed).length,
      banners: modal
        ? 1
        : Array.from(document.querySelectorAll("body > div header, body header")).filter(
            (h) => exposed(h) && !h.closest("main, article, section, aside, nav"),
          ).length,
      unnamedNavs: Array.from(scope.querySelectorAll("nav")).filter(
        (n) => exposed(n) && !landmarkName(n),
      ).length,
      unnamed,
      tables,
      statuses,
      invalid,
    };
  });
}

test.describe("semantics", () => {
  for (const s of allScenarios()) {
    test(`semantics ${s.name}`, async ({ page }, info) => {
      test.skip(!PROJECTS.has(info.project.name), "semantics run at 1440");
      test.skip(
        Boolean(s.when && !s.when(page.viewportSize()?.width ?? 0)),
        "state does not exist at this width",
      );
      await openScenario(page, s);
      const a = await audit(page);
      const where = `${s.name} (${s.path})`;
      // The auth layout and the API-unreachable shell have no site header; everything else does.
      const isAuth = s.api === "auth" || s.group === "auth";
      // With a modal open, its title (h2) heads the exposed content; the page's h1 is hidden.
      if (!a.modal) expect.soft(a.h1, `${where}: exactly one h1`).toBe(1);
      expect.soft(a.skipped, `${where}: skipped heading levels`).toEqual([]);
      expect.soft(a.mains, `${where}: one main landmark`).toBe(1);
      if (!isAuth && s.name !== "shell-api-unreachable") {
        expect.soft(a.banners, `${where}: a banner`).toBeGreaterThanOrEqual(1);
      }
      expect.soft(a.unnamedNavs, `${where}: unnamed nav landmarks`).toBe(0);
      expect.soft(a.unnamed, `${where}: controls without an accessible name`).toEqual([]);
      expect.soft(a.tables, `${where}: tables`).toEqual([]);
      expect.soft(a.statuses, `${where}: status without icon and text`).toEqual([]);
      expect.soft(a.invalid, `${where}: invalid fields without linked errors`).toEqual([]);
    });
  }
});

test.describe("live regions", () => {
  test.beforeEach(() => {
    test.skip(!PROJECTS.has(test.info().project.name), "live regions run at 1440");
  });

  // `expect` omitted: the region starts empty and speaks only on a transition.
  const regions: { path: string; testId: string; expect?: RegExp }[] = [
    { path: `/app/discovery/${RUNNING_JOB_ID}`, testId: "job-live-region" },
    { path: `/app/analysis/${RUNNING_ANALYSIS_ID}`, testId: "analysis-live-region" },
    {
      path: `/app/businesses/import?id=${PROCESSING_IMPORT_ID}`,
      testId: "import-live-region",
      expect: /^Import /,
    },
    {
      path: `/app/businesses/import?id=${COMPLETED_IMPORT_ID}`,
      testId: "import-live-region",
      expect: /^Import /,
    },
    {
      path: `/app/businesses/${BUSINESS_ID}?tab=analysis`,
      testId: "analysis-tab-live-region",
      expect: /^Website analysis /,
    },
    {
      path: `/app/businesses/${BUSINESS_ID}`,
      testId: "enrichment-live-region",
      expect: /^(Contact collection|Email check) /,
    },
  ];
  for (const r of regions) {
    test(`${r.testId} on ${r.path}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(r.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const region = page.getByTestId(r.testId);
      await expect(region).toHaveAttribute("aria-live", "polite");
      await expect(region).toHaveAttribute("aria-atomic", "true");
      if (r.expect) await expect(region).toHaveText(r.expect);
    });
  }

  test("score recompute status is announced", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=scoring");
    const region = page
      .getByTestId("scoring-settings")
      .locator("p[aria-live=polite]")
      .filter({ hasText: /^Score recompute: / });
    await expect(region).toHaveCount(1);
  });

  test("toasts render in a polite live region", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    await page.getByRole("button", { name: "Check email hello@mamaput.example.test" }).click();
    const toast = page.getByText("Checking the email address");
    await expect(toast).toBeVisible();
    const live = await toast.evaluate((el) => el.closest("[aria-live]")?.getAttribute("aria-live"));
    expect(live).toBe("polite");
  });
});
