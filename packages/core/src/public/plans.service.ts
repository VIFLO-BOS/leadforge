import { Injectable } from "@nestjs/common";
import type { PublicPlansResponse } from "@leadforge/contracts";
import { PrismaService } from "@leadforge/db-postgres";

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(): Promise<PublicPlansResponse> {
    const [plans, packs] = await Promise.all([
      this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      this.prisma.creditPack.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    const anyPlaceholder = plans.some((p) => p.isPlaceholder) || packs.some((p) => p.isPlaceholder);
    return {
      plans: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        interval: p.interval,
        priceMinor: Number(p.priceMinor),
        currency: p.currency,
        includedCredits: p.includedCredits,
        maxMembers: p.maxMembers,
        exportRowCap: p.exportRowCap,
        isPlaceholder: p.isPlaceholder,
      })),
      creditPacks: packs.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        credits: p.credits,
        priceMinor: Number(p.priceMinor),
        currency: p.currency,
        isPlaceholder: p.isPlaceholder,
      })),
      pricingPublished: plans.length > 0 && !anyPlaceholder,
    };
  }
}
