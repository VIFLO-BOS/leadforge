import type { ErrorCode } from "@leadforge/contracts";
import { isApiError } from "./api";

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "Some fields need attention.",
  UNAUTHENTICATED: "Please sign in to continue.",
  TOKEN_EXPIRED: "Your session expired. Please sign in again.",
  INVALID_CREDENTIALS: "That email and password combination was not recognized.",
  INVALID_TOKEN: "This link is invalid or has already been used.",
  EMAIL_NOT_VERIFIED: "Verify your email address to continue.",
  FORBIDDEN: "You do not have permission to do that.",
  ORG_FORBIDDEN: "You are not a member of this organization.",
  CSRF_FAILED: "Your session could not be confirmed. Reload the page and try again.",
  NOT_FOUND: "We could not find what you were looking for.",
  CONFLICT: "That already exists.",
  LAST_OWNER: "An organization must keep at least one owner.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  INTERNAL_ERROR: "Something went wrong on our side.",
};

export function friendlyMessage(err: unknown, fallback = "Something went wrong."): string {
  if (isApiError(err)) {
    if (err.code === "VALIDATION_FAILED" && err.details?.length) {
      return err.details.map((d) => d.message).join(" ");
    }
    return MESSAGES[err.code] ?? err.message ?? fallback;
  }
  if (err instanceof TypeError)
    return "Could not reach the server. Check your connection and try again.";
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function requestIdOf(err: unknown): string | undefined {
  return isApiError(err) && err.code === "INTERNAL_ERROR" ? err.requestId : undefined;
}
