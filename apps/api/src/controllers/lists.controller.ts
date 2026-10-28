import { Controller, Delete, Get, HttpCode, Patch, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  CreateLeadListRequest,
  LeadList,
  LeadListItem,
  LeadListItemsQuery,
  LeadListListQuery,
  ListItemsRequest,
  ListItemsResult,
  ObjectIdString,
  UpdateLeadListRequest,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  ListsService,
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
type ListQuery = LeadListListQuery;
type ItemsQuery = LeadListItemsQuery;
type CreateBody = CreateLeadListRequest;
type UpdateBody = UpdateLeadListRequest;
type ItemsBody = ListItemsRequest;

const MANAGE = ["lists:manage", "lists:manage_own"] as const;

@ApiTags("lists")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("lists")
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Lead lists (filter by name prefix, owner, or lists containing a business)",
    description:
      "Every role reads every list of the organization (the role matrix: viewing lists is open to all roles); managing is limited by lists:manage, or lists:manage_own for the lists a sales representative owns. Pass ownerUserId to show only one member's lists.",
  })
  @ApiZodQuery(LeadListListQuery)
  @ApiZodResponse(200, LeadList.array())
  async list(@CurrentOrg() org: OrganizationScope, @ZodQuery(LeadListListQuery) query: ListQuery) {
    const page = await this.lists.list(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Post()
  @RequirePermission(...MANAGE)
  @HttpCode(201)
  @ApiOperation({
    summary:
      "Create a list (sales representatives own the lists they create); 409 CONFLICT on a duplicate name",
  })
  @ApiZodBody(CreateLeadListRequest)
  @ApiZodResponse(201, LeadList)
  create(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateLeadListRequest) body: CreateBody,
    @Req() req: Request,
  ) {
    return this.lists.create(
      org.organizationId,
      actorOf(user, org),
      body,
      AuditService.contextFrom(req),
    );
  }

  @Get(":id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "One list with its item count" })
  @ApiZodResponse(200, LeadList)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.lists.get(org.organizationId, id);
  }

  @Patch(":id")
  @RequirePermission(...MANAGE)
  @ApiOperation({
    summary:
      "Rename, describe or hand over a list (sales representatives: own lists, no hand-over)",
  })
  @ApiZodBody(UpdateLeadListRequest)
  @ApiZodResponse(200, LeadList)
  update(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(UpdateLeadListRequest) body: UpdateBody,
    @Req() req: Request,
  ) {
    return this.lists.update(
      org.organizationId,
      actorOf(user, org),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Delete(":id")
  @RequirePermission(...MANAGE)
  @ApiOperation({ summary: "Delete a list and its items (the businesses are not touched)" })
  remove(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.lists.remove(
      org.organizationId,
      actorOf(user, org),
      id,
      AuditService.contextFrom(req),
    );
  }

  @Get(":id/items")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Businesses on the list, newest first, as directory rows with their lead",
  })
  @ApiZodQuery(LeadListItemsQuery)
  @ApiZodResponse(200, LeadListItem.array())
  async items(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(LeadListItemsQuery) query: ItemsQuery,
  ) {
    const page = await this.lists.listItems(org.organizationId, id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Post(":id/items")
  @RequirePermission(...MANAGE)
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Add up to 100 businesses (outcome per business); larger selections use POST /bulk-operations",
    description:
      "Outcomes: added, already_in_list, not_found, suppressed, list_full (10,000 items per list).",
  })
  @ApiZodBody(ListItemsRequest)
  @ApiZodResponse(200, ListItemsResult)
  add(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(ListItemsRequest) body: ItemsBody,
    @Req() req: Request,
  ) {
    return this.lists.changeItems(
      org.organizationId,
      actorOf(user, org),
      id,
      body.businessIds,
      "add",
      AuditService.contextFrom(req),
    );
  }

  @Post(":id/items/remove")
  @RequirePermission(...MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: "Remove up to 100 businesses (outcomes removed or not_in_list)" })
  @ApiZodBody(ListItemsRequest)
  @ApiZodResponse(200, ListItemsResult)
  removeMany(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(ListItemsRequest) body: ItemsBody,
    @Req() req: Request,
  ) {
    return this.lists.changeItems(
      org.organizationId,
      actorOf(user, org),
      id,
      body.businessIds,
      "remove",
      AuditService.contextFrom(req),
    );
  }

  @Delete(":id/items/:businessId")
  @RequirePermission(...MANAGE)
  @ApiOperation({ summary: "Remove one business from the list" })
  @ApiZodResponse(200, ListItemsResult)
  removeOne(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodParam("businessId", ObjectIdString) businessId: string,
    @Req() req: Request,
  ) {
    return this.lists.changeItems(
      org.organizationId,
      actorOf(user, org),
      id,
      [businessId],
      "remove",
      AuditService.contextFrom(req),
    );
  }
}
