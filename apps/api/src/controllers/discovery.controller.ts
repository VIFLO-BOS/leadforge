import { Controller, Get, Headers, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  DiscoveryCategoriesQuery,
  DiscoveryCategoryOption,
  DiscoveryEstimate,
  DiscoveryItemsQuery,
  DiscoveryLocationOptions,
  DiscoveryLocationsQuery,
  DiscoveryJob,
  DiscoveryJobItem,
  DiscoveryJobListQuery,
  DiscoveryJobSpec,
  DiscoverySourceOption,
  IDEMPOTENCY_KEY_HEADER,
  ObjectIdString,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AppError,
  AuditService,
  CurrentOrg,
  CurrentUser,
  DiscoveryService,
  OvertureCatalogService,
  RequirePermission,
  SourcesService,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
  PausedDuringDeletionGrace,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type ListQuery = DiscoveryJobListQuery;
type ItemsQuery = DiscoveryItemsQuery;
type Spec = DiscoveryJobSpec;
type CategoriesQuery = DiscoveryCategoriesQuery;
type LocationsQuery = DiscoveryLocationsQuery;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

@ApiTags("discovery")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("discovery")
export class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly sources: SourcesService,
    private readonly overture: OvertureCatalogService,
  ) {}

  @Get("sources")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Discovery sources for the job wizard, with status and whether they can run",
  })
  @ApiZodResponse(200, DiscoverySourceOption.array())
  async listSources(@CurrentOrg() org: OrganizationScope) {
    const items = await this.sources.discoveryOptions(org.organizationId);
    return paged(items, { nextCursor: null, pageSize: items.length });
  }

  @Get("categories")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Category options for the job wizard (Overture): curated Nigerian categories with synonyms, then Overture categories",
    description:
      "Send an option's label (or any synonym) in spec.categories. `places` counts offerable places in the loaded snapshot nationwide (null before the first sync). Only overture_places has a catalogue; other sources return an empty list.",
  })
  @ApiZodQuery(DiscoveryCategoriesQuery)
  @ApiZodResponse(200, DiscoveryCategoryOption.array())
  async categories(@ZodQuery(DiscoveryCategoriesQuery) query: CategoriesQuery) {
    const items =
      query.source === "overture_places"
        ? await this.overture.categories(query.q, query.limit)
        : [];
    return paged(items, { nextCursor: null, pageSize: items.length });
  }

  @Get("locations")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "States and LGAs for the job wizard (Overture), with offerable place counts",
    description:
      "Send a state name as location.region and an LGA name as location.lga. Empty before the first Overture sync.",
  })
  @ApiZodQuery(DiscoveryLocationsQuery)
  @ApiZodResponse(200, DiscoveryLocationOptions)
  async locations(@ZodQuery(DiscoveryLocationsQuery) query: LocationsQuery) {
    if (query.source !== "overture_places") {
      return {
        source: query.source,
        release: null,
        country: "NG",
        states: [],
        boundariesAttribution: "",
      };
    }
    return this.overture.locations();
  }

  @Post("jobs/estimate")
  @RequirePermission("discovery:run")
  @HttpCode(200)
  @ApiOperation({
    summary: "Estimate a job: credit hold, per-source limits and blockers",
    description:
      "Never throws for an unconfigured or disabled source; it is listed in `blockers` and `estimateAvailable` is false.",
  })
  @ApiZodBody(DiscoveryJobSpec)
  @ApiZodResponse(200, DiscoveryEstimate)
  estimate(@CurrentOrg() org: OrganizationScope, @ZodBody(DiscoveryJobSpec) spec: Spec) {
    return this.discovery.estimate(org.organizationId, spec);
  }

  @Post("jobs")
  @RequirePermission("discovery:run")
  @PausedDuringDeletionGrace()
  @HttpCode(201)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "8-128 characters; resubmitting the same key and spec returns the same job (200)",
  })
  @ApiOperation({
    summary: "Create and queue a discovery job (holds credits)",
    description:
      "Validates the spec, checks every source is configured and enabled, holds min(maxRecords, source limit) credits and queues the job (Overture: the exact number of matching places not already in the directory). Errors: 402 INSUFFICIENT_CREDITS, 422 SOURCE_POLICY_BLOCKED (google_places: provider terms), 422 SOURCE_NOT_CONFIGURED, 422 SOURCE_DISABLED, 400 VALIDATION_FAILED (path `sources` when nothing matches), 429 RATE_LIMITED (30 jobs per hour per organization), 409 CONFLICT (Idempotency-Key reused with another spec).",
  })
  @ApiZodBody(DiscoveryJobSpec)
  @ApiZodResponse(201, DiscoveryJob)
  async create(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(DiscoveryJobSpec) spec: Spec,
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
    const { job, replayed } = await this.discovery.create(
      org.organizationId,
      user.id,
      spec,
      idempotencyKey,
      AuditService.contextFrom(req),
    );
    if (replayed) res.status(200);
    return job;
  }

  @Get("jobs")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Discovery jobs, newest first" })
  @ApiZodQuery(DiscoveryJobListQuery)
  @ApiZodResponse(200, DiscoveryJob.array())
  async list(
    @CurrentOrg() org: OrganizationScope,
    @ZodQuery(DiscoveryJobListQuery) query: ListQuery,
  ) {
    const page = await this.discovery.list(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("jobs/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Job status, progress, source outcomes and credits (poll every 2 s while queued or running)",
  })
  @ApiZodResponse(200, DiscoveryJob)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.discovery.get(org.organizationId, id);
  }

  @Get("jobs/:id/items")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Per-item results in discovery order (filter by outcome, e.g. outcome=failed)",
  })
  @ApiZodQuery(DiscoveryItemsQuery)
  @ApiZodResponse(200, DiscoveryJobItem.array())
  async items(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(DiscoveryItemsQuery) query: ItemsQuery,
  ) {
    const page = await this.discovery.listItems(org.organizationId, id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Post("jobs/:id/cancel")
  @RequirePermission("discovery:run")
  @HttpCode(200)
  @ApiOperation({
    summary: "Cancel a queued or running job",
    description:
      "Queued jobs are cancelled at once. Running jobs get cancelRequested and stop before the next page; finished items are charged, the rest released. 409 JOB_NOT_CANCELLABLE when already finished.",
  })
  @ApiZodResponse(200, DiscoveryJob)
  cancel(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.discovery.cancel(org.organizationId, user.id, id, AuditService.contextFrom(req));
  }

  @Post("jobs/:id/retry-failed")
  @RequirePermission("discovery:run")
  @PausedDuringDeletionGrace()
  @HttpCode(202)
  @ApiOperation({
    summary: "Re-queue the failed items of a finished job (new credit hold)",
    description:
      "409 JOB_NOT_RETRYABLE when the job is still running, not settled yet, or has no failed items; 402 INSUFFICIENT_CREDITS.",
  })
  @ApiZodResponse(202, DiscoveryJob)
  retryFailed(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.discovery.retryFailed(
      org.organizationId,
      user.id,
      id,
      AuditService.contextFrom(req),
    );
  }
}
