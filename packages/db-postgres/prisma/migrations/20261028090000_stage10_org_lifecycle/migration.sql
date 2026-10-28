-- Stage 10: organization deletion workflow (request, 14-day grace, purge) and its erasure record.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "deletion_reminder_sent_at" TIMESTAMP(3),
ADD COLUMN     "deletion_requested_by_user_id" UUID,
ADD COLUMN     "purge_after" TIMESTAMP(3),
ADD COLUMN     "purged_at" TIMESTAMP(3);

-- Requests made before this migration get the documented 14-day grace.
UPDATE "organizations" SET "purge_after" = "deletion_requested_at" + INTERVAL '14 days'
WHERE "deletion_requested_at" IS NOT NULL AND "purge_after" IS NULL;

-- CreateTable
CREATE TABLE "organization_erasures" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3),
    "requested_by_user_id" UUID,
    "purge_after" TIMESTAMP(3),
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL DEFAULT '{}',
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_erasures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_erasures_organization_id_key" ON "organization_erasures"("organization_id");

-- CreateIndex
CREATE INDEX "organizations_purge_after_idx" ON "organizations"("purge_after");
