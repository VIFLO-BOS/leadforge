import { Injectable } from "@nestjs/common";
import { newId, Prisma, PrismaService } from "@leadforge/db-postgres";

export interface UsageRow {
  /** UTC day, yyyy-mm-dd. */
  day: string;
  metric: string;
  value: number;
}

/**
 * usage_daily (PostgreSQL): one row per organization, UTC day and metric. Rows are written
 * with absolute values (INSERT ... ON CONFLICT DO UPDATE), so a rollup can run any number of
 * times with the same result.
 */
@Injectable()
export class UsageDailyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(organizationId: string, rows: UsageRow[], at: Date): Promise<void> {
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += 500) {
      const values = rows
        .slice(i, i + 500)
        .map(
          (r) =>
            Prisma.sql`(${newId()}::uuid, ${organizationId}::uuid, ${r.day}::date, ${r.metric}, ${BigInt(Math.round(r.value))}, ${at})`,
        );
      await this.prisma.$executeRaw`
        INSERT INTO usage_daily (id, organization_id, day, metric, value, updated_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (organization_id, day, metric) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`;
    }
  }

  async range(organizationId: string, fromDay: string, toDay: string): Promise<UsageRow[]> {
    const rows = await this.prisma.usageDaily.findMany({
      where: {
        organizationId,
        day: { gte: new Date(`${fromDay}T00:00:00Z`), lte: new Date(`${toDay}T00:00:00Z`) },
      },
      select: { day: true, metric: true, value: true },
    });
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      metric: r.metric,
      value: Number(r.value),
    }));
  }

  async lastComputedAt(organizationId: string): Promise<Date | null> {
    const agg = await this.prisma.usageDaily.aggregate({
      where: { organizationId },
      _max: { updatedAt: true },
    });
    return agg._max.updatedAt ?? null;
  }
}
