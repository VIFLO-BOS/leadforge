import {
  ORGANIZATION_DELETION_GRACE_DAYS,
  ORGANIZATION_EXPORT_DOWNLOAD_ERROR_CODES,
  ORGANIZATION_LIFECYCLE_PAGE,
  type OrganizationDataExport,
  type OrganizationExportDownloadErrorCode,
  type OrganizationExportSection,
} from "@leadforge/contracts";
import type { JobState } from "@leadforge/ui";
import { isApiError } from "./api";
import { formatDate } from "./format";

/*
 * Stage 10: the organization data export and the deletion workflow (Settings, Organization).
 * Owners export everything the workspace holds as one ZIP (JSON and CSV), and can schedule the
 * organization for deletion: 14 days of grace in which an owner can cancel, then the purge.
 */

/** Where the export and the deletion live; a failed export link comes back here (`downloadError`). */
export const ORG_LIFECYCLE_HREF = ORGANIZATION_LIFECYCLE_PAGE;
/** The section's anchor on the Settings page. */
export const ORG_LIFECYCLE_ANCHOR = "data-and-deletion";

export const ORG_EXPORT_POLL_MS = 2_000;
export const GRACE_DAYS = ORGANIZATION_DELETION_GRACE_DAYS;

export interface DeletionState {
  pending: boolean;
  requestedAt: string | null;
  purgeAfter: string | null;
}

/**
 * The deletion state of an organization from GET /organizations/current or the /auth/me
 * membership. Older payloads without the fields count as "not pending".
 */
export function deletionStateOf(
  org: { deletionRequestedAt?: string | null; purgeAfter?: string | null } | null | undefined,
): DeletionState {
  const requestedAt = org?.deletionRequestedAt ?? null;
  const purgeAfter = org?.purgeAfter ?? null;
  return { pending: Boolean(requestedAt), requestedAt, purgeAfter };
}

/** The purge date a request made now would get (shown in the dialog before confirming). */
export function purgeDateFrom(now: number = Date.now()): string {
  return new Date(now + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** "12 Nov 2026" for a purge date, or a neutral phrase when the server did not send one. */
export function purgeDateLabel(iso: string | null | undefined): string {
  return iso ? formatDate(iso) : "the end of the 14-day grace period";
}

/** Whole days left until the purge (0 once the date has passed). */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now) / (24 * 60 * 60 * 1000)));
}

/** True for 409 ORGANIZATION_PENDING_DELETION. */
export function isPendingDeletion(err: unknown): boolean {
  return isApiError(err) && err.code === "ORGANIZATION_PENDING_DELETION";
}

/** The purge date from a 409 ORGANIZATION_PENDING_DELETION (`details` path `purgeAfter`). */
export function pendingDeletionPurgeAfter(err: unknown): string | null {
  if (!isPendingDeletion(err) || !isApiError(err)) return null;
  const raw = err.details?.find((d) => d.path === "purgeAfter")?.message;
  return raw && !Number.isNaN(new Date(raw).getTime()) ? raw : null;
}

/** Plain words for ORGANIZATION_PENDING_DELETION, with the purge date when the server sent one. */
export function pendingDeletionMessage(purgeAfter: string | null): string {
  return `This organization is scheduled for deletion${purgeAfter ? ` on ${formatDate(purgeAfter)}` : ""}, so new discovery, website analysis, imports, purchases and invitations are paused. Everything else keeps working. An owner can cancel the deletion in Settings, Organization.`;
}

// ---------------------------------------------------------------------------
// What the deletion removes and keeps (the dialog, the legal pages and docs say the same)
// ---------------------------------------------------------------------------

export const DELETED_ITEMS: readonly string[] = [
  "Businesses, their contacts and provenance (source observations and verification history)",
  "Lead lists, leads, activities and outreach records",
  "Imports, discovery jobs, website analyses, enrichment runs, duplicate reviews and merge history",
  "Export jobs and their files, organization data exports, and in-app notifications",
  "Memberships, pending invitations and notification preferences",
  "Accounts that belong to no other organization: their email, name and password are erased and every session is signed out",
];

export const KEPT_ITEMS: readonly string[] = [
  "Payments, invoices and their PDFs, refunds and the credit ledger, kept for the statutory period billing law requires",
  "The billing audit trail and the security audit log of who did what",
  "Accounts of people who also belong to another organization (only their membership here ends)",
];

// ---------------------------------------------------------------------------
// Organization data export
// ---------------------------------------------------------------------------

export const ORG_EXPORT_SECTION_LABELS: Record<OrganizationExportSection, string> = {
  organization: "Organization profile",
  members: "Members",
  businesses: "Businesses",
  observations: "Provenance (source observations)",
  lists: "Lead lists",
  list_items: "List items",
  leads: "Leads",
  activities: "Activities",
  outreach: "Outreach",
  imports: "Imports",
  jobs: "Jobs",
  credit_ledger: "Credit ledger",
  invoices: "Invoices",
  payments: "Payments",
  usage: "Usage",
  audit_events: "Audit log",
};

export const ORG_EXPORT_STATUS_LABELS: Record<OrganizationDataExport["status"], string> = {
  queued: "Queued",
  running: "Building the file",
  completed: "Ready to download",
  failed: "Failed",
  expired: "Expired",
};

export function isOrgExportActive(
  e: Pick<OrganizationDataExport, "status"> | null | undefined,
): boolean {
  return e?.status === "queued" || e?.status === "running";
}

export function orgExportJobState(status: OrganizationDataExport["status"]): JobState {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "cancelled";
  }
}

/** The id of the export already being built, from a 409 CONFLICT (`details` path `activeExportId`). */
export function activeExportIdFrom(err: unknown): string | null {
  if (!isApiError(err) || err.code !== "CONFLICT") return null;
  const id = err.details?.find((d) => d.path === "activeExportId")?.message;
  return id && /^[a-f0-9]{24}$/i.test(id) ? id : null;
}

/** A signed export link that failed in the browser lands on Settings with `downloadError=<code>`. */
export function orgExportDownloadErrorFrom(
  value: string | null,
): OrganizationExportDownloadErrorCode | null {
  return value && (ORGANIZATION_EXPORT_DOWNLOAD_ERROR_CODES as readonly string[]).includes(value)
    ? (value as OrganizationExportDownloadErrorCode)
    : null;
}

export const ORG_EXPORT_DOWNLOAD_ERROR_MESSAGES: Record<
  OrganizationExportDownloadErrorCode,
  { title: string; message: string }
> = {
  DOWNLOAD_LINK_EXPIRED: {
    title: "That download link expired",
    message: "Download links work for 15 minutes. Choose Download ZIP again for a fresh link.",
  },
  DOWNLOAD_LINK_INVALID: {
    title: "That download link is not valid for you",
    message:
      "Organization export links work only for the owner who asked for them, in this workspace. Choose Download ZIP again.",
  },
  EXPORT_EXPIRED: {
    title: "That export has expired",
    message: "Export files are deleted 7 days after they are built. Request a new export.",
  },
  EXPORT_NOT_READY: {
    title: "That export is not ready yet",
    message: "The file is still being built. Download it when the export shows Ready to download.",
  },
};
