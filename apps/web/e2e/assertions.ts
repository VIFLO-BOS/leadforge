import { expect, type Page } from "@playwright/test";
import { horizontalOverflow } from "./fixtures";

/* Assertions shared by the viewport, behaviour and motion specs. */

export async function expectNoOverflow(page: Page, where: string) {
  const o = await horizontalOverflow(page);
  expect(o.scrollWidth, `${where}: ${o.scrollWidth} > ${o.innerWidth}`).toBeLessThanOrEqual(
    o.innerWidth,
  );
}

/** An open dialog must not scroll sideways either. Confirmations are `alertdialog`s. */
export async function expectDialogFits(page: Page, role: "dialog" | "alertdialog" = "dialog") {
  const dialog = page.getByRole(role).last();
  await expect(dialog).toBeVisible();
  const box = await dialog.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    right: el.getBoundingClientRect().right,
    vw: window.innerWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
  expect(box.right).toBeLessThanOrEqual(box.vw + 1);
}

/**
 * Buttons and links must show their whole label and stay inside the content area at every width
 * (page overflow alone misses a button that is clipped by its card). Controls inside horizontal
 * scroll containers (tables, tab lists) are allowed to extend past the edge.
 */
export async function expectControlsFit(page: Page, where: string) {
  const problems = await page.evaluate(() => {
    const main = document.querySelector("#main");
    if (!main) return ["no #main"];
    const right = main.getBoundingClientRect().right;
    const out: string[] = [];
    for (const el of Array.from(main.querySelectorAll<HTMLElement>("button, a"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Tables and tab lists scroll sideways; breadcrumbs truncate by design (the page title
      // carries the full name).
      if (
        el.closest(
          '[role="region"], [role="tablist"], [aria-hidden="true"], nav[aria-label="Breadcrumb"]',
        )
      ) {
        continue;
      }
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
      if (r.right > right + 1)
        out.push(`${name}: right ${Math.round(r.right)} > ${Math.round(right)}`);
      const parent = el.parentElement?.getBoundingClientRect();
      if (parent && parent.width > 0 && r.right > parent.right + 1) {
        out.push(`${name}: sticks out of its container by ${Math.round(r.right - parent.right)}px`);
      }
      // Checkboxes, radios and switches extend a 40px hit-area halo past their box on purpose.
      const toggle = /^(checkbox|radio|switch)$/.test(el.getAttribute("role") ?? "");
      if (!toggle && el.scrollWidth > el.clientWidth + 1) {
        out.push(`${name}: clipped ${el.scrollWidth} > ${el.clientWidth}`);
      }
    }
    return out;
  });
  expect(problems, `${where}: ${problems.join("; ")}`).toEqual([]);
}
