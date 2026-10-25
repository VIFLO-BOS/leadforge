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
  | "org.deletion_requested";

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
