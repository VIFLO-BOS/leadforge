/**
 * Development seed for billing: plans and credit packs from the billing catalogue configuration
 * (BILLING_CATALOGUE_PATH, or the built-in placeholder catalogue whose prices are all 0 and
 * flagged is_placeholder), and development entitlement overrides for the seeded organization
 * so local flows are not blocked by the free tier (member cap 25, discovery and analysis on).
 * The overrides are `override` rows, visible as such on the Billing page; no subscription or
 * payment is invented. Refuses to run in production.
 */
import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  BillingCatalogueService,
  BillingModule,
  CoreModule,
  EntitlementsModule,
  EntitlementsService,
  ENTITLEMENT_KEYS,
  loadBillingCatalogue,
} from "@leadforge/core";

export const DEV_MAX_MEMBERS = 25;

@Module({})
class BillingSeedModule {
  static forRoot(): DynamicModule {
    return {
      module: BillingSeedModule,
      imports: [CoreModule.forRoot(process.env), BillingModule, EntitlementsModule],
    };
  }
}

export async function seedBilling(organizationId: string): Promise<string[]> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to seed billing in production; use pnpm billing:catalogue");
  const app = await NestFactory.createApplicationContext(BillingSeedModule.forRoot(), {
    logger: ["error", "warn"],
  });
  try {
    const catalogue = loadBillingCatalogue(process.env.BILLING_CATALOGUE_PATH);
    const report = await app.get(BillingCatalogueService, { strict: false }).sync(catalogue);
    const entitlements = app.get(EntitlementsService, { strict: false });
    await entitlements.setOverride(organizationId, {
      key: ENTITLEMENT_KEYS.maxMembers,
      valueInt: DEV_MAX_MEMBERS,
    });
    await entitlements.setOverride(organizationId, {
      key: ENTITLEMENT_KEYS.discoveryEnabled,
      valueBool: true,
    });
    await entitlements.setOverride(organizationId, {
      key: ENTITLEMENT_KEYS.websiteAnalysisEnabled,
      valueBool: true,
    });
    return [
      `Plans: ${catalogue.plans.length} (${report.plans.created} created, ${report.plans.updated} updated); credit packs: ${catalogue.creditPacks.length}`,
      `${report.placeholders} catalogue entries are placeholders (pricing not published)`,
      `Development entitlement overrides: up to ${DEV_MAX_MEMBERS} members, discovery and website analysis on`,
    ];
  } finally {
    await app.close();
  }
}
