import { Injectable } from "@nestjs/common";
import { newId, PrismaService, type Prisma } from "@leadforge/db-postgres";

export interface EntitlementRow {
  key: string;
  valueInt: number | null;
  valueBool: boolean | null;
  source: "plan" | "override";
}

export interface EntitlementValue {
  key: string;
  valueInt?: number | null;
  valueBool?: boolean | null;
}

type Tx = Prisma.TransactionClient;

/** The organization's entitlement rows (PostgreSQL `entitlements`). */
@Injectable()
export class EntitlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async current(organizationId: string, key: string, now: Date): Promise<EntitlementRow[]> {
    const rows = await this.prisma.entitlement.findMany({
      where: {
        key,
        billingCustomer: { organizationId },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      select: { key: true, valueInt: true, valueBool: true, source: true },
    });
    return rows as EntitlementRow[];
  }

  /** Every current row of the organization (all keys). */
  async currentAll(organizationId: string, now: Date): Promise<EntitlementRow[]> {
    const rows = await this.prisma.entitlement.findMany({
      where: {
        billingCustomer: { organizationId },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      select: { key: true, valueInt: true, valueBool: true, source: true },
    });
    return rows as EntitlementRow[];
  }

  /**
   * Replaces the customer's `plan` rows with `values` inside the caller's transaction (plan change,
   * cancellation, expiry). `override` rows are never touched.
   */
  async replacePlanRows(
    tx: Tx,
    billingCustomerId: string,
    values: EntitlementValue[],
    now: Date,
  ): Promise<void> {
    const keys = values.map((v) => v.key);
    await tx.entitlement.deleteMany({
      where: { billingCustomerId, source: "plan", key: { notIn: keys } },
    });
    for (const v of values) {
      await tx.entitlement.upsert({
        where: { billingCustomerId_key_source: { billingCustomerId, key: v.key, source: "plan" } },
        create: {
          id: newId(),
          billingCustomerId,
          key: v.key,
          valueInt: v.valueInt ?? null,
          valueBool: v.valueBool ?? null,
          source: "plan",
          validFrom: now,
          validTo: null,
        },
        update: {
          valueInt: v.valueInt ?? null,
          valueBool: v.valueBool ?? null,
          validFrom: now,
          validTo: null,
        },
      });
    }
  }

  /** Development seed and support: sets an `override` row (wins over the plan). */
  async setOverride(billingCustomerId: string, v: EntitlementValue): Promise<void> {
    await this.prisma.entitlement.upsert({
      where: {
        billingCustomerId_key_source: { billingCustomerId, key: v.key, source: "override" },
      },
      create: {
        id: newId(),
        billingCustomerId,
        key: v.key,
        valueInt: v.valueInt ?? null,
        valueBool: v.valueBool ?? null,
        source: "override",
        validTo: null,
      },
      update: { valueInt: v.valueInt ?? null, valueBool: v.valueBool ?? null, validTo: null },
    });
  }

  customerIdOf(organizationId: string): Promise<{ id: string } | null> {
    return this.prisma.billingCustomer.findUnique({
      where: { organizationId },
      select: { id: true },
    });
  }
}
