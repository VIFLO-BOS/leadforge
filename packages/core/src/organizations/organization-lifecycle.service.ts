import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import {
  ORGANIZATION_DELETION_GRACE_DAYS,
  ORGANIZATION_DELETION_REMINDER_DAYS,
  ORGANIZATION_LIFECYCLE_PAGE,
  type OrganizationDeletionStatus,
  type RequestOrganizationDeletion,
  type ServerEnv,
} from "@leadforge/contracts";
import type { Organization } from "@leadforge/db-postgres";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import type { OrganizationScope } from "../common/request/request-context.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { PasswordService } from "../auth/password.service.js";
import { SessionSecurityService } from "../auth/session-security.service.js";
import { UserRepository } from "../auth/repositories/user.repository.js";
import { MailTemplates } from "../mail/templates.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { QueueService } from "../queue/queue.service.js";
import { OrganizationsService } from "./organizations.service.js";
import { OrganizationRepository } from "./repositories/organization.repository.js";
import { MembershipRepository } from "./repositories/membership.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const dayLabel = (d: Date): string =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Stage 10: the organization deletion workflow up to the purge.
 *
 * - Request (owner): the typed organization name and the owner's current password; schedules the
 *   purge 14 days later. Idempotent while one is pending. Owners and admins are told in-app and by
 *   email, and again by email about 3 days before the purge.
 * - Cancel (owner): any time before the purge starts.
 * - Scan (maintenance, every 10 minutes): sends due reminders and enqueues one `purge-organization`
 *   job per organization past its purge date (OrganizationPurgeService does the rest).
 */
@Injectable()
export class OrganizationLifecycleService {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly orgs: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly sessionSecurity: SessionSecurityService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private link(path: string = ORGANIZATION_LIFECYCLE_PAGE): string {
    return `${this.env.APP_URL.replace(/\/+$/, "")}${path}`;
  }

  /**
   * Re-authentication for a destructive action: the owner's current password. Failures count
   * toward the per-account sign-in lock (10 per 15 minutes), so a stolen session cannot be used to
   * guess the password here; while locked, 429 with the real wait.
   */
  private async reauthenticate(
    userId: string,
    password: string,
    organizationId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) throw new AppError("UNAUTHENTICATED");
    const lockedFor = await this.sessionSecurity.loginLockSeconds(user.email);
    if (lockedFor > 0) {
      const minutes = Math.ceil(lockedFor / 60);
      throw AppError.rateLimited(
        `Too many wrong passwords for this account. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        lockedFor,
      );
    }
    if (await this.passwords.verify(user.passwordHash, password)) {
      await this.sessionSecurity.clearLoginFailures(user.email);
      return;
    }
    await this.sessionSecurity.recordLoginFailure(user.email);
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "org.deletion_reauth_failed",
        resourceType: "organization",
        resourceId: organizationId,
      },
      ctx,
    );
    throw new AppError(
      "REAUTH_FAILED",
      "That password is not correct. Enter your current LeadForge password to confirm.",
    );
  }

  private static status(
    org: Pick<Organization, "deletionRequestedAt" | "purgeAfter">,
  ): OrganizationDeletionStatus {
    const requestedAt = org.deletionRequestedAt!;
    const purgeAfter =
      org.purgeAfter ?? new Date(requestedAt.getTime() + ORGANIZATION_DELETION_GRACE_DAYS * DAY_MS);
    return { deletionRequestedAt: requestedAt.toISOString(), purgeAfter: purgeAfter.toISOString() };
  }

  async requestDeletion(
    scope: OrganizationScope,
    userId: string,
    dto: RequestOrganizationDeletion,
    ctx: AuditContext,
  ): Promise<OrganizationDeletionStatus> {
    const org = await this.orgs.findById(scope.organizationId);
    if (!org) throw AppError.notFound("Organization");
    if (dto.confirmName !== org.name) {
      throw AppError.validation(
        [
          {
            path: "confirmName",
            message: "Type the organization's name exactly as shown to confirm",
          },
        ],
        "The organization name does not match",
      );
    }
    await this.reauthenticate(userId, dto.password, org.id, ctx);
    // Idempotent: a pending request is returned as it is (no second notice, no new grace period).
    if (org.deletionRequestedAt) return OrganizationLifecycleService.status(org);

    const now = new Date();
    const purgeAfter = new Date(now.getTime() + ORGANIZATION_DELETION_GRACE_DAYS * DAY_MS);
    const { scheduled, organization } = await this.orgs.scheduleDeletion(org.id, {
      requestedAt: now,
      purgeAfter,
      requestedByUserId: userId,
    });
    await this.organizations.forgetLifecycle(org.id);
    if (!organization?.deletionRequestedAt) throw AppError.notFound("Organization");
    if (!scheduled) return OrganizationLifecycleService.status(organization);

    await this.audit.record(
      {
        organizationId: org.id,
        actorUserId: userId,
        actorType: "user",
        action: "org.deletion_requested",
        resourceType: "organization",
        resourceId: org.id,
        after: { deletionRequestedAt: now.toISOString(), purgeAfter: purgeAfter.toISOString() },
      },
      ctx,
    );
    const requester = await this.users.findById(userId);
    await this.tellManagers(organization, {
      key: `org-deletion-requested:${org.id}-${now.getTime()}`,
      inApp: {
        type: "organization.deletion_requested",
        title: `${org.name} is scheduled for deletion on ${dayLabel(purgeAfter)}`,
        body: `${requester?.name || "An owner"} asked to delete this organization. New discovery, analysis, imports, purchases and invitations are paused. An owner can cancel the deletion in Settings until ${dayLabel(purgeAfter)}.`,
      },
      mail: {
        subject: `${org.name} will be deleted on ${dayLabel(purgeAfter)}`,
        heading: "Organization scheduled for deletion",
        paragraphs: [
          `${requester?.name || "An owner"} asked to delete the LeadForge organization "${org.name}". It will be deleted permanently on ${dayLabel(purgeAfter)} (14 days from now).`,
          "Until then everyone can keep working, but new discovery, website analysis, imports, purchases and invitations are paused. An owner can export the organization's data, or cancel the deletion, in Settings, Organization.",
          "After the deletion, businesses, lists, leads, activities, jobs and files are erased, and accounts that belong to no other organization are anonymized. Payments, invoices and the credit ledger are kept for the period billing law requires.",
        ],
        linkLabel: "Review or cancel the deletion",
      },
    });
    return OrganizationLifecycleService.status(organization);
  }

  /** Clears a pending deletion. A no-op when none is pending (repeat clicks). */
  async cancelDeletion(scope: OrganizationScope, userId: string, ctx: AuditContext): Promise<void> {
    const org = await this.orgs.findById(scope.organizationId);
    if (!org) throw AppError.notFound("Organization");
    if (!org.deletionRequestedAt) return;
    const purgeAfter = org.purgeAfter;
    if (!(await this.orgs.cancelDeletion(org.id))) {
      await this.organizations.forgetLifecycle(org.id);
      return;
    }
    await this.organizations.forgetLifecycle(org.id);
    await this.audit.record(
      {
        organizationId: org.id,
        actorUserId: userId,
        actorType: "user",
        action: "org.deletion_cancelled",
        resourceType: "organization",
        resourceId: org.id,
        before: {
          deletionRequestedAt: org.deletionRequestedAt.toISOString(),
          purgeAfter: purgeAfter?.toISOString() ?? null,
        },
      },
      ctx,
    );
    const actor = await this.users.findById(userId);
    await this.tellManagers(org, {
      key: `org-deletion-cancelled:${org.id}-${Date.now()}`,
      inApp: {
        type: "organization.deletion_cancelled",
        title: `The deletion of ${org.name} was cancelled`,
        body: `${actor?.name || "An owner"} cancelled the deletion. Everything works as before.`,
      },
      mail: {
        subject: `The deletion of ${org.name} was cancelled`,
        heading: "Deletion cancelled",
        paragraphs: [
          `${actor?.name || "An owner"} cancelled the scheduled deletion of the LeadForge organization "${org.name}". Nothing will be deleted, and discovery, analysis, imports, purchases and invitations work again.`,
        ],
        linkLabel: "Open Settings",
      },
    });
  }

  /**
   * Maintenance (`scan-organization-deletions`): reminder emails for purges due within 3 days, and
   * a purge job for every organization past its purge date.
   */
  async scan(now: Date = new Date()): Promise<{ reminders: number; purgesQueued: number }> {
    let reminders = 0;
    for (const org of await this.orgs.dueForReminder(
      now,
      ORGANIZATION_DELETION_REMINDER_DAYS * DAY_MS,
      100,
    )) {
      if (!(await this.orgs.markReminderSent(org.id, now))) continue;
      const purgeAfter = org.purgeAfter!;
      await this.tellManagers(org, {
        key: `org-deletion-reminder:${org.id}-${org.deletionRequestedAt!.getTime()}`,
        inApp: null,
        mail: {
          subject: `Reminder: ${org.name} will be deleted on ${dayLabel(purgeAfter)}`,
          heading: "Organization deletion in a few days",
          paragraphs: [
            `The LeadForge organization "${org.name}" will be deleted permanently on ${dayLabel(purgeAfter)}.`,
            "Export the organization's data before then if you need it. An owner can still cancel the deletion in Settings, Organization.",
          ],
          linkLabel: "Export data or cancel the deletion",
        },
      });
      reminders += 1;
    }
    let purgesQueued = 0;
    for (const organizationId of await this.orgs.dueForPurge(now, 50)) {
      await this.queue.enqueueOrganizationPurge({ organizationId });
      purgesQueued += 1;
    }
    if (reminders || purgesQueued)
      this.logger.log({ reminders, purgesQueued }, "Organization deletion scan");
    return { reminders, purgesQueued };
  }

  /** In-app notice (optional) and email to every active owner and admin. Never throws. */
  private async tellManagers(
    org: Pick<Organization, "id" | "name">,
    notice: {
      key: string;
      inApp: {
        type: "organization.deletion_requested" | "organization.deletion_cancelled";
        title: string;
        body: string;
      } | null;
      mail: { subject: string; heading: string; paragraphs: string[]; linkLabel: string };
    },
  ): Promise<void> {
    try {
      const managers = await this.memberships.managers(org.id);
      for (const m of managers) {
        if (notice.inApp) {
          await this.notifications.organizationNotice({
            organizationId: org.id,
            userId: m.userId,
            type: notice.inApp.type,
            title: notice.inApp.title,
            body: notice.inApp.body,
            href: ORGANIZATION_LIFECYCLE_PAGE,
            dedupeKey: notice.key,
          });
        }
        await this.queue.enqueueMail({
          message: MailTemplates.organizationNotice(m.user.email, m.user.name, {
            ...notice.mail,
            link: this.link(),
          }),
          // BullMQ custom job ids allow exactly two colons ("mail:<kind>:<id>").
          idempotencyKey: `org-notice:${notice.key.replace(/:/g, "-")}-${m.userId}`,
        });
      }
    } catch (err) {
      this.logger.error(
        { err, organizationId: org.id, key: notice.key },
        "Could not send organization deletion notices",
      );
    }
  }
}
