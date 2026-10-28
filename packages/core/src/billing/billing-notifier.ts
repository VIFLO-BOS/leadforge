import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import {
  NotificationsService,
  type BillingNoticeEvent,
} from "../notifications/notifications.service.js";
import { BillingRepository } from "./repositories/billing.repository.js";

type Mail = BillingNoticeEvent["mail"];

/**
 * Billing notices go to the organization's billing managers (active owners and admins), in-app
 * and by email (each recipient's `emailBilling` preference applies). One notice per event key and
 * recipient, so retries and replays never notify twice. Never throws.
 */
@Injectable()
export class BillingNotifier {
  constructor(
    private readonly repo: BillingRepository,
    private readonly notifications: NotificationsService,
    private readonly logger: Logger,
  ) {}

  async send(input: {
    organizationId: string;
    type: BillingNoticeEvent["type"];
    title: string;
    body: string;
    href?: string;
    dedupeKey: string;
    mail: Mail;
  }): Promise<void> {
    try {
      const managers = await this.repo.billingManagers(input.organizationId);
      for (const m of managers) {
        if (m.user.deletedAt) continue;
        await this.notifications.billingNotice({
          organizationId: input.organizationId,
          userId: m.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          href: input.href ?? "/app/billing",
          dedupeKey: input.dedupeKey,
          mail: input.mail,
        });
      }
    } catch (err) {
      this.logger.error(
        { err, organizationId: input.organizationId, dedupeKey: input.dedupeKey },
        "Could not send billing notices",
      );
    }
  }

  paymentSucceeded(
    organizationId: string,
    p: {
      paymentId: string;
      description: string;
      amount: string;
      credits: number;
      invoiceNumber: string;
      testMode: boolean;
    },
  ): Promise<void> {
    const creditsLine =
      p.credits > 0
        ? ` ${p.credits.toLocaleString("en-US")} credits were added to your balance.`
        : "";
    const test = p.testMode ? " (Paystack test mode: no real money was charged.)" : "";
    return this.send({
      organizationId,
      type: "billing.payment_succeeded",
      title: `Payment received: ${p.amount}`,
      body: `${p.description}. Invoice ${p.invoiceNumber}.${creditsLine}${test}`,
      dedupeKey: `billing:receipt:${p.paymentId}`,
      mail: {
        subject: `LeadForge receipt: ${p.amount} (invoice ${p.invoiceNumber})`,
        heading: "Payment received",
        paragraphs: [
          `We received your payment of ${p.amount} for ${p.description}.${creditsLine}`,
          `Invoice ${p.invoiceNumber} is on the Billing page as a PDF.${test}`,
        ],
        linkLabel: "Open billing",
      },
    });
  }

  paymentFailed(
    organizationId: string,
    p: { key: string; what: string; reason: string | null; renewal: boolean },
  ): Promise<void> {
    const reason = p.reason ? ` The payment provider said: ${p.reason}.` : "";
    const next = p.renewal
      ? " Your subscription is past due. Update the card on the Billing page; Paystack retries the charge, and the plan ends if no payment succeeds within the grace period."
      : " No money was taken and nothing was added. You can try again from the Billing page.";
    return this.send({
      organizationId,
      type: "billing.payment_failed",
      title: p.renewal ? "Subscription renewal failed" : "Payment failed",
      body: `${p.what}.${reason}${next}`,
      dedupeKey: `billing:failed:${p.key}`,
      mail: {
        subject: p.renewal
          ? "Action needed: your LeadForge renewal failed"
          : "Your LeadForge payment failed",
        heading: p.renewal ? "Renewal failed" : "Payment failed",
        paragraphs: [`${p.what}.${reason}`, next.trim()],
        linkLabel: "Open billing",
      },
    });
  }

  subscriptionChanged(
    organizationId: string,
    p: { key: string; title: string; body: string },
  ): Promise<void> {
    return this.send({
      organizationId,
      type: "billing.subscription_changed",
      title: p.title,
      body: p.body,
      dedupeKey: `billing:subscription:${p.key}`,
      mail: {
        subject: `LeadForge: ${p.title}`,
        heading: p.title,
        paragraphs: [p.body],
        linkLabel: "Open billing",
      },
    });
  }

  refundUpdated(
    organizationId: string,
    p: {
      refundId: string;
      status: "processed" | "failed";
      amount: string;
      credits: number;
      reason: string | null;
    },
  ): Promise<void> {
    const processed = p.status === "processed";
    const body = processed
      ? `A refund of ${p.amount} was processed.${p.credits > 0 ? ` ${p.credits.toLocaleString("en-US")} credits bought with it were taken back; if some were already used, the balance can go below zero and new discovery and analyses pause until it is topped up.` : ""}`
      : `A refund of ${p.amount} failed${p.reason ? `: ${p.reason}` : ""}. Nothing was taken back.`;
    return this.send({
      organizationId,
      type: "billing.refund_updated",
      title: processed ? `Refund processed: ${p.amount}` : `Refund failed: ${p.amount}`,
      body,
      dedupeKey: `billing:refund:${p.refundId}:${p.status}`,
      mail: {
        subject: processed
          ? `LeadForge refund processed: ${p.amount}`
          : `LeadForge refund failed: ${p.amount}`,
        heading: processed ? "Refund processed" : "Refund failed",
        paragraphs: [body],
        linkLabel: "Open billing",
      },
    });
  }

  /** Alerts that need a person: verification mismatches and disputes. */
  attention(
    organizationId: string,
    p: { key: string; title: string; body: string },
  ): Promise<void> {
    return this.send({
      organizationId,
      type: "billing.attention",
      title: p.title,
      body: p.body,
      dedupeKey: `billing:attention:${p.key}`,
      mail: {
        subject: `LeadForge billing alert: ${p.title}`,
        heading: p.title,
        paragraphs: [p.body],
        linkLabel: "Open billing",
      },
    });
  }
}
