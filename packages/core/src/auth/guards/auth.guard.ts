import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ACCESS_COOKIE } from "@leadforge/contracts";
import { AppError } from "../../common/errors/app.error.js";
import type { RequestWithContext } from "../../common/request/request-context.js";
import { TokenService } from "../token.service.js";
import { SessionSecurityService } from "../session-security.service.js";
import { IS_PUBLIC_KEY } from "../decorators.js";

/**
 * Verifies the access token from the cookie (or Authorization: Bearer) and attaches
 * req.user. Public routes pass through. A token whose session was revoked (sign-out, device
 * sign-out, password reset, refresh-token reuse) is refused at once through the Redis list
 * kept by SessionSecurityService; org-level guards re-check membership.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessionSecurity: SessionSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const token = extractToken(req);

    if (!token) {
      if (isPublic) return true;
      throw new AppError("UNAUTHENTICATED");
    }

    try {
      const claims = await this.tokens.verifyAccessToken(token);
      if (await this.sessionSecurity.isRevoked(claims.sid)) throw new AppError("UNAUTHENTICATED");
      req.user = { id: claims.sub, sessionId: claims.sid, emailVerified: claims.ev };
      return true;
    } catch (err) {
      if (isPublic) return true;
      throw err;
    }
  }
}

function extractToken(req: RequestWithContext): string | null {
  const cookies = (req as { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}
