import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { clientIp, type RequestWithContext } from "../request/request-context.js";

/** Rate limits per authenticated user when available, otherwise per client IP. */
@Injectable()
export class TrackedThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const user = (req as RequestWithContext).user;
    return user ? `u:${user.id}` : `ip:${clientIp(req)}`;
  }
}
