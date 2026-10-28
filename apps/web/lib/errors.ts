import { RETRY_AFTER_DETAIL_PATH, type ErrorCode } from "@leadforge/contracts";
import { isApiError } from "./api";
import { pendingDeletionMessage, pendingDeletionPurgeAfter } from "./org-lifecycle";

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "Some fields need attention.",
  UNAUTHENTICATED: "Please sign in to continue.",
  TOKEN_EXPIRED: "Your session expired. Please sign in again.",
  INVALID_CREDENTIALS: "That email and password combination was not recognized.",
  INVALID_TOKEN: "This link is invalid or has already been used.",
  EMAIL_NOT_VERIFIED: "Verify your email address to continue.",
  FORBIDDEN: "Your role does not allow this action. Ask an owner or administrator if you need it.",
  ORG_FORBIDDEN: "You are not a member of this organization.",
  CSRF_FAILED:
    "The request was refused because it did not come from this LeadForge page (cross-site protection). Reload the page and try again.",
  NOT_FOUND: "We could not find what you were looking for.",
  CONFLICT: "That already exists.",
  LAST_OWNER: "An organization must keep at least one owner.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  PAYLOAD_TOO_LARGE: "The file is too large. Imports accept up to 20 MB and 50,000 rows.",
  UNSUPPORTED_MEDIA_TYPE:
    "That file type is not supported. Upload a CSV (comma, semicolon or tab separated) saved as .csv, .tsv or .txt.",
  IMPORT_INVALID: "The file could not be read as a CSV.",
  EXPORT_TOO_LARGE:
    "Too many businesses match for one export on this workspace's plan. Narrow the filters or export a list.",
  INSUFFICIENT_CREDITS: "There are not enough credits for this.",
  SOURCE_NOT_CONFIGURED: "A selected source is not configured, so it cannot run.",
  SOURCE_DISABLED: "A selected source is switched off for this workspace.",
  SOURCE_UNAVAILABLE: "The source is not responding right now. Try again later.",
  SOURCE_POLICY_BLOCKED:
    "The provider's terms do not allow this use of a selected source, so it cannot run. Choose another source.",
  JOB_NOT_CANCELLABLE: "This job has already finished, so it cannot be cancelled.",
  JOB_NOT_RETRYABLE:
    "Nothing to retry: the job is still running, its credits are not settled yet, or no item failed.",
  WEBSITE_MISSING:
    "This business has no usable website on record, so there is nothing to fetch. Add its website with Correct details first.",
  MERGE_CONFLICT:
    "One of these businesses changed or was merged since this page loaded. Reload and review it again.",
  VERSION_CONFLICT:
    "Someone else changed this since it loaded. The latest version was loaded; check it and try again.",
  STAGE_NOT_EMPTY: "A stage that still holds leads cannot be archived. Move its leads first.",
  INVALID_ASSIGNEE:
    "That person cannot be assigned leads. Leads go to active owners, administrators and sales representatives.",
  CONTACT_SUPPRESSED:
    "This business or contact is suppressed. Logging contact needs a reason, which is recorded and audited.",
  BULK_LIMIT_EXCEEDED:
    "Bulk operations are limited to 5,000 businesses. Narrow the filters or select fewer businesses.",
  EXPORT_NOT_READY: "The export file is not ready yet.",
  EXPORT_EXPIRED: "The export file was deleted after its retention window. Run the export again.",
  DOWNLOAD_LINK_INVALID: "That download link is not valid for you in this workspace.",
  DOWNLOAD_LINK_EXPIRED: "That download link has expired. Request a new one.",
  BILLING_NOT_CONFIGURED:
    "Payments are not set up on this LeadForge server yet, so nothing can be bought. Nothing was charged.",
  PRICE_NOT_PUBLISHED:
    "This price has not been published yet, so it cannot be bought. Nothing was charged.",
  MEMBER_LIMIT_REACHED:
    "The workspace has reached the member limit of its plan (active members plus pending invitations).",
  CREDIT_BALANCE_NEGATIVE:
    "The credit balance is below zero after a refund or reversal, so new discovery jobs and website analyses are paused until credits are bought.",
  ENTITLEMENT_REQUIRED: "The workspace's plan does not include this feature.",
  PAYMENT_PROVIDER_ERROR:
    "The payment provider could not be reached or declined the request. Nothing was charged; try again in a few minutes.",
  WEBHOOK_SIGNATURE_INVALID: "The payment notification could not be verified.",
  ORGANIZATION_PENDING_DELETION: pendingDeletionMessage(null),
  REAUTH_FAILED: "That password is not correct. Enter your current LeadForge password to confirm.",
  INTERNAL_ERROR: "Something went wrong on our side.",
};

export function friendlyMessage(err: unknown, fallback = "Something went wrong."): string {
  if (isApiError(err)) {
    if (err.code === "VALIDATION_FAILED" && err.details?.length) {
      return err.details.map((d) => d.message).join(" ");
    }
    if (err.code === "IMPORT_INVALID") {
      const line = err.details?.find((d) => d.path === "file")?.message;
      return [err.message || MESSAGES.IMPORT_INVALID, line ? `(${line})` : null]
        .filter(Boolean)
        .join(" ");
    }
    if (err.code === "RATE_LIMITED" && err.retryAfter !== undefined) {
      return `Too many requests. Try again in ${formatWait(err.retryAfter)}.`;
    }
    if (err.code === "INSUFFICIENT_CREDITS") {
      const c = creditShortfall(err);
      if (c) return `This needs ${c.required} credits and ${c.available} are available.`;
    }
    if (err.code === "ENTITLEMENT_REQUIRED") {
      const feature = entitlementFeature(err);
      if (feature) return `The workspace's plan does not include ${feature}.`;
    }
    if (err.code === "MEMBER_LIMIT_REACHED") {
      const m = memberLimitDetails(err);
      if (m) return memberLimitMessage(m);
    }
    if (err.code === "ORGANIZATION_PENDING_DELETION") {
      return pendingDeletionMessage(pendingDeletionPurgeAfter(err));
    }
    if (err.code === "CREDIT_BALANCE_NEGATIVE") {
      const balance = negativeBalanceOf(err);
      if (balance !== null) {
        return `The credit balance is ${balance} after a refund or reversal, so new discovery jobs and website analyses are paused until credits are bought.`;
      }
    }
    return MESSAGES[err.code] ?? err.message ?? fallback;
  }
  if (err instanceof TypeError)
    return "Could not reach the server. Check your connection and try again.";
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** The request ID to quote to support. Every API error carries one; 401s redirect instead. */
export function requestIdOf(err: unknown): string | undefined {
  return isApiError(err) && err.status !== 401 ? err.requestId : undefined;
}

/** True for 403 FORBIDDEN: the signed-in role lacks the permission (the API is the authority). */
export function isForbidden(err: unknown): boolean {
  return isApiError(err) && err.code === "FORBIDDEN";
}

/** Field-level messages from a 400 VALIDATION_FAILED, keyed by detail path ("value", "phones.0"). */
export function validationDetails(err: unknown): Record<string, string> {
  if (!isApiError(err) || err.code !== "VALIDATION_FAILED" || !err.details) return {};
  const out: Record<string, string> = {};
  for (const d of err.details) if (!out[d.path]) out[d.path] = d.message;
  return out;
}

/** "45 seconds", "2 minutes". */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * Required and available credits from a 402 INSUFFICIENT_CREDITS (`details` paths
 * `credits.required` and `credits.available`). Null when the details are absent.
 */
export function creditShortfall(err: unknown): { required: number; available: number } | null {
  if (!isApiError(err) || err.code !== "INSUFFICIENT_CREDITS" || !err.details) return null;
  const read = (path: string) => {
    const raw = err.details?.find((d) => d.path === path)?.message;
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const required = read("credits.required");
  const available = read("credits.available");
  return required === null || available === null ? null : { required, available };
}

function detailNumber(err: unknown, path: string): number | null {
  if (!isApiError(err) || !err.details) return null;
  const raw = err.details.find((d) => d.path === path)?.message;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Plan member cap and use from a 402 MEMBER_LIMIT_REACHED (`members.cap`, `members.used`). */
export function memberLimitDetails(err: unknown): { cap: number; used: number | null } | null {
  if (!isApiError(err) || err.code !== "MEMBER_LIMIT_REACHED") return null;
  const cap = detailNumber(err, "members.cap");
  return cap === null ? null : { cap, used: detailNumber(err, "members.used") };
}

export function memberLimitMessage(m: { cap: number; used: number | null }): string {
  const used = m.used !== null ? ` and ${m.used} ${m.used === 1 ? "is" : "are"} in use` : "";
  return `The workspace's plan allows ${m.cap} ${m.cap === 1 ? "member" : "members"}, counting pending invitations,${used}. Remove a member, revoke an invitation or change the plan.`;
}

/** The balance from a 402 CREDIT_BALANCE_NEGATIVE (`credits.balance`), when sent. */
export function negativeBalanceOf(err: unknown): number | null {
  if (!isApiError(err) || err.code !== "CREDIT_BALANCE_NEGATIVE") return null;
  return detailNumber(err, "credits.balance");
}

const ENTITLEMENT_FEATURES: Record<string, string> = {
  discovery_enabled: "discovery",
  website_analysis_enabled: "website analysis",
};

/** "discovery" or "website analysis" from a 402 ENTITLEMENT_REQUIRED (`details` path `entitlement`). */
export function entitlementFeature(err: unknown): string | null {
  if (!isApiError(err) || err.code !== "ENTITLEMENT_REQUIRED" || !err.details) return null;
  const key = err.details.find((d) => d.path === "entitlement")?.message;
  return key
    ? (ENTITLEMENT_FEATURES[key] ?? key.replace(/_enabled$/, "").replace(/_/g, " "))
    : null;
}

/** Billing-related refusals that an owner or administrator resolves on the Billing page. */
export function isBillingBlock(err: unknown): boolean {
  return (
    isApiError(err) &&
    (err.code === "ENTITLEMENT_REQUIRED" ||
      err.code === "CREDIT_BALANCE_NEGATIVE" ||
      err.code === "MEMBER_LIMIT_REACHED")
  );
}

/**
 * Sign-in failures in plain words. The per-account limit (Phase 7: 10 failed attempts per account
 * in 15 minutes, from any address) answers 429 even with the right password, so it says so and
 * gives the wait from the payload: the `retryAfterSeconds` detail (RETRY_AFTER_DETAIL_PATH, the
 * real remaining time since Stage 9), the server's "Try again in N minutes", or the Retry-After
 * header, in that order.
 */
export function signInErrorMessage(err: unknown): { title: string; message: string } {
  if (isApiError(err) && err.code === "RATE_LIMITED") {
    const perAccount = /this account/i.test(err.message);
    const wait = retryWaitFrom(err);
    if (perAccount) {
      return {
        title: "Sign-in is paused for this account",
        message: `There were too many failed sign-in attempts for this account, so it is paused for everyone, even with the right password.${wait ? ` Try again in ${wait}.` : " Try again later."} If you forgot the password, reset it.`,
      };
    }
    return {
      title: "Too many sign-in attempts",
      message: `Too many attempts from this network.${wait ? ` Try again in ${wait}.` : " Wait a moment and try again."}`,
    };
  }
  return { title: "Could not sign in", message: friendlyMessage(err, "Sign-in failed.") };
}

/** The wait before a retry as words ("15 minutes"), from the payload; null when none is given. */
export function retryWaitFrom(err: unknown): string | null {
  if (!isApiError(err)) return null;
  const detail = detailNumber(err, RETRY_AFTER_DETAIL_PATH);
  if (detail !== null) return formatWait(detail);
  const m = /try again in (\d+)\s*(second|minute|hour)s?/i.exec(err.message);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    return `${n} ${unit}${n === 1 ? "" : "s"}`;
  }
  return err.retryAfter !== undefined ? formatWait(err.retryAfter) : null;
}

/** Source keys named by a 422 SOURCE_NOT_CONFIGURED or SOURCE_DISABLED (`details` path `sources`). */
export function sourcesInError(err: unknown): string[] {
  if (!isApiError(err) || !err.details) return [];
  return err.details
    .filter((d) => d.path === "sources" || d.path.startsWith("sources."))
    .map((d) => d.message);
}
