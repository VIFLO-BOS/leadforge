import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, OrganizationProfile } from "@leadforge/contracts";
import { Toaster, TooltipProvider } from "@leadforge/ui";
import { OrgDeletionBanner } from "@/components/app/org-deletion-banner";
import { PendingDeletionNotice } from "@/components/app/pending-deletion-notice";
import { DataAndDeletionSection } from "@/components/app/settings/data-and-deletion";
import { DeleteOrganizationDialog } from "@/components/app/settings/delete-organization-dialog";
import { ApiError } from "@/lib/api";
import { checkoutError } from "@/lib/billing";
import { friendlyMessage } from "@/lib/errors";
import {
  activeExportIdFrom,
  daysUntil,
  deletionStateOf,
  isPendingDeletion,
  orgExportDownloadErrorFrom,
  pendingDeletionPurgeAfter,
  purgeDateFrom,
} from "@/lib/org-lifecycle";
import { orgExport, ORG_EXPORT_NEW_ID, PURGE_AFTER } from "../e2e/fixtures-stage10";
import { stubApi } from "./phase2-helpers";
import { routerReplace, setLocation } from "./phase3-helpers";

vi.mock("next/navigation", async () => (await import("./phase3-helpers")).navigationMock());

let role: "owner" | "admin" | "researcher" | "sales_rep" | "analyst" = "owner";
let pendingInMe = false;
vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return {
    useWorkspace: () => {
      const w = workspace(role);
      const org = pendingInMe
        ? {
            ...w.org,
            deletionRequestedAt: "2026-10-25T09:00:00.000Z",
            purgeAfter: "2026-11-08T09:00:00.000Z",
          }
        : w.org;
      return { me: { ...w.me, organizations: [org] } as MeResponse, org };
    },
  };
});

const NAME = "Sample Logistics Ltd (Sample)";
const PROFILE: OrganizationProfile = {
  id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  name: NAME,
  slug: "sample-logistics",
  country: "NG",
  defaultCurrency: "NGN",
  freshnessDays: 180,
  createdAt: "2026-10-01T08:00:00.000Z",
  memberCount: 3,
  role: "owner",
  deletionRequestedAt: null,
  purgeAfter: null,
};
const PENDING_PROFILE: OrganizationProfile = {
  ...PROFILE,
  deletionRequestedAt: "2026-10-25T09:00:00.000Z",
  purgeAfter: PURGE_AFTER,
};
const MEMBERS = {
  data: [
    {
      userId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      email: "owner@example.test",
      name: "Ada Okafor (Sample)",
      role: "owner",
      status: "active",
      joinedAt: "2026-10-01T08:00:00.000Z",
    },
    {
      userId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      email: "r@example.test",
      name: "Chinedu (Sample)",
      role: "researcher",
      status: "active",
      joinedAt: "2026-10-03T08:00:00.000Z",
    },
  ],
  meta: { nextCursor: null, pageSize: 100 },
};

beforeEach(() => {
  role = "owner";
  pendingInMe = false;
  setLocation("/app/settings?tab=organization");
  routerReplace.mockClear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = (data: unknown, status = 200) => ({ status, body: { data } });
const fail = (status: number, code: string, message: string, details?: unknown[]) => ({
  status,
  body: { error: { code, message, details, requestId: "req-test" } },
});

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {ui}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("organization lifecycle helpers", () => {
  it("reads the deletion state, treating payloads without the fields as not pending", () => {
    expect(deletionStateOf({})).toEqual({ pending: false, requestedAt: null, purgeAfter: null });
    expect(deletionStateOf(PENDING_PROFILE)).toEqual({
      pending: true,
      requestedAt: PENDING_PROFILE.deletionRequestedAt,
      purgeAfter: PURGE_AFTER,
    });
    expect(daysUntil("2026-11-08T09:00:00.000Z", Date.parse("2026-10-27T09:00:00.000Z"))).toBe(12);
    expect(daysUntil("2026-10-01T09:00:00.000Z")).toBe(0);
    const from = Date.parse("2026-10-27T00:00:00.000Z");
    expect(purgeDateFrom(from)).toBe("2026-11-10T00:00:00.000Z");
  });

  it("explains ORGANIZATION_PENDING_DELETION with the purge date and REAUTH_FAILED without signing out", () => {
    const err = new ApiError({
      code: "ORGANIZATION_PENDING_DELETION",
      message: "x",
      status: 409,
      details: [{ path: "purgeAfter", message: PURGE_AFTER }],
    });
    expect(isPendingDeletion(err)).toBe(true);
    expect(pendingDeletionPurgeAfter(err)).toBe(PURGE_AFTER);
    expect(friendlyMessage(err)).toMatch(/scheduled for deletion on .*2026/);
    expect(friendlyMessage(err)).toMatch(
      /An owner can cancel the deletion in Settings, Organization/,
    );
    expect(checkoutError(err).title).toMatch(/Purchases are paused/);
    expect(checkoutError(err).message).toMatch(/Nothing was charged/);
    const reauth = new ApiError({ code: "REAUTH_FAILED", message: "x", status: 403 });
    expect(friendlyMessage(reauth)).toMatch(/password is not correct/);
  });

  it("follows the export a 409 names and only accepts known link error codes", () => {
    const conflict = new ApiError({
      code: "CONFLICT",
      message: "x",
      status: 409,
      details: [{ path: "activeExportId", message: "6add8b76520012303c64d0ac" }],
    });
    expect(activeExportIdFrom(conflict)).toBe("6add8b76520012303c64d0ac");
    expect(
      activeExportIdFrom(new ApiError({ code: "CONFLICT", message: "x", status: 409 })),
    ).toBeNull();
    expect(orgExportDownloadErrorFrom("DOWNLOAD_LINK_EXPIRED")).toBe("DOWNLOAD_LINK_EXPIRED");
    expect(orgExportDownloadErrorFrom("<script>")).toBeNull();
  });
});

describe("delete organization dialog", () => {
  it("says what is deleted, kept and when, and focuses the first invalid field", async () => {
    stubApi(() => undefined);
    const user = userEvent.setup();
    renderUi(
      <DeleteOrganizationDialog open onOpenChange={() => undefined} organizationName={NAME} />,
    );
    const dialog = await screen.findByTestId("delete-org-dialog");
    expect(within(dialog).getByTestId("delete-org-deleted")).toHaveTextContent(/Businesses/);
    expect(within(dialog).getByTestId("delete-org-kept")).toHaveTextContent(/Payments, invoices/);
    expect(within(dialog).getByTestId("delete-org-purge-date").textContent).not.toBe("");
    await user.click(within(dialog).getByTestId("delete-org-submit"));
    const name = within(dialog).getByLabelText(/^Organization name/);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();
    await user.type(name, "Sample Logistics");
    await user.click(within(dialog).getByTestId("delete-org-submit"));
    expect(within(dialog).getByText(/The name does not match/)).toBeInTheDocument();
  });

  it("puts a wrong password on the password field and sends the typed name and password", async () => {
    const { calls } = stubApi((url, init) => {
      if (url.pathname === "/organizations/current/deletion-requests" && init.method === "POST") {
        const body = JSON.parse(String(init.body)) as { password: string };
        return body.password === "right-password"
          ? ok(
              {
                deletionRequestedAt: "2026-10-27T09:00:00.000Z",
                purgeAfter: "2026-11-10T09:00:00.000Z",
              },
              202,
            )
          : fail(403, "REAUTH_FAILED", "The password is not correct");
      }
      return undefined;
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderUi(<DeleteOrganizationDialog open onOpenChange={onOpenChange} organizationName={NAME} />);
    const dialog = await screen.findByTestId("delete-org-dialog");
    await user.type(within(dialog).getByLabelText(/^Organization name/), NAME);
    const password = within(dialog).getByLabelText(/^Your current password/);
    await user.type(password, "wrong-password");
    await user.click(within(dialog).getByTestId("delete-org-submit"));
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(password).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await user.type(password, "right-password");
    await user.click(within(dialog).getByTestId("delete-org-submit"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.at(-1)?.body).toEqual({ confirmName: NAME, password: "right-password" });
  });
});

describe("data and deletion section", () => {
  function routes(state: { pending: boolean; exports: unknown[] }) {
    return stubApi((url, init) => {
      const method = init.method ?? "GET";
      if (url.pathname === "/organizations/current/members") return { body: MEMBERS };
      if (url.pathname === "/organizations/current/data-exports" && method === "GET") {
        return { body: { data: state.exports, meta: { nextCursor: null, pageSize: 10 } } };
      }
      if (url.pathname === "/organizations/current/data-exports" && method === "POST") {
        const e = orgExport({
          id: ORG_EXPORT_NEW_ID,
          status: "queued",
          file: null,
          sections: [],
          progress: { completedSections: 0, totalSections: 16, currentSection: null },
        });
        state.exports = [e];
        return ok(e, 202);
      }
      if (url.pathname === `/organizations/current/data-exports/${ORG_EXPORT_NEW_ID}`) {
        return ok(
          orgExport({
            id: ORG_EXPORT_NEW_ID,
            status: "running",
            file: null,
            sections: [],
            progress: { completedSections: 3, totalSections: 16, currentSection: "observations" },
          }),
        );
      }
      if (url.pathname === "/organizations/current/deletion-requests" && method === "DELETE") {
        state.pending = false;
        return { status: 204 };
      }
      return undefined;
    });
  }

  it("lets an owner request an export and shows its progress", async () => {
    const { calls } = routes({ pending: false, exports: [] });
    const user = userEvent.setup();
    renderUi(<DataAndDeletionSection profile={PROFILE} />);
    const request = await screen.findByTestId("org-export-request");
    await user.click(request);
    await waitFor(() =>
      expect(screen.getByTestId("org-export")).toHaveAttribute("data-state", "running"),
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    const post = calls.find(
      (c) => c.method === "POST" && c.path === "/organizations/current/data-exports",
    );
    expect(post).toBeTruthy();
  });

  it("offers a download of a ready export through a fresh link", async () => {
    const navigate = vi.fn();
    stubApi((url) => {
      if (url.pathname === "/organizations/current/members") return { body: MEMBERS };
      if (url.pathname === "/organizations/current/data-exports")
        return { body: { data: [orgExport()], meta: { nextCursor: null, pageSize: 10 } } };
      if (url.pathname === `/organizations/current/data-exports/${orgExport().id}`)
        return ok(orgExport());
      if (url.pathname.endsWith("/download-url")) {
        return ok({
          url: "http://127.0.0.1:4999/api/v1/organizations/current/data-exports/x/download?org=o&expires=1&sig=s",
          expiresAt: "2026-10-25T09:15:00.000Z",
        });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderUi(<DataAndDeletionSection profile={PROFILE} navigate={navigate} />);
    await user.click(await screen.findByTestId("org-export-download"));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/api/v1/organizations/current/data-exports/x/download?org=o&expires=1&sig=s",
      ),
    );
  });

  it("explains a failed link once and drops it from the URL", async () => {
    setLocation("/app/settings?tab=organization&downloadError=EXPORT_EXPIRED");
    routes({ pending: false, exports: [] });
    renderUi(<DataAndDeletionSection profile={PROFILE} />);
    expect(await screen.findByTestId("org-export-link-problem")).toHaveTextContent(/expired/);
    expect(routerReplace).toHaveBeenCalledWith("/app/settings?tab=organization", { scroll: false });
  });

  it("shows non-owners who can export and delete, with no buttons", async () => {
    role = "admin";
    routes({ pending: false, exports: [] });
    renderUi(<DataAndDeletionSection profile={PROFILE} />);
    await waitFor(() =>
      expect(screen.getByTestId("org-export-owners-only")).toHaveTextContent(
        /Ask Ada Okafor \(Sample\)/,
      ),
    );
    expect(screen.getByTestId("org-delete-owners-only")).toBeInTheDocument();
    expect(screen.queryByTestId("org-export-request")).toBeNull();
    expect(screen.queryByTestId("org-delete-open")).toBeNull();
  });

  it("lets an owner cancel a pending deletion after confirming", async () => {
    const { calls } = routes({ pending: true, exports: [] });
    const user = userEvent.setup();
    renderUi(<DataAndDeletionSection profile={PENDING_PROFILE} />);
    expect(await screen.findByTestId("org-deletion-pending")).toHaveTextContent(
      /Scheduled for deletion on/,
    );
    await user.click(screen.getByTestId("org-deletion-cancel"));
    const confirm = await screen.findByRole("alertdialog", {
      name: "Cancel the scheduled deletion?",
    });
    expect(within(confirm).getByRole("button", { name: "Keep it scheduled" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Cancel deletion" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.path === "/organizations/current/deletion-requests",
        ),
      ).toBe(true),
    );
  });
});

describe("pending deletion banner and notices", () => {
  it("shows owners a banner they cannot dismiss, with the way to cancel", async () => {
    pendingInMe = true;
    stubApi((url) => (url.pathname === "/organizations/current" ? ok(PENDING_PROFILE) : undefined));
    renderUi(<OrgDeletionBanner />);
    const banner = await screen.findByTestId("org-deletion-banner");
    expect(banner).toHaveAttribute("data-audience", "owner");
    expect(within(banner).getByTestId("org-deletion-banner-cancel")).toHaveAttribute(
      "href",
      "/app/settings?tab=organization#data-and-deletion",
    );
    expect(within(banner).queryByRole("button", { name: /Dismiss/ })).toBeNull();
  });

  it("lets other members hide it for the session", async () => {
    role = "sales_rep";
    pendingInMe = true;
    stubApi((url) =>
      url.pathname === "/organizations/current"
        ? ok({ ...PENDING_PROFILE, role: "sales_rep" })
        : undefined,
    );
    const user = userEvent.setup();
    renderUi(<OrgDeletionBanner />);
    const banner = await screen.findByTestId("org-deletion-banner");
    expect(banner).toHaveTextContent(/ask one/);
    await user.click(within(banner).getByRole("button", { name: /Dismiss/ }));
    await waitFor(() => expect(screen.queryByTestId("org-deletion-banner")).toBeNull());
  });

  it("shows nothing when no deletion is pending, even if the profile request fails", async () => {
    stubApi((url) =>
      url.pathname === "/organizations/current" ? fail(500, "INTERNAL_ERROR", "x") : undefined,
    );
    renderUi(<OrgDeletionBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("org-deletion-banner")).toBeNull();
  });

  it("explains a refusal in flows, with the cancel link for owners only", () => {
    stubApi(() => undefined);
    const err = new ApiError({
      code: "ORGANIZATION_PENDING_DELETION",
      message: "x",
      status: 409,
      details: [{ path: "purgeAfter", message: PURGE_AFTER }],
    });
    const { unmount } = renderUi(
      <PendingDeletionNotice error={err} outcome="Nothing was queued." />,
    );
    expect(screen.getByTestId("pending-deletion-block")).toHaveTextContent(/Nothing was queued/);
    expect(screen.getByRole("link", { name: /Cancel deletion/ })).toBeInTheDocument();
    unmount();
    role = "researcher";
    renderUi(<PendingDeletionNotice error={err} />);
    expect(screen.queryByRole("link", { name: /Cancel deletion/ })).toBeNull();
    renderUi(
      <PendingDeletionNotice
        error={new ApiError({ code: "CONFLICT", message: "x", status: 409 })}
      />,
    );
    expect(screen.getAllByTestId("pending-deletion-block")).toHaveLength(1);
  });
});
