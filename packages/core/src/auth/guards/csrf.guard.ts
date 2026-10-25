import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CSRF_HEADER } from "@leadforge/contracts";
import { AppError } from "../../common/errors/app.error.js";
import type { RequestWithContext } from "../../common/request/request-context.js";
import { CsrfService } from "../csrf.service.js";
import { SKIP_CSRF_KEY } from "../decorators.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Requires X-CSRF-Token on state-changing requests that are authenticated by cookie.
 * Requests authenticated with a Bearer header are not CSRF-prone and are exempt.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly csrf: CsrfService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithContext>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (!req.user) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.startsWith("Bearer ")) return true;

    const presented = req.headers[CSRF_HEADER];
    const token = Array.isArray(presented) ? presented[0] : presented;
    if (!this.csrf.matches(req.user.sessionId, token)) throw new AppError("CSRF_FAILED");
    return true;
  }
}
