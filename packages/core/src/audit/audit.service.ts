import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AuditRepository, type AuditEventInput } from "./repositories/audit.repository.js";
import { clientIp, getRequestId } from "../common/request/request-context.js";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.refresh_reuse_detected"
  | "auth.email_verified"
  | "auth.password_reset_requested"
  | "auth.password_reset"
  | "auth.session_revoked"
  | "org.updated"
  | "org.member_role_changed"
  | "org.member_status_changed"
  | "org.member_removed"
  | "org.invitation_created"
  | "org.invitation_revoked"
  | "org.invitation_accepted"
  | "org.deletion_requested"
  | "org.deletion_reauth_failed"
  | "org.deletion_cancelled"
  | "org.purge_started"
  | "org.purged"
  | "org.data_export_requested"
  | "org.data_export_finished"
  | "org.data_export_downloaded"
  | "business.created"
  | "business.corrected"
  | "business.suppressed"
  | "business.bulk_suppressed"
  | "business.unsuppressed"
  | "business.contacts_viewed"
  | "import.uploaded"
  | "import.committed"
  | "import.finished"
  | "export.created"
  | "source.enabled"
  | "source.disabled"
  | "discovery.created"
  | "discovery.cancel_requested"
  | "discovery.cancelled"
  | "discovery.retry_requested"
  | "discovery.finished"
  | "analysis.requested"
  | "analysis.bulk_requested"
  | "enrichment.requested"
  | "business.refresh_requested"
  | "dedup.scan_requested"
  | "dedup.merged"
  | "dedup.merge_undone"
  | "dedup.candidate_rejected"
  | "dedup.candidate_deferred"
  | "scoring.profile_updated"
  | "scoring.recompute_requested"
  // Phase 5: CRM, bulk operations, async exports
  | "pipeline.config_updated"
  | "lead.created"
  | "lead.assigned"
  | "lead.stage_changed"
  | "lead.updated"
  | "list.created"
  | "list.updated"
  | "list.deleted"
  | "list.items_added"
  | "list.items_removed"
  | "activity.updated"
  | "activity.deleted"
  | "contact.suppression_overridden"
  | "bulk.requested"
  | "bulk.finished"
  | "export.requested"
  | "export.finished"
  | "export.downloaded"
  // Phase 6: billing (PostgreSQL billing_audit holds the authoritative before and after; these
  // application events carry ids and statuses only, never billing state).
  | "billing.checkout_created"
  | "billing.payment_succeeded"
  | "billing.payment_failed"
  | "billing.payment_flagged"
  | "billing.subscription_changed"
  | "billing.subscription_cancel_requested"
  | "billing.subscription_resumed"
  | "billing.refund_requested"
  | "billing.refund_updated"
  | "billing.dispute_opened"
  | "billing.dispute_updated"
  | "billing.invoice_downloaded";

export interface AuditContext {
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  static contextFrom(req: Request): AuditContext {
    return {
      requestId: getRequestId(req),
      ip: clientIp(req),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    };
  }

  /** Events of one action per UTC day (usage rollup). */
  perDay(organizationId: string, action: AuditAction, from: Date, to: Date, sumField?: string) {
    return this.repo.perDay(organizationId, action, from, to, sumField);
  }

  async record(
    input: Omit<AuditEventInput, "occurredAt" | "ip" | "userAgent" | "requestId"> & {
      action: AuditAction;
    },
    ctx: AuditContext = {},
  ): Promise<void> {
    await this.repo.insert({
      ...input,
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      occurredAt: new Date(),
    });
  }
}
