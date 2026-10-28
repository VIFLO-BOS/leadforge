import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  AnalysisListQuery,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  ObjectIdString,
  WebsiteAnalysis,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  WebsiteAnalysisService,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
  PausedDuringDeletionGrace,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type ListQuery = AnalysisListQuery;
type CreateBody = CreateAnalysisRequest;

@ApiTags("analysis")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller()
export class AnalysisController {
  constructor(private readonly analyses: WebsiteAnalysisService) {}

  @Post("analysis/websites")
  @RequirePermission("analysis:run")
  @PausedDuringDeletionGrace()
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Queue website analyses (1 credit each: held now, captured on completion, released on failure)",
    description:
      "Body `{ businessId }` or `{ businessIds }` (1 to 50). A business that already has a queued or running analysis gets that one back and nothing new is held (`alreadyInProgress`). Single: 404 NOT_FOUND, 422 WEBSITE_MISSING, 409 CONFLICT (suppressed). Bulk: such businesses are listed in `skipped`. 402 INSUFFICIENT_CREDITS when the balance cannot cover every new analysis.",
  })
  @ApiZodBody(CreateAnalysisRequest)
  @ApiZodResponse(202, CreateAnalysisResponse)
  request(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateAnalysisRequest) body: CreateBody,
    @Req() req: Request,
  ) {
    return this.analyses.request(
      org.organizationId,
      user.id,
      body,
      "single",
      AuditService.contextFrom(req),
    );
  }

  @Get("analysis/websites")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Website analyses, newest first (filter by status, opportunity, business or bulk batch)",
  })
  @ApiZodQuery(AnalysisListQuery)
  @ApiZodResponse(200, WebsiteAnalysis.array())
  async list(@CurrentOrg() org: OrganizationScope, @ZodQuery(AnalysisListQuery) query: ListQuery) {
    const page = await this.analyses.list(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("analysis/websites/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "One analysis with detections, evidence and opportunities (poll every 2 s while queued or running)",
  })
  @ApiZodResponse(200, WebsiteAnalysis)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.analyses.get(org.organizationId, id);
  }

  @Get("businesses/:id/analysis")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "The business's latest analysis: newest completed, else newest of any status; `data: null` when none ran",
  })
  @ApiZodResponse(200, WebsiteAnalysis.nullable())
  latest(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.analyses.latestForBusiness(org.organizationId, id);
  }
}
