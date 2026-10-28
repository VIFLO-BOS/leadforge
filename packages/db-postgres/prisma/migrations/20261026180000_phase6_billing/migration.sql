-- Phase 6 (billing): Paystack payments, subscriptions lifecycle, invoices with PDFs, refunds,
-- disputes, entitlements per plan and reconciliation of webhooks. Money stays BIGINT minor units.
-- See docs/DATABASE_DESIGN.md sections 3 to 6.

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'awaiting_merchant', 'awaiting_bank', 'resolved');

-- AlterEnum
ALTER TYPE "ReconciliationKind" ADD VALUE 'webhooks';

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "discovery_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "website_analysis_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "last_synced_at" TIMESTAMP(3),
ADD COLUMN     "past_due_at" TIMESTAMP(3),
ADD COLUMN     "provider_status" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "bill_to" JSONB,
ADD COLUMN     "lines" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "pdf_generated_at" TIMESTAMP(3),
ADD COLUMN     "period_end" TIMESTAMP(3),
ADD COLUMN     "period_start" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "access_code" TEXT,
ADD COLUMN     "authorization_url" TEXT,
ADD COLUMN     "credit_units" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "flag_reason" TEXT,
ADD COLUMN     "flagged_at" TIMESTAMP(3),
ADD COLUMN     "gateway_response" TEXT,
ADD COLUMN     "initiated_by_user_id" UUID,
ADD COLUMN     "last_verified_at" TIMESTAMP(3),
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "provider_status" TEXT,
ADD COLUMN     "refunded_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "verify_attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "provider_status" TEXT,
ADD COLUMN     "requested_by_user_id" UUID,
ADD COLUMN     "reversal_units" INTEGER;

-- AlterTable
ALTER TABLE "payment_webhook_events" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invoice_counters" (
    "scope" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "payment_disputes" (
    "id" UUID NOT NULL,
    "billing_customer_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider_dispute_id" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "provider_status" TEXT,
    "resolution" TEXT,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "reason" TEXT,
    "due_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_disputes_provider_dispute_id_key" ON "payment_disputes"("provider_dispute_id");

-- CreateIndex
CREATE INDEX "payment_disputes_billing_customer_id_opened_at_idx" ON "payment_disputes"("billing_customer_id", "opened_at");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "payments_status_initiated_at_idx" ON "payments"("status", "initiated_at");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_processing_status_received_at_idx" ON "payment_webhook_events"("processing_status", "received_at");

-- AddForeignKey
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

