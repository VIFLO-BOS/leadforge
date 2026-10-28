import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  api,
  call,
  expectNoHorizontalScroll,
  linkIn,
  primaryOrg,
  projectKey,
  releaseOnly,
  runId,
  shot,
  toastsGone,
  waitForMail,
} from "./helpers";
import { parseCsv, readZip } from "./zip";

/*
 * Stage 10: the organization lifecycle through the real UI, on a dedicated organization so the
 * other criteria's workspaces are never scheduled for deletion.
 *
 * 1. A new owner (registered and verified through Mailpit) invites a second person, who accepts.
 * 2. The owner requests the organization data export in Settings, Organization; the worker builds
 *    it; the download goes through a fresh signed same-origin link; the ZIP holds the README, the
 *    attribution, the organization profile and JSON plus CSV for every section, members included.
 * 3. The owner schedules the deletion with the typed name and the current password: a wrong
 *    password is refused on the password field, the right one schedules it. Both members see the
 *    banner, new work (an invitation) is refused with ORGANIZATION_PENDING_DELETION, the owner
 *    cancels, and the banner is gone for both.
 * The purge itself (14 days later) is proved by the API integration tests.
 */

interface Person {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  name: string;
}

/** Registers a person through the API (their own organization comes with it) and verifies the address from Mailpit. */
async function registerVerified(
  browser: Browser,
  info: TestInfo,
  label: string,
  run: string,
  orgName: string,
): Promise<Person> {
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  const email = `${label}.${projectKey(info)}.${run}@e2e.example.test`;
  const password = `Release-${run}-Lifecycle-${label}!`;
  const name = `Release ${label} ${run}`;
  await page.goto("/sign-in");
  const res = await page.request.post("/api/v1/auth/register", {
    data: { email, password, name, organizationName: orgName, country: "NG" },
  });
  expect(res.status(), `register ${email}: ${await res.text()}`).toBe(201);
  const mail = await waitForMail(page.request, email, /verify/i);
  await page.goto(linkIn(mail, "/verify-email?token="));
  await expect(page.getByRole("heading", { level: 1, name: "Email verified" })).toBeVisible();
  return { context, page, email, password, name };
}

/**
 * Opens `path` with `orgId` as the active organization. The key is stored from a page without the
 * app shell: the shell writes its own resolved choice (the first membership) on every render, so a
 * key set from /app can be overwritten before the next navigation for a person in two organizations.
 */
async function openInOrg(page: Page, orgId: string, path: string): Promise<void> {
  await page.goto("/legal/privacy");
  await page.evaluate((id) => window.localStorage.setItem("lf.activeOrg", id), orgId);
  await page.goto(path);
}

async function openOrgSettings(page: Page, orgId: string): Promise<void> {
  await openInOrg(page, orgId, "/app/settings?tab=organization");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("data-and-deletion")).toBeVisible({ timeout: 30_000 });
}

test.describe("C17 organization lifecycle: data export and deletion request", () => {
  releaseOnly();

  test("C17 export the organization's data as a ZIP, then schedule the deletion, see the banner as a member, and cancel", async ({
    browser,
  }, info) => {
    const run = runId();
    const orgName = `Lifecycle Org ${projectKey(info)} ${run} (Synthetic)`;
    const owner = await registerVerified(browser, info, "lifecycle-owner", run, orgName);
    const member = await registerVerified(
      browser,
      info,
      "lifecycle-member",
      run,
      `Lifecycle Member Home ${run} (Synthetic)`,
    );
    let orgId = "";
    try {
      const org = await primaryOrg(owner.page, "owner");
      orgId = org.id;
      expect(org.name).toBe(orgName);

      // 1. The second person joins as a researcher through the invitation mail.
      await api(owner.page, "POST", "/organizations/current/invitations", orgId, {
        email: member.email,
        role: "researcher",
      });
      const invite = await waitForMail(member.page.request, member.email, /invit|join/i);
      const token = decodeURIComponent(
        new URL(linkIn(invite, "/invite/")).pathname.split("/").filter(Boolean).pop() ?? "",
      );
      await api(member.page, "POST", `/invitations/${encodeURIComponent(token)}/accept`, null);

      // 2. The organization data export, built by the worker and downloaded through a signed link.
      await openOrgSettings(owner.page, orgId);
      const section = owner.page.getByTestId("org-export");
      await expect(section).toHaveAttribute("data-state", "none");
      await expectNoHorizontalScroll(owner.page, "settings, data and deletion");
      await section.getByTestId("org-export-request").click();
      await expect(owner.page.getByTestId("org-export-status")).toHaveText(/Ready to download/, {
        timeout: 180_000,
      });
      await shot(owner.page, info, "c17-export-ready");
      let signed = "";
      owner.page.on("request", (r) => {
        if (
          /\/api\/v1\/organizations\/current\/data-exports\/[a-f0-9]{24}\/download\?/.test(r.url())
        )
          signed = r.url();
      });
      const downloading = owner.page.waitForEvent("download");
      await owner.page.getByTestId("org-export-download").click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      expect(new URL(signed).origin).toBe(new URL(owner.page.url()).origin);
      expect(signed).toMatch(/[?&]expires=\d+/);
      expect(signed).toMatch(/[?&]sig=/);
      const entries = readZip(await readFile(await download.path()));
      const names = entries.map((e) => e.name);
      for (const expected of [
        "README.txt",
        "ATTRIBUTION.txt",
        "organization.json",
        "members.json",
        "members.csv",
        "businesses.json",
        "businesses.csv",
        "audit_events.json",
        "audit_events.csv",
      ]) {
        expect(names, names.join(", ")).toContain(expected);
      }
      const profile = JSON.parse(
        entries.find((e) => e.name === "organization.json")!.data.toString("utf8"),
      ) as unknown;
      expect(JSON.stringify(profile)).toContain(orgName);
      const members = parseCsv(
        entries.find((e) => e.name === "members.csv")!.data.toString("utf8"),
      );
      const flat = members.flat().join("\n");
      expect(flat).toContain(owner.email);
      expect(flat).toContain(member.email);

      // 3. The deletion request: typed name and current password.
      const deletion = owner.page.getByTestId("org-deletion");
      await expect(deletion).toHaveAttribute("data-state", "none");
      await owner.page.getByTestId("org-delete-open").click();
      const dialog = owner.page.getByTestId("delete-org-dialog");
      await expect(dialog.getByTestId("delete-org-kept")).toContainText("invoices");
      await dialog.getByLabel("Organization name").fill(orgName);
      await dialog.getByLabel("Your current password").fill(`${owner.password}-wrong`);
      await dialog.getByTestId("delete-org-submit").click();
      await expect(dialog.getByLabel("Your current password")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await dialog.getByLabel("Your current password").fill(owner.password);
      await shot(owner.page, info, "c17-delete-dialog");
      await dialog.getByTestId("delete-org-submit").click();
      await expect(dialog).toBeHidden();
      await expect(deletion).toHaveAttribute("data-state", "pending");
      const banner = owner.page.getByTestId("org-deletion-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toHaveAttribute("data-audience", "owner");
      await expect(banner.getByRole("button", { name: /Dismiss/ })).toHaveCount(0);
      await expectNoHorizontalScroll(owner.page, "settings with a pending deletion");
      await shot(owner.page, info, "c17-pending");
      const status = await api<{ deletionRequestedAt: string | null; purgeAfter: string | null }>(
        owner.page,
        "GET",
        "/organizations/current",
        orgId,
      );
      expect(status.deletionRequestedAt).not.toBeNull();
      expect(Date.parse(status.purgeAfter!) - Date.parse(status.deletionRequestedAt!)).toBe(
        14 * 24 * 60 * 60 * 1000,
      );

      // New work is refused during the grace period, with the documented code.
      const refused = await call(owner.page, "POST", "/organizations/current/invitations", orgId, {
        email: `late.${run}@e2e.example.test`,
        role: "analyst",
      });
      expect(refused.status()).toBe(409);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        "ORGANIZATION_PENDING_DELETION",
      );

      // The member sees the banner in this organization and is told to ask an owner.
      await openInOrg(member.page, orgId, "/app");
      const memberBanner = member.page.getByTestId("org-deletion-banner");
      await expect(memberBanner).toBeVisible({ timeout: 30_000 });
      await expect(memberBanner).toHaveAttribute("data-audience", "member");
      await expect(memberBanner).toContainText("Only an owner can cancel");
      await shot(member.page, info, "c17-member-banner");

      // 4. The owner cancels; the banner is gone for both. (The "Deletion scheduled" toast can sit
      // over the Cancel button on phones.)
      await toastsGone(owner.page);
      await owner.page.getByTestId("org-deletion-cancel").click();
      const confirm = owner.page.getByRole("alertdialog", {
        name: "Cancel the scheduled deletion?",
      });
      await confirm.getByRole("button", { name: "Cancel deletion" }).click();
      await expect(deletion).toHaveAttribute("data-state", "none");
      await expect(owner.page.getByTestId("org-deletion-banner")).toHaveCount(0);
      await member.page.reload();
      await expect(member.page.getByRole("heading", { level: 1 })).toBeVisible();
      await member.page.waitForLoadState("networkidle");
      await expect(member.page.getByTestId("org-deletion-banner")).toHaveCount(0);
      const after = await api<{ deletionRequestedAt: string | null }>(
        owner.page,
        "GET",
        "/organizations/current",
        orgId,
      );
      expect(after.deletionRequestedAt).toBeNull();
    } finally {
      // Never leave the organization scheduled for deletion, whatever failed above.
      if (orgId)
        await call(owner.page, "DELETE", "/organizations/current/deletion-requests", orgId).catch(
          () => undefined,
        );
      await owner.context.close();
      await member.context.close();
    }
  });
});
