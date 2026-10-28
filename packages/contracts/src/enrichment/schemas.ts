import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";
import { WebsiteAnalysis } from "../analysis/schemas.js";

/**
 * Enrichment runs: contact extraction from the business's own website (`website_contacts`)
 * and email checks (`email_check`). Release 1 email checks are syntax, MX and
 * disposable-domain only: an email is never `verified` (no mailbox probing), so the UI shows
 * "Mailbox not confirmed". Enrichment is free (no credits).
 */
export const EnrichmentRunKind = z.enum(["website_contacts", "email_check"]);
export type EnrichmentRunKind = z.infer<typeof EnrichmentRunKind>;

export const EnrichmentRunStatus = z.enum(["queued", "running", "completed", "failed"]);
export type EnrichmentRunStatus = z.infer<typeof EnrichmentRunStatus>;

export const ENRICHMENT_TERMINAL_STATUSES: readonly EnrichmentRunStatus[] = ["completed", "failed"];

/** Result of one email check. `verified` is impossible in release 1. */
export const EmailCheckResult = z.enum([
  "mx_found",
  "no_mx",
  "disposable",
  "invalid_syntax",
  "dns_error",
]);
export type EmailCheckResult = z.infer<typeof EmailCheckResult>;

export const EnrichmentRun = z.object({
  id: ObjectIdString,
  businessId: ObjectIdString,
  kind: EnrichmentRunKind,
  status: EnrichmentRunStatus,
  trigger: z.enum(["manual", "refresh"]),
  input: z.object({ url: z.string().nullable(), address: z.string().nullable() }),
  output: z.object({
    pagesVisited: z.array(
      z.object({
        url: z.string(),
        status: z.number().int().nullable(),
        error: z.string().nullable(),
      }),
    ),
    observationIds: z.array(ObjectIdString),
    found: z.object({
      phones: z.number().int(),
      emails: z.number().int(),
      socials: z.number().int(),
      whatsapp: z.number().int(),
    }),
    phonesVerified: z.number().int(),
    whatsappConfirmed: z.number().int(),
    emailChecks: z.array(z.object({ address: z.string(), result: EmailCheckResult })),
    ownSite: z.boolean().nullable(),
  }),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedByUserId: UuidString,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type EnrichmentRun = z.infer<typeof EnrichmentRun>;

/** `POST /enrichment/businesses/:id/check-email`: an address already on the business. */
export const EmailCheckRequest = z.object({ address: z.string().trim().min(3).max(254) }).strict();
export type EmailCheckRequest = z.infer<typeof EmailCheckRequest>;

export const EnrichmentRunListQuery = z.object({
  kind: queryArray(EnrichmentRunKind, 2),
  status: queryArray(EnrichmentRunStatus, 4),
  ...CursorQuery.shape,
});
export type EnrichmentRunListQuery = z.infer<typeof EnrichmentRunListQuery>;

/** `POST /businesses/:id/refresh`: re-collect contacts and re-analyze the website. */
export const RefreshResponse = z.object({
  enrichmentRun: EnrichmentRun,
  analysis: WebsiteAnalysis,
  /** True when an analysis was already queued or running (no new credit held). */
  analysisAlreadyInProgress: z.boolean(),
});
export type RefreshResponse = z.infer<typeof RefreshResponse>;
