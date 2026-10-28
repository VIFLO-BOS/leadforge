import { Controller, Get, Headers, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  BulkOperation,
  BulkOperationItem,
  BulkOperationItemsQuery,
  BulkOperationListQuery,
  BulkOperationRequest,
  BulkPreview,
  IDEMPOTENCY_KEY_HEADER,
  ObjectIdString,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AppError,
  AuditService,
  BulkOperationsService,
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
import { actorOf, IDEMPOTENCY_KEY_PATTERN } from "../common/actor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type ListQuery = BulkOperationListQuery;
type ItemsQuery = BulkOperationItemsQuery;
type RequestBody = BulkOperationRequest;

const ANY_BULK = ["lists:manage", "lists:manage_own", "leads:assign", "pipeline:write"] as const;

@ApiTags("bulk")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("bulk-operations")
export class BulkController {
  constructor(private readonly bulk: BulkOperationsService) {}

  @Post("preview")
  @RequirePermission(...ANY_BULK)
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Preview a bulk operation: matched businesses and the expected outcome counts (nothing is written)",
    description:
      "Actions: add_to_list and remove_from_list (lists:manage, or lists:manage_own on own lists), assign (leads:assign), move_stage (pipeline:write; sales representatives only their assigned leads). `overCap: true` means confirming would be 422 BULK_LIMIT_EXCEEDED (5,000 businesses).",
  })
  @ApiZodBody(BulkOperationRequest)
  @ApiZodResponse(200, BulkPreview)
  preview(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(BulkOperationRequest) body: RequestBody,
  ) {
    return this.bulk.preview(org.organizationId, actorOf(user, org), body);
  }

  @Post()
  @RequirePermission(...ANY_BULK)
  @HttpCode(202)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "8-128 characters; resubmitting the same key and body returns the same operation (200)",
  })
  @ApiOperation({
    summary: "Run a bulk operation in the worker (202); poll GET /bulk-operations/:id",
    description:
      "The selection is resolved now and frozen. Errors: 400 VALIDATION_FAILED (missing Idempotency-Key, empty selection, unknown stage), 403, 404 (list), 409 CONFLICT (key reused with another body), 422 BULK_LIMIT_EXCEEDED, 422 INVALID_ASSIGNEE. Audited; the requester is notified when it finishes, and an assignee once per operation.",
  })
  @ApiZodBody(BulkOperationRequest)
  @ApiZodResponse(202, BulkOperation)
  async create(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(BulkOperationRequest) body: RequestBody,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw AppError.validation([
        {
          path: "Idempotency-Key",
          message: "Send an Idempotency-Key header of 8 to 128 letters, digits or - _ . :",
        },
      ]);
    }
    const { operation, replayed } = await this.bulk.create(
      org.organizationId,
      actorOf(user, org),
      body,
      idempotencyKey,
      AuditService.contextFrom(req),
    );
    if (replayed) res.status(200);
    return operation;
  }

  @Get()
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Bulk operations, newest first" })
  @ApiZodQuery(BulkOperationListQuery)
  @ApiZodResponse(200, BulkOperation.array())
  async list(
    @CurrentOrg() org: OrganizationScope,
    @ZodQuery(BulkOperationListQuery) query: ListQuery,
  ) {
    const page = await this.bulk.list(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get(":id")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "One operation with progress (poll every 1 to 2 s while queued or running)",
  })
  @ApiZodResponse(200, BulkOperation)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.bulk.get(org.organizationId, id);
  }

  @Get(":id/items")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Per-business results (filter by outcome); kept 30 days" })
  @ApiZodQuery(BulkOperationItemsQuery)
  @ApiZodResponse(200, BulkOperationItem.array())
  async items(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(BulkOperationItemsQuery) query: ItemsQuery,
  ) {
    const page = await this.bulk.listItems(org.organizationId, id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }
}
