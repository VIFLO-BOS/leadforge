import { z } from "zod";
import { IsoDateTime, ObjectIdString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryBoolean } from "../common/query.js";

export const NotificationType = z.enum([
  "discovery.completed",
  "discovery.completed_with_warnings",
  "discovery.failed",
  "import.completed",
  "import.completed_with_errors",
  "import.failed",
  "analysis.bulk_completed",
  /** Phase 5: a lead (or, from a bulk operation, several) was assigned to you. */
  "lead.assigned",
  /** Phase 5: your bulk operation finished. */
  "bulk.completed",
  "bulk.completed_with_errors",
  "bulk.failed",
  /** Phase 5: your export is ready to download, or failed. */
  "export.completed",
  "export.failed",
  /** Phase 6 (owners and admins): a payment succeeded (receipt), failed, or a subscription changed. */
  "billing.payment_succeeded",
  "billing.payment_failed",
  "billing.subscription_changed",
  /** Phase 6 (owners and admins): a refund was processed or failed. */
  "billing.refund_updated",
  /** Phase 6 (owners and admins): a payment needs review (verification mismatch) or a dispute was opened. */
  "billing.attention",
  /** Stage 10 (owners and admins): the organization was scheduled for deletion, or the deletion was cancelled. */
  "organization.deletion_requested",
  "organization.deletion_cancelled",
  /** Stage 10 (the requesting owner): the organization data export is ready, or failed. */
  "organization.export_completed",
  "organization.export_failed",
]);
export type NotificationType = z.infer<typeof NotificationType>;

/** In-app notification for the signed-in user in the current organization. Kept 90 days. */
export const Notification = z.object({
  id: ObjectIdString,
  type: NotificationType,
  title: z.string(),
  body: z.string().nullable(),
  /** Dashboard route to open, e.g. /app/discovery/<id>. */
  href: z.string().nullable(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Notification = z.infer<typeof Notification>;

export const NotificationListQuery = z.object({
  /** true: only unread. */
  unread: queryBoolean,
  ...CursorQuery.shape,
});
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;

export const NotificationUnreadCount = z.object({ unread: z.number().int() });
export type NotificationUnreadCount = z.infer<typeof NotificationUnreadCount>;

/** Per user and organization (PostgreSQL notification_preferences). Defaults: all on. */
export const NotificationPreferences = z.object({
  /** Email when a discovery job fails. */
  emailJobEvents: z.boolean(),
  /** Billing emails (Phase 6). */
  emailBilling: z.boolean(),
  /** In-app notifications. */
  inappAll: z.boolean(),
  /**
   * Email when a lead is assigned to you (Phase 5; default on). Always sent by the API from
   * Phase 5; typed optional so older clients still compile.
   */
  emailAssignments: z.boolean().optional(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const UpdateNotificationPreferences = NotificationPreferences.partial();
export type UpdateNotificationPreferences = z.infer<typeof UpdateNotificationPreferences>;
