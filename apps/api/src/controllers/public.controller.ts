import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { ContactRequest, PublicPlansResponse } from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodResponse,
  ContactService,
  PlansService,
  Public,
  SkipCsrf,
  ZodBody,
  clientIp,
} from "@leadforge/core";

@ApiTags("public")
@Controller("public")
@Public()
export class PublicController {
  constructor(
    private readonly plans: PlansService,
    private readonly contact: ContactService,
  ) {}

  @Get("plans")
  @ApiZodResponse(200, PublicPlansResponse)
  listPlans() {
    return this.plans.listPublic();
  }

  @Post("contact")
  @SkipCsrf()
  @Throttle({ contact: { limit: 3, ttl: 60 * 60_000 } })
  @HttpCode(202)
  @ApiZodBody(ContactRequest)
  submitContact(@ZodBody(ContactRequest) body: ContactRequest, @Req() req: Request) {
    return this.contact.submit(body, clientIp(req));
  }
}
