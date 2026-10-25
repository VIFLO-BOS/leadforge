import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";

/**
 * CSRF token bound to the session: HMAC(secret, sessionId). The browser reads it from
 * a non-httpOnly cookie and echoes it in X-CSRF-Token; the guard recomputes it from the
 * authenticated session, so a token from another session or a tossed cookie fails.
 */
@Injectable()
export class CsrfService {
  constructor(@Inject(ENV) private readonly env: ServerEnv) {}

  tokenFor(sessionId: string): string {
    return createHmac("sha256", this.env.CSRF_SECRET).update(sessionId).digest("base64url");
  }

  matches(sessionId: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const expected = Buffer.from(this.tokenFor(sessionId));
    const actual = Buffer.from(presented);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
