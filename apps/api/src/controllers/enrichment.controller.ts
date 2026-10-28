import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  EmailCheckRequest,
  EnrichmentRun,
  EnrichmentRunListQuery,
  ObjectIdString,
  RefreshResponse,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  EnrichmentService,
  RequirePermission,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
  PausedDuringDeletionGrace,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type RunsQuery = EnrichmentRunListQuery;
type EmailBody = EmailCheckRequest;

@ApiTags("enrichment")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller()
export class EnrichmentController {
  constructor(private readonly enrichment: EnrichmentService) {}

  @Post("enrichment/businesses/:id/website-contacts")
  @RequirePermission("analysis:run")
  @PausedDuringDeletionGrace()
  @HttpCode(202)
  @ApiOperation({
    summary: "Collect contacts from the business's own website (free)",
    description:
      "Queues a website-contacts run: mailto, tel, WhatsApp and social links are recorded as `website` observations with evidence; phones found on the own site become verified, WhatsApp links confirm WhatsApp, and emails are checked (syntax, MX, disposable; never verified). Returns the active run when one is already queued or running. 422 WEBSITE_MISSING, 409 CONFLICT (suppressed), 429 RATE_LIMITED.",
  })
  @ApiZodResponse(202, EnrichmentRun)
  async websiteContacts(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return (
      await this.enrichment.requestWebsiteContacts(
        org.organizationId,
        user.id,
        id,
        AuditService.contextFrom(req),
      )
    ).run;
  }

  @Post("enrichment/businesses/:id/check-email")
  @RequirePermission("analysis:run")
  @PausedDuringDeletionGrace()
  @HttpCode(202)
  @ApiOperation({
    summary: "Check one email address of the business (syntax, MX, disposable domain; free)",
    description:
      "Results are verification events; the address stays unverified (release 1 does no mailbox probing). 400 when the address is not on the business.",
  })
  @ApiZodBody(EmailCheckRequest)
  @ApiZodResponse(202, EnrichmentRun)
  async checkEmail(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(EmailCheckRequest) body: EmailBody,
    @Req() req: Request,
  ) {
    return (
      await this.enrichment.requestEmailCheck(
        org.organizationId,
        user.id,
        id,
        body.address,
        AuditService.contextFrom(req),
      )
    ).run;
  }

  @Post("businesses/:id/refresh")
  @RequirePermission("analysis:run")
  @PausedDuringDeletionGrace()
  @HttpCode(202)
  @ApiOperation({
    summary: "Refresh a business: re-collect website contacts and re-analyze its website",
    description:
      "Holds 1 credit for the analysis (none when one is already in progress); contacts collection is free. 422 WEBSITE_MISSING, 402 INSUFFICIENT_CREDITS, 409 CONFLICT (suppressed).",
  })
  @ApiZodResponse(202, RefreshResponse)
  refresh(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.enrichment.refresh(org.organizationId, user.id, id, AuditService.contextFrom(req));
  }

  @Get("enrichment/runs/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "One enrichment run (poll every 2 s while queued or running)" })
  @ApiZodResponse(200, EnrichmentRun)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.enrichment.get(org.organizationId, id);
  }

  @Get("businesses/:id/enrichment-runs")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Enrichment runs of a business, newest first" })
  @ApiZodQuery(EnrichmentRunListQuery)
  @ApiZodResponse(200, EnrichmentRun.array())
  async list(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(EnrichmentRunListQuery) query: RunsQuery,
  ) {
    const page = await this.enrichment.listForBusiness(org.organizationId, id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }
}
