import { expect, type Locator, type Page } from "@playwright/test";

/*
 * Keyboard-only helpers: every interaction goes through page.keyboard, never the mouse.
 */

export interface FocusInfo {
  ok: boolean;
  tag: string;
  role: string | null;
  name: string;
  landmark: string;
  why: string;
}

/**
 * Describes the focused element and whether it shows a visible focus indicator. Focus styles
 * transition over 200 to 300 ms (DESIGN_SYSTEM motion rules), so the check first waits for the
 * element's running CSS transitions to finish and judges the settled state, not a frame in
 * between. Only transitions are awaited (they always end), never animations.
 *
 * Stage 9: this made the old flaky stop deterministic. Tabbing through a datetime-local field
 * ends on its calendar button, where the input no longer matches :focus; the field's focus styles
 * faded out over 200 ms, and the check passed only when it read them mid-fade. Fields now key
 * their focus styles on :focus-within (packages/ui `fieldClasses`), so the indicator stays.
 */
export async function focusInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate(async () => {
    const focused = document.activeElement as HTMLElement | null;
    if (focused && typeof focused.getAnimations === "function") {
      const transitions = focused
        .getAnimations()
        .filter((a) => typeof CSSTransition !== "undefined" && a instanceof CSSTransition);
      if (transitions.length) {
        await Promise.race([
          Promise.all(transitions.map((a) => a.finished.catch(() => undefined))),
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    }
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) {
      return {
        ok: false,
        tag: "body",
        role: null,
        name: "",
        landmark: "none",
        why: "focus is on <body>",
      };
    }
    const s = getComputedStyle(el);
    const outline =
      s.outlineStyle !== "none" &&
      parseFloat(s.outlineWidth) >= 2 &&
      !/rgba\(0, 0, 0, 0\)|transparent/.test(s.outlineColor);
    // Fields thicken their outline with an inset shadow; tabs and chips use rings (box-shadow).
    const shadow = s.boxShadow !== "none" && s.boxShadow !== "";
    // Radix menu, listbox and select items show focus as a highlighted container, which must
    // actually differ from the popup's own background.
    const popup = el.closest("[role=menu], [role=listbox]");
    const popupBg = popup ? getComputedStyle(popup).backgroundColor : "";
    const highlighted =
      (el.hasAttribute("data-highlighted") || el.getAttribute("aria-selected") === "true") &&
      !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) &&
      s.backgroundColor !== popupBg;
    const visible =
      el.matches(":focus-visible") || el.tagName === "INPUT" || el.tagName === "TEXTAREA";
    // Overlays first, then main (which holds its own navs: breadcrumbs, pagination, steppers).
    const overlay = el.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]");
    const landmark = overlay
      ? (overlay.getAttribute("role") ?? "overlay")
      : el.closest("main")
        ? "main"
        : el.closest("header")
          ? "header"
          : el.closest("nav")
            ? "nav"
            : el.closest("footer")
              ? "footer"
              : el.getAttribute("href") === "#main"
                ? "skip"
                : "other";
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    const ok = visible && (outline || shadow || highlighted);
    return {
      ok,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      name,
      landmark,
      why: ok
        ? ""
        : `no focus indicator (outline ${s.outlineStyle} ${s.outlineWidth}, shadow ${s.boxShadow}, :focus-visible ${el.matches(":focus-visible")})`,
    };
  });
}

/** Fails unless the focused element shows a focus indicator (2px ring, field outline or highlight). */
export async function expectFocusVisible(page: Page, where = ""): Promise<void> {
  const info = await focusInfo(page);
  expect(info.ok, `${where} focused <${info.tag}> "${info.name}": ${info.why}`).toBe(true);
}

async function isFocused(target: Locator): Promise<boolean> {
  return target
    .evaluate((el) => el === document.activeElement, undefined, { timeout: 1_000 })
    .catch(() => false);
}

/**
 * Checks the stop the last Tab press reached. Focus on <body> means either the end of the tab
 * order (focus went to the browser UI; the next Tab wraps to the skip link, which is fine) or that
 * the focused element vanished, which is a defect: the next Tab then continues mid-page.
 * Returns "wrapped" at the end of the document.
 */
async function checkStop(page: Page, label: string, reverse: boolean): Promise<"ok" | "wrapped"> {
  const info = await focusInfo(page);
  if (info.tag !== "body") {
    expect(info.ok, `${label} focused <${info.tag}> "${info.name}": ${info.why}`).toBe(true);
    return "ok";
  }
  await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
  const next = await focusInfo(page);
  if (!reverse) {
    expect(
      next.landmark,
      `${label}: focus fell to <body> mid-page (the focused element disappeared); the next Tab went to <${next.tag}> "${next.name}" instead of wrapping to the skip link`,
    ).toBe("skip");
  }
  return "wrapped";
}

/**
 * Presses Tab (or Shift+Tab) until `target` has focus, checking a visible focus indicator at every
 * stop. Fails after `max` presses, which also proves the target is reachable by keyboard.
 */
export async function tabTo(
  page: Page,
  target: Locator,
  {
    max = 80,
    reverse = false,
    checkEachStop = true,
  }: { max?: number; reverse?: boolean; checkEachStop?: boolean } = {},
): Promise<void> {
  for (let i = 0; i <= max; i++) {
    if (await isFocused(target)) {
      await expectFocusVisible(page, `tabTo target`);
      return;
    }
    await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
    if (checkEachStop) await checkStop(page, `tab stop ${i + 1}`, reverse);
  }
  const info = await focusInfo(page);
  throw new Error(
    `Could not reach the target with ${max} Tab presses; focus is on <${info.tag}> "${info.name}"`,
  );
}

/**
 * Records up to `steps` Tab stops from the current focus, stopping at the end of the document.
 * Fails if focus is lost to <body> mid-page.
 */
export async function tabSequence(page: Page, steps: number): Promise<FocusInfo[]> {
  const out: FocusInfo[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const info = await focusInfo(page);
    if (info.tag === "body") {
      await checkStop(page, `stop ${i + 1}`, false);
      break;
    }
    out.push(info);
  }
  return out;
}

/** Focus stays inside `container` for `presses` Tabs forwards and backwards (a modal focus trap). */
export async function expectFocusTrapped(
  page: Page,
  container: Locator,
  presses = 12,
): Promise<void> {
  for (const key of ["Tab", "Shift+Tab"] as const) {
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(key);
      const inside = await container.evaluate((el) => el.contains(document.activeElement));
      const info = await focusInfo(page);
      expect(
        inside,
        `${key} #${i + 1} left the dialog: focus on <${info.tag}> "${info.name}"`,
      ).toBe(true);
    }
  }
}

/** The focused element is inside `container`. */
export async function expectFocusWithin(container: Locator): Promise<void> {
  await expect
    .poll(() => container.evaluate((el) => el.contains(document.activeElement)), { timeout: 5_000 })
    .toBe(true);
}

/** Escape closes `layer` and focus returns to `trigger`. */
export async function expectEscapeRestores(
  page: Page,
  layer: Locator,
  trigger: Locator,
): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(layer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectFocusVisible(page, "restored trigger");
}

/**
 * Presses a key the way a person does, holding it briefly. Radix radio groups check an item on
 * focus only while the arrow key is still down, and move focus in a timeout, so an instant
 * down/up can lose that race on a loaded machine.
 */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(80);
  await page.keyboard.up(key);
}

/** Selects the field's text and types, as a keyboard user replacing a value. */
export async function replaceValue(page: Page, text: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
}
