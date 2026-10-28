import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Permission } from "@leadforge/contracts";
import type { OrganizationScope, RequestWithContext } from "../common/request/request-context.js";

export const REQUIRED_PERMISSION_KEY = "lf:permission";

/**
 * Route requires organization scope and this permission; with several, any one of them
 * (the service then narrows what each role may do, for example assigned-only exports).
 */
export const RequirePermission = (permission: Permission, ...anyOf: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, anyOf.length ? [permission, ...anyOf] : permission);

/** Stage 10: metadata key of routes refused while the organization is scheduled for deletion. */
export const PAUSED_DURING_DELETION_KEY = "lf:paused-during-deletion";

/**
 * Stage 10: new paid or long work (discovery, website analysis and enrichment, imports, checkouts
 * and plan changes, invitations) is refused with 409 ORGANIZATION_PENDING_DELETION while the
 * organization is in its 14-day deletion grace. Checked by PermissionsGuard after the permission.
 */
export const PausedDuringDeletionGrace = () => SetMetadata(PAUSED_DURING_DELETION_KEY, true);

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationScope => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!req.org) throw new Error("CurrentOrg used on a route without OrgScopeGuard");
    return req.org;
  },
);
