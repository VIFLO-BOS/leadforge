import { ERROR_STATUS, type ErrorCode, type ErrorDetail } from "@leadforge/contracts";

/**
 * Domain error carrying a stable code. The exception filter maps it to the
 * API error envelope and the conventional HTTP status.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, message?: string, details?: ErrorDetail[]) {
    super(message ?? defaultMessage(code));
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
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
