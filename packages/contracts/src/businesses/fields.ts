import { z } from "zod";
import { IsoDateTime, ObjectIdString } from "../common/ids.js";

/**
 * Per-field state (docs/PRODUCT_REQUIREMENTS.md section 5).
 * - verified: a verification method succeeded.
 * - unverified: observed but not verified.
 * - stale: last observed or verified longer ago than the organization's freshness window.
 * - expired: past the source's retention limit; the value is hidden.
 * - conflicting: sources disagree and no resolution rule applies; alternatives are listed.
 * - missing: no observation.
 */
export const FieldState = z.enum([
  "verified",
  "unverified",
  "stale",
  "expired",
  "missing",
  "conflicting",
]);
export type FieldState = z.infer<typeof FieldState>;

/** WhatsApp has exactly three values. There is no "probably". */
export const WhatsAppStatus = z.enum(["confirmed", "user_asserted", "unknown"]);
export type WhatsAppStatus = z.infer<typeof WhatsAppStatus>;

/**
 * Provenance source keys. `user_edit` covers manual creation and corrections.
 * `overture_places` is the Overture Maps Places open dataset (monthly snapshot).
 */
export const SourceKey = z.enum([
  "google_places",
  "overture_places",
  "website",
  "user_import",
  "user_edit",
]);
export type SourceKey = z.infer<typeof SourceKey>;

/** `dataset_snapshot`: read from a published open-data release kept in LeadForge's staging catalogue. */
export const CollectionMethod = z.enum([
  "api",
  "dataset_snapshot",
  "website_fetch",
  "user_import",
  "user_edit",
]);
export type CollectionMethod = z.infer<typeof CollectionMethod>;

/** Vocabulary a category value came from. `overture` is the Overture Maps places taxonomy. */
export const CategoryTaxonomy = z.enum(["leadforge", "google", "overture", "user"]);
export type CategoryTaxonomy = z.infer<typeof CategoryTaxonomy>;

/**
 * Email address kind from its domain (data only, for data-protection review): `free_mail` for
 * consumer mailbox providers such as gmail.com (often a sole trader's personal address),
 * `business` for any other domain.
 */
export const EmailKind = z.enum(["free_mail", "business"]);
export type EmailKind = z.infer<typeof EmailKind>;

export const ObservationField = z.enum([
  "name",
  "website",
  "phone",
  "email",
  "social",
  "category",
  "location",
  "whatsapp",
  "hours",
  "description",
]);
export type ObservationField = z.infer<typeof ObservationField>;

export const PhoneType = z.enum([
  "mobile",
  "fixed_line",
  "fixed_line_or_mobile",
  "toll_free",
  "voip",
  "other",
  "unknown",
]);
export type PhoneType = z.infer<typeof PhoneType>;

export const SocialPlatform = z.enum([
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
]);
export type SocialPlatform = z.infer<typeof SocialPlatform>;

/** Metadata every contact-bearing field carries. */
export const FieldMeta = z.object({
  state: FieldState,
  /** 0 to 1. */
  confidence: z.number().min(0).max(1),
  /** Provenance references, newest last, capped at 50. */
  observationIds: z.array(ObjectIdString),
  lastObservedAt: IsoDateTime.nullable(),
  lastVerifiedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
});
export type FieldMeta = z.infer<typeof FieldMeta>;

/** A competing value kept when a field is `conflicting`. */
export function alternativeOf<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    rawValue: z.string().nullable(),
    observationIds: z.array(ObjectIdString),
    lastObservedAt: IsoDateTime.nullable(),
  });
}

/**
 * `value` is the normalized value (null when missing or expired), `rawValue` the value as
 * observed (also hidden when expired).
 */
export function fieldValue<T extends z.ZodTypeAny>(value: T) {
  return FieldMeta.extend({
    value: value.nullable(),
    rawValue: z.string().nullable(),
  });
}

/** Compact field summary for table rows. */
export const FieldSummary = z.object({
  value: z.string().nullable(),
  state: FieldState,
});
export type FieldSummary = z.infer<typeof FieldSummary>;
