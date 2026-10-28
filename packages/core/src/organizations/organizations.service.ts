import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS } from "../redis/redis.module.js";
import {
  ROLE_PERMISSIONS,
  type MemberSummary,
  type OrganizationMembershipSummary,
  type OrganizationProfile,
  type OrganizationRole,
  type UpdateMemberRequest,
  type UpdateOrganizationRequest,
} from "@leadforge/contracts";
import { newId, PrismaService, type Prisma } from "@leadforge/db-postgres";
import { AppError } from "../common/errors/app.error.js";
import type { OrganizationScope } from "../common/request/request-context.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { OrganizationRepository } from "./repositories/organization.repository.js";
import { MembershipRepository } from "./repositories/membership.repository.js";
import { EntitlementsService, memberLimitReached } from "../entitlements/entitlements.service.js";

const DEFAULT_CURRENCY_BY_COUNTRY: Record<string, string> = {
  NG: "NGN",
  GH: "GHS",
  KE: "KES",
  ZA: "ZAR",
  US: "USD",
  GB: "GBP",
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Drops the authz membership cache entry so the next request re-reads PostgreSQL. */
  private async invalidateMembershipCache(userId: string, organizationId: string): Promise<void> {
    await this.redis.del(`lf:member:${userId}:${organizationId}`).catch(() => undefined);
  }

  private static dataSettingsKey(organizationId: string): string {
    return `lf:org:data-settings:${organizationId}`;
  }

  /**
   * Settings other modules need on hot paths (freshness window for field states, country
   * for phone parsing defaults). Cached for 5 minutes and dropped on update.
   */
  async getDataSettings(
    organizationId: string,
  ): Promise<{ freshnessDays: number; country: string }> {
    const key = OrganizationsService.dataSettingsKey(organizationId);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { freshnessDays: number; country: string };
        if (typeof parsed.freshnessDays === "number" && typeof parsed.country === "string")
          return parsed;
      } catch {
        // fall through to the database
      }
    }
    const org = await this.organizations.findById(organizationId);
    if (!org) throw AppError.notFound("Organization");
    const settings = { freshnessDays: org.freshnessDays, country: org.country };
    await this.redis.set(key, JSON.stringify(settings), "EX", 300).catch(() => undefined);
    return settings;
  }

  private static lifecycleKey(organizationId: string): string {
    return `lf:org:lifecycle:${organizationId}`;
  }

  /**
   * Stage 10: the organization's pending deletion, if any (cached 60 seconds; dropped when a
   * deletion is requested or cancelled, so this process sees the change at once).
   */
  async deletionState(
    organizationId: string,
  ): Promise<{ pending: boolean; deletionRequestedAt: Date | null; purgeAfter: Date | null }> {
    const key = OrganizationsService.lifecycleKey(organizationId);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          requestedAt: string | null;
          purgeAfter: string | null;
        };
        return {
          pending: Boolean(parsed.requestedAt),
          deletionRequestedAt: parsed.requestedAt ? new Date(parsed.requestedAt) : null,
          purgeAfter: parsed.purgeAfter ? new Date(parsed.purgeAfter) : null,
        };
      } catch {
        // fall through to the database
      }
    }
    const org = await this.organizations.findAnyById(organizationId);
    const requestedAt = org?.deletionRequestedAt ?? null;
    const purgeAfter = org?.purgeAfter ?? null;
    await this.redis
      .set(
        key,
        JSON.stringify({
          requestedAt: requestedAt?.toISOString() ?? null,
          purgeAfter: purgeAfter?.toISOString() ?? null,
        }),
        "EX",
        60,
      )
      .catch(() => undefined);
    return { pending: Boolean(requestedAt), deletionRequestedAt: requestedAt, purgeAfter };
  }

  /** Drops the cached deletion state (after a request, a cancellation or the purge). */
  async forgetLifecycle(organizationId: string): Promise<void> {
    await this.redis
      .del(
        OrganizationsService.lifecycleKey(organizationId),
        OrganizationsService.dataSettingsKey(organizationId),
      )
      .catch(() => undefined);
  }

  /**
   * Stage 10: 409 ORGANIZATION_PENDING_DELETION while a deletion is pending. Guards new paid or
   * long work (discovery, analysis, imports, checkouts, invitations); reads, exports and CRM edits
   * never call this.
   */
  async assertNotPendingDeletion(organizationId: string): Promise<void> {
    const state = await this.deletionState(organizationId);
    if (!state.pending) return;
    throw pendingDeletionError(state.purgeAfter);
  }

  /** Background jobs re-check that the organization is live and the requester still a member. */
  async isActiveMember(
    organizationId: string,
    userId: string,
  ): Promise<{ active: boolean; role: OrganizationRole | null }> {
    const membership = await this.memberships.findActive(organizationId, userId);
    return { active: Boolean(membership), role: membership?.role ?? null };
  }

  /** Maintenance (usage rollup): live organization ids in id order after `afterId`. */
  liveOrganizationIds(afterId: string | null, limit: number): Promise<string[]> {
    return this.organizations.liveIds(afterId, limit);
  }

  /** Creates organization, owner membership and billing customer inside the caller's transaction. */
  async createForNewUser(
    input: { name: string; country: string; userId: string; email: string },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const slug = await this.uniqueSlug(input.name, tx);
    const org = await tx.organization.create({
      data: {
        id: newId(),
        name: input.name,
        slug,
        country: input.country,
        defaultCurrency: DEFAULT_CURRENCY_BY_COUNTRY[input.country] ?? "USD",
        createdByUserId: input.userId,
      },
    });
    await this.memberships.create(
      { organizationId: org.id, userId: input.userId, role: "owner" },
      tx,
    );
    const customer = await tx.billingCustomer.create({
      data: {
        id: newId(),
        organizationId: org.id,
        email: input.email,
        currency: org.defaultCurrency,
      },
    });
    // Phase 6: a new organization starts on the free tier's entitlements.
    await this.entitlements.writeForPlanInTx(tx, customer.id, null);
  }

  async listForUser(userId: string): Promise<OrganizationMembershipSummary[]> {
    const rows = await this.memberships.listForUser(userId);
    return rows.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      country: m.organization.country,
      role: m.role,
      deletionRequestedAt: m.organization.deletionRequestedAt?.toISOString() ?? null,
      purgeAfter: m.organization.deletionRequestedAt
        ? (m.organization.purgeAfter?.toISOString() ?? null)
        : null,
    }));
  }

  async getCurrent(scope: OrganizationScope): Promise<OrganizationProfile> {
    const org = await this.organizations.findById(scope.organizationId);
    if (!org) throw AppError.notFound("Organization");
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      country: org.country,
      defaultCurrency: org.defaultCurrency,
      freshnessDays: org.freshnessDays,
      createdAt: org.createdAt.toISOString(),
      memberCount: await this.organizations.countMembers(org.id),
      role: scope.role,
      deletionRequestedAt: org.deletionRequestedAt?.toISOString() ?? null,
      purgeAfter: org.deletionRequestedAt ? (org.purgeAfter?.toISOString() ?? null) : null,
    };
  }

  async update(
    scope: OrganizationScope,
    actorUserId: string,
    dto: UpdateOrganizationRequest,
    ctx: AuditContext,
  ): Promise<OrganizationProfile> {
    const before = await this.organizations.findById(scope.organizationId);
    if (!before) throw AppError.notFound("Organization");
    const after = await this.organizations.update(scope.organizationId, dto);
    await this.redis
      .del(OrganizationsService.dataSettingsKey(scope.organizationId))
      .catch(() => undefined);
    await this.audit.record(
      {
        organizationId: scope.organizationId,
        actorUserId,
        actorType: "user",
        action: "org.updated",
        resourceType: "organization",
        resourceId: scope.organizationId,
        before: pick(before, Object.keys(dto)),
        after: pick(after, Object.keys(dto)),
      },
      ctx,
    );
    return this.getCurrent(scope);
  }

  async listMembers(organizationId: string): Promise<MemberSummary[]> {
    const rows = await this.memberships.listForOrganization(organizationId);
    return rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.status,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async updateMember(
    scope: OrganizationScope,
    actorUserId: string,
    targetUserId: string,
    dto: UpdateMemberRequest,
    ctx: AuditContext,
  ): Promise<MemberSummary> {
    const target = await this.memberships.find(scope.organizationId, targetUserId);
    if (!target) throw AppError.notFound("Member");
    this.assertCanManage(scope.role, target.role, dto.role);

    if (dto.role && dto.role !== "owner" && target.role === "owner") {
      await this.assertNotLastOwner(scope.organizationId);
    }
    if (dto.status === "suspended" && target.role === "owner") {
      await this.assertNotLastOwner(scope.organizationId);
    }
    if (
      targetUserId === actorUserId &&
      dto.role &&
      dto.role !== target.role &&
      target.role === "owner"
    ) {
      await this.assertNotLastOwner(scope.organizationId);
    }

    let updated;
    if (dto.status === "active" && target.status !== "active") {
      // Member cap (Phase 6): reactivating a suspended member takes a seat.
      const cap = await this.entitlements.maxMembers(scope.organizationId);
      updated = await this.prisma.$transaction(async (tx) => {
        await this.memberships.lockOrganization(scope.organizationId, tx);
        const active = await this.memberships.countActive(scope.organizationId, tx);
        if (active + 1 > cap) throw memberLimitReached(cap, active);
        return this.memberships.update(scope.organizationId, targetUserId, dto, tx);
      });
    } else {
      updated = await this.memberships.update(scope.organizationId, targetUserId, dto);
    }
    await this.invalidateMembershipCache(targetUserId, scope.organizationId);
    if (dto.role && dto.role !== target.role) {
      await this.audit.record(
        {
          organizationId: scope.organizationId,
          actorUserId,
          actorType: "user",
          action: "org.member_role_changed",
          resourceType: "membership",
          resourceId: updated.id,
          before: { role: target.role },
          after: { role: dto.role },
        },
        ctx,
      );
    }
    if (dto.status && dto.status !== target.status) {
      await this.audit.record(
        {
          organizationId: scope.organizationId,
          actorUserId,
          actorType: "user",
          action: "org.member_status_changed",
          resourceType: "membership",
          resourceId: updated.id,
          before: { status: target.status },
          after: { status: dto.status },
        },
        ctx,
      );
    }
    const members = await this.listMembers(scope.organizationId);
    const summary = members.find((m) => m.userId === targetUserId);
    if (!summary) throw AppError.notFound("Member");
    return summary;
  }

  async removeMember(
    scope: OrganizationScope,
    actorUserId: string,
    targetUserId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const target = await this.memberships.find(scope.organizationId, targetUserId);
    if (!target) throw AppError.notFound("Member");
    this.assertCanManage(scope.role, target.role);
    if (target.role === "owner") await this.assertNotLastOwner(scope.organizationId);
    await this.memberships.delete(scope.organizationId, targetUserId);
    await this.invalidateMembershipCache(targetUserId, scope.organizationId);
    await this.audit.record(
      {
        organizationId: scope.organizationId,
        actorUserId,
        actorType: "user",
        action: "org.member_removed",
        resourceType: "membership",
        resourceId: target.id,
        before: { userId: targetUserId, role: target.role },
      },
      ctx,
    );
  }

  permissionsFor(role: OrganizationRole) {
    return ROLE_PERMISSIONS[role];
  }

  /** Admins may not touch owners or grant ownership; nobody below admin manages members. */
  private assertCanManage(
    actorRole: OrganizationRole,
    targetRole: OrganizationRole,
    newRole?: OrganizationRole,
  ): void {
    if (actorRole === "owner") return;
    if (actorRole === "admin") {
      if (targetRole === "owner" || newRole === "owner") {
        throw AppError.forbidden("Only owners can manage owner memberships");
      }
      return;
    }
    throw AppError.forbidden();
  }

  private async assertNotLastOwner(organizationId: string): Promise<void> {
    const owners = await this.memberships.countByRole(organizationId, "owner");
    if (owners <= 1) throw new AppError("LAST_OWNER");
  }

  private async uniqueSlug(name: string, tx: Prisma.TransactionClient): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "org";
    let candidate = base;
    for (let i = 0; i < 5; i++) {
      if (!(await this.organizations.slugExists(candidate, tx))) return candidate;
      candidate = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    }
    return `${base}-${newId().slice(-8)}`;
  }
}

/** 409 ORGANIZATION_PENDING_DELETION with the purge date (`details` path `purgeAfter`). */
export function pendingDeletionError(purgeAfter: Date | null): AppError {
  const when = purgeAfter ? ` on ${purgeAfter.toISOString().slice(0, 10)}` : "";
  return new AppError(
    "ORGANIZATION_PENDING_DELETION",
    `This organization is scheduled for deletion${when}. New discovery, website analysis, imports, purchases and invitations are paused; an owner can cancel the deletion in Settings.`,
    purgeAfter ? [{ path: "purgeAfter", message: purgeAfter.toISOString() }] : undefined,
  );
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}
