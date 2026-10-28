import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
  CreateInvitationRequest,
  ExportDownloadLink,
  ExportDownloadQuery,
  IDEMPOTENCY_KEY_HEADER,
  InvitationSummary,
  MemberSummary,
  ObjectIdString,
  OrganizationDataExport,
  OrganizationDeletionStatus,
  OrganizationProfile,
  RequestOrganizationDeletion,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
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
  InvitationsService,
  OrganizationExportService,
  OrganizationLifecycleService,
  OrganizationsService,
  PausedDuringDeletionGrace,
  RequirePermission,
  THROTTLE_AUTH,
  THROTTLE_EXPORTS,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";
import { IDEMPOTENCY_KEY_PATTERN } from "../common/actor.js";
import { OrganizationExportDownloadRedirectFilter } from "../common/download-redirect.filter.js";

// Type-only alias keeps the Zod schema out of Swagger's query-parameter expansion.
type DownloadQuery = ExportDownloadQuery;

@ApiTags("organizations")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("organizations/current")
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly invitations: InvitationsService,
    private readonly lifecycle: OrganizationLifecycleService,
    private readonly orgExports: OrganizationExportService,
  ) {}

  @Get()
  @RequirePermission("businesses:read")
  @ApiZodResponse(200, OrganizationProfile)
  current(@CurrentOrg() org: OrganizationScope) {
    return this.organizations.getCurrent(org);
  }

  @Patch()
  @RequirePermission("organization:settings")
  @ApiZodBody(UpdateOrganizationRequest)
  @ApiZodResponse(200, OrganizationProfile)
  update(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(UpdateOrganizationRequest) body: UpdateOrganizationRequest,
    @Req() req: Request,
  ) {
    return this.organizations.update(org, user.id, body, AuditService.contextFrom(req));
  }

  @Get("members")
  @RequirePermission("businesses:read")
  @ApiZodResponse(200, MemberSummary.array())
  async members(@CurrentOrg() org: OrganizationScope) {
    return paged(await this.organizations.listMembers(org.organizationId));
  }

  @Patch("members/:userId")
  @RequirePermission("members:manage")
  @ApiZodBody(UpdateMemberRequest)
  @ApiZodResponse(200, MemberSummary)
  updateMember(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @ZodBody(UpdateMemberRequest) body: UpdateMemberRequest,
    @Req() req: Request,
  ) {
    return this.organizations.updateMember(
      org,
      user.id,
      userId,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Delete("members/:userId")
  @RequirePermission("members:manage")
  @HttpCode(204)
  async removeMember(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ) {
    await this.organizations.removeMember(org, user.id, userId, AuditService.contextFrom(req));
  }

  @Get("invitations")
  @RequirePermission("members:manage")
  @ApiZodResponse(200, InvitationSummary.array())
  async listInvitations(@CurrentOrg() org: OrganizationScope) {
    return paged(await this.invitations.list(org.organizationId));
  }

  @Post("invitations")
  @RequirePermission("members:manage")
  @PausedDuringDeletionGrace()
  @HttpCode(201)
  @ApiZodBody(CreateInvitationRequest)
  @ApiZodResponse(201, InvitationSummary)
  createInvitation(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateInvitationRequest) body: CreateInvitationRequest,
    @Req() req: Request,
  ) {
    return this.invitations.create(org, user.id, body, AuditService.contextFrom(req));
  }

  @Delete("invitations/:id")
  @RequirePermission("members:manage")
  @HttpCode(204)
  async revokeInvitation(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    await this.invitations.revoke(org, user.id, id, AuditService.contextFrom(req));
  }

  @Post("deletion-requests")
  @RequirePermission("organization:delete")
  @HttpCode(202)
  @Throttle(THROTTLE_AUTH)
  @ApiOperation({
    summary: "Schedule the organization for deletion (owner): purge after a 14-day grace",
    description:
      "Body: `confirmName` (the organization's exact name, else 400 VALIDATION_FAILED on confirmName) and `password` (the owner's current password, else 403 REAUTH_FAILED; failures count toward the per-account sign-in lock, 429 with Retry-After while locked). Idempotent while a deletion is pending (the same dates come back). Owners and admins are notified in-app and by email, and again by email about 3 days before the purge. While pending, new discovery, analysis, imports, checkouts and invitations get 409 ORGANIZATION_PENDING_DELETION. Audited.",
  })
  @ApiZodBody(RequestOrganizationDeletion)
  @ApiZodResponse(202, OrganizationDeletionStatus)
  requestDeletion(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(RequestOrganizationDeletion) body: RequestOrganizationDeletion,
    @Req() req: Request,
  ) {
    return this.lifecycle.requestDeletion(org, user.id, body, AuditService.contextFrom(req));
  }

  @Delete("deletion-requests")
  @RequirePermission("organization:delete")
  @HttpCode(204)
  @ApiOperation({
    summary: "Cancel the pending deletion (owner), any time before the purge starts",
    description:
      "204 also when nothing is pending. Once the purge has started nobody can open the organization (403 ORG_FORBIDDEN). Audited; owners and admins are notified.",
  })
  async cancelDeletion(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.lifecycle.cancelDeletion(org, user.id, AuditService.contextFrom(req));
  }

  @Post("data-exports")
  @RequirePermission("organization:export")
  @HttpCode(202)
  @Throttle(THROTTLE_EXPORTS)
  @ApiHeader({
    name: "Idempotency-Key",
    required: false,
    description:
      "Optional, 8-128 characters; resubmitting the same key returns the same export (200)",
  })
  @ApiOperation({
    summary: "Export all of the organization's data (owner): 202 and a ZIP built in the worker",
    description:
      "JSON and CSV per section (organization, members, businesses with provenance, lists, leads, activities, outreach, imports and jobs summaries, credit ledger, invoices, payments, usage, audit log) plus README.txt, ATTRIBUTION.txt and LICENSES/. Values past their source retention are left out; CSVs are formula-safe; the file is kept 7 days. One export at a time: 409 CONFLICT with `activeExportId` in details. Poll GET /organizations/current/data-exports/:id. Audited.",
  })
  @ApiZodResponse(202, OrganizationDataExport)
  async createDataExport(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw AppError.validation([
        { path: "Idempotency-Key", message: "Use 8 to 128 letters, digits or - _ . :" },
      ]);
    }
    const { job, replayed } = await this.orgExports.create(
      org.organizationId,
      user.id,
      idempotencyKey,
      AuditService.contextFrom(req),
    );
    if (replayed) res.status(200);
    return job;
  }

  @Get("data-exports")
  @RequirePermission("organization:export")
  @ApiOperation({ summary: "The organization's 10 most recent data exports, newest first (owner)" })
  @ApiZodResponse(200, OrganizationDataExport.array())
  async listDataExports(@CurrentOrg() org: OrganizationScope) {
    return paged(await this.orgExports.list(org.organizationId));
  }

  @Get("data-exports/:id")
  @RequirePermission("organization:export")
  @ApiOperation({
    summary: "One organization data export (poll every 2 s while queued or running)",
  })
  @ApiZodResponse(200, OrganizationDataExport)
  getDataExport(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.orgExports.get(org.organizationId, id);
  }

  @Get("data-exports/:id/download-url")
  @RequirePermission("organization:export")
  @ApiOperation({
    summary: "A signed download link for the caller (valid 15 minutes)",
    description:
      "409 EXPORT_NOT_READY while queued, running or failed; 410 EXPORT_EXPIRED after the 7-day retention. Navigate the browser to `url`.",
  })
  @ApiZodResponse(200, ExportDownloadLink)
  dataExportDownloadUrl(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
  ) {
    return this.orgExports.downloadLink(org.organizationId, user.id, id);
  }

  @Get("data-exports/:id/download")
  @AuthOnly()
  @UseFilters(OrganizationExportDownloadRedirectFilter)
  @ApiOperation({
    summary:
      "Download the organization export ZIP through a signed link (signed in; the link names the organization)",
    description:
      "Checks the HMAC signature (403 DOWNLOAD_LINK_INVALID), the expiry (410 DOWNLOAD_LINK_EXPIRED), that the caller is still an owner (403 ORG_FORBIDDEN or FORBIDDEN) and the file (409 EXPORT_NOT_READY, 410 EXPORT_EXPIRED). Audited. A browser navigation that fails with one of those link or file codes gets 303 See Other to <APP_URL>/app/settings?tab=organization&downloadError=<code>; a signed-out navigation gets 303 to <APP_URL>/sign-in?next=%2Fapp%2Fsettings%3Ftab%3Dorganization.",
  })
  @ApiResponse({
    status: 303,
    description: "Browser navigation only: the link failed, or the browser is signed out",
  })
  @ApiZodQuery(ExportDownloadQuery)
  @ApiProduces("application/zip")
  async downloadDataExport(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(ExportDownloadQuery) query: DownloadQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!user.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED");
    const file = await this.orgExports.openDownload(
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
