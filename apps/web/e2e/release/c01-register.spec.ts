import { expect, test } from "@playwright/test";
import {
  api,
  expectNoHorizontalScroll,
  linkIn,
  primaryOrg,
  projectKey,
  releaseOnly,
  runId,
  shot,
  signInThroughForm,
  waitForMail,
} from "./helpers";

/*
 * Criterion 1: register and create an organization. A new person signs up through the form, the
 * workspace stays locked until the address is verified, the verification mail arrives in Mailpit,
 * its link verifies the account, and the new organization opens with honest, empty metrics. Then
 * they sign out and back in through the form.
 */

test.describe("C1 register and create an organization", () => {
  releaseOnly();

  test("C1 sign up, verify the email from Mailpit, land in the new workspace, sign out and in", async ({
    page,
    request,
  }, info) => {
    const run = runId();
    const key = projectKey(info);
    const email = `signup.${key}.${run}@e2e.example.test`;
    const password = `Release-${run}-Passphrase!`;
    const orgName = `Signup Org ${key} ${run} (Synthetic)`;

    // 1. The sign-up form.
    await page.goto("/sign-up");
    await expect(
      page.getByRole("heading", { level: 1, name: "Create your workspace" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, "sign-up");
    await page.getByLabel("Your name").fill(`Release Signup ${run}`);
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Country").fill("NG");
    await shot(page, info, "c01-sign-up");
    await page.getByRole("button", { name: "Create account" }).click();

    // 2. The workspace waits for the verification.
    await page.waitForURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
    await expect(page.locator("#main")).toContainText(email);
    await expectNoHorizontalScroll(page, "verify gate");
    const before = await api<{ user: { emailVerifiedAt: string | null } }>(
      page,
      "GET",
      "/auth/me",
      null,
    );
    expect(before.user.emailVerifiedAt).toBeNull();

    // 3. The mail arrives through the worker and SMTP; its link verifies the account.
    const mail = await waitForMail(request, email, /verify/i);
    const link = linkIn(mail, "/verify-email?token=");
    expect(new URL(link).origin).toBe(new URL(page.url()).origin);
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1, name: "Email verified" })).toBeVisible();
    await shot(page, info, "c01-verified");
    await page.getByRole("link", { name: "Open your workspace" }).click();
    await page.waitForURL(/\/app$/);

    // 4. The new organization, owned by the new account, with honest empty metrics.
    const data = await api<{
      user: { emailVerifiedAt: string | null };
      organizations: { id: string; name: string; role: string }[];
    }>(page, "GET", "/auth/me", null);
    expect(data.user.emailVerifiedAt).not.toBeNull();
    expect(data.organizations).toEqual([expect.objectContaining({ name: orgName, role: "owner" })]);
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome, Release/ })).toBeVisible();
    await expect(page.locator("#main")).toContainText(`${orgName} workspace`);
    await expect(page.getByText("No businesses yet")).toBeVisible();
    const org = await primaryOrg(page);
    const metrics = await api<{ businesses: { total: number } }>(
      page,
      "GET",
      "/reports/overview?period=30d",
      org.id,
    );
    expect(metrics.businesses.total).toBe(0);
    await expect(page.locator('[data-stat="Businesses"] [data-stat-value]')).toHaveText("0");
    await expect(page.locator('[data-stat="Credits available"] [data-stat-value]')).toHaveText("0");
    await expectNoHorizontalScroll(page, "new workspace overview");
    await shot(page, info, "c01-workspace");

    // 5. Sign out from the user menu, then sign in through the form.
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await page.getByRole("menuitem", { name: /Sign out/ }).click();
    await page.waitForURL(/\/sign-in/);
    await signInThroughForm(page, email, password);
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome, Release/ })).toBeVisible();
  });
});
