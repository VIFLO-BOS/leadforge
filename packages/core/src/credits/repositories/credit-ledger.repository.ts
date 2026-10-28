import { Injectable } from "@nestjs/common";
import {
  Prisma,
  PrismaService,
  type CreditLedger,
  type LedgerEntryType,
} from "@leadforge/db-postgres";

export type LedgerTx = Prisma.TransactionClient;

export interface LockedCustomer {
  id: string;
  balance: number;
}

export interface NewLedgerEntry {
  id: string;
  billingCustomerId: string;
  entryType: LedgerEntryType;
  units: number;
  capturedUnits?: number | null;
  balanceAfter: number;
  referenceType?: string | null;
  referenceId?: string | null;
  /** Human name of what the entry belongs to (job name, "Website analysis: <host>"). */
  referenceName?: string | null;
  holdId?: string | null;
  idempotencyKey: string;
  description?: string | null;
  actorUserId?: string | null;
}

export interface OpenHoldRow {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  referenceType: string | null;
  referenceId: string | null;
  units: number;
  createdAt: Date;
}

/** Long enough for 50 concurrent holds queueing on one customer row under load. */
const TX_OPTIONS = { maxWait: 60_000, timeout: 60_000 } as const;

/**
 * Credit ledger (append-only) and the cached balance on billing_customers. Every write runs
 * inside withLockedCustomer, which holds SELECT ... FOR UPDATE on the organization's customer
 * row, so concurrent holds are serialized and the cached balance is updated in the same
 * transaction as the ledger insert (docs/DATABASE_DESIGN.md section 4).
 */
@Injectable()
export class CreditLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withLockedCustomer<T>(
    organizationId: string,
    fn: (tx: LedgerTx, customer: LockedCustomer) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; credit_balance: number }>>`
        SELECT id, credit_balance FROM billing_customers WHERE organization_id = ${organizationId}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new Error(`No billing customer for organization ${organizationId}`);
      return fn(tx, { id: row.id, balance: Number(row.credit_balance) });
    }, TX_OPTIONS);
  }

  findByKey(tx: LedgerTx, idempotencyKey: string): Promise<CreditLedger | null> {
    return tx.creditLedger.findUnique({ where: { idempotencyKey } });
  }

  closingEntries(tx: LedgerTx, holdId: string): Promise<CreditLedger[]> {
    return tx.creditLedger.findMany({
      where: { holdId, entryType: { in: ["capture", "release"] } },
    });
  }

  insert(tx: LedgerTx, entry: NewLedgerEntry): Promise<CreditLedger> {
    return tx.creditLedger.create({ data: entry });
  }

  async setBalance(tx: LedgerTx, customerId: string, balance: number): Promise<void> {
    await tx.billingCustomer.update({
      where: { id: customerId },
      data: { creditBalance: balance },
    });
  }

  customer(organizationId: string) {
    return this.prisma.billingCustomer.findUnique({ where: { organizationId } });
  }

  async openHolds(organizationId: string): Promise<{ held: number; count: number }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ held: bigint | number | null; count: bigint | number }>
    >`
      SELECT COALESCE(SUM(-h.units), 0) AS held, COUNT(*) AS count
      FROM credit_ledger h
      JOIN billing_customers bc ON bc.id = h.billing_customer_id
      WHERE bc.organization_id = ${organizationId}::uuid
        AND h.entry_type = 'hold'
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger c WHERE c.hold_id = h.id AND c.entry_type IN ('capture', 'release')
        )`;
    return { held: Number(rows[0]?.held ?? 0), count: Number(rows[0]?.count ?? 0) };
  }

  async page(
    organizationId: string,
    filter: { entryTypes?: LedgerEntryType[]; referenceType?: string; referenceId?: string },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<{ items: CreditLedger[]; nextCursor: string | null }> {
    const customer = await this.customer(organizationId);
    if (!customer) return { items: [], nextCursor: null };
    const rows = await this.prisma.creditLedger.findMany({
      where: {
        billingCustomerId: customer.id,
        ...(filter.entryTypes?.length ? { entryType: { in: filter.entryTypes } } : {}),
        ...(filter.referenceType ? { referenceType: filter.referenceType } : {}),
        ...(filter.referenceId ? { referenceId: filter.referenceId } : {}),
        ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: opts.pageSize + 1,
    });
    const hasMore = rows.length > opts.pageSize;
    const items = hasMore ? rows.slice(0, opts.pageSize) : rows;
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  /** Captured units per UTC day and reference type (capture rows, `credit_ledger(billing_customer_id, created_at)` index). */
  async capturedByDay(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ day: string; referenceType: string | null; units: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; reference_type: string | null; units: bigint | number | null }>
    >`
      SELECT to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, c.reference_type, SUM(c.captured_units) AS units
      FROM credit_ledger c
      JOIN billing_customers bc ON bc.id = c.billing_customer_id
      WHERE bc.organization_id = ${organizationId}::uuid AND c.entry_type = 'capture'
        AND c.created_at >= ${from} AND c.created_at < ${to}
      GROUP BY 1, 2`;
    return rows.map((r) => ({
      day: r.day,
      referenceType: r.reference_type,
      units: Number(r.units ?? 0),
    }));
  }

  /** Sum of ledger units for the organization: must equal the cached balance (invariant). */
  async ledgerSum(organizationId: string): Promise<{ sum: number; cached: number }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ sum: bigint | number | null; cached: number }>
    >`
      SELECT COALESCE((SELECT SUM(units) FROM credit_ledger WHERE billing_customer_id = bc.id), 0) AS sum, bc.credit_balance AS cached
      FROM billing_customers bc WHERE bc.organization_id = ${organizationId}::uuid`;
    return { sum: Number(rows[0]?.sum ?? 0), cached: Number(rows[0]?.cached ?? 0) };
  }

  /**
   * Maintenance only (reconciliation): holds in any organization created before `cutoff` that
   * have no capture or release yet. Later writes go through withLockedCustomer per organization.
   */
  async findOpenHoldsOlderThan(
    cutoff: Date,
    limit: number,
    filter: { only?: string; exclude?: string[] } = {},
  ): Promise<OpenHoldRow[]> {
    const only = filter.only ? Prisma.sql`AND h.reference_type = ${filter.only}` : Prisma.empty;
    const exclude = filter.exclude?.length
      ? Prisma.sql`AND (h.reference_type IS NULL OR h.reference_type NOT IN (${Prisma.join(filter.exclude)}))`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        organization_id: string;
        idempotency_key: string;
        reference_type: string | null;
        reference_id: string | null;
        units: number;
        created_at: Date;
      }>
    >`
      SELECT h.id, bc.organization_id, h.idempotency_key, h.reference_type, h.reference_id, h.units, h.created_at
      FROM credit_ledger h
      JOIN billing_customers bc ON bc.id = h.billing_customer_id
      WHERE h.entry_type = 'hold' AND h.created_at < ${cutoff} ${only} ${exclude}
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger c WHERE c.hold_id = h.id AND c.entry_type IN ('capture', 'release')
        )
      ORDER BY h.created_at ASC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      idempotencyKey: r.idempotency_key,
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      units: Number(r.units),
      createdAt: r.created_at,
    }));
  }

  /** Maintenance record of a reconciliation pass (reconciliation_runs). */
  async recordRun(run: {
    id: string;
    startedAt: Date;
    finishedAt: Date;
    checked: number;
    fixed: number;
    errors: unknown[];
  }): Promise<void> {
    await this.prisma.reconciliationRun.create({
      data: {
        id: run.id,
        kind: "holds",
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        checked: run.checked,
        fixed: run.fixed,
        errors: run.errors.length ? (run.errors as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
