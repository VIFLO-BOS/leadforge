import { Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import { AppError } from "../common/errors/app.error.js";
import { BillingReconciliationService } from "./billing-reconciliation.service.js";
import { InvoiceService } from "./invoice.service.js";
import { PaymentSettlementService } from "./payment-settlement.service.js";
import { WebhookService } from "./webhook.service.js";

const Uuid = z.string().uuid();
const ProcessWebhook = z.object({ eventId: Uuid });
const VerifyPayment = z.object({
  paymentId: Uuid,
  trigger: z.enum(["webhook", "return", "reconcile", "renewal"]).default("reconcile"),
});
const InvoicePdf = z.object({ organizationId: Uuid, invoiceId: Uuid });

/** Billing job names handled here (the worker's BillingProcessor also runs `reconcile-credits`). */
export const BILLING_HANDLER_JOBS = [
  "process-webhook",
  "verify-payment",
  "generate-invoice-pdf",
  "reconcile-billing",
] as const;

/**
 * Billing queue jobs. Lives in packages/core so the API test harness runs exactly what the
 * worker runs. Payloads are validated; a malformed one fails without retries.
 */
@Injectable()
export class BillingQueueHandler {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly settlement: PaymentSettlementService,
    private readonly invoices: InvoiceService,
    private readonly reconciliation: BillingReconciliationService,
  ) {}

  handles(name: string): boolean {
    return (BILLING_HANDLER_JOBS as readonly string[]).includes(name);
  }

  async handle(job: Job): Promise<unknown> {
    switch (job.name) {
      case "process-webhook": {
        const p = ProcessWebhook.safeParse(job.data);
        if (!p.success) throw new UnrecoverableError("Invalid process-webhook payload");
        return this.webhooks.process(p.data.eventId);
      }
      case "verify-payment": {
        const p = VerifyPayment.safeParse(job.data);
        if (!p.success) throw new UnrecoverableError("Invalid verify-payment payload");
        return {
          outcome: await this.settlement.verifyAndSettle(p.data.paymentId, {
            trigger: p.data.trigger,
          }),
        };
      }
      case "generate-invoice-pdf": {
        const p = InvoicePdf.safeParse(job.data);
        if (!p.success) throw new UnrecoverableError("Invalid generate-invoice-pdf payload");
        try {
          return await this.invoices.ensurePdf(p.data.organizationId, p.data.invoiceId);
        } catch (err) {
          // An invoice outside the payload's organization (or gone) will never appear: no retries.
          if (err instanceof AppError && err.code === "NOT_FOUND") {
            throw new UnrecoverableError(
              `Invoice ${p.data.invoiceId} not found in organization ${p.data.organizationId}`,
            );
          }
          throw err;
        }
      }
      case "reconcile-billing":
        return this.reconciliation.run();
      default:
        throw new UnrecoverableError(`Unknown billing job ${job.name}`);
    }
  }
}
