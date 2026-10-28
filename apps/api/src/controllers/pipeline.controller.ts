import { Controller, Get, HttpCode, Patch, Post, Put, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  AssignLeadRequest,
  CreateLeadRequest,
  Lead,
  LeadListQuery,
  MoveLeadRequest,
  ObjectIdString,
  PipelineBoard,
  PipelineBoardQuery,
  PipelineConfig,
  UpdateLeadRequest,
  UpdatePipelineConfigRequest,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  LeadsService,
  PipelineService,
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
type ListQuery = LeadListQuery;
type BoardQuery = PipelineBoardQuery;
type ConfigBody = UpdatePipelineConfigRequest;
type CreateBody = CreateLeadRequest;
type MoveBody = MoveLeadRequest;
type UpdateBody = UpdateLeadRequest;
type AssignBody = AssignLeadRequest;

@ApiTags("pipeline")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("pipeline")
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly leads: LeadsService,
  ) {}

  @Get("config")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Pipeline stages in board order (defaults are created on first use)" })
  @ApiZodResponse(200, PipelineConfig)
  getConfig(@CurrentOrg() org: OrganizationScope) {
    return this.pipeline.getConfig(org.organizationId);
  }

  @Put("config")
  @RequirePermission("settings:pipeline")
  @ApiOperation({
    summary: "Replace the stage list: rename, reorder, add and archive stages (owner, admin)",
    description:
      "Send every stage in board order with the current `version`. Stages with `key` are existing ones; stages without are new. Existing stages cannot be removed (archive them); won and lost cannot be archived. Errors: 400 VALIDATION_FAILED (per-stage paths), 409 VERSION_CONFLICT (stale version), 409 STAGE_NOT_EMPTY (archiving a stage that holds leads). Audited.",
  })
  @ApiZodBody(UpdatePipelineConfigRequest)
  @ApiZodResponse(200, PipelineConfig)
  updateConfig(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(UpdatePipelineConfigRequest) body: ConfigBody,
    @Req() req: Request,
  ) {
    return this.pipeline.updateConfig(
      org.organizationId,
      user.id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Get("board")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Board: every active stage with its lead count and first leads (newest activity first)",
    description:
      "Filters: assignedToUserId or unassigned, and listId (leads of businesses on that list; another organization's list is 404).",
  })
  @ApiZodQuery(PipelineBoardQuery)
  @ApiZodResponse(200, PipelineBoard)
  board(@CurrentOrg() org: OrganizationScope, @ZodQuery(PipelineBoardQuery) query: BoardQuery) {
    return this.leads.board(org.organizationId, query);
  }

  @Get("leads")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Leads, filtered by stage, assignee, priority, business or list; `meta.total` on the first page",
  })
  @ApiZodQuery(LeadListQuery)
  @ApiZodResponse(200, Lead.array())
  async list(@CurrentOrg() org: OrganizationScope, @ZodQuery(LeadListQuery) query: ListQuery) {
    const page = await this.leads.list(org.organizationId, query);
    return paged(page.items, {
      nextCursor: page.nextCursor,
      pageSize: query.pageSize,
      ...(page.total !== undefined ? { total: page.total } : {}),
    });
  }

  @Get("leads/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "One lead" })
  @ApiZodResponse(200, Lead)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.leads.get(org.organizationId, id);
  }

  @Post("leads")
  @RequirePermission("pipeline:write", "leads:assign")
  @HttpCode(201)
  @ApiOperation({
    summary:
      "Add a business to the pipeline (201; 200 with the existing lead when it already has one)",
    description:
      "Owners and admins may set the stage and assignee; researchers may assign but not choose a stage; sales representatives' leads are assigned to themselves. Errors: 404 business, 409 CONFLICT (suppressed business), 400 (unknown or archived stage), 422 INVALID_ASSIGNEE, 403. Audited; the assignee is notified.",
  })
  @ApiZodBody(CreateLeadRequest)
  @ApiZodResponse(201, Lead)
  async create(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateLeadRequest) body: CreateBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.leads.create(
      org.organizationId,
      actorOf(user, org),
      body,
      AuditService.contextFrom(req),
    );
    if (!result.created) res.status(200);
    return result.lead;
  }

  @Post("leads/:id/move")
  @RequirePermission("pipeline:write")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Move a lead to a stage (one atomic, version-checked write; keyboard moves use direction)",
    description:
      "Body `{ stageKey }` or `{ direction: next|previous }`, optionally `version` (409 VERSION_CONFLICT with the current version in `details` when the lead changed). Sales representatives move only leads assigned to them (403). Moving into the current stage returns the lead unchanged. Writes a stage_change activity; audited.",
  })
  @ApiZodBody(MoveLeadRequest)
  @ApiZodResponse(200, Lead)
  move(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(MoveLeadRequest) body: MoveBody,
    @Req() req: Request,
  ) {
    return this.leads.move(
      org.organizationId,
      actorOf(user, org),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Patch("leads/:id")
  @RequirePermission("pipeline:write")
  @ApiOperation({
    summary:
      "Edit priority, next action, lost reason or won value (version-checked; sales representatives: own leads only)",
  })
  @ApiZodBody(UpdateLeadRequest)
  @ApiZodResponse(200, Lead)
  update(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(UpdateLeadRequest) body: UpdateBody,
    @Req() req: Request,
  ) {
    return this.leads.update(
      org.organizationId,
      actorOf(user, org),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Post("leads/:id/assign")
  @RequirePermission("leads:assign")
  @HttpCode(200)
  @ApiOperation({
    summary: "Assign or unassign a lead (owner, admin, researcher)",
    description:
      "The assignee must be an active owner, admin or sales representative (422 INVALID_ASSIGNEE). Writes an assignment activity, notifies the assignee (in-app, and email when allowed) and is audited.",
  })
  @ApiZodBody(AssignLeadRequest)
  @ApiZodResponse(200, Lead)
  assign(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(AssignLeadRequest) body: AssignBody,
    @Req() req: Request,
  ) {
    return this.leads.assign(
      org.organizationId,
      actorOf(user, org),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }
}
