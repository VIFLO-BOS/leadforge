import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  api,
  expectNoHorizontalScroll,
  me,
  primaryOrg,
  releaseOnly,
  runId,
  seededEmail,
  projectKey,
  sessionFor,
  shot,
  signInThroughForm,
} from "./helpers";
import { parseCsv, readZip } from "./zip";

/*
 * Criterion 10: export authorized records. The owner exports a lead list asynchronously; the job
 * page polls until the file is built, then the download goes through a fresh signed link and the
 * ZIP holds the CSV (exactly the list's rows), ATTRIBUTION.txt and the licences. A sales rep
 * exporting the same businesses gets only the leads assigned to them.
 */

async function exportAndDownload(
  page: Page,
  info: Parameters<typeof shot>[1],
  tag: string,
): Promise<{ entries: ReturnType<typeof readZip>; signed: string }> {
  await page.getByTestId("export-dialog").getByRole("button", { name: "Create export" }).click();
  await page.waitForURL(/\/app\/jobs\/exports\/[a-f0-9]{24}/);
  await expect(page.getByTestId("export-status")).toHaveText(/Ready to download/, {
    timeout: 180_000,
  });
  await expectNoHorizontalScroll(page, `export job (${tag})`);
  await shot(page, info, `c10-${tag}-ready`);
  let signed = "";
  page.on("request", (r) => {
    if (/\/api\/v1\/exports\/[a-f0-9]{24}\/download\?/.test(r.url())) signed = r.url();
  });
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export-download").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const entries = readZip(await readFile(await download.path()));
  return { entries, signed };
}

function csvNames(entries: ReturnType<typeof readZip>): string[] {
  const csv = entries.find((e) => e.name.endsWith(".csv"));
  if (!csv) throw new Error(`No CSV in the ZIP: ${entries.map((e) => e.name).join(", ")}`);
  const rows = parseCsv(csv.data.toString("utf8"));
  const header = rows[0] ?? [];
  const col = header.findIndex((h) => /^(name|business name)$/i.test(h.trim()));
  expect(col, `name column in ${header.join(",")}`).toBeGreaterThanOrEqual(0);
  return rows.slice(1).map((r) => r[col] ?? "");
}

test.describe("C10 export authorized records", () => {
  releaseOnly();

  test("C10 a list export through the signed link, and a sales rep exports only assigned leads", async ({
    browser,
  }, info) => {
    const run = runId();
    const owner = await sessionFor(browser, info, "owner");
    const rep = await sessionFor(browser, info, "rep");
    try {
      await owner.page.goto("/app");
      await rep.page.goto("/app");
      const org = await primaryOrg(owner.page);
      const repUser = await me(rep.page);
      expect(repUser.organizations.find((o) => o.id === org.id)?.role).toBe("sales_rep");

      const names = [
        `E2E Export One ${run} (Sample)`,
        `E2E Export Two ${run} (Sample)`,
        `E2E Export Three ${run} (Sample)`,
      ];
      const ids: string[] = [];
      for (const [i, name] of names.entries()) {
        const b = await api<{ id: string }>(owner.page, "POST", "/businesses", org.id, {
          name,
          phones: [`+44117496${String((Date.now() + i) % 1000).padStart(4, "0")}`],
          emails: [`hello@export-${i}-${run}.e2e.example.test`],
          location: { locality: "Ikeja", region: "Lagos" },
          categories: ["Retail"],
        });
        ids.push(b.id);
      }
      const list = await api<{ id: string }>(owner.page, "POST", "/lists", org.id, {
        name: `E2E export list ${run} (Sample)`,
      });
      await api(owner.page, "POST", `/lists/${list.id}/items`, org.id, { businessIds: ids });
      // Only the first business's lead belongs to the sales rep.
      await api(owner.page, "POST", "/pipeline/leads", org.id, {
        businessId: ids[0],
        assignedToUserId: repUser.user.id,
      });
      await api(owner.page, "POST", "/pipeline/leads", org.id, { businessId: ids[1] });

      // 1. The owner exports the list; the download is a fresh signed same-origin link.
      await owner.page.goto(`/app/lists/${list.id}`);
      await owner.page
        .locator("#main")
        .getByRole("button", { name: "Export", exact: true })
        .click();
      await expect(owner.page.getByTestId("export-dialog")).toContainText("3 businesses");
      const full = await exportAndDownload(owner.page, info, "owner");
      expect(new URL(full.signed).origin).toBe(new URL(owner.page.url()).origin);
      expect(full.signed).toMatch(/[?&]expires=\d+/);
      expect(full.signed).toMatch(/[?&]sig=/);
      const entryNames = full.entries.map((e) => e.name);
      expect(entryNames, entryNames.join(", ")).toContain("ATTRIBUTION.txt");
      expect(csvNames(full.entries).sort()).toEqual([...names].sort());
      // The signed link is single-purpose: without its signature the same URL is refused.
      const unsigned = full.signed.replace(/([?&])sig=[^&]+/, "$1sig=0000");
      expect(
        (await owner.page.request.get(unsigned, { maxRedirects: 0 })).status(),
      ).toBeGreaterThanOrEqual(300);

      // A signed-out browser that opens the link is sent to sign in, then back to the export page,
      // where a fresh link is asked for as usual (Stage 9: 303 to /sign-in?next=).
      const exportId = /\/exports\/([a-f0-9]{24})\/download/.exec(full.signed)![1]!;
      const signedOut = await browser.newContext({ ...info.project.use });
      try {
        const visitor = await signedOut.newPage();
        await visitor.goto(full.signed);
        await visitor.waitForURL(/\/sign-in\?/);
        expect(new URL(visitor.url()).searchParams.get("next")).toBe(
          `/app/jobs/exports/${exportId}`,
        );
        await signInThroughForm(visitor, seededEmail("owner", projectKey(info)));
        await visitor.waitForURL((u) => u.pathname === `/app/jobs/exports/${exportId}`);
        await expect(visitor.getByTestId("export-status")).toHaveText(/Ready to download/, {
          timeout: 60_000,
        });
        const again = visitor.waitForEvent("download");
        await visitor.getByTestId("export-download").click();
        expect((await again).suggestedFilename()).toMatch(/\.zip$/);
      } finally {
        await signedOut.close();
      }

      // 2. The sales rep exports the same businesses from the directory: only their assigned lead.
      await rep.page.goto(`/app/businesses?q=${encodeURIComponent(run)}`);
      await expect(
        rep.page.locator("#main").getByRole("link", { name: names[2] }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await rep.page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(rep.page.getByTestId("export-dialog")).toContainText(
        "Only your assigned leads are exported",
      );
      await shot(rep.page, info, "c10-rep-dialog");
      const scoped = await exportAndDownload(rep.page, info, "rep");
      expect(csvNames(scoped.entries)).toEqual([names[0]]);
    } finally {
      await owner.context.close();
      await rep.context.close();
    }
  });
});
