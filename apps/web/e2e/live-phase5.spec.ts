import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/*
 * Live end-to-end for Phase 5 against a real API and worker:
 *   1. create a lead list and add businesses to it,
 *   2. assign a lead,
 *   3. move its stage with the keyboard,
 *   4. log a call,
 *   5. run a bulk assign to completion,
 *   6. export the list asynchronously and download the ZIP (it must hold the CSV and ATTRIBUTION.txt),
 *   7. open the reports.
 * Skipped unless E2E_LIVE=1; runs once, in the 1440px project. Sign-in from E2E_LIVE_EMAIL and
 * E2E_LIVE_PASSWORD (defaults to the seeded owner). Every record it creates is "(Sample)".
 */

const LIVE = process.env.E2E_LIVE === "1";
const EMAIL = process.env.E2E_LIVE_EMAIL ?? "owner@example.test";
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? "synthetic-owner-pass-2026";

interface Org {
  id: string;
  name: string;
  role: string;
}

async function csrf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return decodeURIComponent(cookies.find((c) => c.name === "lf_csrf")?.value ?? "");
}

async function api<T>(
  page: Page,
  method: "GET" | "POST",
  path: string,
  orgId: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { "X-Organization-Id": orgId };
  if (method !== "GET") headers["X-CSRF-Token"] = await csrf(page);
  const res = await page.request.fetch(`/api/v1${path}`, { method, headers, data: body });
  expect(res.ok(), `${method} ${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: T }).data;
}

/** File names in a ZIP's central directory (no dependency: the format is simple enough). */
function zipEntryNames(buf: Buffer): string[] {
  const names: string[] = [];
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = buf.readUInt16LE(i + 28);
    const extraLength = buf.readUInt16LE(i + 30);
    const commentLength = buf.readUInt16LE(i + 32);
    names.push(buf.subarray(i + 46, i + 46 + nameLength).toString("utf8"));
    i += 45 + nameLength + extraLength + commentLength;
  }
  return names;
}

test.describe("live: Phase 5 end to end", () => {
  test.skip(!LIVE, "Set E2E_LIVE=1 with the API and worker running to run the live spec.");
  test.setTimeout(480_000);

  test("list, assign, keyboard move, log a call, bulk assign, export and download, reports", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "w1440", "The live flow runs once, at 1440px.");
    const run = Date.now().toString(36);
    const main = page.locator("#main");

    // Sign in and choose a workspace the user owns or administers.
    await page.goto("/sign-in");
    await page.locator("input[type=email]").fill(EMAIL);
    await page.locator("input[type=password]").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app$/, { timeout: 60_000 });
    const me = (await (await page.request.get("/api/v1/auth/me")).json()) as {
      data: { user: { id: string; name: string }; organizations: Org[] };
    };
    const org = me.data.organizations.find((o) => o.role === "owner" || o.role === "admin");
    if (!org) throw new Error("The signed-in user is not an owner or admin of any organization");
    await page.evaluate((id) => window.localStorage.setItem("lf.activeOrg", id), org.id);

    // Three businesses for this run.
    const names = [
      `E2E Bakery ${run} (Sample)`,
      `E2E Florist ${run} (Sample)`,
      `E2E Pharmacy ${run} (Sample)`,
    ];
    const ids: string[] = [];
    for (const [i, name] of names.entries()) {
      const b = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
        name,
        phones: [`+23480${String(Date.now() + i).slice(-8)}`],
        location: { locality: "Ikeja", region: "Lagos" },
        categories: ["Retail"],
      });
      ids.push(b.id);
    }

    // 1. Create a list and add the businesses from a directory search.
    const listName = `E2E list ${run} (Sample)`;
    await page.goto("/app/lists");
    await main.getByRole("button", { name: "New list" }).first().click();
    const form = page.getByTestId("list-form-dialog");
    await form.getByLabel("Name").fill(listName);
    await form.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByText(`List “${listName}” created`)).toBeVisible();
    await main.getByRole("link", { name: listName }).click();
    await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
    await main.getByRole("button", { name: "Add businesses" }).first().click();
    const add = page.getByTestId("add-businesses-dialog");
    await add.getByRole("searchbox").fill(run);
    for (const name of names) await add.getByLabel(name).check({ timeout: 20_000 });
    await add.getByRole("button", { name: /Add 3 to list/ }).click();
    await expect(page.getByText(`Added 3 businesses to “${listName}”`)).toBeVisible();
    await expect(page.getByTestId("list-meta")).toContainText("3 businesses");
    const listId = page.url().split("/").pop()!;

    // 2. Assign a lead from the business page (adds it to the pipeline with that owner).
    await page.goto(`/app/businesses/${ids[0]}`);
    const panel = page.getByTestId("lead-panel");
    await panel.getByRole("button", { name: "Add and assign…" }).click();
    const assign = page.getByTestId("assign-dialog");
    await assign.getByText(/\(you\)/).click();
    await assign.getByRole("button", { name: "Add to pipeline" }).click();
    await expect(panel.getByTestId("lead-owner")).toHaveText("You", { timeout: 20_000 });
    await expect(panel.getByTestId("lead-stage")).toContainText("New");

    // 3. Move its stage with the keyboard on the board.
    await page.goto(`/app/pipeline?assignedToUserId=${me.data.user.id}`);
    const forward = page.getByRole("button", { name: `Move ${names[0]} forward to Qualified` });
    await forward.focus();
    await page.keyboard.press("]");
    await expect(page.getByTestId("pipeline-announcer")).toHaveText(
      `Moved ${names[0]} to Qualified.`,
      { timeout: 20_000 },
    );
    await expect(
      page.getByRole("button", { name: `Move ${names[0]} forward to Contacted` }),
    ).toBeFocused();
    const leads = await api<{ stageKey: string }[]>(
      page,
      "GET",
      `/pipeline/leads?businessId=${ids[0]}`,
      org.id,
    );
    expect(leads[0]?.stageKey).toBe("qualified");

    // 4. Log a call on the business.
    await page.goto(`/app/businesses/${ids[0]}?tab=activities`);
    const tab = page.getByTestId("activities-tab");
    await tab.getByRole("button", { name: "Log activity" }).click();
    const log = page.getByTestId("log-activity-dialog");
    await log.getByText("Call", { exact: true }).click();
    await log.getByRole("combobox", { name: "Outcome" }).click();
    await page.getByRole("option", { name: "Connected" }).click();
    await log.getByLabel("Notes (optional)").fill("Live e2e call (Sample).");
    await log.getByRole("button", { name: "Log call" }).click();
    await expect(page.getByText("Call logged")).toBeVisible();
    await expect(tab.getByTestId("activity-timeline")).toContainText("Call · Connected");

    // 5. Bulk assign the three businesses from the directory, to completion.
    await page.goto(`/app/businesses?q=${encodeURIComponent(run)}`);
    await expect(main.getByRole("link", { name: names[2] })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("checkbox", { name: "Select all rows on this page" }).check();
    await page.getByRole("button", { name: "Lead actions" }).click();
    await page.getByRole("menuitem", { name: "Assign…" }).click();
    const bulk = page.getByTestId("bulk-action-dialog");
    await bulk.getByText(/\(you\)/).click();
    await bulk.getByRole("button", { name: "Preview changes" }).click();
    await expect(bulk.getByTestId("bulk-preview")).toContainText("3 businesses match");
    await bulk.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Assign 3" }).click();
    await page.waitForURL(/\/app\/jobs\/bulk\//);
    await expect(page.getByTestId("bulk-status")).toHaveText(/Completed/, { timeout: 120_000 });
    await expect(page.getByTestId("bulk-counts")).toContainText("3");

    // 6. Export the list asynchronously, then download the ZIP and look inside.
    await page.goto(`/app/lists/${listId}`);
    await main.getByRole("button", { name: "Export" }).click();
    await page.getByTestId("export-dialog").getByRole("button", { name: "Create export" }).click();
    await page.waitForURL(/\/app\/jobs\/exports\//);
    await expect(page.getByTestId("export-status")).toHaveText(/Ready to download/, {
      timeout: 180_000,
    });
    const downloading = page.waitForEvent("download");
    await page.getByTestId("export-download").click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const zip = await readFile(await download.path());
    const entries = zipEntryNames(zip);
    expect(
      entries.some((n) => n.endsWith(".csv")),
      entries.join(", "),
    ).toBe(true);
    expect(entries, entries.join(", ")).toContain("ATTRIBUTION.txt");

    // 7. Reports open with real data.
    await page.goto("/app/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    const activity = page.getByTestId("report-activity");
    await activity.getByRole("radio", { name: /Table/ }).first().click();
    await expect(activity.getByRole("table", { name: "Activities by type" })).toContainText("Call");
    await expect(page.getByTestId("report-funnel")).toContainText("Open leads");
  });
});
