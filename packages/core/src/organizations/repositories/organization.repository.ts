import { Injectable } from "@nestjs/common";
import { newId, PrismaService, type Organization, type Prisma } from "@leadforge/db-postgres";

@Injectable()
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
  }

  async slugExists(slug: string, tx: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    return (await tx.organization.count({ where: { slug } })) > 0;
  }

  create(
    data: { name: string; slug: string; country: string; createdByUserId: string },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Organization> {
    return tx.organization.create({ data: { id: newId(), ...data } });
  }

  update(
    id: string,
    data: Partial<Pick<Organization, "name" | "country" | "defaultCurrency" | "freshnessDays">>,
  ): Promise<Organization> {
    return this.prisma.organization.update({ where: { id }, data });
  }

  /** Any organization row, including closed and purged ones (the purge and its erasure record). */
  findAnyById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  /**
   * Stage 10: schedules the deletion unless one is already pending (or the purge started).
   * Returns the row either way; `scheduled` is false when another request won.
   */
  async scheduleDeletion(
    id: string,
    input: { requestedAt: Date; purgeAfter: Date; requestedByUserId: string },
  ): Promise<{ scheduled: boolean; organization: Organization | null }> {
    const res = await this.prisma.organization.updateMany({
      where: { id, deletedAt: null, deletionRequestedAt: null },
      data: {
        deletionRequestedAt: input.requestedAt,
        purgeAfter: input.purgeAfter,
        deletionRequestedByUserId: input.requestedByUserId,
        deletionReminderSentAt: null,
      },
    });
    return { scheduled: res.count === 1, organization: await this.findById(id) };
  }

  /** Stage 10: clears a pending deletion while the purge has not started. False when nothing was pending. */
  async cancelDeletion(id: string): Promise<boolean> {
    const res = await this.prisma.organization.updateMany({
      where: { id, deletedAt: null, deletionRequestedAt: { not: null } },
      data: {
        deletionRequestedAt: null,
        purgeAfter: null,
        deletionRequestedByUserId: null,
        deletionReminderSentAt: null,
      },
    });
    return res.count === 1;
  }

  /** Pending deletions whose reminder is due (purge within `withinMs`) and not yet sent. */
  dueForReminder(now: Date, withinMs: number, limit: number): Promise<Organization[]> {
    return this.prisma.organization.findMany({
      where: {
        deletedAt: null,
        purgedAt: null,
        deletionRequestedAt: { not: null },
        deletionReminderSentAt: null,
        purgeAfter: { lte: new Date(now.getTime() + withinMs), gt: now },
      },
      orderBy: { purgeAfter: "asc" },
      take: limit,
    });
  }

  /** Marks the reminder sent; false when another scan (or a cancellation) got there first. */
  async markReminderSent(id: string, at: Date): Promise<boolean> {
    const res = await this.prisma.organization.updateMany({
      where: { id, deletionReminderSentAt: null, deletionRequestedAt: { not: null } },
      data: { deletionReminderSentAt: at },
    });
    return res.count === 1;
  }

  /** Organizations past their purge date and not purged yet (a crashed purge stays here until it finishes). */
  async dueForPurge(now: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.organization.findMany({
      where: { purgedAt: null, deletionRequestedAt: { not: null }, purgeAfter: { lte: now } },
      select: { id: true },
      orderBy: { purgeAfter: "asc" },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  /** Stage 10: closes the organization for everyone (the purge has started). Idempotent. */
  async markClosed(id: string, at: Date): Promise<void> {
    await this.prisma.organization.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: at },
    });
  }

  /** Maintenance (usage rollup): live organization ids in id order after `afterId`. */
  async liveIds(afterId: string | null, limit: number): Promise<string[]> {
    const rows = await this.prisma.organization.findMany({
      where: { deletedAt: null, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  countMembers(id: string): Promise<number> {
    return this.prisma.membership.count({ where: { organizationId: id, status: "active" } });
  }
}
