import { Injectable } from "@nestjs/common";
import { newId, Prisma, PrismaService, type OrganizationErasure } from "@leadforge/db-postgres";

export type ErasureTrigger = "schedule" | "reapply";

export interface PostgresPurgeResult {
  memberships: number;
  invitations: number;
  notificationPreferences: number;
  apiKeys: number;
  usageDaily: number;
  /** Members of no other organization: email, name and password erased, sessions revoked. */
  anonymizedUsers: number;
  /** Members who also belong to another organization: untouched apart from this membership. */
  keptUsers: number;
  emailTokens: number;
  billingCustomerEmail: boolean;
  /** Sessions revoked here; the caller also marks them revoked in Redis (immediate effect). */
  revokedSessionIds: string[];
}

/** A non-routable placeholder address under the reserved `.invalid` TLD (RFC 2606), unique per id. */
export function erasedEmail(id: string): string {
  return `erased+${id}@erased.invalid`;
}

/** The display name an organization keeps after the purge (invoices keep their frozen bill-to). */
export function erasedOrganizationName(id: string): string {
  return `Deleted organization ${id.slice(0, 8)}`;
}

/**
 * Stage 10: PostgreSQL side of the organization purge, and the erasure record that outlives it.
 * Billing records (customers, subscriptions, payments, invoices, refunds, disputes, the credit
 * ledger, entitlements, billing_audit) are never deleted here.
 */
@Injectable()
export class OrganizationErasureRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organizationId: string): Promise<OrganizationErasure | null> {
    return this.prisma.organizationErasure.findUnique({ where: { organizationId } });
  }

  /** Creates the record (or counts another attempt on it). `reapply` starts the steps afresh. */
  async begin(
    organizationId: string,
    input: {
      requestedAt: Date | null;
      requestedByUserId: string | null;
      purgeAfter: Date | null;
      trigger: ErasureTrigger;
    },
  ): Promise<OrganizationErasure> {
    return this.prisma.organizationErasure.upsert({
      where: { organizationId },
      create: {
        id: newId(),
        organizationId,
        requestedAt: input.requestedAt,
        requestedByUserId: input.requestedByUserId,
        purgeAfter: input.purgeAfter,
        trigger: input.trigger,
        attempts: 1,
        steps: {},
      },
      update: {
        attempts: { increment: 1 },
        lastError: null,
        ...(input.trigger === "reapply"
          ? { trigger: "reapply", steps: {}, completedAt: null, startedAt: new Date() }
          : {}),
      },
    });
  }

  /** Records a finished step with its counts (`steps.<step> = { completedAt, ...result }`). */
  async recordStep(
    organizationId: string,
    step: string,
    result: Record<string, unknown>,
    at: Date,
  ): Promise<OrganizationErasure> {
    const current = await this.prisma.organizationErasure.findUniqueOrThrow({
      where: { organizationId },
    });
    const steps = {
      ...((current.steps as Record<string, unknown> | null) ?? {}),
      [step]: { completedAt: at.toISOString(), ...result },
    };
    return this.prisma.organizationErasure.update({
      where: { organizationId },
      data: { steps: steps as Prisma.InputJsonValue },
    });
  }

  async fail(organizationId: string, message: string): Promise<void> {
    await this.prisma.organizationErasure.updateMany({
      where: { organizationId },
      data: { lastError: message.slice(0, 1000) },
    });
  }

  complete(organizationId: string, at: Date): Promise<OrganizationErasure> {
    return this.prisma.organizationErasure.update({
      where: { organizationId },
      data: { completedAt: at, lastError: null },
    });
  }

  /** Every member (any status) of the organization: user ids for cache invalidation before the purge. */
  async memberUserIds(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /**
   * One transaction: deletes memberships, invitations, notification preferences, API keys and
   * usage rows; anonymizes members who belong to no other organization (email to a unique
   * `.invalid` placeholder, name and password cleared, verification cleared, `deleted_at` set,
   * email links deleted, sessions revoked); replaces the billing customer's contact email with a
   * placeholder (invoices keep their frozen bill-to). Members of other organizations keep their
   * account and other memberships untouched.
   */
  async purgeOrganizationRows(organizationId: string, now: Date): Promise<PostgresPurgeResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const members = await tx.membership.findMany({
          where: { organizationId },
          select: { userId: true },
        });
        const memberIds = [...new Set(members.map((m) => m.userId))];
        const shared = memberIds.length
          ? await tx.membership.findMany({
              where: { userId: { in: memberIds }, organizationId: { not: organizationId } },
              select: { userId: true },
              distinct: ["userId"],
            })
          : [];
        const keep = new Set(shared.map((m) => m.userId));
        const erase = memberIds.filter((id) => !keep.has(id));

        const invitations = await tx.invitation.deleteMany({ where: { organizationId } });
        const notificationPreferences = await tx.notificationPreference.deleteMany({
          where: { organizationId },
        });
        const apiKeys = await tx.apiKey.deleteMany({ where: { organizationId } });
        const usageDaily = await tx.usageDaily.deleteMany({ where: { organizationId } });
        const memberships = await tx.membership.deleteMany({ where: { organizationId } });

        let emailTokens = 0;
        const revokedSessionIds: string[] = [];
        for (const userId of erase) {
          const live = await tx.session.findMany({
            where: { userId, revokedAt: null },
            select: { id: true },
          });
          revokedSessionIds.push(...live.map((s) => s.id));
          await tx.session.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: now },
          });
          emailTokens += (await tx.emailToken.deleteMany({ where: { userId } })).count;
          // The user's preferences in other organizations cannot exist (no other membership).
          await tx.notificationPreference.deleteMany({ where: { userId } });
          await tx.user.update({
            where: { id: userId },
            data: {
              email: erasedEmail(userId),
              name: "",
              passwordHash: "",
              avatarUrl: null,
              authProviders: Prisma.DbNull,
              emailVerifiedAt: null,
              deletedAt: now,
            },
          });
        }

        const customer = await tx.billingCustomer.updateMany({
          where: { organizationId, email: { not: erasedEmail(organizationId) } },
          data: { email: erasedEmail(organizationId) },
        });

        return {
          memberships: memberships.count,
          invitations: invitations.count,
          notificationPreferences: notificationPreferences.count,
          apiKeys: apiKeys.count,
          usageDaily: usageDaily.count,
          anonymizedUsers: erase.length,
          keptUsers: keep.size,
          emailTokens,
          billingCustomerEmail: customer.count > 0,
          revokedSessionIds,
        };
      },
      { maxWait: 60_000, timeout: 120_000 },
    );
  }

  /** Marks the organization purged and replaces its name and slug (billing law keeps invoice bill-to, not the profile). */
  async finalizeOrganization(organizationId: string, now: Date): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: erasedOrganizationName(organizationId),
        slug: `deleted-${organizationId}`,
        deletedAt: now,
        purgedAt: now,
        deletionRequestedByUserId: null,
      },
    });
  }
}
