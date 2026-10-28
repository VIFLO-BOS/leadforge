import { Injectable } from "@nestjs/common";
import {
  newId,
  Prisma,
  PrismaService,
  type BillingCustomer,
  type CreditPack,
  type Invoice,
  type Payment,
  type PaymentDispute,
  type PaymentStatus,
  type PaymentWebhookEvent,
  type Plan,
  type Refund,
  type Subscription,
  type SubscriptionStatus,
} from "@leadforge/db-postgres";

export type BillingTx = Prisma.TransactionClient;

export type PaymentWithRefunds = Payment & { refunds: Refund[] };
export type SubscriptionWithPlan = Subscription & { plan: Plan };
export type CustomerWithOrg = BillingCustomer & {
  organization: { id: string; name: string; country: string; deletedAt: Date | null };
};

/** Long enough for bursts of concurrent settlements queueing on one customer row. */
const TX_OPTIONS = { maxWait: 60_000, timeout: 60_000 } as const;

const LIVE_SUBSCRIPTION: SubscriptionStatus[] = ["active", "past_due"];

/**
 * Billing tables in PostgreSQL (the only store of billing state). Organization-facing reads take
 * the organization's billing customer id, which callers resolve from the organization id;
 * maintenance scans (reconciliation, webhook lookups by provider reference) are cross-organization
 * by nature and say so.
 */
@Injectable()
export class BillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: BillingTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, TX_OPTIONS);
  }

  // ---------------------------------------------------------------- customers

  customerByOrg(organizationId: string): Promise<CustomerWithOrg | null> {
    return this.prisma.billingCustomer.findUnique({
      where: { organizationId },
      include: {
        organization: { select: { id: true, name: true, country: true, deletedAt: true } },
      },
    });
  }

  /** Maintenance and webhooks: the customer behind a provider record. */
  customerById(id: string): Promise<CustomerWithOrg | null> {
    return this.prisma.billingCustomer.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, country: true, deletedAt: true } },
      },
    });
  }

  /** Webhooks: the customer Paystack names (customer_code). */
  customerByProviderCode(code: string): Promise<BillingCustomer | null> {
    return this.prisma.billingCustomer.findUnique({ where: { providerCustomerCode: code } });
  }

  /** Stores the provider customer code once (a concurrent checkout keeps the first). */
  async setProviderCustomerCode(customerId: string, code: string): Promise<string> {
    await this.prisma.billingCustomer.updateMany({
      where: { id: customerId, providerCustomerCode: null },
      data: { providerCustomerCode: code },
    });
    const row = await this.prisma.billingCustomer.findUnique({
      where: { id: customerId },
      select: { providerCustomerCode: true },
    });
    return row?.providerCustomerCode ?? code;
  }

  // ---------------------------------------------------------------- catalogue

  activePlans(): Promise<Plan[]> {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
  }

  activePacks(): Promise<CreditPack[]> {
    return this.prisma.creditPack.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
  }

  planById(id: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { id } });
  }

  planByProviderCode(code: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { providerPlanCode: code } });
  }

  packById(id: string): Promise<CreditPack | null> {
    return this.prisma.creditPack.findUnique({ where: { id } });
  }

  /** Stores the provider plan code once; returns the code that won. */
  async setProviderPlanCode(planId: string, code: string): Promise<string> {
    await this.prisma.plan.updateMany({
      where: { id: planId, providerPlanCode: null },
      data: { providerPlanCode: code },
    });
    const row = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: { providerPlanCode: true },
    });
    return row?.providerPlanCode ?? code;
  }

  // ---------------------------------------------------------------- subscriptions

  /** The live subscription (active or past_due), newest first. */
  liveSubscription(
    customerId: string,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<SubscriptionWithPlan | null> {
    return tx.subscription.findFirst({
      where: { billingCustomerId: customerId, status: { in: LIVE_SUBSCRIPTION } },
      include: { plan: true },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  /** The newest incomplete checkout created after `since`. */
  pendingSubscription(customerId: string, since: Date): Promise<SubscriptionWithPlan | null> {
    return this.prisma.subscription.findFirst({
      where: { billingCustomerId: customerId, status: "incomplete", createdAt: { gte: since } },
      include: { plan: true },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  subscriptionById(
    id: string,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<SubscriptionWithPlan | null> {
    return tx.subscription.findUnique({ where: { id }, include: { plan: true } });
  }

  subscriptionByCode(code: string): Promise<SubscriptionWithPlan | null> {
    return this.prisma.subscription.findUnique({
      where: { providerSubscriptionCode: code },
      include: { plan: true },
    });
  }

  /** subscription.create: the newest local subscription of this customer and plan without a provider code yet. */
  linkableSubscription(
    customerId: string,
    planId: string | null,
  ): Promise<SubscriptionWithPlan | null> {
    return this.prisma.subscription.findFirst({
      where: {
        billingCustomerId: customerId,
        providerSubscriptionCode: null,
        status: { in: ["incomplete", "active", "past_due"] },
        ...(planId ? { planId } : {}),
      },
      include: { plan: true },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  /** Renewal charges: the customer's subscriptions that can receive a renewal, newest first. */
  renewableSubscriptions(customerId: string): Promise<SubscriptionWithPlan[]> {
    return this.prisma.subscription.findMany({
      where: {
        billingCustomerId: customerId,
        status: { in: ["active", "past_due", "incomplete"] },
      },
      include: { plan: true },
      orderBy: [{ createdAt: "desc" }],
      take: 10,
    });
  }

  createSubscription(data: Prisma.SubscriptionUncheckedCreateInput): Promise<Subscription> {
    return this.prisma.subscription.create({ data });
  }

  updateSubscription(
    id: string,
    data: Prisma.SubscriptionUncheckedUpdateInput,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<Subscription> {
    return tx.subscription.update({ where: { id }, data });
  }

  /** Conditional transition: updates only when the status is still one of `from` (returns whether it did). */
  async transitionSubscription(
    id: string,
    from: SubscriptionStatus[],
    data: Prisma.SubscriptionUncheckedUpdateInput,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<boolean> {
    const res = await tx.subscription.updateMany({ where: { id, status: { in: from } }, data });
    return res.count === 1;
  }

  /** Maintenance: subscriptions in `statuses` whose period ended before `before`. */
  subscriptionsEndedBefore(
    statuses: SubscriptionStatus[],
    before: Date,
    extra: Prisma.SubscriptionWhereInput,
    limit: number,
  ): Promise<SubscriptionWithPlan[]> {
    return this.prisma.subscription.findMany({
      where: { status: { in: statuses }, currentPeriodEnd: { lt: before }, ...extra },
      include: { plan: true },
      orderBy: [{ currentPeriodEnd: "asc" }],
      take: limit,
    });
  }

  /** Maintenance: past_due subscriptions that went past due before `before`. */
  pastDueBefore(before: Date, limit: number): Promise<SubscriptionWithPlan[]> {
    return this.prisma.subscription.findMany({
      where: { status: "past_due", pastDueAt: { lt: before } },
      include: { plan: true },
      orderBy: [{ pastDueAt: "asc" }],
      take: limit,
    });
  }

  /** Maintenance: incomplete checkouts created before `before`. */
  incompleteBefore(before: Date, limit: number): Promise<SubscriptionWithPlan[]> {
    return this.prisma.subscription.findMany({
      where: { status: "incomplete", createdAt: { lt: before } },
      include: { plan: true },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
    });
  }

  // ---------------------------------------------------------------- payments

  createPayment(data: Prisma.PaymentUncheckedCreateInput): Promise<Payment> {
    return this.prisma.payment.create({ data });
  }

  paymentById(
    id: string,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<PaymentWithRefunds | null> {
    return tx.payment.findUnique({
      where: { id },
      include: { refunds: { orderBy: { createdAt: "asc" } } },
    });
  }

  paymentByReference(reference: string): Promise<PaymentWithRefunds | null> {
    return this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: { refunds: { orderBy: { createdAt: "asc" } } },
    });
  }

  paymentByIdempotencyKey(key: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { idempotencyKey: key } });
  }

  updatePayment(
    id: string,
    data: Prisma.PaymentUncheckedUpdateInput,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<Payment> {
    return tx.payment.update({ where: { id }, data });
  }

  async transitionPayment(
    id: string,
    from: PaymentStatus[],
    data: Prisma.PaymentUncheckedUpdateInput,
    tx: BillingTx | PrismaService = this.prisma,
    extra: { unflaggedOnly?: boolean } = {},
  ): Promise<boolean> {
    const res = await tx.payment.updateMany({
      where: { id, status: { in: from }, ...(extra.unflaggedOnly ? { flaggedAt: null } : {}) },
      data,
    });
    return res.count === 1;
  }

  async paymentsPage(
    customerId: string,
    filter: { statuses?: PaymentStatus[]; purpose?: "subscription" | "credit_pack" },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<{ items: PaymentWithRefunds[]; nextCursor: string | null }> {
    const rows = await this.prisma.payment.findMany({
      where: {
        billingCustomerId: customerId,
        ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
        ...(filter.purpose ? { purpose: filter.purpose } : {}),
        ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
      },
      include: { refunds: { orderBy: { createdAt: "asc" } } },
      orderBy: { id: "desc" },
      take: opts.pageSize + 1,
    });
    const hasMore = rows.length > opts.pageSize;
    const items = hasMore ? rows.slice(0, opts.pageSize) : rows;
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  /**
   * The hosted checkout of an incomplete subscription that may still be resumed: its payment is
   * pending (never a final one), not under review, has a stored authorization URL and started
   * after `since`. Newest first.
   */
  resumableSubscriptionCheckout(
    customerId: string,
    subscriptionId: string,
    since: Date,
  ): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: {
        billingCustomerId: customerId,
        purpose: "subscription",
        purposeRef: subscriptionId,
        status: "pending",
        flaggedAt: null,
        authorizationUrl: { not: null },
        initiatedAt: { gte: since },
      },
      orderBy: { initiatedAt: "desc" },
    });
  }

  latestPayment(customerId: string): Promise<PaymentWithRefunds | null> {
    return this.prisma.payment.findFirst({
      where: { billingCustomerId: customerId },
      include: { refunds: { orderBy: { createdAt: "asc" } } },
      orderBy: { id: "desc" },
    });
  }

  /** Maintenance: unflagged pending payments initiated before `before`, oldest first. */
  pendingPaymentsBefore(before: Date, limit: number): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { status: "pending", initiatedAt: { lt: before }, flaggedAt: null },
      orderBy: { initiatedAt: "asc" },
      take: limit,
    });
  }

  countFlaggedPending(): Promise<number> {
    return this.prisma.payment.count({ where: { status: "pending", flaggedAt: { not: null } } });
  }

  /** Credits granted by a payment (its ledger grant or purchase row), 0 when none. */
  async grantedUnits(
    paymentId: string,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<number> {
    const row = await tx.creditLedger.findUnique({
      where: { idempotencyKey: `payment:${paymentId}:grant` },
      select: { units: true },
    });
    return row?.units ?? 0;
  }

  async grantedUnitsMany(paymentIds: string[]): Promise<Map<string, number>> {
    if (paymentIds.length === 0) return new Map();
    const rows = await this.prisma.creditLedger.findMany({
      where: { idempotencyKey: { in: paymentIds.map((id) => `payment:${id}:grant`) } },
      select: { idempotencyKey: true, units: true },
    });
    return new Map(rows.map((r) => [r.idempotencyKey.split(":")[1] ?? "", r.units]));
  }

  // ---------------------------------------------------------------- refunds and disputes

  createRefund(
    data: Prisma.RefundUncheckedCreateInput,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<Refund> {
    return tx.refund.create({ data });
  }

  updateRefund(
    id: string,
    data: Prisma.RefundUncheckedUpdateInput,
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<Refund> {
    return tx.refund.update({ where: { id }, data });
  }

  refundByProviderReference(ref: string): Promise<Refund | null> {
    return this.prisma.refund.findUnique({ where: { providerRefundReference: ref } });
  }

  refundById(id: string, tx: BillingTx | PrismaService = this.prisma): Promise<Refund | null> {
    return tx.refund.findUnique({ where: { id } });
  }

  /** The oldest pending refund of a payment, preferring one of the same amount. */
  async pendingRefundFor(paymentId: string, amountMinor: bigint | null): Promise<Refund | null> {
    const rows = await this.prisma.refund.findMany({
      where: { paymentId, status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    return (
      rows.find((r) => amountMinor !== null && r.amountMinor === amountMinor) ?? rows[0] ?? null
    );
  }

  disputeByProviderId(id: string): Promise<PaymentDispute | null> {
    return this.prisma.paymentDispute.findUnique({ where: { providerDisputeId: id } });
  }

  upsertDispute(
    create: Prisma.PaymentDisputeUncheckedCreateInput,
    update: Prisma.PaymentDisputeUncheckedUpdateInput,
  ): Promise<PaymentDispute> {
    return this.prisma.paymentDispute.upsert({
      where: { providerDisputeId: create.providerDisputeId },
      create,
      update,
    });
  }

  countOpenDisputes(paymentId: string): Promise<number> {
    return this.prisma.paymentDispute.count({ where: { paymentId, status: { not: "resolved" } } });
  }

  // ---------------------------------------------------------------- invoices

  async nextInvoiceNumber(tx: BillingTx, year: number): Promise<string> {
    // Upsert-and-increment holds the counter row lock until the surrounding transaction ends, so
    // numbers are sequential and a rolled-back payment never consumes one (no gaps).
    const scope = String(year);
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
      INSERT INTO invoice_counters (scope, last_value) VALUES (${scope}, 1)
      ON CONFLICT (scope) DO UPDATE SET last_value = invoice_counters.last_value + 1
      RETURNING last_value`;
    const n = Number(rows[0]?.last_value ?? 0);
    if (!n) throw new Error("Invoice counter did not return a value");
    return `LF-${scope}-${String(n).padStart(6, "0")}`;
  }

  createInvoice(data: Prisma.InvoiceUncheckedCreateInput, tx: BillingTx): Promise<Invoice> {
    return tx.invoice.create({ data });
  }

  invoiceById(customerId: string, id: string): Promise<(Invoice & { payments: Payment[] }) | null> {
    return this.prisma.invoice.findFirst({
      where: { id, billingCustomerId: customerId },
      include: { payments: true },
    });
  }

  /** Worker: an invoice by id (the payload's organization is checked by the caller). */
  invoiceByIdAny(
    id: string,
  ): Promise<(Invoice & { payments: Payment[]; billingCustomer: BillingCustomer }) | null> {
    return this.prisma.invoice.findUnique({
      where: { id },
      include: { payments: true, billingCustomer: true },
    });
  }

  async invoicesPage(
    customerId: string,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<{ items: Array<Invoice & { payments: Payment[] }>; nextCursor: string | null }> {
    const rows = await this.prisma.invoice.findMany({
      where: { billingCustomerId: customerId, ...(opts.cursor ? { id: { lt: opts.cursor } } : {}) },
      include: { payments: true },
      orderBy: { id: "desc" },
      take: opts.pageSize + 1,
    });
    const hasMore = rows.length > opts.pageSize;
    const items = hasMore ? rows.slice(0, opts.pageSize) : rows;
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  setInvoicePdf(id: string, key: string): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id },
      data: { pdfKey: key, pdfGeneratedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------- webhook events

  /**
   * Stores a verified event once per (provider, event key). Returns the stored row and whether
   * this call inserted it; a concurrent or later duplicate gets `inserted: false`.
   */
  async insertWebhookEvent(data: {
    id: string;
    providerEventId: string;
    eventType: string;
    reference: string | null;
    payload: Prisma.InputJsonValue;
  }): Promise<{ event: PaymentWebhookEvent; inserted: boolean }> {
    const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payment_webhook_events (id, provider, provider_event_id, event_type, reference, signature_valid, payload, received_at, processing_status, attempts)
      VALUES (${data.id}::uuid, 'paystack', ${data.providerEventId}, ${data.eventType}, ${data.reference}, true, ${JSON.stringify(data.payload)}::jsonb, now(), 'received', 0)
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id`;
    const event = await this.prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_providerEventId: { provider: "paystack", providerEventId: data.providerEventId },
      },
    });
    if (!event) throw new Error("Webhook event vanished after insert");
    return { event, inserted: inserted.length === 1 };
  }

  webhookEventById(id: string): Promise<PaymentWebhookEvent | null> {
    return this.prisma.paymentWebhookEvent.findUnique({ where: { id } });
  }

  /** Claims an event for processing: counts the attempt; returns null when it is already final. */
  async beginWebhookProcessing(id: string): Promise<PaymentWebhookEvent | null> {
    const res = await this.prisma.paymentWebhookEvent.updateMany({
      where: { id, processingStatus: { in: ["received", "failed"] } },
      data: { attempts: { increment: 1 } },
    });
    if (res.count === 0) return null;
    return this.prisma.paymentWebhookEvent.findUnique({ where: { id } });
  }

  finishWebhookEvent(
    id: string,
    status: "processed" | "ignored" | "failed",
    error: string | null,
  ): Promise<PaymentWebhookEvent> {
    return this.prisma.paymentWebhookEvent.update({
      where: { id },
      data: {
        processingStatus: status,
        processedAt: status === "failed" ? null : new Date(),
        error: error?.slice(0, 500) ?? null,
      },
    });
  }

  /** Maintenance: events still `received` (or `failed` with attempts left) since before `before`. */
  stuckWebhookEvents(
    before: Date,
    maxAttempts: number,
    limit: number,
  ): Promise<PaymentWebhookEvent[]> {
    return this.prisma.paymentWebhookEvent.findMany({
      where: {
        receivedAt: { lt: before },
        OR: [
          { processingStatus: "received" },
          { processingStatus: "failed", attempts: { lt: maxAttempts } },
        ],
      },
      orderBy: { receivedAt: "asc" },
      take: limit,
    });
  }

  // ---------------------------------------------------------------- audit and runs

  async audit(
    entry: {
      billingCustomerId: string;
      actorType: "user" | "system" | "provider";
      actorId: string | null;
      action: string;
      before?: unknown;
      after?: unknown;
      requestId?: string | null;
    },
    tx: BillingTx | PrismaService = this.prisma,
  ): Promise<void> {
    await tx.billingAudit.create({
      data: {
        id: newId(),
        billingCustomerId: entry.billingCustomerId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        before:
          entry.before === undefined ? undefined : (toJson(entry.before) as Prisma.InputJsonValue),
        after:
          entry.after === undefined ? undefined : (toJson(entry.after) as Prisma.InputJsonValue),
        requestId: entry.requestId ?? null,
      },
    });
  }

  async recordRun(run: {
    id: string;
    kind: "payments" | "subscriptions" | "webhooks";
    startedAt: Date;
    finishedAt: Date;
    checked: number;
    fixed: number;
    errors: unknown[];
  }): Promise<void> {
    await this.prisma.reconciliationRun.create({
      data: {
        id: run.id,
        kind: run.kind,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        checked: run.checked,
        fixed: run.fixed,
        errors: run.errors.length ? (toJson(run.errors) as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  // ---------------------------------------------------------------- members (entitlement checks)

  /** Active members and live invitations of an organization (member cap). */
  async memberUsage(
    organizationId: string,
    tx: BillingTx | PrismaService = this.prisma,
    excludeInviteEmail?: string,
  ): Promise<{ active: number; pendingInvitations: number }> {
    const now = new Date();
    const [active, pendingInvitations] = await Promise.all([
      tx.membership.count({ where: { organizationId, status: "active" } }),
      tx.invitation.count({
        where: {
          organizationId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
          ...(excludeInviteEmail
            ? { NOT: { email: { equals: excludeInviteEmail, mode: "insensitive" } } }
            : {}),
        },
      }),
    ]);
    return { active, pendingInvitations };
  }

  /** Billing managers (owners and admins) to notify, with their email and name. */
  billingManagers(
    organizationId: string,
  ): Promise<
    Array<{
      userId: string;
      role: string;
      user: { email: string; name: string; deletedAt: Date | null };
    }>
  > {
    return this.prisma.membership.findMany({
      where: { organizationId, status: "active", role: { in: ["owner", "admin"] } },
      select: {
        userId: true,
        role: true,
        user: { select: { email: true, name: true, deletedAt: true } },
      },
    });
  }
}

/** BigInt-safe JSON for audit snapshots. */
export function toJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v,
    ),
  );
}
