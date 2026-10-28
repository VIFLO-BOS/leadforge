import { Controller, Get, Patch, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { SourceKey, SourceRegistryEntry, UpdateSourceConfigRequest } from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  SourcesService,
  ZodBody,
  ZodParam,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

@ApiTags("sources")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("sources")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Source registry with status, this organization's setting, coverage and data policy",
  })
  @ApiZodResponse(200, SourceRegistryEntry.array())
  async list(@CurrentOrg() org: OrganizationScope) {
    const items = await this.sources.list(org.organizationId);
    return paged(items, { nextCursor: null, pageSize: items.length });
  }

  @Patch(":key")
  @RequirePermission("settings:sources")
  @ApiOperation({
    summary: "Enable or disable a discovery source for this organization (owner and admin)",
    description:
      "Only discovery sources are configurable; others are 400 VALIDATION_FAILED. Disabling stops new jobs with SOURCE_DISABLED; running jobs finish.",
  })
  @ApiZodBody(UpdateSourceConfigRequest)
  @ApiZodResponse(200, SourceRegistryEntry)
  update(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("key", SourceKey) key: SourceKey,
    @ZodBody(UpdateSourceConfigRequest) body: UpdateSourceConfigRequest,
    @Req() req: Request,
  ) {
    return this.sources.setEnabled(
      org.organizationId,
      user.id,
      key,
      body.enabled,
      AuditService.contextFrom(req),
    );
  }
}
