import type { Route } from "@playwright/test";
import type { MeResponse, OrganizationDataExport, OrganizationProfile } from "@leadforge/contracts";

/*
 * Stage 10 fixtures: the organization deletion workflow and the organization data export
 * (Settings, Organization, "Data and deletion"), plus the 409 ORGANIZATION_PENDING_DELETION the
 * API answers for new paid or long work while a deletion is pending. Stateful per page: a request
 * makes the deletion pending, a cancellation clears it, a new export builds over a few polls.
 */

export const ORG_EXPORT_ID = "6add8b76520012303c64d0aa";
export const ORG_EXPORT_NEW_ID = "6add8b76520012303c64d0ab";
export const ORG_EXPORT_ACTIVE_ID = "6add8b76520012303c64d0ac";
export const DELETION_REQUESTED_AT = "2026-10-25T09:00:00.000Z";
export const PURGE_AFTER = "2026-11-08T09:00:00.000Z";
/** The password the deletion mock accepts; anything else is REAUTH_FAILED. */
export const OWNER_PASSWORD = "synthetic-owner-pass-2026";

const ORG_ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const USER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

export const STAGE10_ROUTES = ["/app/settings?tab=organization"] as const;

export type OrgExportFixture = "none" | "queued" | "running" | "completed" | "failed" | "expired";

export interface Stage10Options {
  role?: string;
  /** The active organization is scheduled for deletion. */
  orgDeletion?: "pending";
  /** POST deletion-requests answers with this error (the right name and password otherwise succeed). */
  orgDeletionError?: "rate" | "server";
  /** The latest organization data export (GET …/data-exports). Defaults to none. */
  orgExport?: OrgExportFixture;
  /** POST …/data-exports answers 409 CONFLICT naming a running export. */
  orgExportConflict?: boolean;
}

const SECTIONS: OrganizationDataExport["sections"] = [
  { key: "organization", rows: 1 },
  { key: "members", rows: 4 },
  { key: "businesses", rows: 24 },
  { key: "observations", rows: 96 },
  { key: "lists", rows: 3 },
  { key: "list_items", rows: 18 },
  { key: "leads", rows: 12 },
  { key: "activities", rows: 40 },
  { key: "outreach", rows: 9 },
  { key: "imports", rows: 2 },
  { key: "jobs", rows: 11 },
  { key: "credit_ledger", rows: 27 },
  { key: "invoices", rows: 2 },
  { key: "payments", rows: 3 },
  { key: "usage", rows: 30 },
  { key: "audit_events", rows: 150 },
];

export function orgExport(over: Partial<OrganizationDataExport> = {}): OrganizationDataExport {
  return {
    id: ORG_EXPORT_ID,
    status: "completed",
    progress: { completedSections: 16, totalSections: 16, currentSection: null },
    sections: SECTIONS,
    file: {
      name: "leadforge-organization-2026-10-25-09-00-00.zip",
      bytes: 482_311,
      sha256: "4f3c2b1a0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b",
      expiresAt: "2026-11-01T09:00:00.000Z",
      available: true,
    },
    error: null,
    requestedByUserId: USER_ID,
    createdAt: "2026-10-25T08:58:00.000Z",
    startedAt: "2026-10-25T08:58:01.000Z",
    finishedAt: "2026-10-25T09:00:00.000Z",
    ...over,
  };
}

function fixtureExport(kind: OrgExportFixture): OrganizationDataExport | null {
  switch (kind) {
    case "queued":
      return orgExport({
        status: "queued",
        progress: { completedSections: 0, totalSections: 16, currentSection: null },
        sections: [],
        file: null,
        startedAt: null,
        finishedAt: null,
      });
    case "running":
      return orgExport({
        status: "running",
        progress: { completedSections: 6, totalSections: 16, currentSection: "leads" },
        sections: [],
        file: null,
        finishedAt: null,
      });
    case "completed":
      return orgExport();
    case "failed":
      return orgExport({
        status: "failed",
        sections: [],
        file: null,
        error: { code: "EXPORT_ERROR", message: "The export could not be built after retries." },
      });
    case "expired":
      return orgExport({
        status: "expired",
        file: { ...orgExport().file!, expiresAt: "2026-10-20T09:00:00.000Z", available: false },
      });
    default:
      return null;
  }
}

/** New paid or long work the API refuses while a deletion is pending (POST unless noted). */
const REFUSED: RegExp[] = [
  /^\/discovery\/jobs$/,
  /^\/discovery\/jobs\/[a-f0-9]{24}\/retry-failed$/,
  /^\/analysis\/websites$/,
  /^\/businesses\/[a-f0-9]{24}\/refresh$/,
  /^\/enrichment\/businesses\/[a-f0-9]{24}\/(website-contacts|check-email)$/,
  /^\/imports$/,
  /^\/imports\/[a-f0-9]{24}\/commit$/,
  /^\/billing\/checkout\/(credits|subscription)$/,
  /^\/billing\/subscription\/resume$/,
  /^\/organizations\/current\/invitations$/,
  /^\/invitations\/[^/]+\/accept$/,
];

function json(route: Route, status: number, body: unknown, headers?: Record<string, string>) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    headers,
  });
}

function err(
  route: Route,
  status: number,
  code: string,
  message: string,
  details?: unknown[],
  headers?: Record<string, string>,
) {
  return json(route, status, { error: { code, message, details, requestId: "e2e" } }, headers);
}

export function createStage10Mock(opts: Stage10Options = {}) {
  const owner = (opts.role ?? "owner") === "owner";
  let pending = opts.orgDeletion === "pending";
  let requestedAt = DELETION_REQUESTED_AT;
  let purgeAfter = PURGE_AFTER;
  let latest = fixtureExport(opts.orgExport ?? "none");
  const polls = new Map<string, number>();

  const deletion = () =>
    pending
      ? { deletionRequestedAt: requestedAt, purgeAfter }
      : { deletionRequestedAt: null, purgeAfter: null };

  /** A new export: queued, then running, then completed on the third read. */
  const progressed = (id: string): OrganizationDataExport | null => {
    if (!latest || latest.id !== id) return null;
    if (id !== ORG_EXPORT_NEW_ID && id !== ORG_EXPORT_ACTIVE_ID) return latest;
    const n = (polls.get(id) ?? 0) + 1;
    polls.set(id, n);
    if (n === 1)
      latest = orgExport({
        id,
        status: "running",
        progress: { completedSections: 4, totalSections: 16, currentSection: "observations" },
        sections: [],
        file: null,
        finishedAt: null,
      });
    else if (n >= 2)
      latest = orgExport({
        id,
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
    return latest;
  };

  return {
    /** /auth/me with the active organization's deletion state. */
    me(base: MeResponse): MeResponse {
      return {
        ...base,
        organizations: base.organizations.map((o, i) => (i === 0 ? { ...o, ...deletion() } : o)),
      };
    },
    profile(base: OrganizationProfile): OrganizationProfile {
      return {
        ...base,
        role: (opts.role as OrganizationProfile["role"]) ?? base.role,
        ...deletion(),
      };
    },
    handle(route: Route, url: URL, path: string, method: string): Promise<void> | null {
      if (method === "POST" && pending && REFUSED.some((r) => r.test(path))) {
        return err(
          route,
          409,
          "ORGANIZATION_PENDING_DELETION",
          `This organization is scheduled for deletion on ${purgeAfter.slice(0, 10)}; new work is paused until an owner cancels it.`,
          [{ path: "purgeAfter", message: purgeAfter }],
        );
      }
      if (path === "/organizations/current/deletion-requests") {
        if (!owner) return err(route, 403, "FORBIDDEN", "Only owners can do this.");
        if (method === "POST") {
          const body = (route.request().postDataJSON() ?? {}) as {
            confirmName?: string;
            password?: string;
          };
          if (body.confirmName !== "Sample Logistics Ltd (Sample)") {
            return err(route, 400, "VALIDATION_FAILED", "Request validation failed", [
              {
                path: "confirmName",
                message: "Type the organization's name exactly as it is shown",
              },
            ]);
          }
          if (opts.orgDeletionError === "rate") {
            return err(
              route,
              429,
              "RATE_LIMITED",
              "Too many failed sign-in attempts for this account. Try again in 15 minutes.",
              [{ path: "retryAfterSeconds", message: "900" }],
              { "retry-after": "900" },
            );
          }
          if (opts.orgDeletionError === "server")
            return err(route, 500, "INTERNAL_ERROR", "Something went wrong on our side");
          if (body.password !== OWNER_PASSWORD)
            return err(route, 403, "REAUTH_FAILED", "The password is not correct");
          if (!pending) {
            pending = true;
            requestedAt = new Date().toISOString();
            purgeAfter = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
          }
          return json(route, 202, { data: { deletionRequestedAt: requestedAt, purgeAfter } });
        }
        if (method === "DELETE") {
          pending = false;
          return route.fulfill({ status: 204, body: "" });
        }
      }
      if (!path.startsWith("/organizations/current/data-exports")) return null;
      if (!owner)
        return err(route, 403, "FORBIDDEN", "Only owners can export the organization's data.");
      if (method === "GET" && path === "/organizations/current/data-exports") {
        return json(route, 200, {
          data: latest ? [latest] : [],
          meta: { nextCursor: null, pageSize: 10 },
        });
      }
      if (method === "POST" && path === "/organizations/current/data-exports") {
        if (opts.orgExportConflict) {
          latest = orgExport({
            id: ORG_EXPORT_ACTIVE_ID,
            status: "running",
            progress: { completedSections: 2, totalSections: 16, currentSection: "businesses" },
            sections: [],
            file: null,
            finishedAt: null,
          });
          return err(route, 409, "CONFLICT", "An organization export is already being built", [
            { path: "activeExportId", message: ORG_EXPORT_ACTIVE_ID },
          ]);
        }
        latest = orgExport({
          id: ORG_EXPORT_NEW_ID,
          status: "queued",
          progress: { completedSections: 0, totalSections: 16, currentSection: null },
          sections: [],
          file: null,
          createdAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
        });
        polls.set(ORG_EXPORT_NEW_ID, 0);
        return json(route, 202, { data: latest });
      }
      const m =
        /^\/organizations\/current\/data-exports\/([a-f0-9]{24})(\/download-url|\/download)?$/.exec(
          path,
        );
      if (method === "GET" && m) {
        const id = m[1]!;
        if (!m[2]) {
          const e = progressed(id);
          return e
            ? json(route, 200, { data: e })
            : err(route, 404, "NOT_FOUND", "Organization export not found");
        }
        if (!latest || latest.id !== id)
          return err(route, 404, "NOT_FOUND", "Organization export not found");
        if (m[2] === "/download-url") {
          if (latest.status === "expired" || (latest.file && !latest.file.available))
            return err(
              route,
              410,
              "EXPORT_EXPIRED",
              "This export's file was deleted after its retention period",
            );
          if (latest.status !== "completed")
            return err(route, 409, "EXPORT_NOT_READY", "This export is still being built");
          return json(route, 200, {
            data: {
              url: `http://127.0.0.1:4999/api/v1/organizations/current/data-exports/${id}/download?org=${ORG_ID}&expires=1793000000&sig=e2e-signature-abcdefghijklmnop`,
              expiresAt: "2026-10-25T09:15:00.000Z",
            },
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/zip",
          headers: {
            "content-disposition": `attachment; filename="${latest.file?.name ?? "export.zip"}"`,
          },
          body: Buffer.from("PK e2e sample organization export"),
        });
      }
      return null;
    },
  };
}
