import { z } from "zod";
import { IsoDateTime, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";

export const LedgerEntryType = z.enum([
  "grant",
  "purchase",
  "hold",
  "capture",
  "release",
  "adjustment",
  "refund_reversal",
  "expiry",
]);
export type LedgerEntryType = z.infer<typeof LedgerEntryType>;

/**
 * `GET /credits/balance`. `balance` is what can be spent now: holds are debited when a job
 * is queued, so credits held by running jobs are already excluded and shown in `held`.
 */
export const CreditBalance = z.object({
  balance: z.number().int(),
  held: z.number().int(),
  /** Open holds (queued or running jobs, or settlements pending reconciliation). */
  openHolds: z.number().int(),
  updatedAt: IsoDateTime,
});
export type CreditBalance = z.infer<typeof CreditBalance>;

/**
 * One ledger row. `units` is signed: grant, purchase, release and positive adjustments add;
 * hold, expiry, refund_reversal and negative adjustments subtract. A capture has `units: 0`
 * and records the billed amount in `capturedUnits` (the hold already debited it). A release
 * row is written only when units go back (from Phase 5 a fully captured hold has no 0-unit release).
 */
export const CreditLedgerEntry = z.object({
  id: UuidString,
  entryType: LedgerEntryType,
  units: z.number().int(),
  capturedUnits: z.number().int().nullable(),
  balanceAfter: z.number().int(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  /**
   * Human name of what the entry belongs to (the discovery job name, "Website analysis:
   * <host>"); null for entries without one or written before Phase 5. Always sent from Phase 5;
   * typed optional so older clients still compile.
   */
  referenceName: z.string().nullable().optional(),
  holdId: UuidString.nullable(),
  description: z.string().nullable(),
  actorUserId: UuidString.nullable(),
  createdAt: IsoDateTime,
});
export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntry>;

export const CreditLedgerQuery = z.object({
  entryType: queryArray(LedgerEntryType, 8),
  /** Only entries for this reference, e.g. `discovery_job`. */
  referenceType: z.string().trim().max(40).optional(),
  referenceId: z.string().trim().max(64).optional(),
  ...CursorQuery.shape,
});
export type CreditLedgerQuery = z.infer<typeof CreditLedgerQuery>;
