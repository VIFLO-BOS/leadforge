import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@leadforge/db-postgres";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { freeTierEntitlements } from "../billing/catalogue.js";
import {
  EntitlementRepository,
  type EntitlementRow,
  type EntitlementValue,
} from "./repositories/entitlement.repository.js";

/** Entitlement keys (docs/DATABASE_DESIGN.md section 6). */
export const ENTITLEMENT_KEYS = {
  exportRowCap: "export_row_cap",
  maxMembers: "max_members",
  discoveryEnabled: "discovery_enabled",
  websiteAnalysisEnabled: "website_analysis_enabled",
  monthlyIncludedCredits: "monthly_included_credits",
} as const;

export type EntitlementSource = "plan" | "override" | "default";

export interface ResolvedEntitlements {
  maxMembers: number;
  exportRowCap: number;
  discoveryEnabled: boolean;
  websiteAnalysisEnabled: boolean;
  monthlyIncludedCredits: number;
  sources: {
    maxMembers: EntitlementSource;
    exportRowCap: EntitlementSource;
    discoveryEnabled: EntitlementSource;
    websiteAnalysisEnabled: EntitlementSource;
    monthlyIncludedCredits: EntitlementSource;
  };
}

/** The plan fields entitlements derive from (a Prisma Plan row satisfies it). */
export interface EntitlementPlan {
  maxMembers: number;
  exportRowCap: number;
  discoveryEnabled: boolean;
  websiteAnalysisEnabled: boolean;
  includedCredits: number;
}

/**
 * Plan-dependent limits. Phase 6 writes `entitlements` rows from the live subscription's plan,
 * or the free tier without one (on plan change, cancellation and expiry); an `override` row wins
 * over a `plan` row; a key with no row falls back to the free-tier default from the environment.
 * Enforced server-side: member cap (invitations, acceptance, reactivation), discovery and website
 * analysis switches, async export row cap.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly repo: EntitlementRepository,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private static pick(rows: EntitlementRow[]): EntitlementRow | null {
    return (
      rows.find((r) => r.source === "override") ?? rows.find((r) => r.source === "plan") ?? null
    );
  }

  /** Free-tier values (no subscription). */
  freeTier() {
    return freeTierEntitlements(this.env);
  }

  /** Rows a plan (or the free tier, for null) derives. */
  derive(plan: EntitlementPlan | null): EntitlementValue[] {
    const v = plan
      ? {
          maxMembers: plan.maxMembers,
          exportRowCap: plan.exportRowCap,
          discoveryEnabled: plan.discoveryEnabled,
          websiteAnalysisEnabled: plan.websiteAnalysisEnabled,
          monthlyIncludedCredits: plan.includedCredits,
        }
      : this.freeTier();
    return [
      { key: ENTITLEMENT_KEYS.maxMembers, valueInt: v.maxMembers },
      { key: ENTITLEMENT_KEYS.exportRowCap, valueInt: v.exportRowCap },
      { key: ENTITLEMENT_KEYS.discoveryEnabled, valueBool: v.discoveryEnabled },
      { key: ENTITLEMENT_KEYS.websiteAnalysisEnabled, valueBool: v.websiteAnalysisEnabled },
      { key: ENTITLEMENT_KEYS.monthlyIncludedCredits, valueInt: v.monthlyIncludedCredits },
    ];
  }

  /** Recalculation inside the caller's transaction (the same one that changes the subscription). */
  writeForPlanInTx(
    tx: Prisma.TransactionClient,
    billingCustomerId: string,
    plan: EntitlementPlan | null,
    now: Date = new Date(),
  ): Promise<void> {
    return this.repo.replacePlanRows(tx, billingCustomerId, this.derive(plan), now);
  }

  /** Sets an override row (development seed, support). */
  async setOverride(organizationId: string, value: EntitlementValue): Promise<void> {
    const customer = await this.repo.customerIdOf(organizationId);
    if (!customer) throw new Error(`No billing customer for organization ${organizationId}`);
    await this.repo.setOverride(customer.id, value);
  }

  async resolve(organizationId: string, now: Date = new Date()): Promise<ResolvedEntitlements> {
    const rows = await this.repo.currentAll(organizationId, now);
    const free = this.freeTier();
    const of = (key: string) => EntitlementsService.pick(rows.filter((r) => r.key === key));
    const int = (key: string, fallback: number): [number, EntitlementSource] => {
      const row = of(key);
      return row && row.valueInt !== null && row.valueInt >= 0
        ? [row.valueInt, row.source]
        : [fallback, "default"];
    };
    const bool = (key: string, fallback: boolean): [boolean, EntitlementSource] => {
      const row = of(key);
      return row && row.valueBool !== null ? [row.valueBool, row.source] : [fallback, "default"];
    };
    const [maxMembers, sMembers] = int(ENTITLEMENT_KEYS.maxMembers, free.maxMembers);
    const [exportRowCap, sExport] = int(ENTITLEMENT_KEYS.exportRowCap, free.exportRowCap);
    const [discoveryEnabled, sDiscovery] = bool(
      ENTITLEMENT_KEYS.discoveryEnabled,
      free.discoveryEnabled,
    );
    const [websiteAnalysisEnabled, sAnalysis] = bool(
      ENTITLEMENT_KEYS.websiteAnalysisEnabled,
      free.websiteAnalysisEnabled,
    );
    const [monthlyIncludedCredits, sCredits] = int(
      ENTITLEMENT_KEYS.monthlyIncludedCredits,
      free.monthlyIncludedCredits,
    );
    return {
      maxMembers: Math.max(1, maxMembers),
      exportRowCap: exportRowCap > 0 ? exportRowCap : free.exportRowCap,
      discoveryEnabled,
      websiteAnalysisEnabled,
      monthlyIncludedCredits,
      sources: {
        maxMembers: sMembers,
        exportRowCap: sExport,
        discoveryEnabled: sDiscovery,
        websiteAnalysisEnabled: sAnalysis,
        monthlyIncludedCredits: sCredits,
      },
    };
  }

  /** Rows one asynchronous export may contain. */
  async exportRowCap(organizationId: string, now: Date = new Date()): Promise<number> {
    const row = EntitlementsService.pick(
      await this.repo.current(organizationId, ENTITLEMENT_KEYS.exportRowCap, now),
    );
    return row?.valueInt && row.valueInt > 0 ? row.valueInt : this.env.EXPORT_DEFAULT_ROW_CAP;
  }

  /** Active members (plus live invitations, when inviting) the organization may have. */
  async maxMembers(organizationId: string, now: Date = new Date()): Promise<number> {
    const row = EntitlementsService.pick(
      await this.repo.current(organizationId, ENTITLEMENT_KEYS.maxMembers, now),
    );
    return row?.valueInt && row.valueInt > 0 ? row.valueInt : this.freeTier().maxMembers;
  }

  private async flag(organizationId: string, key: string, fallback: boolean): Promise<boolean> {
    const row = EntitlementsService.pick(await this.repo.current(organizationId, key, new Date()));
    return row && row.valueBool !== null ? row.valueBool : fallback;
  }

  discoveryEnabled(organizationId: string): Promise<boolean> {
    return this.flag(
      organizationId,
      ENTITLEMENT_KEYS.discoveryEnabled,
      this.freeTier().discoveryEnabled,
    );
  }

  websiteAnalysisEnabled(organizationId: string): Promise<boolean> {
    return this.flag(
      organizationId,
      ENTITLEMENT_KEYS.websiteAnalysisEnabled,
      this.freeTier().websiteAnalysisEnabled,
    );
  }

  /** 402 ENTITLEMENT_REQUIRED when the plan does not include discovery. */
  async assertDiscoveryEnabled(organizationId: string): Promise<void> {
    if (!(await this.discoveryEnabled(organizationId)))
      throw entitlementRequired(
        ENTITLEMENT_KEYS.discoveryEnabled,
        "Your plan does not include discovery. Change the plan on the Billing page.",
      );
  }

  /** 402 ENTITLEMENT_REQUIRED when the plan does not include website analysis. */
  async assertWebsiteAnalysisEnabled(organizationId: string): Promise<void> {
    if (!(await this.websiteAnalysisEnabled(organizationId))) {
      throw entitlementRequired(
        ENTITLEMENT_KEYS.websiteAnalysisEnabled,
        "Your plan does not include website analysis. Change the plan on the Billing page.",
      );
    }
  }
}

export function entitlementRequired(key: string, message: string): AppError {
  return new AppError("ENTITLEMENT_REQUIRED", message, [{ path: "entitlement", message: key }]);
}

/** 402 MEMBER_LIMIT_REACHED with the cap and current use. */
export function memberLimitReached(cap: number, used: number): AppError {
  return new AppError(
    "MEMBER_LIMIT_REACHED",
    `Your plan allows ${cap} members (including pending invitations); ${used} are in use. Remove a member, revoke an invitation or change the plan.`,
    [
      { path: "members.cap", message: String(cap) },
      { path: "members.used", message: String(used) },
    ],
  );
}
