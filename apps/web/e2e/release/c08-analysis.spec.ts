import { expect, test } from "@playwright/test";
import {
  api,
  expectNoHorizontalScroll,
  primaryOrg,
  releaseOnly,
  runId,
  sessionFor,
  shot,
  toastsGone,
  toast,
} from "./helpers";

/*
 * Criterion 8: evidence-based website analysis and lead scores. The worker fetches the stack's test
 * site (an old WordPress page with markup in it that would run if it were ever rendered as HTML),
 * and the analysis page lists every detection with its evidence as escaped text, the
 * opportunities that rest on them, and the business's lead score with a breakdown equal to the API.
 */

const SITE = "kitchen.lf-e2e.test";

interface Score {
  fit: number;
  dataConfidence: number;
  breakdown: { signal: string; label: string; points: number; weight: number }[];
}

test.describe("C8 evidence-based website analysis and lead scores", () => {
  releaseOnly();

  test("C8 request an analysis, escaped evidence, opportunities and the score breakdown", async ({
    browser,
  }, info) => {
    const run = runId();
    const name = `E2E Analysis Kitchen ${run} (Sample)`;
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const biz = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
        name,
        website: `http://${SITE}`,
        location: { locality: "Ikeja", region: "Lagos" },
        categories: ["Restaurant"],
      });
      const before = await api<{ balance: number }>(page, "GET", "/credits/balance", org.id);

      // 1. Request the analysis (1 credit, confirmed first).
      await page.goto(`/app/businesses/${biz.id}?tab=analysis`);
      const tab = page.getByTestId("analysis-tab");
      await tab.getByRole("button", { name: /Run website analysis/ }).click();
      await expect(page.getByRole("alertdialog")).toContainText(/1 credit/);
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: /Run analysis/ })
        .click();
      await expect(toast(page, "Website analysis queued")).toBeVisible();
      await expect(tab.getByRole("link", { name: /Open full analysis/ })).toBeVisible({
        timeout: 180_000,
      });
      await toastsGone(page);
      await tab.getByRole("link", { name: /Open full analysis/ }).click();
      await page.waitForURL(/\/app\/analysis\/[a-f0-9]{24}/);
      const analysisId = page.url().split("/").pop()!.split(/[?#]/)[0]!;

      // 2. Every detection with evidence; the platform version is observed.
      await expect(page.getByTestId("analysis-status-line")).toContainText("Completed", {
        timeout: 60_000,
      });
      const analysis = await api<{
        detections: { key: string; observed: string; evidence: unknown[] }[];
        opportunities: { key: string; title: string }[];
        credits?: unknown;
      }>(page, "GET", `/analysis/websites/${analysisId}`, org.id);
      const detections = page.getByRole("list", { name: "Detections" });
      await expect(detections.locator("[data-detection]")).toHaveCount(analysis.detections.length);
      for (const d of analysis.detections) {
        await expect(detections.locator(`[data-detection="${d.key}"]`)).toHaveAttribute(
          "data-observed",
          d.observed,
        );
      }
      await expect(detections.locator('[data-detection="outdated_platform"]')).toContainText(
        "WordPress 4.9.8",
      );
      expect(await detections.getByRole("list", { name: "Evidence" }).count()).toBeGreaterThan(3);
      await expect(page.getByTestId("analysis-pages")).toContainText(`${SITE}/contact`);
      await expect(page.getByTestId("analysis-credits")).toContainText("Settled");

      // 3. Evidence is text: markup from the site shows as characters and never runs.
      const snippets = (await page.getByTestId("evidence-snippet").allTextContents()).join("\n");
      expect(snippets, "some evidence quotes the site's markup").toMatch(/<[a-z]+[\s>]/i);
      expect(
        await page.evaluate(() => (window as unknown as { __lfInjected?: number }).__lfInjected),
      ).toBeUndefined();
      await expect(page.locator('#main img[src="x"]')).toHaveCount(0);
      await expectNoHorizontalScroll(page, "analysis page");
      await shot(page, info, "c08-analysis");

      // 4. Opportunities, each resting on detections.
      const opportunities = page.getByTestId("analysis-opportunities");
      expect(analysis.opportunities.length).toBeGreaterThan(0);
      for (const o of analysis.opportunities)
        await expect(opportunities.locator(`[data-opportunity="${o.key}"]`)).toContainText(o.title);

      // 5. The lead score and its breakdown equal the API.
      const after = await api<{ balance: number }>(page, "GET", "/credits/balance", org.id);
      expect(before.balance - after.balance).toBe(1);
      let score: Score | null = null;
      await expect
        .poll(
          async () => {
            score = await api<Score | null>(page, "GET", `/businesses/${biz.id}/score`, org.id);
            return score?.breakdown.length ?? 0;
          },
          { timeout: 60_000 },
        )
        .toBeGreaterThan(0);
      await page.goto(`/app/businesses/${biz.id}?tab=score`);
      const scoreTab = page.getByTestId("score-tab");
      await expect(scoreTab).toBeVisible({ timeout: 30_000 });
      score = await api<Score>(page, "GET", `/businesses/${biz.id}/score`, org.id);
      await expect(scoreTab.getByTestId("fit-score-value")).toHaveText(String(score!.fit));
      await expect(scoreTab.getByTestId("data-confidence-value")).toHaveText(
        String(score!.dataConfidence),
      );
      for (const row of score!.breakdown)
        await expect(scoreTab.getByText(row.label, { exact: true }).first()).toBeVisible();
      await expectNoHorizontalScroll(page, "score tab");
      await shot(page, info, "c08-score");
    } finally {
      await context.close();
    }
  });
});
