import type { Request } from "express";
import type { OrganizationRole, Permission } from "@leadforge/contracts";

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  emailVerified: boolean;
}

export interface OrganizationScope {
  organizationId: string;
  role: OrganizationRole;
  permissions: readonly Permission[];
}

export interface RequestWithContext extends Request {
  user?: AuthenticatedUser;
  org?: OrganizationScope;
}

export function getRequestId(req: Request): string {
  const fromReq = (req as { id?: unknown }).id;
  if (typeof fromReq === "string" && fromReq) return fromReq;
  if (typeof fromReq === "number") return String(fromReq);
  const header = req.headers["x-request-id"];
  return typeof header === "string" && header ? header : "unknown";
}

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
