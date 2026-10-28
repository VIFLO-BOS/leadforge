import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import http from "node:http";

/*
 * Live end-to-end for Phase 4 against a real API and worker:
 *   1. analyze a business whose website is a local test site (served by this spec),
 *   2. see detections with evidence on the analysis page,
 *   3. collect contacts from the website and find the new observations in provenance,
 *   4. merge a duplicate pair in the review queue and undo the merge,
 *   5. change the scoring weights and watch the recompute finish (the weights are restored after).
 *
 * The worker must map the test host to this spec's server with the development-only override:
 *   SAFE_FETCH_HOST_OVERRIDES="lf-e2e-site.test=127.0.0.1:4299"
 * Skipped unless E2E_LIVE=1; runs once, in the 1440px project. Sign-in from E2E_LIVE_EMAIL and
 * E2E_LIVE_PASSWORD (defaults to the seeded owner).
 */

const LIVE = process.env.E2E_LIVE === "1";
const EMAIL = process.env.E2E_LIVE_EMAIL ?? "owner@example.test";
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? "synthetic-owner-pass-2026";
const SITE_HOST = process.env.E2E_SITE_HOST ?? "lf-e2e-site.test";
const SITE_PORT = Number(process.env.E2E_SITE_PORT ?? 4299);

interface Org {
  id: string;
  name: string;
  role: string;
}

function siteHtml(path: string, phone: string): string | null {
  const national = `0${phone.slice(4, 7)} ${phone.slice(7, 10)} ${phone.slice(10)}`;
  if (path === "/robots.txt") return "User-agent: *\nAllow: /\n";
  if (path === "/") {
    return `<!doctype html><html><head><title>E2E Kitchen (Sample)</title>
<meta name="generator" content="WordPress 4.9.8"></head>
<body><table width="1024"><tr><td>
<h1>E2E Kitchen (Sample)</h1>
<p>Home-cooked meals in Ikeja. Call us on <a href="tel:${phone}">${national}</a>.</p>
<p><a href="https://wa.me/${phone.slice(1)}">Chat on WhatsApp</a></p>
<p><a href="/contact">Contact</a> <a href="/about">About</a></p>
<p><a href="https://instagram.com/e2ekitchen.sample">Instagram</a></p>
</td></tr></table></body></html>`;
  }
  if (path === "/contact") {
    return `<!doctype html><html><head><title>Contact E2E Kitchen (Sample)</title></head>
<body><h1>Contact</h1><p>Email <a href="mailto:hello@${SITE_HOST}">hello@${SITE_HOST}</a></p>
<p>WhatsApp: ${national}</p></body></html>`;
  }
  if (path === "/about") {
    return `<!doctype html><html><head><title>About (Sample)</title></head><body><p>Family business since 2010.</p></body></html>`;
  }
  return null;
}

async function startSite(phone: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const body = siteHtml(path, phone);
    if (body === null) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": path === "/robots.txt" ? "text/plain" : "text/html; charset=utf-8",
    });
    res.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(SITE_PORT, "127.0.0.1", resolve);
  });
  return server;
}

async function csrf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return decodeURIComponent(cookies.find((c) => c.name === "lf_csrf")?.value ?? "");
}

async function api<T>(
  page: Page,
  method: "GET" | "POST" | "PATCH",
  path: string,
  orgId: string,
  body?: unknown,
): Promise<T> {
  const request: APIRequestContext = page.request;
  const headers: Record<string, string> = { "X-Organization-Id": orgId };
  if (method !== "GET") headers["X-CSRF-Token"] = await csrf(page);
  const res = await request.fetch(`/api/v1${path}`, { method, headers, data: body });
  expect(res.ok(), `${method} ${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: T }).data;
}

async function pickOrg(page: Page): Promise<Org> {
  const me = await page.request.get("/api/v1/auth/me");
  const orgs = ((await me.json()) as { data: { organizations: Org[] } }).data.organizations.filter(
    (o) => ["owner", "admin"].includes(o.role),
  );
  let best: { org: Org; balance: number } | null = null;
  for (const org of orgs) {
    const b = await api<{ balance: number }>(page, "GET", "/credits/balance", org.id);
    if (!best || b.balance > best.balance) best = { org, balance: b.balance };
  }
  if (!best) throw new Error("The signed-in user is not an owner or admin of any organization");
  expect(
    best.balance,
    "The organization needs at least 2 credits for the analyses",
  ).toBeGreaterThanOrEqual(2);
  return best.org;
}

test.describe("live: Phase 4 end to end", () => {
  test.skip(!LIVE, "Set E2E_LIVE=1 with the API and worker running to run the live spec.");
  test.setTimeout(420_000);

  let server: http.Server | null = null;
  test.afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  test("analysis with evidence, contact collection, merge and undo, scoring recompute", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "w1440", "The live flow runs once, at 1440px.");
    const run = Date.now().toString(36);
    const digits = String(Date.now()).slice(-7);
    const phone = `+234803${digits}`;
    server = await startSite(phone);

    // Sign in and choose the workspace.
    await page.goto("/sign-in");
    await page.locator("input[type=email]").fill(EMAIL);
    await page.locator("input[type=password]").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app$/, { timeout: 60_000 });
    const org = await pickOrg(page);
    await page.evaluate((id) => window.localStorage.setItem("lf.activeOrg", id), org.id);

    // Two businesses that share a phone in the same place: A has the test site as its website.
    const a = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
      name: `E2E Kitchen ${run} (Sample)`,
      website: `http://${SITE_HOST}`,
      phones: [phone],
      location: { locality: "Ikeja", region: "Lagos" },
      categories: ["Restaurant"],
    });
    const b = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
      name: `E2E Kitchens ${run} Ikeja (Sample)`,
      phones: [phone],
      location: { locality: "Ikeja", region: "Lagos" },
      categories: ["Restaurant"],
    });

    // 1. Run a website analysis from the business page (1 credit, confirmed).
    await page.goto(`/app/businesses/${a.id}?tab=analysis`);
    const tab = page.getByTestId("analysis-tab");
    await tab.getByRole("button", { name: /Run website analysis/ }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /Run analysis/ })
      .click();
    await expect(page.getByText("Website analysis queued")).toBeVisible();
    await expect(tab.getByRole("link", { name: /Open full analysis/ })).toBeVisible({
      timeout: 180_000,
    });

    // 2. The analysis page lists every detection with evidence, and the credit settled.
    await tab.getByRole("link", { name: /Open full analysis/ }).click();
    await expect(page.getByTestId("analysis-status-line")).toContainText("Completed", {
      timeout: 30_000,
    });
    const detections = page.getByRole("list", { name: "Detections" });
    await expect(detections.locator("[data-detection]")).toHaveCount(9);
    await expect(detections.locator('[data-detection="no_contact_form"]')).toHaveAttribute(
      "data-observed",
      "yes",
    );
    await expect(detections.locator('[data-detection="no_whatsapp_link"]')).toHaveAttribute(
      "data-observed",
      "no",
    );
    await expect(detections.locator('[data-detection="outdated_platform"]')).toContainText(
      "WordPress 4.9.8",
    );
    expect(await detections.getByRole("list", { name: "Evidence" }).count()).toBeGreaterThan(5);
    await expect(page.getByTestId("analysis-credits")).toContainText("Settled");
    await expect(page.getByTestId("analysis-pages")).toContainText(`${SITE_HOST}/contact`);

    // 3. Collect contacts from the website and find the new observations in provenance.
    await page.goto(`/app/businesses/${a.id}`);
    const collection = page.getByTestId("contact-collection");
    await collection.getByRole("button", { name: /Find contacts on website/ }).click();
    await expect(
      collection.locator('[data-run-kind="website_contacts"][data-run-status="completed"]').first(),
    ).toBeVisible({
      timeout: 120_000,
    });
    await expect(collection).toContainText(/found/);
    await page.goto(`/app/businesses/${a.id}?tab=provenance`);
    const timeline = page.getByRole("list", { name: "Observations, newest first" });
    await expect(timeline.locator('[data-observation-source="website"]').first()).toBeVisible({
      timeout: 30_000,
    });

    // 4. Merge the duplicate pair from the review queue, then undo it.
    await api(page, "POST", "/dedup/scan", org.id, { businessIds: [a.id, b.id] });
    let candidateId: string | null = null;
    await expect
      .poll(
        async () => {
          const list = await api<{ id: string; businessIds: string[] }[]>(
            page,
            "GET",
            `/dedup/candidates?businessId=${a.id}&status=pending`,
            org.id,
          );
          candidateId = list.find((c) => c.businessIds.includes(b.id))?.id ?? null;
          return candidateId;
        },
        { timeout: 90_000, intervals: [2_000] },
      )
      .not.toBeNull();
    await page.goto("/app/businesses/duplicates");
    await page.locator(`a[href="/app/businesses/duplicates/${candidateId}"]`).first().click();
    await expect(page.getByTestId("candidate-compare")).toContainText(
      `E2E Kitchens ${run} Ikeja (Sample)`,
    );
    await page.getByRole("button", { name: /Merge/ }).first().click();
    const dialog = page.getByTestId("merge-dialog");
    await dialog
      .getByRole("radiogroup", { name: "Surviving record" })
      .getByRole("radio", { name: `E2E Kitchen ${run} (Sample)` })
      .check();
    await dialog.getByRole("button", { name: /Merge businesses/ }).click();
    await expect(page.getByText("Businesses merged")).toBeVisible();
    await page.waitForURL(
      (url) => url.pathname === `/app/businesses/${a.id}` && url.search.includes("tab=duplicates"),
    );
    const history = page.getByRole("list", { name: "Merge history" });
    await history
      .getByRole("button", { name: /Undo merge/ })
      .first()
      .click();
    await page
      .getByRole("alertdialog", { name: "Undo this merge?" })
      .getByRole("button", { name: "Undo merge" })
      .click();
    // Scores or enrichment may have touched a record after the merge: then undo needs force.
    const force = page.getByRole("alertdialog", { name: "These records changed after the merge" });
    const undone = page.getByText("Merge undone");
    await expect(force.or(undone).first()).toBeVisible({ timeout: 30_000 });
    if (await force.isVisible()) await force.getByRole("button", { name: "Undo anyway" }).click();
    await expect(undone).toBeVisible();
    const restored = await api<{ id: string }>(page, "GET", `/businesses/${b.id}`, org.id);
    expect(restored.id).toBe(b.id);

    // 5. Change the scoring weights and watch the recompute finish; restore them afterwards.
    const before = await api<{ weights: Record<string, number>; version: number }>(
      page,
      "GET",
      "/scoring/profile",
      org.id,
    );
    try {
      await page.goto("/app/settings?tab=scoring");
      const settings = page.getByTestId("scoring-settings");
      const freshness = settings.getByLabel("Freshness");
      const reliability = settings.getByLabel("Source reliability");
      const f = before.weights.freshness ?? 10;
      const r = before.weights.sourceReliability ?? 5;
      const shift = f > 0 ? 1 : -1;
      await freshness.fill(String(f - shift));
      await reliability.fill(String(r + shift));
      await expect(settings.getByTestId("weights-total")).toContainText("100 of 100");
      await settings.getByRole("button", { name: /Save and recompute scores/ }).click();
      await expect(page.getByText("Scoring profile saved")).toBeVisible();
      await expect(settings.getByTestId("recompute-status")).toHaveText("Scores are up to date", {
        timeout: 180_000,
      });
      const after = await api<{
        version: number;
        recompute: { status: string; profileVersion: number };
      }>(page, "GET", "/scoring/profile", org.id);
      expect(after.version).toBe(before.version + 1);
      expect(after.recompute).toMatchObject({ status: "completed", profileVersion: after.version });
    } finally {
      const current = await api<{ version: number }>(page, "GET", "/scoring/profile", org.id);
      await api(page, "PATCH", "/scoring/profile", org.id, {
        version: current.version,
        weights: before.weights,
      });
    }
  });
});
