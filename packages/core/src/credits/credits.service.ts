import { Injectable } from "@nestjs/common";
import { newId, type CreditLedger, type LedgerEntryType } from "@leadforge/db-postgres";
import {
  UuidString,
  type CreditBalance,
  type CreditLedgerEntry,
  type CreditLedgerQuery,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import {
  CreditLedgerRepository,
  type LedgerTx,
  type LockedCustomer,
  type OpenHoldRow,
} from "./repositories/credit-ledger.repository.js";

export type { LedgerTx, LockedCustomer };

/** Adds credits inside a locked transaction (payment grants, purchases). */
export interface CreditInTxInput {
  units: number;
  key: string;
  entryType: Extract<LedgerEntryType, "grant" | "purchase" | "adjustment">;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceName?: string | null;
  actorUserId?: string | null;
}

/** Removes credits inside a locked transaction; the balance may go below zero (refund reversals). */
export interface DebitInTxInput {
  units: number;
  key: string;
  entryType: Extract<LedgerEntryType, "refund_reversal" | "adjustment" | "expiry">;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceName?: string | null;
  actorUserId?: string | null;
}

export interface HoldInput {
  units: number;
  /** Idempotency key, e.g. `job:<jobId>:hold`. The same key never debits twice. */
  key: string;
  referenceType: string;
  referenceId: string;
  /** Shown on the Usage page next to the entry: the job name or "Website analysis: <host>". */
  referenceName?: string | null;
  actorUserId: string | null;
  description: string;
}

export interface SettleInput {
  holdKey: string;
  captureKey: string;
  releaseKey: string;
  /** Billable units produced; clamped to 0..held. */
  capturedUnits: number;
  description: string;
}

export interface SettleResult {
  /** False when no hold exists under holdKey (nothing to settle). */
  found: boolean;
  held: number;
  captured: number;
  released: number;
}

/**
 * Credits (PostgreSQL, authoritative). A hold debits the balance when work is queued; settling
 * records a capture (units 0, captured_units n, for reporting) and releases the unused h - n,
 * so a settled job costs exactly n. Every write holds a row lock on the organization's
 * billing_customers row and is idempotent by key, so retries, double submits and concurrent
 * holds can never double-charge or overdraw (docs/DATABASE_DESIGN.md section 4).
 */
@Injectable()
export class CreditsService {
  constructor(private readonly ledger: CreditLedgerRepository) {}

  /** Debits `units` now or throws INSUFFICIENT_CREDITS (402). Replays of the key return the original entry. */
  async hold(
    organizationId: string,
    input: HoldInput,
  ): Promise<{ entry: CreditLedger; replayed: boolean }> {
    if (!Number.isInteger(input.units) || input.units < 1)
      throw new Error("A hold needs at least 1 unit");
    return this.ledger.withLockedCustomer(organizationId, async (tx, customer) => {
      const existing = await this.ledger.findByKey(tx, input.key);
      if (existing) {
        if (existing.billingCustomerId !== customer.id || existing.entryType !== "hold")
          throw new Error("Idempotency key reused for another entry");
        return { entry: existing, replayed: true };
      }
      if (customer.balance < 0) {
        // Phase 6: a refund or reversal took back credits that were already spent. New work waits
        // until the balance is topped up (docs/DATABASE_DESIGN.md section 5).
        throw negativeBalanceError(customer.balance);
      }
      if (customer.balance < input.units) {
        throw new AppError(
          "INSUFFICIENT_CREDITS",
          `This needs ${input.units} credits; ${Math.max(0, customer.balance)} available.`,
          [
            { path: "credits.required", message: String(input.units) },
            { path: "credits.available", message: String(Math.max(0, customer.balance)) },
          ],
        );
      }
      const balance = customer.balance - input.units;
      const entry = await this.ledger.insert(tx, {
        id: newId(),
        billingCustomerId: customer.id,
        entryType: "hold",
        units: -input.units,
        balanceAfter: balance,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceName: input.referenceName?.slice(0, 200) ?? null,
        idempotencyKey: input.key,
        description: input.description,
        actorUserId: input.actorUserId,
      });
      await this.ledger.setBalance(tx, customer.id, balance);
      return { entry, replayed: false };
    });
  }

  /**
   * Captures `capturedUnits` (capped at the hold) and releases the rest. Idempotent: a second
   * call returns what the first recorded. A hold already closed by a full release (for example a
   * compensating release) is reported as released with nothing captured.
   */
  async settle(organizationId: string, input: SettleInput): Promise<SettleResult> {
    return this.ledger.withLockedCustomer(organizationId, async (tx, customer) => {
      const hold = await this.ledger.findByKey(tx, input.holdKey);
      if (!hold) return { found: false, held: 0, captured: 0, released: 0 };
      if (hold.entryType !== "hold" || hold.billingCustomerId !== customer.id)
        throw new Error("Not a hold of this organization");
      const held = -hold.units;
      const closing = await this.ledger.closingEntries(tx, hold.id);
      const capture = closing.find((e) => e.entryType === "capture") ?? null;
      const release = closing.find((e) => e.entryType === "release") ?? null;
      if (release && !capture) return { found: true, held, captured: 0, released: release.units };

      let balance = customer.balance;
      const captured = capture
        ? (capture.capturedUnits ?? 0)
        : Math.min(held, Math.max(0, Math.floor(input.capturedUnits)));
      if (!capture) {
        await this.ledger.insert(tx, {
          id: newId(),
          billingCustomerId: customer.id,
          entryType: "capture",
          units: 0,
          capturedUnits: captured,
          balanceAfter: balance,
          referenceType: hold.referenceType,
          referenceId: hold.referenceId,
          referenceName: hold.referenceName,
          holdId: hold.id,
          idempotencyKey: input.captureKey,
          description: input.description,
        });
      }
      // The capture closes the hold; a release row is written only when units go back
      // (a fully captured hold gets no 0-unit release since Phase 5).
      let released = release?.units ?? 0;
      if (!release && held - captured > 0) {
        released = held - captured;
        balance += released;
        await this.ledger.insert(tx, {
          id: newId(),
          billingCustomerId: customer.id,
          entryType: "release",
          units: released,
          balanceAfter: balance,
          referenceType: hold.referenceType,
          referenceId: hold.referenceId,
          referenceName: hold.referenceName,
          holdId: hold.id,
          idempotencyKey: input.releaseKey,
          description: input.description,
        });
        await this.ledger.setBalance(tx, customer.id, balance);
      }
      return { found: true, held, captured, released };
    });
  }

  /** Returns a whole open hold (compensation when queueing failed, or an orphan hold). */
  async releaseHold(
    organizationId: string,
    input: { holdKey: string; releaseKey: string; description: string },
  ): Promise<SettleResult> {
    return this.ledger.withLockedCustomer(organizationId, async (tx, customer) => {
      const hold = await this.ledger.findByKey(tx, input.holdKey);
      if (!hold) return { found: false, held: 0, captured: 0, released: 0 };
      if (hold.entryType !== "hold" || hold.billingCustomerId !== customer.id)
        throw new Error("Not a hold of this organization");
      const held = -hold.units;
      const closing = await this.ledger.closingEntries(tx, hold.id);
      if (closing.length > 0) {
        const capture = closing.find((e) => e.entryType === "capture");
        const release = closing.find((e) => e.entryType === "release");
        return {
          found: true,
          held,
          captured: capture?.capturedUnits ?? 0,
          released: release?.units ?? 0,
        };
      }
      const balance = customer.balance + held;
      await this.ledger.insert(tx, {
        id: newId(),
        billingCustomerId: customer.id,
        entryType: "release",
        units: held,
        balanceAfter: balance,
        referenceType: hold.referenceType,
        referenceId: hold.referenceId,
        referenceName: hold.referenceName,
        holdId: hold.id,
        idempotencyKey: input.releaseKey,
        description: input.description,
      });
      await this.ledger.setBalance(tx, customer.id, balance);
      return { found: true, held, captured: 0, released: held };
    });
  }

  /** Adds credits (development seed grants now; plan grants and purchases in Phase 6). Idempotent by key. */
  async grant(
    organizationId: string,
    input: {
      units: number;
      key: string;
      description: string;
      actorUserId?: string | null;
      entryType?: Extract<LedgerEntryType, "grant" | "purchase" | "adjustment">;
    },
  ): Promise<{ entry: CreditLedger; replayed: boolean }> {
    if (!Number.isInteger(input.units) || input.units < 1)
      throw new Error("A grant needs at least 1 unit");
    return this.ledger.withLockedCustomer(organizationId, async (tx, customer) => {
      const existing = await this.ledger.findByKey(tx, input.key);
      if (existing) return { entry: existing, replayed: true };
      const balance = customer.balance + input.units;
      const entry = await this.ledger.insert(tx, {
        id: newId(),
        billingCustomerId: customer.id,
        entryType: input.entryType ?? "grant",
        units: input.units,
        balanceAfter: balance,
        idempotencyKey: input.key,
        description: input.description,
        actorUserId: input.actorUserId ?? null,
      });
      await this.ledger.setBalance(tx, customer.id, balance);
      return { entry, replayed: false };
    });
  }

  /**
   * Runs `fn` in one PostgreSQL transaction holding the organization's billing customer row lock
   * (SELECT ... FOR UPDATE). Billing settles payments through this so the payment state change and
   * its ledger entry commit together.
   */
  withLockedCustomer<T>(
    organizationId: string,
    fn: (tx: LedgerTx, customer: LockedCustomer) => Promise<T>,
  ): Promise<T> {
    return this.ledger.withLockedCustomer(organizationId, fn);
  }

  /** Inside withLockedCustomer: adds units. Idempotent by key; updates `customer.balance`. */
  async creditInTx(
    tx: LedgerTx,
    customer: LockedCustomer,
    input: CreditInTxInput,
  ): Promise<{ entry: CreditLedger; replayed: boolean }> {
    if (!Number.isInteger(input.units) || input.units < 1)
      throw new Error("A credit needs at least 1 unit");
    const existing = await this.ledger.findByKey(tx, input.key);
    if (existing) {
      if (existing.billingCustomerId !== customer.id)
        throw new Error("Idempotency key reused for another customer");
      return { entry: existing, replayed: true };
    }
    const balance = customer.balance + input.units;
    const entry = await this.ledger.insert(tx, {
      id: newId(),
      billingCustomerId: customer.id,
      entryType: input.entryType,
      units: input.units,
      balanceAfter: balance,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceName: input.referenceName?.slice(0, 200) ?? null,
      idempotencyKey: input.key,
      description: input.description,
      actorUserId: input.actorUserId ?? null,
    });
    await this.ledger.setBalance(tx, customer.id, balance);
    customer.balance = balance;
    return { entry, replayed: false };
  }

  /** Inside withLockedCustomer: removes units, allowing a negative balance. Idempotent by key. */
  async debitInTx(
    tx: LedgerTx,
    customer: LockedCustomer,
    input: DebitInTxInput,
  ): Promise<{ entry: CreditLedger | null; replayed: boolean }> {
    if (!Number.isInteger(input.units) || input.units < 0)
      throw new Error("A debit needs a non-negative whole number of units");
    const existing = await this.ledger.findByKey(tx, input.key);
    if (existing) {
      if (existing.billingCustomerId !== customer.id)
        throw new Error("Idempotency key reused for another customer");
      return { entry: existing, replayed: true };
    }
    if (input.units === 0) return { entry: null, replayed: false };
    const balance = customer.balance - input.units;
    const entry = await this.ledger.insert(tx, {
      id: newId(),
      billingCustomerId: customer.id,
      entryType: input.entryType,
      units: -input.units,
      balanceAfter: balance,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceName: input.referenceName?.slice(0, 200) ?? null,
      idempotencyKey: input.key,
      description: input.description,
      actorUserId: input.actorUserId ?? null,
    });
    await this.ledger.setBalance(tx, customer.id, balance);
    customer.balance = balance;
    return { entry, replayed: false };
  }

  async balance(organizationId: string): Promise<CreditBalance> {
    const [customer, holds] = await Promise.all([
      this.ledger.customer(organizationId),
      this.ledger.openHolds(organizationId),
    ]);
    return {
      balance: customer?.creditBalance ?? 0,
      held: holds.held,
      openHolds: holds.count,
      updatedAt: (customer?.updatedAt ?? new Date()).toISOString(),
    };
  }

  async listLedger(
    organizationId: string,
    query: CreditLedgerQuery,
  ): Promise<{ items: CreditLedgerEntry[]; nextCursor: string | null }> {
    if (query.cursor && !UuidString.safeParse(query.cursor).success) {
      throw AppError.validation([
        { path: "cursor", message: "Invalid or expired cursor; start from the first page" },
      ]);
    }
    const page = await this.ledger.page(
      organizationId,
      {
        entryTypes: query.entryType,
        referenceType: query.referenceType,
        referenceId: query.referenceId,
      },
      { pageSize: query.pageSize, cursor: query.cursor ?? null },
    );
    return { items: page.items.map(toEntryView), nextCursor: page.nextCursor };
  }

  /** Captured (billed) units per UTC day and reference type in [from, to) (usage rollup). */
  capturedByDay(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ day: string; referenceType: string | null; units: number }>> {
    return this.ledger.capturedByDay(organizationId, from, to);
  }

  /** Invariant check used by tests and reconciliation: ledger sum equals the cached balance. */
  invariant(organizationId: string): Promise<{ sum: number; cached: number }> {
    return this.ledger.ledgerSum(organizationId);
  }

  /** Open holds older than `cutoff`; `filter.only` or `filter.exclude` select reference types. */
  orphanHolds(
    cutoff: Date,
    limit = 200,
    filter: { only?: string; exclude?: string[] } = {},
  ): Promise<OpenHoldRow[]> {
    return this.ledger.findOpenHoldsOlderThan(cutoff, limit, filter);
  }

  recordReconciliation(run: {
    startedAt: Date;
    finishedAt: Date;
    checked: number;
    fixed: number;
    errors: unknown[];
  }): Promise<void> {
    return this.ledger.recordRun({ id: newId(), ...run });
  }
}

/** 402 CREDIT_BALANCE_NEGATIVE: new holds wait until a negative balance is topped up. */
export function negativeBalanceError(balance: number): AppError {
  return new AppError(
    "CREDIT_BALANCE_NEGATIVE",
    `The credit balance is ${balance} after a refund or reversal. Buy credits to bring it above zero before starting new work.`,
    [{ path: "credits.balance", message: String(balance) }],
  );
}

function toEntryView(e: CreditLedger): CreditLedgerEntry {
  return {
    id: e.id,
    entryType: e.entryType,
    units: e.units,
    capturedUnits: e.capturedUnits,
    balanceAfter: e.balanceAfter,
    referenceType: e.referenceType,
    referenceId: e.referenceId,
    referenceName: e.referenceName,
    holdId: e.holdId,
    description: e.description,
    actorUserId: e.actorUserId,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Ledger idempotency keys for a discovery job round (round 0 uses the plain job keys). */
export function jobCreditKeys(
  jobId: string,
  round: number,
): { hold: string; capture: string; release: string } {
  const base = round === 0 ? `job:${jobId}` : `job:${jobId}:retry:${round}`;
  return { hold: `${base}:hold`, capture: `${base}:capture`, release: `${base}:release` };
}

/** Ledger idempotency keys for one website analysis (1 credit: hold at queue, capture or release at the end). */
export function analysisCreditKeys(analysisId: string): {
  hold: string;
  capture: string;
  release: string;
} {
  return {
    hold: `analysis:${analysisId}:hold`,
    capture: `analysis:${analysisId}:capture`,
    release: `analysis:${analysisId}:release`,
  };
}
