import {
  ERROR_STATUS,
  RETRY_AFTER_DETAIL_PATH,
  type ErrorCode,
  type ErrorDetail,
} from "@leadforge/contracts";

/**
 * Domain error carrying a stable code. The exception filter maps it to the
 * API error envelope and the conventional HTTP status.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  /** 429 only: whole seconds until a retry can succeed, sent as `Retry-After` (60 when unset). */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: ErrorDetail[],
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(message ?? defaultMessage(code));
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /**
   * 429 RATE_LIMITED with a known wait: `Retry-After` and the `retryAfterSeconds` detail carry the
   * same whole number of seconds (at least 1).
   */
  static rateLimited(message: string, retryAfterSeconds: number): AppError {
    const seconds = wholeRetrySeconds(retryAfterSeconds);
    return new AppError("RATE_LIMITED", message, retryAfterDetails(seconds), {
      retryAfterSeconds: seconds,
    });
  }

  static notFound(what = "Resource"): AppError {
    return new AppError("NOT_FOUND", `${what} was not found`);
  }

  static forbidden(message = "You do not have permission to do that"): AppError {
    return new AppError("FORBIDDEN", message);
  }

  static conflict(message: string): AppError {
    return new AppError("CONFLICT", message);
  }

  static validation(details: ErrorDetail[], message = "Request validation failed"): AppError {
    return new AppError("VALIDATION_FAILED", message, details);
  }
}

/** A retry wait as whole seconds, at least 1 (a Retry-After of 0 would invite an immediate retry). */
export function wholeRetrySeconds(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 1;
}

/** The `details` entry naming the retry wait (`RETRY_AFTER_DETAIL_PATH`). */
export function retryAfterDetails(seconds: number): ErrorDetail[] {
  return [{ path: RETRY_AFTER_DETAIL_PATH, message: String(seconds) }];
}

function defaultMessage(code: ErrorCode): string {
  switch (code) {
    case "UNAUTHENTICATED":
      return "Sign in to continue";
    case "TOKEN_EXPIRED":
      return "Your session has expired";
    case "INVALID_CREDENTIALS":
      return "Email or password is incorrect";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email address to continue";
    case "ORG_FORBIDDEN":
      return "You are not a member of this organization";
    case "RATE_LIMITED":
      return "Too many requests. Try again shortly";
    case "CSRF_FAILED":
      return "Request could not be verified. Reload the page and try again";
    case "INVALID_TOKEN":
      return "This link is invalid or has expired";
    case "LAST_OWNER":
      return "An organization must keep at least one owner";
    case "INTERNAL_ERROR":
      return "Something went wrong on our side";
    default:
      return code.toLowerCase().replace(/_/g, " ");
  }
}
