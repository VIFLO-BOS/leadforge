import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  DedupScanRequest,
  DedupScanResponse,
  DuplicateCandidate,
  DuplicateCandidateListQuery,
  MergeListQuery,
  MergeRecord,
  MergeRequest,
  MergeResponse,
  ObjectIdString,
  UndoMergeRequest,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  DedupService,
  RequirePermission,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type CandidatesQuery = DuplicateCandidateListQuery;
type MergesQuery = MergeListQuery;
type MergeBody = MergeRequest;
type UndoBody = UndoMergeRequest;
type ScanBody = DedupScanRequest;

@ApiTags("dedup")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("dedup")
export class DedupController {
  constructor(private readonly dedup: DedupService) {}

  private actor(org: OrganizationScope, user: AuthenticatedUser) {
    return { userId: user.id, role: org.role };
  }

  @Get("candidates")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Duplicate review queue, highest score first (default status=pending; filter by businessId, minScore)",
  })
  @ApiZodQuery(DuplicateCandidateListQuery)
  @ApiZodResponse(200, DuplicateCandidate.array())
  async list(
    @CurrentOrg() org: OrganizationScope,
    @ZodQuery(DuplicateCandidateListQuery) query: CandidatesQuery,
  ) {
    const page = await this.dedup.list(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("candidates/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "One candidate pair with both businesses side by side and the reasons" })
  @ApiZodResponse(200, DuplicateCandidate)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.dedup.get(org.organizationId, id);
  }

  @Post("candidates/:id/merge")
  @RequirePermission("dedup:write")
  @HttpCode(200)
  @ApiOperation({
    summary: "Accept: merge the pair into `survivorId` (snapshots kept for undo)",
    description:
      "409 CONFLICT when the candidate was already decided; 409 MERGE_CONFLICT when a business changed or was merged meanwhile; 400 when survivorId is not in the pair.",
  })
  @ApiZodBody(MergeRequest)
  @ApiZodResponse(200, MergeResponse)
  merge(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(MergeRequest) body: MergeBody,
    @Req() req: Request,
  ) {
    return this.dedup.merge(
      org.organizationId,
      this.actor(org, user),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Post("candidates/:id/reject")
  @RequirePermission("dedup:write")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject: not the same business (the pair is never proposed again)" })
  @ApiZodResponse(200, DuplicateCandidate)
  reject(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.dedup.reject(
      org.organizationId,
      this.actor(org, user),
      id,
      AuditService.contextFrom(req),
    );
  }

  @Post("candidates/:id/defer")
  @RequirePermission("dedup:write")
  @HttpCode(200)
  @ApiOperation({ summary: "Defer: decide later (status=deferred)" })
  @ApiZodResponse(200, DuplicateCandidate)
  defer(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @Req() req: Request,
  ) {
    return this.dedup.defer(
      org.organizationId,
      this.actor(org, user),
      id,
      AuditService.contextFrom(req),
    );
  }

  @Get("merges")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Merge history, newest first (filter by businessId: survivor or merged)",
  })
  @ApiZodQuery(MergeListQuery)
  @ApiZodResponse(200, MergeRecord.array())
  async merges(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(MergeListQuery) query: MergesQuery,
  ) {
    const page = await this.dedup.listMerges(org.organizationId, this.actor(org, user), query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("merges/:id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "One merge record" })
  @ApiZodResponse(200, MergeRecord)
  getMerge(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
  ) {
    return this.dedup.getMerge(org.organizationId, this.actor(org, user), id);
  }

  @Post("merges/:id/undo")
  @RequirePermission("dedup:write")
  @HttpCode(200)
  @ApiOperation({
    summary: "Undo a merge: restores both records exactly from their snapshots",
    description:
      "Owners and admins, or the person who merged within 30 days (else 403). 409 CONFLICT when already undone; 409 MERGE_CONFLICT when a record changed since the merge (send `force: true` to restore anyway).",
  })
  @ApiZodBody(UndoMergeRequest)
  @ApiZodResponse(200, MergeRecord)
  undo(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(UndoMergeRequest) body: UndoBody,
    @Req() req: Request,
  ) {
    return this.dedup.undo(
      org.organizationId,
      this.actor(org, user),
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Post("scan")
  @RequirePermission("dedup:write")
  @HttpCode(202)
  @ApiOperation({
    summary: "Look for duplicate candidates among these businesses, or the whole organization",
  })
  @ApiZodBody(DedupScanRequest)
  @ApiZodResponse(202, DedupScanResponse)
  scan(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(DedupScanRequest) body: ScanBody,
    @Req() req: Request,
  ) {
    return this.dedup.requestScan(org.organizationId, user.id, body, AuditService.contextFrom(req));
  }
}
