import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import type { ErrorCode } from "../common/errors.js";
import { CountryCode, Email, PersonName } from "../auth/schemas.js";
import { OrganizationRole } from "./roles.js";

export const OrganizationProfile = z.object({
  id: UuidString,
  name: z.string(),
  slug: z.string(),
  country: z.string(),
  defaultCurrency: z.string(),
  freshnessDays: z.number().int(),
  createdAt: IsoDateTime,
  memberCount: z.number().int(),
  role: OrganizationRole,
  /** Stage 10: when an owner asked to delete the organization; null when no deletion is pending. */
  deletionRequestedAt: IsoDateTime.nullable(),
  /** Stage 10: the earliest moment the purge may start (deletionRequestedAt + 14 days); null when none is pending. */
  purgeAfter: IsoDateTime.nullable(),
});
export type OrganizationProfile = z.infer<typeof OrganizationProfile>;

export const UpdateOrganizationRequest = z
  .object({
    name: z.string().trim().min(2).max(120),
    country: CountryCode,
    defaultCurrency: z.string().trim().toUpperCase().length(3),
    freshnessDays: z.number().int().min(7).max(730),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequest>;

export const MemberStatus = z.enum(["active", "suspended"]);
export type MemberStatus = z.infer<typeof MemberStatus>;

export const MemberSummary = z.object({
  userId: UuidString,
  email: Email,
  name: PersonName,
  role: OrganizationRole,
  status: MemberStatus,
  joinedAt: IsoDateTime,
});
export type MemberSummary = z.infer<typeof MemberSummary>;

export const UpdateMemberRequest = z
  .object({
    role: OrganizationRole,
    status: MemberStatus,
  })
  .partial()
  .refine((v) => v.role !== undefined || v.status !== undefined, "Provide role or status");
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export const CreateInvitationRequest = z.object({
  email: Email,
  role: OrganizationRole.exclude(["owner"]),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

export const InvitationSummary = z.object({
  id: UuidString,
  email: Email,
  role: OrganizationRole,
  invitedBy: z.object({ id: UuidString, name: z.string() }),
  expiresAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type InvitationSummary = z.infer<typeof InvitationSummary>;

export const InvitationPreview = z.object({
  organizationName: z.string(),
  email: Email,
  role: OrganizationRole,
  expiresAt: IsoDateTime,
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

// ---------------------------------------------------------------------------
// Stage 10: organization deletion workflow
// ---------------------------------------------------------------------------

/** Days between a deletion request and the purge; an owner can cancel at any time before it starts. */
export const ORGANIZATION_DELETION_GRACE_DAYS = 14;
/** Owners and admins get a reminder email this many days before the purge. */
export const ORGANIZATION_DELETION_REMINDER_DAYS = 3;

/**
 * `POST /organizations/current/deletion-requests` (owner only). `confirmName` must equal the
 * organization's current name exactly (VALIDATION_FAILED otherwise) and `password` is the owner's
 * current password (403 REAUTH_FAILED when wrong; failures count toward the per-account sign-in lock).
 */
export const RequestOrganizationDeletion = z
  .object({
    confirmName: z.string().min(1).max(200),
    password: z.string().min(1).max(256),
  })
  .strict();
export type RequestOrganizationDeletion = z.infer<typeof RequestOrganizationDeletion>;

/** A pending deletion: when it was requested and when the purge may start. */
export const OrganizationDeletionStatus = z.object({
  deletionRequestedAt: IsoDateTime,
  purgeAfter: IsoDateTime,
});
export type OrganizationDeletionStatus = z.infer<typeof OrganizationDeletionStatus>;

// ---------------------------------------------------------------------------
// Stage 10: organization data export (owner only)
// ---------------------------------------------------------------------------

/**
 * Sections of the organization data export ZIP, in build order. Each is written as
 * `<section>.json` and, for tabular sections, `<section>.csv` (formula-safe).
 */
export const ORGANIZATION_EXPORT_SECTIONS = [
  "organization",
  "members",
  "businesses",
  "observations",
  "lists",
  "list_items",
  "leads",
  "activities",
  "outreach",
  "imports",
  "jobs",
  "credit_ledger",
  "invoices",
  "payments",
  "usage",
  "audit_events",
] as const;
export const OrganizationExportSection = z.enum(ORGANIZATION_EXPORT_SECTIONS);
export type OrganizationExportSection = z.infer<typeof OrganizationExportSection>;

/** `expired`: the file was deleted after its 7-day retention; request a new export. */
export const OrganizationDataExportStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "expired",
]);
export type OrganizationDataExportStatus = z.infer<typeof OrganizationDataExportStatus>;

export const OrganizationDataExport = z.object({
  id: ObjectIdString,
  status: OrganizationDataExportStatus,
  progress: z.object({
    completedSections: z.number().int(),
    totalSections: z.number().int(),
    /** The section being written while running; null otherwise. */
    currentSection: OrganizationExportSection.nullable(),
  }),
  /** Rows written per section (filled when the export completes). */
  sections: z.array(z.object({ key: OrganizationExportSection, rows: z.number().int() })),
  file: z
    .object({
      name: z.string(),
      bytes: z.number().int(),
      sha256: z.string(),
      expiresAt: IsoDateTime,
      /** False once the file has been deleted. */
      available: z.boolean(),
    })
    .nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedByUserId: UuidString,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type OrganizationDataExport = z.infer<typeof OrganizationDataExport>;

/**
 * A browser navigating to a signed organization-export link that fails with one of these codes
 * gets `303 See Other` to `<APP_URL>/app/settings?tab=organization&downloadError=<code>`; a
 * signed-out navigation goes to sign-in with that page as `next`.
 */
export const ORGANIZATION_EXPORT_DOWNLOAD_ERROR_CODES = [
  "DOWNLOAD_LINK_INVALID",
  "DOWNLOAD_LINK_EXPIRED",
  "EXPORT_EXPIRED",
  "EXPORT_NOT_READY",
] as const satisfies readonly ErrorCode[];
export const OrganizationExportDownloadErrorCode = z.enum(ORGANIZATION_EXPORT_DOWNLOAD_ERROR_CODES);
export type OrganizationExportDownloadErrorCode = z.infer<
  typeof OrganizationExportDownloadErrorCode
>;

/** Settings page that owns the organization data export and the deletion workflow. */
export const ORGANIZATION_LIFECYCLE_PAGE = "/app/settings?tab=organization";
