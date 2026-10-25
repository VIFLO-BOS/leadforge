import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Permission } from "@leadforge/contracts";
import type { OrganizationScope, RequestWithContext } from "../common/request/request-context.js";

export const REQUIRED_PERMISSION_KEY = "lf:permission";

/** Route requires organization scope and this permission. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationScope => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!req.org) throw new Error("CurrentOrg used on a route without OrgScopeGuard");
    return req.org;
  },
);
