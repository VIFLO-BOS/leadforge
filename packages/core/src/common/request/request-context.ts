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

/**
 * The client address as Express computes it from the socket and the `trust proxy` setting
 * (TRUST_PROXY_HOPS): only the hops added by our own proxies are trusted. The left-most
 * `X-Forwarded-For` entry is whatever the client sent, so it is never used here; reading it
 * let anyone pick a fresh address per request and skip every per-IP rate limit.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
