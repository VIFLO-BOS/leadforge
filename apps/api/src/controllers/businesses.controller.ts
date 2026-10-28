import { Controller, Delete, Get, HttpCode, Patch, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  BusinessDetail,
  BusinessFacets,
  BusinessListItem,
  BusinessListQuery,
  CorrectionRequest,
  CreateBusinessRequest,
  Observation,
  ObservationListQuery,
  ObjectIdString,
  SuppressRequest,
  BulkSuppressRequest,
  BulkSuppressResult,
  VerificationEvent,
  VerificationEventListQuery,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AuditService,
  BusinessesService,
  CurrentOrg,
  CurrentUser,
  ImportsService,
  RequirePermission,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only aliases: query DTOs must not emit their Zod schema as design metadata, or Swagger
// tries to expand it into query parameters.
type ListQuery = BusinessListQuery;
type ObservationsQuery = ObservationListQuery;
type VerificationsQuery = VerificationEventListQuery;

@ApiTags("businesses")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("businesses")
export class BusinessesController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly imports: ImportsService,
  ) {}

  @Get()
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Directory: search, filter, sort and page businesses",
    description:
      "Cursor pagination. `meta.total` (or `meta.totalApprox` above 10,000) is returned on the first page only. Suppressed businesses are excluded unless `suppression=include|only`. `ids` (comma-separated and/or repeated, at most 100) limits the page to those businesses and combines with every other filter; ids that are not in the organization match nothing (400 VALIDATION_FAILED above 100 or for a malformed id).",
  })
  @ApiZodQuery(BusinessListQuery)
  @ApiZodResponse(200, BusinessListItem.array())
  async list(@CurrentOrg() org: OrganizationScope, @ZodQuery(BusinessListQuery) query: ListQuery) {
    // A foreign import id is a 404, never an empty result that reveals nothing exists.
    if (query.importId) await this.imports.requireJob(org.organizationId, query.importId);
    const page = await this.businesses.list(org.organizationId, query);
    return paged(page.items, {
      nextCursor: page.nextCursor,
      pageSize: query.pageSize,
      ...(page.total !== undefined ? { total: page.total } : {}),
      ...(page.totalApprox !== undefined ? { totalApprox: page.totalApprox } : {}),
    });
  }

  @Get("facets")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Filter facets with counts (non-suppressed businesses, cached up to 60 s)",
  })
  @ApiZodResponse(200, BusinessFacets)
  facets(@CurrentOrg() org: OrganizationScope) {
    return this.businesses.facets(org.organizationId);
  }

  @Post()
  @RequirePermission("businesses:write")
  @HttpCode(201)
  @ApiOperation({
    summary: "Add a business by hand (records user_edit observations)",
    description:
      "409 CONFLICT when a business with the same name and a shared phone, email or domain exists; `details[0].message` carries its id.",
  })
  @ApiZodBody(CreateBusinessRequest)
  @ApiZodResponse(201, BusinessDetail)
  create(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateBusinessRequest) body: CreateBusinessRequest,
    @Req() req: Request,
  ) {
    return this.businesses.create(org.organizationId, user.id, body, AuditService.contextFrom(req));
  }

  @Get(":id")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Business detail with field states, provenance summary and suppression (access is audited)",
  })
  @ApiZodResponse(200, BusinessDetail)
  detail(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.businesses.getDetail(org.organizationId, id, {
      userId: user.id,
      ctx: AuditService.contextFrom(req),
    });
  }

  @Patch(":id")
  @RequirePermission("businesses:write")
  @ApiOperation({
    summary: "Correct one field",
    description:
      "Records a user_edit observation, updates the canonical value, sets it to unverified and resolves conflicts on that field.",
  })
  @ApiZodBody(CorrectionRequest)
  @ApiZodResponse(200, BusinessDetail)
  correct(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(CorrectionRequest) body: CorrectionRequest,
    @Req() req: Request,
  ) {
    return this.businesses.correct(
      org.organizationId,
      user.id,
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Get(":id/observations")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Provenance: source observations, newest first" })
  @ApiZodQuery(ObservationListQuery)
  @ApiZodResponse(200, Observation.array())
  async observations(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(ObservationListQuery) query: ObservationsQuery,
  ) {
    const page = await this.businesses.listObservations(org.organizationId, id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get(":id/verification-events")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Verification history, newest first" })
  @ApiZodQuery(VerificationEventListQuery)
  @ApiZodResponse(200, VerificationEvent.array())
  async verificationEvents(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(VerificationEventListQuery) query: VerificationsQuery,
  ) {
    const page = await this.businesses.listVerificationEvents(org.organizationId, id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Post("suppress")
  @RequirePermission("businesses:write")
  @HttpCode(200)
  @ApiOperation({
    summary: "Suppress up to 100 businesses in one request",
    description:
      "Each id is handled like POST /businesses/:id/suppress with the same scope and reason (phone and email scopes use the business's primary value). Results are per item (suppressed, already_suppressed, not_found, no_value, failed); ids from another organization are not_found. 400 VALIDATION_FAILED for more than 100 ids, duplicates or a bad scope. One audit event (business.bulk_suppressed) records the batch.",
  })
  @ApiZodBody(BulkSuppressRequest)
  @ApiZodResponse(200, BulkSuppressResult)
  bulkSuppress(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(BulkSuppressRequest) body: BulkSuppressRequest,
    @Req() req: Request,
  ) {
    return this.businesses.bulkSuppress(
      org.organizationId,
      user.id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Post(":id/suppress")
  @RequirePermission("businesses:write")
  @HttpCode(200)
  @ApiOperation({
    summary: "Suppress the business, or its domain, phone or email",
    description:
      "Adds a suppression entry (checked at import and export) and flags every matching business in the organization.",
  })
  @ApiZodBody(SuppressRequest)
  @ApiZodResponse(200, BusinessDetail)
  suppress(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(SuppressRequest) body: SuppressRequest,
    @Req() req: Request,
  ) {
    return this.businesses.suppress(
      org.organizationId,
      user.id,
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Delete(":id/suppression")
  @RequirePermission("businesses:write")
  @HttpCode(200)
  @ApiOperation({
    summary: "Lift suppression created from this business",
    description:
      "Entries created from other businesses (for example a shared domain) still apply and are listed in the detail.",
  })
  @ApiZodResponse(200, BusinessDetail)
  unsuppress(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.businesses.unsuppress(
      org.organizationId,
      user.id,
      id,
      AuditService.contextFrom(req),
    );
  }
}
