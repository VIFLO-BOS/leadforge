import { Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { InvitationPreview } from "@leadforge/contracts";
import {
  ApiZodResponse,
  AuditService,
  AuthOnly,
  CurrentUser,
  InvitationsService,
  Public,
  type AuthenticatedUser,
} from "@leadforge/core";

@ApiTags("invitations")
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(":token")
  @Public()
  @Throttle({ auth: { limit: 20, ttl: 60_000 } })
  @ApiZodResponse(200, InvitationPreview)
  preview(@Param("token") token: string) {
    return this.invitations.preview(token);
  }

  @Post(":token/accept")
  @AuthOnly()
  @HttpCode(200)
  accept(
    @Param("token") token: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.invitations.accept(token, user.id, AuditService.contextFrom(req));
  }
}
