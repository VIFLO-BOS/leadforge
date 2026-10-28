import { Controller, Delete, Get, HttpCode, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  Activity,
  ActivityListQuery,
  CreateActivityRequest,
  CreateActivityResponse,
  CreateOutreachRequest,
  LogOutreachAttemptRequest,
  LogOutreachAttemptResponse,
  ObjectIdString,
  OutreachListQuery,
  OutreachRecord,
  UpdateActivityRequest,
  UpdateOutreachRequest,
} from "@leadforge/contracts";
import {
  ActivitiesService,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  RequirePermission,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";
import { actorOf } from "../common/actor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type ListQuery = ActivityListQuery;
type OutreachQuery = OutreachListQuery;
type CreateBody = CreateActivityRequest;
type UpdateBody = UpdateActivityRequest;
type CreateOutreachBody = CreateOutreachRequest;
type UpdateOutreachBody = UpdateOutreachRequest;
type AttemptBody = LogOutreachAttemptRequest;

const SUPPRESSION_NOTE =
  "Suppression: contact (call, WhatsApp, email, meeting) with a suppressed business, or to a suppressed phone or address, is 409 CONTACT_SUPPRESSED unless `suppressionOverride.reason` (10 to 500 characters) is sent; the reason is kept on the record and audited. Notes are always allowed.";

@ApiTags("activities")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get("activities")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Activities, newest first (filter by type, author, business, lead, list and date range)",
  })
  @ApiZodQuery(ActivityListQuery)
  @ApiZodResponse(200, Activity.array())
  async list(@CurrentOrg() org: OrganizationScope, @ZodQuery(ActivityListQuery) query: ListQuery) {
    const page = await this.activities.list(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("activities/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "One activity" })
  @ApiZodResponse(200, Activity)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.activities.get(org.organizationId, id);
  }

  @Post("activities")
  @RequirePermission("pipeline:write")
  @HttpCode(201)
  @ApiOperation({
    summary: "Log a note, call, WhatsApp message, email or meeting",
    description: `Outbound calls, WhatsApp messages and emails also count an attempt on the business's outreach record for that channel. Sales representatives log only on leads assigned to them (403). ${SUPPRESSION_NOTE}`,
  })
  @ApiZodBody(CreateActivityRequest)
  @ApiZodResponse(201, CreateActivityResponse)
  create(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateActivityRequest) body: CreateBody,
    @Req() req: Request,
  ) {
    return this.activities.create(
      org.organizationId,
      actorOf(user, org),
      body,
      AuditService.contextFrom(req),
    );
  }

  @Patch("activities/:id")
  @RequirePermission("pipeline:write")
  @ApiOperation({
    summary:
      "Edit text, outcome or time (author, or owner and admin); system stage changes and assignments are 409",
  })
  @ApiZodBody(UpdateActivityRequest)
  @ApiZodResponse(200, Activity)
  update(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(UpdateActivityRequest) body: UpdateBody,
    @Req() req: Request,
  ) {
    return this.activities.update(
      org.organizationId,
      actorOf(user, org),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Delete("activities/:id")
  @RequirePermission("pipeline:write")
  @ApiOperation({
    summary: "Delete an activity (author, or owner and admin); audited with its content",
  })
  remove(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.activities.remove(
      org.organizationId,
      actorOf(user, org),
      id,
      AuditService.contextFrom(req),
    );
  }

  @Get("outreach")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Outreach records, most recently updated first (filter by channel, status, owner, business, list and last-attempt range)",
  })
  @ApiZodQuery(OutreachListQuery)
  @ApiZodResponse(200, OutreachRecord.array())
  async listOutreach(
    @CurrentOrg() org: OrganizationScope,
    @ZodQuery(OutreachListQuery) query: OutreachQuery,
  ) {
    const page = await this.activities.listOutreach(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("outreach/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "One outreach record" })
  @ApiZodResponse(200, OutreachRecord)
  getOutreach(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.activities.getOutreach(org.organizationId, id);
  }

  @Post("outreach")
  @RequirePermission("pipeline:write")
  @HttpCode(201)
  @ApiOperation({
    summary:
      "Plan outreach on a channel (201; 200 with the existing record for that business and channel)",
    description: SUPPRESSION_NOTE,
  })
  @ApiZodBody(CreateOutreachRequest)
  @ApiZodResponse(201, OutreachRecord)
  async createOutreach(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateOutreachRequest) body: CreateOutreachBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.activities.createOutreach(
      org.organizationId,
      actorOf(user, org),
      body,
      AuditService.contextFrom(req),
    );
    if (!result.created) res.status(200);
    return result.outreach;
  }

  @Patch("outreach/:id")
  @RequirePermission("pipeline:write")
  @ApiOperation({
    summary:
      "Change status, next attempt or target (optional version: 409 VERSION_CONFLICT when stale)",
  })
  @ApiZodBody(UpdateOutreachRequest)
  @ApiZodResponse(200, OutreachRecord)
  updateOutreach(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(UpdateOutreachRequest) body: UpdateOutreachBody,
  ) {
    return this.activities.updateOutreach(org.organizationId, actorOf(user, org), id, body);
  }

  @Post("outreach/:id/attempts")
  @RequirePermission("pipeline:write")
  @HttpCode(201)
  @ApiOperation({
    summary: "Log one attempt (an outbound activity of the record's channel)",
    description: SUPPRESSION_NOTE,
  })
  @ApiZodBody(LogOutreachAttemptRequest)
  @ApiZodResponse(201, LogOutreachAttemptResponse)
  logAttempt(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(LogOutreachAttemptRequest) body: AttemptBody,
    @Req() req: Request,
  ) {
    return this.activities.logAttempt(
      org.organizationId,
      actorOf(user, org),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }
}
