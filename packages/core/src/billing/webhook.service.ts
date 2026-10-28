import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { newId, type Prisma } from "@leadforge/db-postgres";
import type { ServerEnv, WebhookAck } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { QueueService } from "../queue/queue.service.js";
import { QueueNames } from "../queue/queue.constants.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./provider/payment-provider.js";
import {
  HANDLED_PAYSTACK_EVENTS,
  parseWebhookBody,
  PaystackEventData,
  redactPaystackPayload,
  type HandledPaystackEvent,
} from "./provider/paystack-events.js";
import { BillingRepository } from "./repositories/billing.repository.js";
import { PaymentSettlementService } from "./payment-settlement.service.js";
import { SubscriptionLifecycleService } from "./subscription-lifecycle.service.js";

type Json = Record<string, unknown>;

/** Strips the IPv4-mapped IPv6 prefix Node reports for IPv4 clients. */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return "";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/**
 * Paystack webhooks. The API side (`ingest`) only authenticates and stores: optional IP
 * allowlist, HMAC-SHA512 signature over the exact raw bytes (constant-time), one row per event
 * key in payment_webhook_events (a replay hits the unique index and stops), then enqueue
 * `process-webhook` and answer 200 at once. The worker side (`process`) dispatches by type;
 * charge handling always verifies with Paystack before anything is granted.
 */
@Injectable()
export class WebhookService {
  constructor(
    private readonly repo: BillingRepository,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly settlement: PaymentSettlementService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  async ingest(input: {
    rawBody: Buffer | undefined;
    signature: string | undefined;
    ip: string | undefined;
    requestId: string;
  }): Promise<WebhookAck> {
    if (!this.provider.configured) {
      // Without the secret key nothing can be authenticated; never store or act on it.
      throw new AppError(
        "BILLING_NOT_CONFIGURED",
        "Payments are not configured on this server; webhooks cannot be verified.",
      );
    }
    const allow = this.env.PAYSTACK_WEBHOOK_IP_ALLOWLIST;
    if (allow.length > 0 && !allow.includes(normalizeIp(input.ip))) {
      this.logger.warn(
        { ip: normalizeIp(input.ip), requestId: input.requestId },
        "Webhook from an address outside PAYSTACK_WEBHOOK_IP_ALLOWLIST refused",
      );
      throw AppError.forbidden("This address may not deliver payment webhooks");
    }
    if (!input.rawBody || !this.provider.verifyWebhookSignature(input.rawBody, input.signature)) {
      this.logger.warn(
        { ip: normalizeIp(input.ip), requestId: input.requestId, hasBody: Boolean(input.rawBody) },
        "Webhook with an invalid signature refused",
      );
      throw new AppError("WEBHOOK_SIGNATURE_INVALID", "The webhook signature is not valid");
    }
    const parsed = parseWebhookBody(input.rawBody);
    if (!parsed)
      throw AppError.validation([
        { path: "body", message: "Expected a JSON object with event and data" },
      ]);
    const { event, inserted } = await this.repo.insertWebhookEvent({
      id: newId(),
      providerEventId: parsed.eventKey,
      eventType: parsed.event,
      reference: parsed.reference,
      payload: {
        event: parsed.event,
        data: redactPaystackPayload(parsed.data),
      } as unknown as Prisma.InputJsonValue,
    });
    if (inserted) {
      await this.enqueue(event.id, 0).catch((err: unknown) =>
        // Stored but not queued: the reconciliation pass re-enqueues events left in `received`.
        this.logger.error(
          { err, eventId: event.id },
          "Could not enqueue process-webhook; reconciliation will pick it up",
        ),
      );
    }
    return { received: true, duplicate: !inserted };
  }

  enqueue(eventId: string, attempt: number): Promise<unknown> {
    return this.queue
      .queue(QueueNames.billing)
      .add(
        "process-webhook",
        { eventId },
        {
          jobId: `webhook-${eventId}-a${attempt}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 15_000 },
        },
      );
  }

  /** Worker: processes one stored event. Final states are never processed again. */
  async process(eventId: string): Promise<{ status: string; outcome: string }> {
    const event = await this.repo.beginWebhookProcessing(eventId);
    if (!event) return { status: "skipped", outcome: "already final or missing" };
    const payload = event.payload as { event?: string; data?: Json };
    const data = payload.data ?? {};
    const type = String(payload.event ?? event.eventType);
    try {
      if (!(HANDLED_PAYSTACK_EVENTS as readonly string[]).includes(type)) {
        await this.repo.finishWebhookEvent(
          event.id,
          "ignored",
          `Event ${type} is not used by LeadForge`,
        );
        return { status: "ignored", outcome: type };
      }
      const outcome = await this.dispatch(type as HandledPaystackEvent, data, event.id);
      const ignored = outcome.startsWith("ignored");
      await this.repo.finishWebhookEvent(
        event.id,
        ignored ? "ignored" : "processed",
        ignored ? outcome : null,
      );
      return { status: ignored ? "ignored" : "processed", outcome };
    } catch (err) {
      await this.repo.finishWebhookEvent(
        event.id,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  private async dispatch(type: HandledPaystackEvent, data: Json, eventId: string): Promise<string> {
    switch (type) {
      case "charge.success": {
        const reference = typeof data.reference === "string" ? data.reference : null;
        if (!reference) return "ignored: charge without a reference";
        const res = await this.settlement.settleUnknownCharge(reference, { eventId });
        return res.outcome === "ignored" ? `ignored: ${res.note ?? "unknown charge"}` : res.outcome;
      }
      case "subscription.create":
        return this.lifecycle.onSubscriptionCreate(data);
      case "subscription.not_renew":
        return this.lifecycle.onNotRenew(data);
      case "subscription.disable":
        return this.lifecycle.onDisable(data);
      case "invoice.create":
        return "ignored: upcoming invoice noted (the charge is settled when it is paid)";
      case "invoice.update":
        return this.lifecycle.onInvoiceUpdate(data, eventId);
      case "invoice.payment_failed":
        return this.lifecycle.onInvoiceFailed(data);
      case "refund.pending":
      case "refund.processing":
      case "refund.processed":
      case "refund.failed": {
        const status = type.slice("refund.".length) as
          "pending" | "processing" | "processed" | "failed";
        return (await this.settlement.onRefundEvent(status, PaystackEventData.refund(data)))
          .outcome;
      }
      case "charge.dispute.create":
        return this.lifecycle.onDispute("create", data);
      case "charge.dispute.remind":
        return this.lifecycle.onDispute("remind", data);
      case "charge.dispute.resolve":
        return this.lifecycle.onDispute("resolve", data);
    }
  }
}
