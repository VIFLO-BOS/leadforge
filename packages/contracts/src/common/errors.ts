import { z } from "zod";

export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "ORG_FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INSUFFICIENT_CREDITS",
  "ENTITLEMENT_REQUIRED",
  "SOURCE_UNAVAILABLE",
  "SOURCE_POLICY_BLOCKED",
  "INVALID_URL",
  "URL_NOT_ALLOWED",
  "PAYMENT_PROVIDER_ERROR",
  "WEBHOOK_SIGNATURE_INVALID",
  "JOB_NOT_CANCELLABLE",
  "MERGE_CONFLICT",
  "INVALID_CREDENTIALS",
  "INVALID_TOKEN",
  "CSRF_FAILED",
  "LAST_OWNER",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "IMPORT_INVALID",
  "EXPORT_TOO_LARGE",
  "SOURCE_NOT_CONFIGURED",
  "SOURCE_DISABLED",
  "JOB_NOT_RETRYABLE",
  "WEBSITE_MISSING",
  "VERSION_CONFLICT",
  "STAGE_NOT_EMPTY",
  "INVALID_ASSIGNEE",
  "CONTACT_SUPPRESSED",
  "BULK_LIMIT_EXCEEDED",
  "EXPORT_NOT_READY",
  "EXPORT_EXPIRED",
  "DOWNLOAD_LINK_INVALID",
  "DOWNLOAD_LINK_EXPIRED",
  "BILLING_NOT_CONFIGURED",
  "PRICE_NOT_PUBLISHED",
  "MEMBER_LIMIT_REACHED",
  "CREDIT_BALANCE_NEGATIVE",
  "ORGANIZATION_PENDING_DELETION",
  "REAUTH_FAILED",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorDetail = z.object({
  path: z.string(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof ErrorDetail>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.array(ErrorDetail).optional(),
    requestId: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/**
 * Stage 9: a `429 RATE_LIMITED` whose wait is known carries
 * `details: [{ path: "retryAfterSeconds", message: "<whole seconds>" }]`, the same number as its
 * `Retry-After` header: the per-account sign-in lock (the time left on that lock) and the per-IP or
 * per-user route limits (the time left on the throttler's block). Other 429s (per-organization job
 * quotas, the verification-email limit) send no detail and `Retry-After: 60`.
 */
export const RETRY_AFTER_DETAIL_PATH = "retryAfterSeconds";

/** HTTP status conventionally associated with each error code. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_TOKEN: 400,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  ORG_FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LAST_OWNER: 409,
  JOB_NOT_CANCELLABLE: 409,
  MERGE_CONFLICT: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_CREDITS: 402,
  ENTITLEMENT_REQUIRED: 402,
  SOURCE_UNAVAILABLE: 503,
  SOURCE_POLICY_BLOCKED: 422,
  INVALID_URL: 400,
  URL_NOT_ALLOWED: 422,
  PAYMENT_PROVIDER_ERROR: 502,
  WEBHOOK_SIGNATURE_INVALID: 401,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IMPORT_INVALID: 422,
  EXPORT_TOO_LARGE: 422,
  SOURCE_NOT_CONFIGURED: 422,
  SOURCE_DISABLED: 422,
  JOB_NOT_RETRYABLE: 409,
  WEBSITE_MISSING: 422,
  /** Phase 5: the lead, pipeline config or outreach record changed since it was read (send the current version). */
  VERSION_CONFLICT: 409,
  /** Phase 5: a pipeline stage that still holds leads cannot be archived. */
  STAGE_NOT_EMPTY: 409,
  /** Phase 5: the assignee is not an active member who can work leads. */
  INVALID_ASSIGNEE: 422,
  /** Phase 5: the business or contact is suppressed; send suppressionOverride.reason to log it anyway. */
  CONTACT_SUPPRESSED: 409,
  /** Phase 5: the selection is larger than the bulk operation limit. */
  BULK_LIMIT_EXCEEDED: 422,
  /** Phase 5: the export is not completed yet (or failed), so there is nothing to download. */
  EXPORT_NOT_READY: 409,
  /** Phase 5: the export file was deleted after its retention window; run the export again. */
  EXPORT_EXPIRED: 410,
  /** Phase 5: the download link is malformed, tampered with, or issued to another user or organization. */
  DOWNLOAD_LINK_INVALID: 403,
  /** Phase 5: the download link is past its expiry; request a new one. */
  DOWNLOAD_LINK_EXPIRED: 410,
  /** Phase 6: payments are not configured on this server (no PAYSTACK_SECRET_KEY); nothing was charged. */
  BILLING_NOT_CONFIGURED: 422,
  /** Phase 6: the plan or credit pack price is a placeholder (or zero) and is never charged on a live key. */
  PRICE_NOT_PUBLISHED: 422,
  /** Phase 6: the organization is at its plan's member cap (details: members.cap, members.used). */
  MEMBER_LIMIT_REACHED: 402,
  /** Phase 6: the credit balance is below zero after a refund or reversal; new discovery and analyses are blocked until it is topped up (details: credits.balance). */
  CREDIT_BALANCE_NEGATIVE: 402,
  /**
   * Stage 10: the organization is scheduled for deletion (14-day grace). New discovery, website
   * analysis and enrichment, imports, checkouts and plan changes, and invitations are refused until
   * an owner cancels the deletion (details: purgeAfter). Reads, exports and CRM edits keep working.
   */
  ORGANIZATION_PENDING_DELETION: 409,
  /** Stage 10: the current password given to confirm a destructive action is wrong (never 401: the session is fine). */
  REAUTH_FAILED: 403,
  INTERNAL_ERROR: 500,
};
