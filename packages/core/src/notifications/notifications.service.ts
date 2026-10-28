import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { ObjectId } from "@leadforge/db-mongo";
import type {
  Notification,
  NotificationListQuery,
  NotificationPreferences,
  NotificationType,
  ServerEnv,
  UpdateNotificationPreferences,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { QueueService } from "../queue/queue.service.js";
import { MailTemplates } from "../mail/templates.js";
import { UserRepository } from "../auth/repositories/user.repository.js";
import {
  NotificationRepository,
  type NotificationDocument,
} from "./repositories/notification.repository.js";
import { NotificationPreferenceRepository } from "./repositories/notification-preference.repository.js";

/** Defaults when a user has no notification_preferences row: everything on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Required<NotificationPreferences> = {
  emailJobEvents: true,
  emailBilling: true,
  inappAll: true,
  emailAssignments: true,
};

export interface DiscoveryFinishedEvent {
  organizationId: string;
  jobId: string;
  round: number;
  name: string;
  status: "completed" | "completed_with_warnings" | "failed";
  userId: string;
  created: number;
  updated: number;
  failed: number;
  reason: string | null;
}

export interface ImportFinishedEvent {
  organizationId: string;
  importId: string;
  fileName: string;
  status: "completed" | "completed_with_errors" | "failed";
  userId: string;
  created: number;
  updated: number;
  failed: number;
}

export interface LeadAssignedEvent {
  organizationId: string;
  assigneeUserId: string;
  assignedByUserId: string;
  /** Leads assigned by this event (1 for a single assignment, more for a bulk operation). */
  count: number;
  /** The business name when one lead was assigned. */
  businessName: string | null;
  /** One notice per key (`lead-assigned:<leadId>:v<version>`, `bulk-assign:<operationId>`). */
  dedupeKey: string;
}

export interface BulkFinishedEvent {
  organizationId: string;
  userId: string;
  operationId: string;
  action: string;
  status: "completed" | "completed_with_errors" | "failed";
  changed: number;
  unchanged: number;
  skipped: number;
  failed: number;
  reason: string | null;
}

export interface ExportFinishedEvent {
  organizationId: string;
  userId: string;
  exportId: string;
  status: "completed" | "failed";
  rowCount: number;
  reason: string | null;
}

const BULK_ACTION_LABELS: Record<string, string> = {
  add_to_list: "Add to list",
  remove_from_list: "Remove from list",
  assign: "Assign",
  move_stage: "Move stage",
};

/**
 * Phase 6 billing notice to one owner or admin: in-app (unless in-app notices are off) and an
 * email when their billing emails are on (`emailBilling`, default on).
 */
export interface BillingNoticeEvent {
  organizationId: string;
  userId: string;
  type: Extract<NotificationType, `billing.${string}`>;
  title: string;
  body: string;
  href: string;
  /** One notice per key and recipient (e.g. `billing:receipt:<paymentId>`). */
  dedupeKey: string;
  mail: { subject: string; heading: string; paragraphs: string[]; linkLabel: string } | null;
}

export interface AnalysisBatchFinishedEvent {
  organizationId: string;
  batchId: string;
  userId: string;
  completed: number;
  failed: number;
}

/**
 * In-app notifications (MongoDB `notifications`, 90-day TTL) and job emails through the mail
 * queue. Each event notifies once (dedupe key), respecting the recipient's preferences in
 * PostgreSQL notification_preferences (defaults: all on).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly users: UserRepository,
    private readonly queue: QueueService,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  async list(
    organizationId: string,
    userId: string,
    query: NotificationListQuery,
  ): Promise<{ items: Notification[]; nextCursor: string | null }> {
    const page = await withCursor(() =>
      this.notifications.page(
        organizationId,
        userId,
        { unread: query.unread },
        { pageSize: query.pageSize, cursor: query.cursor ?? null },
      ),
    );
    return { items: page.items.map(toView), nextCursor: page.nextCursor };
  }

  async unreadCount(organizationId: string, userId: string): Promise<{ unread: number }> {
    return { unread: await this.notifications.countUnread(organizationId, userId) };
  }

  /** 404 for another user's or another organization's notification. */
  async markRead(organizationId: string, userId: string, id: string): Promise<Notification> {
    const doc = await this.notifications.markRead(
      organizationId,
      userId,
      new ObjectId(id),
      new Date(),
    );
    if (!doc) throw AppError.notFound("Notification");
    return toView(doc);
  }

  async markAllRead(organizationId: string, userId: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(organizationId, userId, new Date()) };
  }

  async getPreferences(
    organizationId: string,
    userId: string,
  ): Promise<Required<NotificationPreferences>> {
    const row = await this.preferences.find(organizationId, userId);
    return row
      ? {
          emailJobEvents: row.emailJobEvents,
          emailBilling: row.emailBilling,
          inappAll: row.inappAll,
          emailAssignments: row.emailAssignments,
        }
      : { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  async updatePreferences(
    organizationId: string,
    userId: string,
    patch: UpdateNotificationPreferences,
  ): Promise<Required<NotificationPreferences>> {
    const current = await this.getPreferences(organizationId, userId);
    const next = {
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "boolean")),
    };
    const row = await this.preferences.upsert(organizationId, userId, next);
    return {
      emailJobEvents: row.emailJobEvents,
      emailBilling: row.emailBilling,
      inappAll: row.inappAll,
      emailAssignments: row.emailAssignments,
    };
  }

  private async notify(input: {
    organizationId: string;
    userId: string;
    type: NotificationType;
    title: string;
    body: string | null;
    href: string | null;
    dedupeKey: string;
  }): Promise<boolean> {
    return this.notifications.insertOnce(input.organizationId, {
      _id: new ObjectId(),
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 1000) ?? null,
      href: input.href,
      readAt: null,
      dedupeKey: input.dedupeKey,
      createdAt: new Date(),
    });
  }

  /** In-app notice to the job's creator; on failure also an email (unless they turned job emails off). */
  async discoveryFinished(event: DiscoveryFinishedEvent): Promise<void> {
    try {
      const prefs = await this.getPreferences(event.organizationId, event.userId);
      const href = `/app/discovery/${event.jobId}`;
      const counts = `${event.created} new, ${event.updated} updated${event.failed ? `, ${event.failed} failed` : ""}`;
      const type: NotificationType = `discovery.${event.status}`;
      const title =
        event.status === "failed"
          ? `Discovery job "${event.name}" failed`
          : event.status === "completed_with_warnings"
            ? `Discovery job "${event.name}" finished with warnings`
            : `Discovery job "${event.name}" completed`;
      const body =
        event.status === "failed"
          ? `${event.reason ?? "The job stopped."} ${counts}.`
          : `${counts}.`;
      if (prefs.inappAll) {
        await this.notify({
          ...event,
          type,
          title,
          body,
          href,
          dedupeKey: `discovery:${event.jobId}:r${event.round}`,
        });
      }
      if (event.status === "failed" && prefs.emailJobEvents) {
        const user = await this.users.findById(event.userId);
        if (user && !user.deletedAt) {
          const link = `${this.env.APP_URL.replace(/\/$/, "")}${href}`;
          await this.queue.enqueueMail({
            message: MailTemplates.discoveryJobFailed(
              user.email,
              user.name,
              event.name,
              event.reason ?? "The job stopped.",
              link,
            ),
            idempotencyKey: `discovery-failed:${event.jobId}-r${event.round}`,
          });
        }
      }
    } catch (err) {
      // Notifications never fail the job they report on.
      this.logger.error(
        { err, organizationId: event.organizationId, jobId: event.jobId },
        "Could not send discovery notification",
      );
    }
  }

  /**
   * Lead assignment: in-app notice to the assignee (unless they assigned it to themselves) and an
   * email when their assignment emails are on. Never throws.
   */
  async leadAssigned(event: LeadAssignedEvent): Promise<void> {
    if (event.assigneeUserId === event.assignedByUserId || event.count < 1) return;
    try {
      const prefs = await this.getPreferences(event.organizationId, event.assigneeUserId);
      const href = `/app/pipeline?assignedToUserId=${event.assigneeUserId}`;
      const assigner = await this.users.findById(event.assignedByUserId);
      const by = assigner?.name ?? "A teammate";
      const what =
        event.count === 1
          ? event.businessName
            ? `"${event.businessName}"`
            : "A lead"
          : `${event.count} leads`;
      if (prefs.inappAll) {
        await this.notify({
          organizationId: event.organizationId,
          userId: event.assigneeUserId,
          type: "lead.assigned",
          title: event.count === 1 ? `${what} was assigned to you` : `${what} were assigned to you`,
          body: `Assigned by ${by}.`,
          href,
          dedupeKey: event.dedupeKey,
        });
      }
      if (prefs.emailAssignments) {
        const user = await this.users.findById(event.assigneeUserId);
        if (user && !user.deletedAt) {
          const link = `${this.env.APP_URL.replace(/\/$/, "")}${href}`;
          await this.queue.enqueueMail({
            message: MailTemplates.leadAssigned(
              user.email,
              user.name,
              by,
              event.count,
              event.businessName,
              link,
            ),
            // BullMQ custom job ids allow exactly two colons ("mail:<kind>:<id>").
            idempotencyKey: `assignment:${event.organizationId}-${event.dedupeKey.replace(/:/g, "-")}`,
          });
        }
      }
    } catch (err) {
      this.logger.error(
        { err, organizationId: event.organizationId, dedupeKey: event.dedupeKey },
        "Could not send assignment notification",
      );
    }
  }

  /** In-app notice to the requester when a bulk operation finishes. */
  async bulkFinished(event: BulkFinishedEvent): Promise<void> {
    try {
      const prefs = await this.getPreferences(event.organizationId, event.userId);
      if (!prefs.inappAll) return;
      const label = BULK_ACTION_LABELS[event.action] ?? event.action;
      const title =
        event.status === "failed"
          ? `Bulk action "${label}" failed`
          : event.status === "completed_with_errors"
            ? `Bulk action "${label}" finished with errors`
            : `Bulk action "${label}" completed`;
      const counts = `${event.changed} changed, ${event.unchanged} unchanged, ${event.skipped} skipped${event.failed ? `, ${event.failed} failed` : ""}`;
      await this.notify({
        organizationId: event.organizationId,
        userId: event.userId,
        type: `bulk.${event.status}`,
        title,
        body:
          event.status === "failed"
            ? `${event.reason ?? "The operation stopped."} ${counts}.`
            : `${counts}.`,
        href: `/app/jobs/bulk/${event.operationId}`,
        dedupeKey: `bulk:${event.operationId}`,
      });
    } catch (err) {
      this.logger.error(
        { err, organizationId: event.organizationId, operationId: event.operationId },
        "Could not send bulk notification",
      );
    }
  }

  /** In-app notice to the requester when an export is ready or failed. */
  async exportFinished(event: ExportFinishedEvent): Promise<void> {
    try {
      const prefs = await this.getPreferences(event.organizationId, event.userId);
      if (!prefs.inappAll) return;
      await this.notify({
        organizationId: event.organizationId,
        userId: event.userId,
        type: `export.${event.status}`,
        title:
          event.status === "completed"
            ? `Your export of ${event.rowCount} business${event.rowCount === 1 ? "" : "es"} is ready`
            : "Your export failed",
        body:
          event.status === "completed"
            ? "Download it from the export page; the file is kept for 7 days."
            : (event.reason ?? "The export could not be built."),
        href: `/app/jobs/exports/${event.exportId}`,
        dedupeKey: `export:${event.exportId}`,
      });
    } catch (err) {
      this.logger.error(
        { err, organizationId: event.organizationId, exportId: event.exportId },
        "Could not send export notification",
      );
    }
  }

  /**
   * Stage 10 organization notice (deletion scheduled or cancelled, organization data export ready
   * or failed): in-app for one member, whatever their preferences (it concerns the whole account).
   * Emails are sent by the caller. Never throws.
   */
  async organizationNotice(event: {
    organizationId: string;
    userId: string;
    type: Extract<NotificationType, `organization.${string}`>;
    title: string;
    body: string;
    href: string;
    dedupeKey: string;
  }): Promise<void> {
    try {
      await this.notify({ ...event, dedupeKey: `${event.dedupeKey}:${event.userId}` });
    } catch (err) {
      this.logger.error(
        { err, organizationId: event.organizationId, dedupeKey: event.dedupeKey },
        "Could not send organization notification",
      );
    }
  }

  /** Billing notice (receipt, failed payment, subscription change, refund, alert). Never throws. */
  async billingNotice(event: BillingNoticeEvent): Promise<void> {
    try {
      const prefs = await this.getPreferences(event.organizationId, event.userId);
      if (prefs.inappAll) {
        await this.notify({
          organizationId: event.organizationId,
          userId: event.userId,
          type: event.type,
          title: event.title,
          body: event.body,
          href: event.href,
          dedupeKey: `${event.dedupeKey}:${event.userId}`,
        });
      }
      if (event.mail && prefs.emailBilling) {
        const user = await this.users.findById(event.userId);
        if (user && !user.deletedAt) {
          const link = `${this.env.APP_URL.replace(/\/$/, "")}${event.href}`;
          await this.queue.enqueueMail({
            message: MailTemplates.billingNotice(user.email, user.name, { ...event.mail, link }),
            // BullMQ custom job ids allow exactly two colons ("mail:<kind>:<id>").
            idempotencyKey: `billing:${event.dedupeKey.replace(/:/g, "-")}-${event.userId}`,
          });
        }
      }
    } catch (err) {
      this.logger.error(
        { err, organizationId: event.organizationId, dedupeKey: event.dedupeKey },
        "Could not send billing notification",
      );
    }
  }

  /** In-app notice to the requester when every analysis of a bulk request has finished. */
  async analysisBatchFinished(event: AnalysisBatchFinishedEvent): Promise<void> {
    try {
      const prefs = await this.getPreferences(event.organizationId, event.userId);
      if (!prefs.inappAll) return;
      const total = event.completed + event.failed;
      await this.notify({
        organizationId: event.organizationId,
        userId: event.userId,
        type: "analysis.bulk_completed",
        title: `Website analysis of ${total} business${total === 1 ? "" : "es"} finished`,
        body: `${event.completed} completed${event.failed ? `, ${event.failed} failed (credits for failed analyses were returned)` : ""}.`,
        href: `/app/analysis?batchId=${event.batchId}`,
        dedupeKey: `analysis-batch:${event.batchId}`,
      });
    } catch (err) {
      this.logger.error(
        { err, organizationId: event.organizationId, batchId: event.batchId },
        "Could not send analysis notification",
      );
    }
  }

  async importFinished(event: ImportFinishedEvent): Promise<void> {
    try {
      const prefs = await this.getPreferences(event.organizationId, event.userId);
      if (!prefs.inappAll) return;
      const title =
        event.status === "failed"
          ? `Import of ${event.fileName} failed`
          : event.status === "completed_with_errors"
            ? `Import of ${event.fileName} finished with row errors`
            : `Import of ${event.fileName} completed`;
      await this.notify({
        organizationId: event.organizationId,
        userId: event.userId,
        type: `import.${event.status}`,
        title,
        body: `${event.created} new, ${event.updated} updated${event.failed ? `, ${event.failed} rows failed` : ""}.`,
        href: `/app/businesses?importId=${event.importId}`,
        dedupeKey: `import:${event.importId}`,
      });
    } catch (err) {
      this.logger.error(
        { err, organizationId: event.organizationId, importId: event.importId },
        "Could not send import notification",
      );
    }
  }
}

function toView(d: NotificationDocument): Notification {
  return {
    id: d._id.toHexString(),
    type: d.type,
    title: d.title,
    body: d.body,
    href: d.href,
    readAt: d.readAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
