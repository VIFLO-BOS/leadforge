import { Injectable } from "@nestjs/common";
import { PrismaService, type Prisma } from "@leadforge/db-postgres";

const PAGE = 1000;

const LEDGER_SELECT = {
  id: true,
  entryType: true,
  units: true,
  capturedUnits: true,
  balanceAfter: true,
  referenceType: true,
  referenceId: true,
  referenceName: true,
  holdId: true,
  description: true,
  actorUserId: true,
  createdAt: true,
} as const satisfies Prisma.CreditLedgerSelect;
export type LedgerExportRow = Prisma.CreditLedgerGetPayload<{ select: typeof LEDGER_SELECT }>;

/**
 * Stage 10: PostgreSQL reads for the organization data export (members, credit ledger, invoices,
 * payments, usage), all filtered by the organization (directly or through its billing customer).
 * Card data never leaves: payments are read without the masked authorization and checkout fields.
 */
@Injectable()
export class OrganizationRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  organization(organizationId: string) {
    return this.prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
  }

  members(organizationId: string) {
    return this.prisma.membership.findMany({
      where: { organizationId },
      select: {
        userId: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { name: true, email: true, deletedAt: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  private async customerId(organizationId: string): Promise<string | null> {
    const c = await this.prisma.billingCustomer.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  /** The credit ledger in id (time) order, in pages. */
  async *ledger(organizationId: string): AsyncGenerator<LedgerExportRow[]> {
    const customerId = await this.customerId(organizationId);
    if (!customerId) return;
    let after: string | null = null;
    for (;;) {
      const rows: LedgerExportRow[] = await this.prisma.creditLedger.findMany({
        where: { billingCustomerId: customerId, ...(after ? { id: { gt: after } } : {}) },
        select: LEDGER_SELECT,
        orderBy: { id: "asc" },
        take: PAGE,
      });
      if (rows.length === 0) return;
      yield rows;
      if (rows.length < PAGE) return;
      after = rows[rows.length - 1]!.id;
    }
  }

  async invoices(organizationId: string) {
    const customerId = await this.customerId(organizationId);
    if (!customerId) return [];
    return this.prisma.invoice.findMany({
      where: { billingCustomerId: customerId },
      select: {
        id: true,
        number: true,
        status: true,
        subtotalMinor: true,
        taxMinor: true,
        totalMinor: true,
        currency: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
        periodStart: true,
        periodEnd: true,
        lines: true,
        billTo: true,
        subscriptionId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  /** Payment metadata only: no masked card, authorization URL or access code. */
  async payments(organizationId: string) {
    const customerId = await this.customerId(organizationId);
    if (!customerId) return [];
    return this.prisma.payment.findMany({
      where: { billingCustomerId: customerId },
      select: {
        id: true,
        providerReference: true,
        purpose: true,
        description: true,
        amountMinor: true,
        currency: true,
        status: true,
        channel: true,
        creditUnits: true,
        refundedMinor: true,
        invoiceId: true,
        initiatedAt: true,
        paidAt: true,
        failedAt: true,
        reversedAt: true,
        initiatedByUserId: true,
        refunds: {
          select: {
            id: true,
            amountMinor: true,
            currency: true,
            status: true,
            reason: true,
            createdAt: true,
            processedAt: true,
          },
        },
      },
      orderBy: [{ initiatedAt: "asc" }, { id: "asc" }],
    });
  }

  usage(organizationId: string) {
    return this.prisma.usageDaily.findMany({
      where: { organizationId },
      select: { day: true, metric: true, value: true },
      orderBy: [{ day: "asc" }, { metric: "asc" }],
    });
  }
}
