import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Redis } from "ioredis";
import {
  ORGANIZATION_HEADER,
  OrganizationRole,
  ROLE_PERMISSIONS,
  UuidString,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import type { RequestWithContext } from "../common/request/request-context.js";
import { REDIS } from "../redis/redis.module.js";
import { IS_PUBLIC_KEY, AUTH_ONLY_KEY } from "../auth/decorators.js";
import { MembershipRepository } from "../organizations/repositories/membership.repository.js";

const CACHE_TTL_SECONDS = 60;

/**
 * Resolves the organization asserted in X-Organization-Id, verifies the caller is an
 * active member (cached 60s), and attaches req.org. Unverified emails are blocked from
 * all organization data.
 */
@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    if (!req.user) throw new AppError("UNAUTHENTICATED");
    if (!req.user.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED");

    const raw = req.headers[ORGANIZATION_HEADER];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const parsed = UuidString.safeParse(header);
    if (!parsed.success)
      throw new AppError("ORG_FORBIDDEN", "Missing or invalid organization header");
    const organizationId = parsed.data;

    const role = await this.resolveRole(req.user.id, organizationId);
    if (!role) throw new AppError("ORG_FORBIDDEN");

    req.org = { organizationId, role, permissions: ROLE_PERMISSIONS[role] };
    return true;
  }

  private async resolveRole(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRole | null> {
    const key = `lf:member:${userId}:${organizationId}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      const parsed = OrganizationRole.safeParse(cached);
      if (parsed.success) return parsed.data;
    }
    const membership = await this.memberships.findActive(organizationId, userId);
    if (!membership) return null;
    await this.redis.set(key, membership.role, "EX", CACHE_TTL_SECONDS).catch(() => undefined);
    return membership.role;
  }

  /** Call after any membership change so the next request sees it. */
  static invalidationKey(userId: string, organizationId: string): string {
    return `lf:member:${userId}:${organizationId}`;
  }
}
