import { Module } from "@nestjs/common";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { BillingCatalogueService } from "./billing-catalogue.service.js";
import { BillingNotifier } from "./billing-notifier.js";
import { BillingReconciliationService } from "./billing-reconciliation.service.js";
import { BillingQueueHandler } from "./billing.queue-handler.js";
import { BillingService } from "./billing.service.js";
import { InvoiceService } from "./invoice.service.js";
import { PaymentSettlementService } from "./payment-settlement.service.js";
import { PAYMENT_PROVIDER } from "./provider/payment-provider.js";
import { PaystackProvider } from "./provider/paystack.provider.js";
import { BillingRepository } from "./repositories/billing.repository.js";
import { SubscriptionLifecycleService } from "./subscription-lifecycle.service.js";
import { WebhookService } from "./webhook.service.js";

/**
 * Phase 6 billing (PostgreSQL only): Paystack provider, checkout, webhooks, settlement,
 * subscriptions, invoices, refunds, reconciliation. The provider is Paystack; without
 * PAYSTACK_SECRET_KEY it reports "not configured" and every payment call fails cleanly.
 */
@Module({
  imports: [CreditsModule, EntitlementsModule, NotificationsModule, OrganizationsModule],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV],
      useFactory: (env: ServerEnv) =>
        new PaystackProvider(env.PAYSTACK_SECRET_KEY, env.PAYSTACK_BASE_URL),
    },
    BillingRepository,
    BillingNotifier,
    BillingService,
    BillingCatalogueService,
    InvoiceService,
    PaymentSettlementService,
    SubscriptionLifecycleService,
    WebhookService,
    BillingReconciliationService,
    BillingQueueHandler,
  ],
  exports: [
    PAYMENT_PROVIDER,
    BillingService,
    BillingCatalogueService,
    InvoiceService,
    PaymentSettlementService,
    SubscriptionLifecycleService,
    WebhookService,
    BillingReconciliationService,
    BillingQueueHandler,
  ],
})
export class BillingModule {}
