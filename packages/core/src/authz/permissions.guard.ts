import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import type { RequestWithContext } from "../common/request/request-context.js";
import { AUTH_ONLY_KEY, IS_PUBLIC_KEY } from "../auth/decorators.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { PAUSED_DURING_DELETION_KEY, REQUIRED_PERMISSION_KEY } from "./decorators.js";

/**
 * Fails closed: a scoped route without a declared permission is denied. Stage 10: a route marked
 * @PausedDuringDeletionGrace() is then refused (409 ORGANIZATION_PENDING_DELETION) while the
 * organization is scheduled for deletion.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly organizations: OrganizationsService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission | Permission[] | undefined>(
      REQUIRED_PERMISSION_KEY,
      targets,
    );
    const req = context.switchToHttp().getRequest<RequestWithContext>();
    if (!required || !req.org) throw AppError.forbidden();
    const anyOf = Array.isArray(required) ? required : [required];
    if (anyOf.length === 0 || !anyOf.some((p) => req.org!.permissions.includes(p)))
      throw AppError.forbidden();
    if (this.reflector.getAllAndOverride<boolean>(PAUSED_DURING_DELETION_KEY, targets)) {
      return this.organizations.assertNotPendingDeletion(req.org.organizationId).then(() => true);
    }
    return true;
  }
}
