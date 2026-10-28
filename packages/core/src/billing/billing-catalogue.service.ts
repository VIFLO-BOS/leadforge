import { Injectable } from "@nestjs/common";
import { newId, PrismaService } from "@leadforge/db-postgres";
import type { BillingCatalogueConfig } from "./catalogue.js";

export interface CatalogueSyncReport {
  plans: { created: number; updated: number };
  creditPacks: { created: number; updated: number };
  placeholders: number;
}

/**
 * Upserts plans and credit packs from configuration by `code` (seed and `pnpm billing:catalogue`).
 * The provider plan code is never touched: an existing Paystack plan keeps charging what it was
 * created with, so changing a published plan's price needs a new plan code (docs/DEVELOPMENT.md).
 * Codes missing from the configuration are left alone (deactivate them with `isActive: false`).
 */
@Injectable()
export class BillingCatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(config: BillingCatalogueConfig): Promise<CatalogueSyncReport> {
    const report: CatalogueSyncReport = {
      plans: { created: 0, updated: 0 },
      creditPacks: { created: 0, updated: 0 },
      placeholders: 0,
    };
    for (const p of config.plans) {
      const data = {
        name: p.name,
        description: p.description,
        interval: p.interval,
        priceMinor: BigInt(p.priceMinor),
        currency: p.currency,
        includedCredits: p.includedCredits,
        maxMembers: p.maxMembers,
        exportRowCap: p.exportRowCap,
        discoveryEnabled: p.discoveryEnabled,
        websiteAnalysisEnabled: p.websiteAnalysisEnabled,
        isActive: p.isActive,
        isPlaceholder: p.isPlaceholder,
        sortOrder: p.sortOrder,
      };
      const existing = await this.prisma.plan.findUnique({
        where: { code: p.code },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.plan.update({ where: { code: p.code }, data });
        report.plans.updated++;
      } else {
        await this.prisma.plan.create({ data: { id: newId(), code: p.code, ...data } });
        report.plans.created++;
      }
      if (p.isPlaceholder) report.placeholders++;
    }
    for (const c of config.creditPacks) {
      const data = {
        name: c.name,
        credits: c.credits,
        priceMinor: BigInt(c.priceMinor),
        currency: c.currency,
        isActive: c.isActive,
        isPlaceholder: c.isPlaceholder,
        sortOrder: c.sortOrder,
      };
      const existing = await this.prisma.creditPack.findUnique({
        where: { code: c.code },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.creditPack.update({ where: { code: c.code }, data });
        report.creditPacks.updated++;
      } else {
        await this.prisma.creditPack.create({ data: { id: newId(), code: c.code, ...data } });
        report.creditPacks.created++;
      }
      if (c.isPlaceholder) report.placeholders++;
    }
    return report;
  }
}
