import { Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerException, ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import type { Request } from "express";
import { clientIp, type RequestWithContext } from "../request/request-context.js";
import { wholeRetrySeconds } from "../errors/app.error.js";

/**
 * A route limit was hit. Carries the time left on the throttler's block (RedisThrottlerStorage
 * reports it with every hit), so the exception filter sends the real `Retry-After` and the
 * `retryAfterSeconds` detail instead of a fixed 60 seconds.
 */
export class ThrottledException extends ThrottlerException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

/** Rate limits per authenticated user when available, otherwise per client IP. */
@Injectable()
export class TrackedThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const user = (req as RequestWithContext).user;
    return user ? `u:${user.id}` : `ip:${clientIp(req)}`;
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottledException(
      await this.getErrorMessage(context, detail),
      wholeRetrySeconds(detail.timeToBlockExpire),
    );
  }
}
