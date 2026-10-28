import { Inject, Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { Logger } from "nestjs-pino";
import { z } from "zod";
import { UuidString } from "@leadforge/contracts";
import { REDIS } from "../redis/redis.module.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionSecurityService } from "../auth/session-security.service.js";
import { SubscriptionLifecycleService } from "../billing/subscription-lifecycle.service.js";
import { QueueService } from "../queue/queue.service.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/object-storage.js";
import { OrganizationsService } from "./organizations.service.js";
import { OrganizationRepository } from "./repositories/organization.repository.js";
import { OrganizationDataRepository } from "./repositories/organization-data.repository.js";
import {
  OrganizationErasureRepository,
  type ErasureTrigger,
} from "./repositories/organization-erasure.repository.js";

/** Purge steps, in order. Each is idempotent; a finished step is recorded and skipped on resume. */
export const PURGE_STEPS = [
  "stop_work",
  "subscription",
  "storage",
  "mongo",
  "postgres",
  "finalize",
] as const;
export type PurgeStep = (typeof PURGE_STEPS)[number];

export type PurgeOutcome =
  | { status: "purged"; organizationId: string; steps: PurgeStep[] }
  | { status: "already_purged" | "not_due" | "not_found"; organizationId: string };

const Payload = z.object({ organizationId: UuidString });

/** Object-storage key of the erasure receipt (outside both databases and their backups). */
export function erasureReceiptKey(organizationId: string): string {
  return `erasures/${organizationId}.json`;
}

/**
 * Stage 10: purges one organization after its 14-day grace (maintenance queue, job
 * `purge-organization`). Steps, each recorded in `organization_erasures.steps` so a crash resumes
 * after the last finished one:
 *
 * 1. `stop_work`: the organization is closed (`deleted_at`: nobody can open it any more), its
 *    waiting and delayed queue jobs are removed and unfinished jobs are marked stopped.
 * 2. `subscription`: renewal is disabled at Paystack (tolerating "not configured") and local
 *    subscriptions end as cancelled.
 * 3. `storage`: export files are deleted from object storage; invoice PDFs are kept.
 * 4. `mongo`: every document with the organization's id is deleted from every organization-scoped
 *    collection in the schema registry, except the audit log (organizationPurgePlan).
 * 5. `postgres`: memberships, invitations, preferences, API keys and usage rows are deleted;
 *    members of no other organization are anonymized; billing records are kept.
 * 6. `finalize`: the organization is marked purged and renamed; an erasure receipt is written to
 *    object storage and the audit log.
 *
 * A re-run after completion is a no-op. `reapply` (operators, after restoring a backup taken before
 * the purge) runs every step again.
 */
@Injectable()
export class OrganizationPurgeService {
  constructor(
    private readonly orgs: OrganizationRepository,
    private readonly organizations: OrganizationsService,
    private readonly data: OrganizationDataRepository,
    private readonly erasures: OrganizationErasureRepository,
    private readonly subscriptions: SubscriptionLifecycleService,
    private readonly queue: QueueService,
    private readonly sessionSecurity: SessionSecurityService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** BullMQ glue (`purge-organization`), shared by apps/worker and the API test harness. */
  async handle(job: Job): Promise<PurgeOutcome> {
    if (job.name !== "purge-organization")
      throw new UnrecoverableError(`Unknown purge job ${job.name}`);
    const parsed = Payload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("Invalid purge-organization payload");
    return this.purge(parsed.data.organizationId);
  }

  async purge(
    organizationId: string,
    options: { trigger?: ErasureTrigger; now?: Date } = {},
  ): Promise<PurgeOutcome> {
    const trigger = options.trigger ?? "schedule";
    const now = options.now ?? new Date();
    const org = await this.orgs.findAnyById(organizationId);
    if (!org) return { status: "not_found", organizationId };
    if (org.purgedAt && trigger !== "reapply") return { status: "already_purged", organizationId };
    // Scheduled purges only past the grace period of a request that is still pending.
    if (
      trigger === "schedule" &&
      (!org.deletionRequestedAt || !org.purgeAfter || org.purgeAfter > now)
    )
      return { status: "not_due", organizationId };

    const record = await this.erasures.begin(organizationId, {
      requestedAt: org.deletionRequestedAt,
      requestedByUserId: org.deletionRequestedByUserId,
      purgeAfter: org.purgeAfter,
      trigger,
    });
    const done = new Set(Object.keys((record.steps as Record<string, unknown> | null) ?? {}));
    const ran: PurgeStep[] = [];
    try {
      for (const step of PURGE_STEPS) {
        if (done.has(step)) continue;
        const result = await this.runStep(step, organizationId, now);
        await this.erasures.recordStep(organizationId, step, result, new Date());
        ran.push(step);
      }
    } catch (err) {
      await this.erasures
        .fail(organizationId, err instanceof Error ? err.message : String(err))
        .catch(() => undefined);
      this.logger.error(
        { err, organizationId },
        "Organization purge step failed; it resumes on the next attempt",
      );
      throw err;
    }
    const completed = await this.erasures.complete(organizationId, new Date());
    const receipt = {
      kind: "organization_erasure",
      organizationId,
      requestedAt: completed.requestedAt?.toISOString() ?? null,
      purgeAfter: completed.purgeAfter?.toISOString() ?? null,
      startedAt: completed.startedAt.toISOString(),
      completedAt: completed.completedAt?.toISOString() ?? null,
      trigger: completed.trigger,
      attempts: completed.attempts,
      steps: completed.steps,
    };
    // Outside both databases (and their backups): what to re-apply after a restore (docs/OPERATIONS.md).
    await this.storage.put(
      erasureReceiptKey(organizationId),
      Buffer.from(JSON.stringify(receipt, null, 2) + "\n", "utf8"),
      "application/json",
    );
    await this.audit.record({
      organizationId,
      actorUserId: null,
      actorType: "system",
      action: "org.purged",
      resourceType: "organization",
      resourceId: organizationId,
      after: { trigger, completedAt: receipt.completedAt, steps: receipt.steps },
    });
    this.logger.warn(
      { erasure: receipt },
      "Organization purged (erasure receipt; re-apply after any restore from an older backup)",
    );
    return { status: "purged", organizationId, steps: ran };
  }

  private async runStep(
    step: PurgeStep,
    organizationId: string,
    now: Date,
  ): Promise<Record<string, unknown>> {
    switch (step) {
      case "stop_work": {
        // Close the organization first: membership checks (API and workers) refuse it from here on.
        await this.orgs.markClosed(organizationId, now);
        const members = await this.erasures.memberUserIds(organizationId);
        if (members.length)
          await this.redis
            .del(...members.map((u) => `lf:member:${u}:${organizationId}`))
            .catch(() => undefined);
        await this.organizations.forgetLifecycle(organizationId);
        await this.audit.record({
          organizationId,
          actorUserId: null,
          actorType: "system",
          action: "org.purge_started",
          resourceType: "organization",
          resourceId: organizationId,
        });
        const removedJobs = await this.queue.removeOrganizationJobs(organizationId);
        const stopped = await this.data.stopActiveWork(organizationId, now);
        return { removedJobs, stopped };
      }
      case "subscription":
        return this.subscriptions.cancelForErasure(organizationId);
      case "storage": {
        const keys = (await this.data.exportFileKeys(organizationId)).filter(
          (k) => !k.startsWith("invoices/"),
        );
        for (const key of keys) await this.storage.delete(key);
        return { deletedFiles: keys.length, keptInvoicePdfs: true };
      }
      case "mongo": {
        const plan = this.data.plan();
        const deleted = await this.data.deleteOrganizationDocuments(organizationId, plan.delete);
        return { deleted, retained: plan.retain.map((r) => r.collection) };
      }
      case "postgres": {
        const { revokedSessionIds, ...result } = await this.erasures.purgeOrganizationRows(
          organizationId,
          now,
        );
        await this.sessionSecurity.markRevoked(revokedSessionIds);
        return { ...result, revokedSessions: revokedSessionIds.length };
      }
      case "finalize":
        await this.erasures.finalizeOrganization(organizationId, now);
        await this.organizations.forgetLifecycle(organizationId);
        return {};
    }
  }
}
