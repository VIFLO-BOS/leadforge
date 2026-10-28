import { Catch, Inject, Optional, type ArgumentsHost } from "@nestjs/common";
import type { Request, Response } from "express";
import { Logger } from "nestjs-pino";
import {
  EXPORT_DOWNLOAD_ERROR_CODES,
  INVOICE_DOWNLOAD_ERROR_CODES,
  ORGANIZATION_EXPORT_DOWNLOAD_ERROR_CODES,
  ORGANIZATION_LIFECYCLE_PAGE,
  ObjectIdString,
  type ErrorCode,
  type ServerEnv,
} from "@leadforge/contracts";
import { AppError, AppExceptionFilter, ENV, MetricsService } from "@leadforge/core";

/**
 * True when the browser is opening the URL as a page (the user followed a signed download link)
 * rather than fetching it from script: `Sec-Fetch-Mode: navigate`, or, from browsers without Fetch
 * Metadata, an `Accept` header that prefers text/html over JSON. No `Accept`, or `*\/*`, is a
 * script or tool and keeps the JSON envelope.
 */
export function isBrowserNavigation(req: Request): boolean {
  if (String(req.headers["sec-fetch-mode"] ?? "").toLowerCase() === "navigate") return true;
  if (!req.headers.accept) return false;
  return req.accepts(["application/json", "text/html"]) === "text/html";
}

/** Signed out, or the access token ran out: a browser navigation is sent to sign in (Stage 9). */
const SIGN_IN_CODES: readonly ErrorCode[] = ["UNAUTHENTICATED", "TOKEN_EXPIRED"];

/**
 * The download error a failed signed link reports to a navigating browser, or null to keep the
 * JSON envelope. A link whose query fails validation (truncated or edited by hand) is
 * DOWNLOAD_LINK_INVALID; any other failure (no longer a member, server errors) is not
 * redirected. Signed-out navigations are handled before this, by the sign-in redirect.
 */
function downloadErrorCode(exception: AppError, allowed: readonly ErrorCode[]): ErrorCode | null {
  if (exception.code === "VALIDATION_FAILED") return "DOWNLOAD_LINK_INVALID";
  return allowed.includes(exception.code) ? exception.code : null;
}

/** Strips a trailing slash so paths join cleanly (APP_URL may carry a base path). */
const appBase = (env: ServerEnv) => env.APP_URL.replace(/\/+$/, "");

/**
 * Signed download routes opened by a browser. Every Location is built from APP_URL, a fixed path,
 * a validated id and a code from a fixed list; never from anything else in the request (Host,
 * X-Forwarded-*, Referer, the query), so it cannot be turned into an open redirect:
 * - signed out (401 UNAUTHENTICATED or TOKEN_EXPIRED): `303 See Other` to
 *   `<APP_URL>/sign-in?next=<the page the link belongs to>`, so the user signs in and lands there;
 * - a failed link: `303 See Other` to that page with `?downloadError=<code>`.
 * Everything else, and every request that is not a navigation, gets the JSON error envelope
 * exactly as from the global filter.
 */
abstract class DownloadRedirectFilter extends AppExceptionFilter {
  protected constructor(
    logger: Logger,
    metrics: MetricsService | undefined,
    protected readonly env: ServerEnv,
    private readonly codes: readonly ErrorCode[],
  ) {
    super(logger, metrics);
  }

  /** The web app page the link belongs to (a path under APP_URL), or null when no safe one can be built. */
  protected abstract pagePath(req: Request): string | null;

  /** Where to send the browser, or null to answer with the JSON envelope. */
  private location(req: Request, exception: AppError): string | null {
    const page = this.pagePath(req);
    if (!page) return null;
    // A page with its own query (Settings, Organization) is encoded as `next` and extended with `&`.
    if (SIGN_IN_CODES.includes(exception.code))
      return `${appBase(this.env)}/sign-in?next=${page.includes("?") ? encodeURIComponent(page) : page}`;
    const code = downloadErrorCode(exception, this.codes);
    return code
      ? `${appBase(this.env)}${page}${page.includes("?") ? "&" : "?"}downloadError=${code}`
      : null;
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const location =
      exception instanceof AppError && !res.headersSent && isBrowserNavigation(req)
        ? this.location(req, exception)
        : null;
    if (!location || !(exception instanceof AppError)) {
      super.catch(exception, host);
      return;
    }
    // Counted under the error it stands for, so download-failure and auth metrics and alerts are unchanged.
    this.metrics?.countError(exception.code, exception.status);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(303, location);
  }
}

/**
 * `GET /exports/:id/download`: the export's page, `/app/jobs/exports/<id>`. Signed out:
 * `/sign-in?next=/app/jobs/exports/<id>`; a failed link: `/app/jobs/exports/<id>?downloadError=<code>`.
 * A malformed id has no page, so it keeps the JSON error.
 */
@Catch()
export class ExportDownloadRedirectFilter extends DownloadRedirectFilter {
  constructor(
    logger: Logger,
    @Optional() @Inject(MetricsService) metrics: MetricsService | undefined,
    @Inject(ENV) env: ServerEnv,
  ) {
    super(logger, metrics, env, EXPORT_DOWNLOAD_ERROR_CODES);
  }

  protected pagePath(req: Request): string | null {
    const id = ObjectIdString.safeParse(req.params?.id);
    return id.success ? `/app/jobs/exports/${id.data.toLowerCase()}` : null;
  }
}

/**
 * `GET /billing/invoices/:id/download`: the Billing page, `/app/billing`. Signed out:
 * `/sign-in?next=/app/billing`; a failed link: `/app/billing?downloadError=<code>`.
 */
@Catch()
export class InvoiceDownloadRedirectFilter extends DownloadRedirectFilter {
  constructor(
    logger: Logger,
    @Optional() @Inject(MetricsService) metrics: MetricsService | undefined,
    @Inject(ENV) env: ServerEnv,
  ) {
    super(logger, metrics, env, INVOICE_DOWNLOAD_ERROR_CODES);
  }

  protected pagePath(): string {
    return "/app/billing";
  }
}

/**
 * Stage 10, `GET /organizations/current/data-exports/:id/download`: Settings, Organization
 * (`/app/settings?tab=organization`), where the organization data export lives. Signed out:
 * `/sign-in?next=%2Fapp%2Fsettings%3Ftab%3Dorganization`; a failed link:
 * `/app/settings?tab=organization&downloadError=<code>`. A malformed id keeps the JSON error.
 */
@Catch()
export class OrganizationExportDownloadRedirectFilter extends DownloadRedirectFilter {
  constructor(
    logger: Logger,
    @Optional() @Inject(MetricsService) metrics: MetricsService | undefined,
    @Inject(ENV) env: ServerEnv,
  ) {
    super(logger, metrics, env, ORGANIZATION_EXPORT_DOWNLOAD_ERROR_CODES);
  }

  protected pagePath(req: Request): string | null {
    return ObjectIdString.safeParse(req.params?.id).success ? ORGANIZATION_LIFECYCLE_PAGE : null;
  }
}
