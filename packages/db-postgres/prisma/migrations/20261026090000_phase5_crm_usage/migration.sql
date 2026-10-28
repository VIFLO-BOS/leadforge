-- Phase 5 (CRM, exports, usage).
-- Ledger rows carry a human reference name (job name or "Website analysis: <host>") for the Usage page.
ALTER TABLE "credit_ledger" ADD COLUMN "reference_name" TEXT;

-- Assignment emails can be switched off per user and organization (default on).
ALTER TABLE "notification_preferences" ADD COLUMN "email_assignments" BOOLEAN NOT NULL DEFAULT true;

-- The usage rollup rewrites each day's value; updated_at says when it last ran.
ALTER TABLE "usage_daily" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "usage_daily_organization_id_metric_day_idx" ON "usage_daily"("organization_id", "metric", "day");
