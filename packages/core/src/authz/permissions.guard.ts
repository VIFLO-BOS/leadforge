import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import type { RequestWithContext } from "../common/request/request-context.js";
import { AUTH_ONLY_KEY, IS_PUBLIC_KEY } from "../auth/decorators.js";
import { REQUIRED_PERMISSION_KEY } from "./decorators.js";

/** Fails closed: a scoped route without a declared permission is denied. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION_KEY,
      targets,
    );
    const req = context.switchToHttp().getRequest<RequestWithContext>();
    if (!required || !req.org) throw AppError.forbidden();
    if (!req.org.permissions.includes(required)) throw AppError.forbidden();
    return true;
  }
}
