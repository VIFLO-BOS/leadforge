import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  CreateInvitationRequest,
  InvitationSummary,
  MemberSummary,
  OrganizationProfile,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodResponse,
  AuditService,
  CurrentOrg,
  CurrentUser,
  InvitationsService,
  OrganizationsService,
  RequirePermission,
  ZodBody,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

@ApiTags("organizations")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("organizations/current")
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @RequirePermission("businesses:read")
  @ApiZodResponse(200, OrganizationProfile)
  current(@CurrentOrg() org: OrganizationScope) {
    return this.organizations.getCurrent(org);
  }

  @Patch()
  @RequirePermission("organization:settings")
  @ApiZodBody(UpdateOrganizationRequest)
  @ApiZodResponse(200, OrganizationProfile)
  update(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(UpdateOrganizationRequest) body: UpdateOrganizationRequest,
    @Req() req: Request,
  ) {
    return this.organizations.update(org, user.id, body, AuditService.contextFrom(req));
  }

  @Get("members")
  @RequirePermission("businesses:read")
  @ApiZodResponse(200, MemberSummary.array())
  async members(@CurrentOrg() org: OrganizationScope) {
    return paged(await this.organizations.listMembers(org.organizationId));
  }

  @Patch("members/:userId")
  @RequirePermission("members:manage")
  @ApiZodBody(UpdateMemberRequest)
  @ApiZodResponse(200, MemberSummary)
  updateMember(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @ZodBody(UpdateMemberRequest) body: UpdateMemberRequest,
    @Req() req: Request,
  ) {
    return this.organizations.updateMember(
      org,
      user.id,
      userId,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Delete("members/:userId")
  @RequirePermission("members:manage")
  @HttpCode(204)
  async removeMember(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ) {
    await this.organizations.removeMember(org, user.id, userId, AuditService.contextFrom(req));
  }

  @Get("invitations")
  @RequirePermission("members:manage")
  @ApiZodResponse(200, InvitationSummary.array())
  async listInvitations(@CurrentOrg() org: OrganizationScope) {
    return paged(await this.invitations.list(org.organizationId));
  }

  @Post("invitations")
  @RequirePermission("members:manage")
  @HttpCode(201)
  @ApiZodBody(CreateInvitationRequest)
  @ApiZodResponse(201, InvitationSummary)
  createInvitation(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CreateInvitationRequest) body: CreateInvitationRequest,
    @Req() req: Request,
  ) {
    return this.invitations.create(org, user.id, body, AuditService.contextFrom(req));
  }

  @Delete("invitations/:id")
  @RequirePermission("members:manage")
  @HttpCode(204)
  async revokeInvitation(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    await this.invitations.revoke(org, user.id, id, AuditService.contextFrom(req));
  }

  @Post("deletion-requests")
  @RequirePermission("organization:delete")
  @HttpCode(202)
  requestDeletion(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.organizations.requestDeletion(org, user.id, AuditService.contextFrom(req));
  }
}
