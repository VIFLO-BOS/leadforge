import { Controller, Get } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JobListQuery, JobSummary } from "@leadforge/contracts";
import {
  ApiZodQuery,
  ApiZodResponse,
  CurrentOrg,
  CurrentUser,
  JobsService,
  RequirePermission,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";
import { actorOf } from "../common/actor.js";

// Type-only alias keeps the Zod schema out of Swagger's query-parameter expansion.
type ListQuery = JobListQuery;

@ApiTags("jobs")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "All background jobs (discovery, import, analysis, enrichment, export, bulk), newest first, with normalized statuses",
    description: "Exports appear for their requester, and for owners and admins.",
  })
  @ApiZodQuery(JobListQuery)
  @ApiZodResponse(200, JobSummary.array())
  async list(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(JobListQuery) query: ListQuery,
  ) {
    const page = await this.jobs.list(org.organizationId, query, actorOf(user, org));
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }
}
