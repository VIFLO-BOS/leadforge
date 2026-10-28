import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Shared helpers of the release suite. Everything here talks to the live stack started by
 * infra/e2e/release-stack.mjs: the web app (same-origin /api/v1 calls with the browser's own
 * cookies and CSRF token), Mailpit's HTTP API and the fixture server's /__e2e/ control routes.
 * Nothing is mocked.
 */

export const RELEASE = process.env.E2E_RELEASE === "1";
export const FIXTURE_URL = process.env.E2E_FIXTURE_URL ?? "http://127.0.0.1:4310";
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
export const PASSWORD = process.env.E2E_SEED_PASSWORD ?? "release-e2e-pass-2026";
export const AUTH_DIR = resolve(process.env.E2E_AUTH_DIR ?? "test-results/release-auth");
const SCREENS_DIR = process.env.E2E_SCREENS_DIR ?? null;

export type ProjectKey = "w1440" | "w375" | "smoke";
export type SeededRole = "owner" | "rep" | "rival";

/** Skips the whole file unless the live release stack is running. */
export function releaseOnly(): void {
  test.skip(!RELEASE, "Set E2E_RELEASE=1 with the release stack running (pnpm e2e:release).");
}

export function projectKey(info: TestInfo): ProjectKey {
  const name = info.project.name;
  if (name === "release-1440") return "w1440";
  if (name === "release-375") return "w375";
  return "smoke";
}

export function isPhone(info: TestInfo): boolean {
  return (info.project.use.viewport?.width ?? 1440) < 768;
}

/** Seeded users (apps/api/src/scripts/seed-e2e.ts): one organization per project key. */
export function seededEmail(role: SeededRole, key: ProjectKey): string {
  return `${role}.${key}@e2e.example.test`;
}

export function storageStatePath(role: SeededRole, key: ProjectKey): string {
  return join(AUTH_DIR, `${role}-${key}.json`);
}

/** A run id that makes names unique across reruns on the same databases. */
export function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** A browser context signed in as a seeded user (sessions stored by the setup project). */
export async function sessionFor(
  browser: Browser,
  info: TestInfo,
  role: SeededRole,
): Promise<{ context: BrowserContext; page: Page }> {
  const key = projectKey(info);
  const context = await browser.newContext({
    ...info.project.use,
    storageState: storageStatePath(role, key),
  });
  const page = await context.newPage();
  return { context, page };
}

// ---------------------------------------------------------------------------- API

export interface Org {
  id: string;
  name: string;
  role: string;
}

export async function csrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return decodeURIComponent(cookies.find((c) => c.name === "lf_csrf")?.value ?? "");
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A same-origin API call with the page's cookies; returns the raw response. */
export async function call(
  page: Page,
  method: Method,
  path: string,
  orgId: string | null,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extra };
  if (orgId) headers["X-Organization-Id"] = orgId;
  if (method !== "GET") headers["X-CSRF-Token"] = await csrfToken(page);
  return page.request.fetch(`/api/v1${path}`, { method, headers, data: body });
}

/** A same-origin API call that must succeed; returns `data` from the envelope. */
export async function api<T>(
  page: Page,
  method: Method,
  path: string,
  orgId: string | null,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<T> {
  const res = await call(page, method, path, orgId, body, extra);
  expect(res.ok(), `${method} ${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  if (res.status() === 204) return undefined as T;
  return ((await res.json()) as { data: T }).data;
}

/** Every page of a cursor-paged list endpoint. */
export async function apiAll<T>(page: Page, path: string, orgId: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await call(
      page,
      "GET",
      `${path}${cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ""}`,
      orgId,
    );
    expect(res.ok(), `GET ${path} answered ${res.status()}`).toBe(true);
    const json = (await res.json()) as { data: T[]; meta?: { nextCursor?: string | null } };
    out.push(...json.data);
    cursor = json.meta?.nextCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

export async function me(
  page: Page,
): Promise<{ user: { id: string; name: string; email: string }; organizations: Org[] }> {
  return api(page, "GET", "/auth/me", null);
}

/** The single organization of a seeded user (or the one with this role). */
export async function primaryOrg(page: Page, role?: string): Promise<Org> {
  const data = await me(page);
  const org = role ? data.organizations.find((o) => o.role === role) : data.organizations[0];
  if (!org)
    throw new Error(`No organization${role ? ` with role ${role}` : ""} for ${data.user.email}`);
  return org;
}

/**
 * Sign in through the form (on the current sign-in page, keeping its `next`, or a fresh one).
 * Waits out the per-address sign-in limit if a run hits it.
 */
export async function signInThroughForm(
  page: Page,
  email: string,
  password: string = PASSWORD,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0 || new URL(page.url(), "http://x").pathname !== "/sign-in")
      await page.goto("/sign-in");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const outcome = await Promise.race([
      page.waitForURL(/\/app(\/|$|\?)/, { timeout: 60_000 }).then(() => "in" as const),
      page
        .getByTestId("sign-in-error")
        .waitFor({ timeout: 60_000 })
        .then(() => "error" as const),
    ]);
    if (outcome === "in") return;
    const text = (await page.getByTestId("sign-in-error").textContent()) ?? "";
    if (!/too many|try again/i.test(text)) throw new Error(`Sign-in failed: ${text}`);
    const seconds = Number(/in (\d+) seconds?/.exec(text)?.[1] ?? 60);
    await page.waitForTimeout((Math.min(seconds, 90) + 1) * 1000);
  }
  throw new Error("Sign-in stayed rate limited");
}

// ---------------------------------------------------------------------------- Mailpit

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
  To: { Address: string }[];
}

/** The newest mail to `to` whose subject matches, polled from Mailpit's API. */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  subject: RegExp,
  timeoutMs = 90_000,
): Promise<{ id: string; subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request.get(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`,
    );
    if (res.ok()) {
      const list = ((await res.json()) as { messages: MailSummary[] }).messages ?? [];
      const hit = list.find((m) => subject.test(m.Subject));
      if (hit) {
        const full = (await (
          await request.get(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)
        ).json()) as { Subject: string; Text: string; HTML: string };
        return { id: hit.ID, subject: full.Subject, text: full.Text ?? "", html: full.HTML ?? "" };
      }
    }
    if (Date.now() > deadline)
      throw new Error(`No mail to ${to} matching ${subject} within ${timeoutMs / 1000} s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The first link in a mail's text that starts with the app's base URL and contains `path`. */
export function linkIn(mail: { text: string; html: string }, path: string): string {
  const urls = `${mail.text}\n${mail.html}`.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const found = urls.map((u) => u.replace(/&amp;/g, "&")).find((u) => u.includes(path));
  if (!found) throw new Error(`No ${path} link in the mail`);
  return found;
}

// ---------------------------------------------------------------------------- fixture server

export async function fixture<T = unknown>(
  request: APIRequestContext,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await request.fetch(`${FIXTURE_URL}${path}`, { method, data: body });
  expect(res.ok(), `fixture ${method} ${path} answered ${res.status()}: ${await res.text()}`).toBe(
    true,
  );
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------- layout and evidence

/** Criterion 15: the page never scrolls sideways at this width. */
export async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    o.scrollWidth,
    `${where}: the page scrolls sideways (${o.scrollWidth} > ${o.innerWidth})`,
  ).toBeLessThanOrEqual(o.innerWidth);
}

/** A screenshot of the release flow, when E2E_SCREENS_DIR is set. */
export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SCREENS_DIR) return;
  mkdirSync(SCREENS_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENS_DIR, `${info.project.name}-${name}.png`) });
}

/** Opens the app navigation on narrow screens (the drawer is a sheet below 1024px). */
export async function openNav(page: Page): Promise<void> {
  const open = page.getByRole("button", { name: "Open navigation" });
  if (await open.isVisible()) await open.click();
}

/** The value of a `<dt>label</dt><dd>value</dd>` pair inside a panel. */
export function countIn(panel: Locator, label: string): Locator {
  return panel.locator(`xpath=.//dt[normalize-space()="${label}"]/following-sibling::dd[1]`);
}

/** The shown value of a KPI tile (packages/ui Stat), by its label. */
export async function statValue(scope: Page | Locator, label: string): Promise<string> {
  const value = scope.locator(`[data-stat="${label}"] [data-stat-value]`).first();
  await expect(value).toBeVisible();
  return ((await value.textContent()) ?? "").trim();
}

/** A DataTable by its caption: a table from 480 px, a list of cards below (packages/ui DataTable). */
export function dataTable(scope: Page | Locator, caption: string): Locator {
  return scope.getByRole("table", { name: caption }).or(scope.getByRole("list", { name: caption }));
}

/** Selects every row on the page: the header checkbox on a table, each card's checkbox on phones. */
export async function selectAllRows(page: Page): Promise<void> {
  const all = page.getByRole("checkbox", { name: "Select all rows on this page" });
  if (await all.isVisible()) {
    await all.check();
    return;
  }
  const rows = page.locator("#main").getByRole("checkbox", { name: /^Select row \d+$/ });
  const n = await rows.count();
  expect(n, "selectable rows").toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await rows.nth(i).check();
}

/**
 * Waits until no toast covers the page (they sit over content at the bottom on phones). Toasts
 * pause while the pointer rests on them, and after a tap the pointer stays where the button was,
 * so it is moved to the top corner first, as a person's finger would lift.
 */
export async function toastsGone(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
}

/** A toast by its text (a polite live region may repeat the same words for screen readers). */
export function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
}
