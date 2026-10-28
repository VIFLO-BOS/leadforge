import { expect, test } from "@playwright/test";
import {
  api,
  apiAll,
  expectNoHorizontalScroll,
  primaryOrg,
  releaseOnly,
  sessionFor,
  shot,
  statValue,
} from "./helpers";

/*
 * The brief's last rule: the product never fabricates discovered businesses, verified contacts,
 * source coverage, customer statistics or successful operations. After the criterion specs have
 * filled this project's workspace, every number on the overview, the reports and the background
 * jobs page must equal what the API computes from the records; every business that did not come
 * from a real source is labelled "(Sample)"; and no price is shown as ₦0.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

interface Overview {
  businesses: { total: number; addedInPeriod: number };
  contacts: { verifiedPhone: number; verifiedEmail: number };
  pipeline?: { qualifiedLeads: number };
  discovery?: { inProgress: number; completedInPeriod: number; failedInPeriod: number };
  jobs?: { failedInPeriod: number };
  credits?: { balance: number };
}

test.describe("Honesty: no fabricated numbers, samples labelled, no ₦0 prices", () => {
  releaseOnly();

  test("Honesty: overview, reports and jobs equal the API; samples are labelled; no ₦0", async ({
    browser,
  }, info) => {
    const { context, page } = await sessionFor(browser, info, "owner");
    const main = page.locator("#main");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);

      // 1. Overview tiles equal GET /reports/overview.
      await page.goto("/app?period=30d");
      await expect(page.getByRole("heading", { level: 1, name: /^Welcome/ })).toBeVisible();
      await expect(main.locator('[data-stat="Businesses"] [data-stat-value]')).toBeVisible({
        timeout: 30_000,
      });
      const m = await api<Overview>(page, "GET", "/reports/overview?period=30d", org.id);
      const tiles: Array<[string, number | undefined]> = [
        ["Businesses", m.businesses.total],
        ["Added in period", m.businesses.addedInPeriod],
        ["Verified phones", m.contacts.verifiedPhone],
        ["Verified emails", m.contacts.verifiedEmail],
        ["Qualified leads", m.pipeline?.qualifiedLeads],
        ["Active discovery jobs", m.discovery?.inProgress],
        ["Discovery jobs completed", m.discovery?.completedInPeriod],
        ["Failed jobs needing attention", m.jobs?.failedInPeriod ?? m.discovery?.failedInPeriod],
        ["Credits available", m.credits?.balance],
      ];
      for (const [label, value] of tiles) {
        if (value === undefined)
          await expect(main.locator(`[data-stat="${label}"] [data-stat-empty]`)).toHaveText(
            "No data yet",
          );
        else expect(await statValue(main, label), label).toBe(fmt(value));
      }
      expect(m.businesses.total, "the criterion specs filled this workspace").toBeGreaterThan(0);
      await expectNoHorizontalScroll(page, "overview");
      await shot(page, info, "honesty-overview");

      // 2. Reports: the source total and the funnel equal their reports.
      const sources = await api<{ totalBusinesses: number }>(
        page,
        "GET",
        "/reports/source-breakdown?period=30d",
        org.id,
      );
      const funnel = await api<{
        totals: { open: number; won: number; lost: number; leads: number };
      }>(page, "GET", "/reports/pipeline-funnel?period=30d", org.id);
      const activity = await api<{ total: number }>(
        page,
        "GET",
        "/reports/activity-summary?period=30d",
        org.id,
      );
      await page.goto("/app/reports");
      await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
      await expect(page.getByTestId("report-sources")).toContainText(
        `${fmt(sources.totalBusinesses)} businesses`,
      );
      const funnelSection = page.getByTestId("report-funnel");
      expect(await statValue(funnelSection, "Open leads")).toBe(fmt(funnel.totals.open));
      expect(await statValue(funnelSection, "Won")).toBe(fmt(funnel.totals.won));
      expect(await statValue(funnelSection, "Lost")).toBe(fmt(funnel.totals.lost));
      await expect(funnelSection).toContainText(`${fmt(funnel.totals.leads)} leads in total`);
      await expect(page.getByTestId("report-activity")).toContainText(
        `${fmt(activity.total)} activities`,
      );
      await expectNoHorizontalScroll(page, "reports");
      await shot(page, info, "honesty-reports");

      // 3. Background jobs: each listed job shows the API's progress.
      const jobs = await api<
        { name: string; progress: { processed: number; total: number | null; failed: number } }[]
      >(page, "GET", "/jobs?pageSize=25", org.id);
      expect(jobs.length).toBeGreaterThan(0);
      await page.goto("/app/jobs");
      await expect(page.getByRole("heading", { level: 1, name: "Background jobs" })).toBeVisible();
      for (const j of jobs.slice(0, 10)) {
        const p = j.progress;
        const done =
          p.total !== null
            ? `${fmt(p.processed)} of ${fmt(p.total)} processed`
            : `${fmt(p.processed)} processed`;
        await expect(main.getByText(j.name, { exact: true }).first()).toBeVisible();
        await expect(main).toContainText(p.failed ? `${done} · ${fmt(p.failed)} failed` : done);
      }
      await expectNoHorizontalScroll(page, "background jobs");

      // 4. Every business that did not come from a real source is labelled "(Sample)".
      const all = await apiAll<{ name: string; sources: string[] }>(
        page,
        "/businesses?pageSize=100",
        org.id,
      );
      const unlabelled = all.filter(
        (b) => !b.name.endsWith("(Sample)") && !b.sources.includes("overture_places"),
      );
      expect(
        unlabelled.map((b) => b.name),
        "businesses with neither a real source nor a (Sample) label",
      ).toEqual([]);
      const real = all.filter((b) => !b.name.endsWith("(Sample)"));
      for (const b of real)
        expect(b.sources, `${b.name} must come from Overture`).toContain("overture_places");
      await page.goto(`/app/businesses?q=${encodeURIComponent("E2E")}`);
      await expect(main.getByRole("link", { name: /\(Sample\)$/ }).first()).toBeVisible({
        timeout: 30_000,
      });

      // 5. No page in the money path shows ₦0 as a price.
      for (const path of [
        "/app/billing",
        "/app/billing?tab=plans",
        "/app/billing?tab=payments",
        "/app/usage",
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(main).not.toContainText(/₦\s?0(\.00)?(?![\d,])/);
      }
    } finally {
      await context.close();
    }
  });
});
