import { expect, test } from "@playwright/test";
import { expectNoOverflow } from "./assertions";

/*
 * Legal pages (Stage 9): each one says it is a draft pending legal review, never invents company
 * details (they are bracketed placeholders), names the processors and sources that were actually
 * built, and keeps one h1 and the legal navigation.
 */

const LEGAL = [
  {
    path: "/legal/privacy",
    h1: "Privacy Policy",
    mentions: [
      "Paystack",
      "Overture Maps Places",
      "Mailbox not confirmed",
      "Nigeria Data Protection Act 2023",
      "90 days",
      "7 days",
      "Settings, Organization",
      "14-day grace period",
      "anonymized",
    ],
  },
  {
    path: "/legal/terms",
    h1: "Terms of Service",
    mentions: [
      "Paystack",
      "Overture Maps Places",
      "Google Places is not used",
      "CDLA Permissive 2.0",
      "Settings, Organization",
      "14-day grace period",
    ],
  },
  {
    path: "/legal/acceptable-use",
    h1: "Acceptable Use Policy",
    mentions: ["do-not-collect", "audited"],
  },
  {
    path: "/legal/data-collection",
    h1: "Data Collection Policy",
    mentions: [
      "LeadForgeBot/1.0",
      "robots.txt",
      "Google Places is not used",
      "Overture Maps Foundation",
      "purged after a 14-day grace",
    ],
  },
  {
    path: "/legal/data-sources",
    h1: "Data sources and licences",
    mentions: [
      "Overture Maps Foundation",
      "Meta",
      "Foursquare",
      "OpenStreetMap",
      "Google Places is not used",
    ],
  },
] as const;

test.describe("legal pages", () => {
  for (const page of LEGAL) {
    test(`${page.path} is a marked draft that states only what was built`, async ({ page: p }) => {
      await p.goto(page.path);
      await expect(p.getByRole("heading", { level: 1, name: page.h1 })).toBeVisible();
      const notice = p.getByTestId("legal-draft-notice");
      await expect(notice).toContainText("Draft, pending legal review");
      await expect(notice).toHaveAttribute("role", "note");
      const article = p.locator("article");
      for (const m of page.mentions) await expect(article).toContainText(m);
      // Company details are placeholders, never invented; the dev-only mail catcher is never named.
      const placeholders = article.locator("[data-legal-placeholder]");
      for (const text of await placeholders.allTextContents())
        expect(text).toMatch(/^\[To be completed: .+\]$/);
      await expect(article).not.toContainText(/Mailpit/i);
      await expectNoOverflow(p, page.path);
    });
  }
});
