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
  INTERNAL_ERROR: 500,
};
