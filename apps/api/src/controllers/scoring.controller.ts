import { Controller, Get, HttpCode, Patch, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  ObjectIdString,
  ScoreSnapshot,
  ScoringProfile,
  UpdateScoringProfileRequest,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodResponse,
  AuditService,
  BusinessesService,
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  ScoringService,
  ZodBody,
  ZodParam,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";

type UpdateBody = UpdateScoringProfileRequest;

@ApiTags("scoring")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller()
export class ScoringController {
  constructor(
    private readonly scoring: ScoringService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get("scoring/profile")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "The organization's scoring profile (created with the default weights on first read), with recompute progress",
  })
  @ApiZodResponse(200, ScoringProfile)
  get(@CurrentOrg() org: OrganizationScope) {
    return this.scoring.getProfile(org.organizationId);
  }

  @Patch("scoring/profile")
  @RequirePermission("settings:scoring")
  @ApiOperation({
    summary: "Edit weights and the ideal customer profile; queues a recompute of every score",
    description:
      "Weights: seven whole numbers 0 to 100 that add up to 100. Send the `version` you loaded; 409 CONFLICT when it changed.",
  })
  @ApiZodBody(UpdateScoringProfileRequest)
  @ApiZodResponse(200, ScoringProfile)
  update(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(UpdateScoringProfileRequest) body: UpdateBody,
    @Req() req: Request,
  ) {
    return this.scoring.updateProfile(
      org.organizationId,
      user.id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Post("scoring/recompute")
  @RequirePermission("settings:scoring")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Recompute every score with the current profile (poll GET /scoring/profile for `recompute`)",
  })
  @ApiZodResponse(202, ScoringProfile)
  recompute(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.scoring.requestRecompute(
      org.organizationId,
      user.id,
      AuditService.contextFrom(req),
    );
  }

  @Get("businesses/:id/score")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Score snapshot with the per-signal breakdown and explanation; `data: null` until scored",
  })
  @ApiZodResponse(200, ScoreSnapshot.nullable())
  score(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.businesses.getScore(org.organizationId, id);
  }
}
