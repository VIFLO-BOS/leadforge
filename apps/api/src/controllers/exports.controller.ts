import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  StreamableFile,
  UseFilters,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  CreateExportRequest,
  ExportBusinessesRequest,
  ExportDownloadLink,
  ExportDownloadQuery,
  ExportJob,
  ExportListQuery,
  IDEMPOTENCY_KEY_HEADER,
  ObjectIdString,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AppError,
  AuditService,
  AuthOnly,
  CurrentOrg,
  CurrentUser,
  ExportsService,
  RequirePermission,
  THROTTLE_EXPORTS,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";
import { actorOf, IDEMPOTENCY_KEY_PATTERN } from "../common/actor.js";
import { ExportDownloadRedirectFilter } from "../common/download-redirect.filter.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type ListQuery = ExportListQuery;
type DownloadQuery = ExportDownloadQuery;
type CreateBody = CreateExportRequest;

const EXPORTERS = ["exports:create", "exports:create_assigned"] as const;

@ApiTags("exports")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description:
    "Organization scope; membership is verified server-side (not needed on the signed download)",
})
@Controller("exports")
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Post("businesses")
  @RequirePermission(...EXPORTERS)
  @HttpCode(200)
  @Throttle(THROTTLE_EXPORTS)
  @ApiOperation({
    summary: "Download businesses as CSV (synchronous, up to 1,000 rows)",
    description:
      "Selected `ids` or the directory `filter`. Suppressed businesses are never exported; sales representatives get only businesses whose lead is assigned to them. Cells starting with = + - @ tab or CR are prefixed with a single quote. 422 EXPORT_TOO_LARGE above 1,000 rows (use POST /exports). Audited. Rate limit 10 per hour per user.",
  })
  @ApiZodBody(ExportBusinessesRequest)
  @ApiProduces("text/csv")
  @ApiResponse({
    status: 200,
    description:
      'UTF-8 CSV with BOM; `X-Export-Row-Count` header carries the row count. Rows with open data carry source, dataset, licence, release, attribution and licence-URL columns, and the response has a `Link: <.../public/data-licenses>; rel="license"` header.',
    content: { "text/csv": { schema: { type: "string" } } },
  })
  async exportBusinesses(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(ExportBusinessesRequest) body: ExportBusinessesRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.exportsService.exportBusinesses(
      org.organizationId,
      actorOf(user, org),
      body,
      AuditService.contextFrom(req),
    );
    res.setHeader("X-Export-Row-Count", String(file.rowCount));
    // Openly licensed rows: the licence texts and attributions travel with the file as a link.
    if (file.licensesUrl) res.setHeader("Link", `<${file.licensesUrl}>; rel="license"`);
    res.setHeader("Cache-Control", "no-store");
    return new StreamableFile(Buffer.from(file.content, "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  @Post()
  @RequirePermission(...EXPORTERS)
  @HttpCode(202)
  @Throttle(THROTTLE_EXPORTS)
  @ApiHeader({
    name: "Idempotency-Key",
    required: false,
    description:
      "Optional, 8-128 characters; resubmitting the same key and body returns the same export (200)",
  })
  @ApiOperation({
    summary:
      "Start an export job (202): the directory filter, a lead list or selected ids; poll GET /exports/:id",
    description:
      "Built in the worker as a ZIP (CSV, ATTRIBUTION.txt, LICENSES/ for the open-data licences that apply). Row cap per organization (`export_row_cap` entitlement, default 10,000): 422 EXPORT_TOO_LARGE with `rowCap` in details. Sales representatives export only businesses whose lead is assigned to them. Errors: 400, 403, 404 (list or import), 409 CONFLICT (key reused), 429 (10 per hour per user). Audited.",
  })
  @ApiZodBody(CreateExportRequest)
  @ApiZodResponse(202, ExportJob)
  async create(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateExportRequest) body: CreateBody,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw AppError.validation([
        { path: "Idempotency-Key", message: "Use 8 to 128 letters, digits or - _ . :" },
      ]);
    }
    const { job, replayed } = await this.exportsService.createJob(
      org.organizationId,
      actorOf(user, org),
      body,
      idempotencyKey,
      AuditService.contextFrom(req),
    );
    if (replayed) res.status(200);
    return job;
  }

  @Get()
  @RequirePermission(...EXPORTERS)
  @ApiOperation({
    summary: "Export jobs, newest first (owners and admins see all; others their own)",
  })
  @ApiZodQuery(ExportListQuery)
  @ApiZodResponse(200, ExportJob.array())
  async list(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(ExportListQuery) query: ListQuery,
  ) {
    const page = await this.exportsService.listJobs(org.organizationId, actorOf(user, org), query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get(":id")
  @RequirePermission(...EXPORTERS)
  @ApiOperation({ summary: "One export job (poll every 2 s while queued or running)" })
  @ApiZodResponse(200, ExportJob)
  get(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
  ) {
    return this.exportsService.getJob(org.organizationId, actorOf(user, org), id);
  }

  @Get(":id/download-url")
  @RequirePermission(...EXPORTERS)
  @ApiOperation({
    summary: "A signed download link for the caller (valid 15 minutes)",
    description:
      "409 EXPORT_NOT_READY while queued, running or failed; 410 EXPORT_EXPIRED after the 7-day retention. Navigate the browser to `url` (cookies are sent; no headers needed).",
  })
  @ApiZodResponse(200, ExportDownloadLink)
  downloadUrl(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
  ) {
    return this.exportsService.downloadLink(org.organizationId, actorOf(user, org), id);
  }

  @Get(":id/download")
  @AuthOnly()
  @UseFilters(ExportDownloadRedirectFilter)
  @ApiOperation({
    summary:
      "Download the export ZIP through a signed link (signed in; the link names the organization)",
    description:
      "Checks the HMAC signature (403 DOWNLOAD_LINK_INVALID when tampered with or issued to someone else), the expiry (410 DOWNLOAD_LINK_EXPIRED), current membership and export permission (403 ORG_FORBIDDEN or FORBIDDEN), and the file (409 EXPORT_NOT_READY, 410 EXPORT_EXPIRED). Audited as export.downloaded. A browser navigation (Sec-Fetch-Mode: navigate, or Accept preferring text/html) that fails with DOWNLOAD_LINK_INVALID, DOWNLOAD_LINK_EXPIRED, EXPORT_EXPIRED or EXPORT_NOT_READY (a damaged query counts as DOWNLOAD_LINK_INVALID) gets 303 See Other to <APP_URL>/app/jobs/exports/<id>?downloadError=<code> instead, and a signed-out navigation (401 UNAUTHENTICATED or TOKEN_EXPIRED) gets 303 See Other to <APP_URL>/sign-in?next=/app/jobs/exports/<id> (Stage 9); other requests keep the JSON error.",
  })
  @ApiResponse({
    status: 303,
    description:
      "Browser navigation only: the link failed (Location <APP_URL>/app/jobs/exports/<id>?downloadError=<code>), or the browser is signed out (Location <APP_URL>/sign-in?next=/app/jobs/exports/<id>)",
  })
  @ApiZodQuery(ExportDownloadQuery)
  @ApiProduces("application/zip")
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(ExportDownloadQuery) query: DownloadQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!user.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED");
    const file = await this.exportsService.openDownload(
      user.id,
      id,
      query,
      AuditService.contextFrom(req),
    );
    res.setHeader("Cache-Control", "no-store");
    return new StreamableFile(file.stream, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
      ...(file.bytes !== null ? { length: file.bytes } : {}),
    });
  }
}
