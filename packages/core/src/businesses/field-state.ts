import type { FieldState, WhatsAppStatus } from "@leadforge/contracts";
import type { StoredFieldMeta } from "./business.types.js";

export interface StateContext {
  now: Date;
  /** Organization freshness window in days (organizations.freshness_days, default 180). */
  freshnessDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function staleCutoff(ctx: StateContext): Date {
  return new Date(ctx.now.getTime() - ctx.freshnessDays * DAY_MS);
}

/**
 * Read-time state of one field value:
 * missing (no value) > expired (past source retention) > conflicting > stale (last observed
 * or verified before the freshness window) > the stored verified/unverified state.
 */
export function deriveFieldState(
  meta:
    | Pick<StoredFieldMeta, "state" | "expiresAt" | "lastObservedAt" | "lastVerifiedAt">
    | null
    | undefined,
  hasValue: boolean,
  ctx: StateContext,
): FieldState {
  if (!meta || !hasValue) return "missing";
  if (meta.expiresAt && meta.expiresAt.getTime() <= ctx.now.getTime()) return "expired";
  if (meta.state === "conflicting") return "conflicting";
  const freshest = Math.max(
    meta.lastObservedAt?.getTime() ?? 0,
    meta.lastVerifiedAt?.getTime() ?? 0,
  );
  if (freshest < staleCutoff(ctx).getTime()) return "stale";
  return meta.state;
}

/** Lower is better: used to pick a primary phone or email and a summary state. */
export const STATE_RANK: Record<FieldState, number> = {
  verified: 0,
  unverified: 1,
  stale: 2,
  conflicting: 3,
  expired: 4,
  missing: 5,
};

export function bestState(states: FieldState[]): FieldState {
  return states.reduce<FieldState>(
    (best, s) => (STATE_RANK[s] < STATE_RANK[best] ? s : best),
    "missing",
  );
}

const WHATSAPP_RANK: Record<WhatsAppStatus, number> = {
  confirmed: 0,
  user_asserted: 1,
  unknown: 2,
};

export function bestWhatsApp(statuses: WhatsAppStatus[]): WhatsAppStatus {
  return statuses.reduce<WhatsAppStatus>(
    (best, s) => (WHATSAPP_RANK[s] < WHATSAPP_RANK[best] ? s : best),
    "unknown",
  );
}
