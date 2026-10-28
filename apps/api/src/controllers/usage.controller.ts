import { Controller, Get } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UsageQuery, UsageSummary } from "@leadforge/contracts";
import {
  ApiZodQuery,
  ApiZodResponse,
  CurrentOrg,
  RequirePermission,
  UsageService,
  ZodQuery,
  type OrganizationScope,
} from "@leadforge/core";

// Type-only alias keeps the Zod schema out of Swagger's query-parameter expansion.
type Query = UsageQuery;

@ApiTags("usage")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @RequirePermission("usage:read")
  @ApiOperation({
    summary:
      "Usage page: a daily series and totals (credits used, discovery jobs and records, analyses, enrichment runs, exports, export rows)",
    description:
      "Read from usage_daily, which the worker rolls up every 10 minutes (latest 2 UTC days) and daily (90 days); `computedAt` says when. Owner, admin, researcher, analyst.",
  })
  @ApiZodQuery(UsageQuery)
  @ApiZodResponse(200, UsageSummary)
  summary(@CurrentOrg() org: OrganizationScope, @ZodQuery(UsageQuery) query: Query) {
    return this.usage.summary(org.organizationId, query.period);
  }
}
