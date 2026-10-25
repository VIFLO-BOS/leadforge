import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { SkipThrottle } from "@nestjs/throttler";
import { HealthService, Public } from "@leadforge/core";

@ApiTags("health")
@Controller("health")
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @HttpCode(200)
  live() {
    return this.health.live();
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.ready();
    res.status(result.status === "ok" ? 200 : 503);
    return result;
  }
}
