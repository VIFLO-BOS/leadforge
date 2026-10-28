import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Plans and credit packs as configuration (Phase 6). `pnpm db:seed` (development) and
 * `pnpm billing:catalogue` (any environment) upsert these rows by `code`.
 *
 * Prices are NOT decided yet. Every entry ships with `isPlaceholder: true` and a price of 0, so
 * nothing invented is ever shown or charged as final: the pricing page shows "Pricing not yet
 * published" while any placeholder is active, and checkout refuses a zero or placeholder price on
 * a live key (PRICE_NOT_PUBLISHED). Real prices go into a JSON file named by
 * BILLING_CATALOGUE_PATH (same shape as below) once they are approved; set `isPlaceholder: false`
 * there. Test-mode runs may use a JSON file with test prices (still flagged placeholders).
 *
 * The plan limits below (credits, members, export rows) came with the Phase 1 seed and are
 * placeholders as well, pending the pricing decision (docs/PRODUCT_REQUIREMENTS.md section 8).
 */

export const CataloguePlan = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(300).nullable().default(null),
  interval: z.enum(["monthly", "yearly"]),
  /** Minor units (kobo). 0 means not priced yet. */
  priceMinor: z.number().int().min(0),
  currency: z.string().length(3).default("NGN"),
  includedCredits: z.number().int().min(0),
  maxMembers: z.number().int().min(1),
  exportRowCap: z.number().int().min(1),
  discoveryEnabled: z.boolean().default(true),
  websiteAnalysisEnabled: z.boolean().default(true),
  isPlaceholder: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type CataloguePlan = z.infer<typeof CataloguePlan>;

export const CataloguePack = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  name: z.string().min(1).max(60),
  credits: z.number().int().min(1),
  priceMinor: z.number().int().min(0),
  currency: z.string().length(3).default("NGN"),
  isPlaceholder: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type CataloguePack = z.infer<typeof CataloguePack>;

export const BillingCatalogueConfig = z.object({
  plans: z.array(CataloguePlan),
  creditPacks: z.array(CataloguePack),
});
export type BillingCatalogueConfig = z.infer<typeof BillingCatalogueConfig>;

const PLACEHOLDER_PLAN_TEXT = "Placeholder plan. Pricing has not been published.";

/** Default catalogue: every price is an unpublished placeholder (0). */
export const DEFAULT_BILLING_CATALOGUE: BillingCatalogueConfig = BillingCatalogueConfig.parse({
  plans: [
    {
      code: "starter",
      name: "Starter",
      description: PLACEHOLDER_PLAN_TEXT,
      interval: "monthly",
      priceMinor: 0,
      includedCredits: 200,
      maxMembers: 2,
      exportRowCap: 1000,
      sortOrder: 1,
    },
    {
      code: "growth",
      name: "Growth",
      description: PLACEHOLDER_PLAN_TEXT,
      interval: "monthly",
      priceMinor: 0,
      includedCredits: 2000,
      maxMembers: 10,
      exportRowCap: 25000,
      sortOrder: 2,
    },
    {
      code: "scale",
      name: "Scale",
      description: PLACEHOLDER_PLAN_TEXT,
      interval: "monthly",
      priceMinor: 0,
      includedCredits: 10000,
      maxMembers: 50,
      exportRowCap: 250000,
      sortOrder: 3,
    },
  ],
  creditPacks: [
    { code: "credits-500", name: "500 credits", credits: 500, priceMinor: 0, sortOrder: 1 },
    { code: "credits-2000", name: "2,000 credits", credits: 2000, priceMinor: 0, sortOrder: 2 },
    { code: "credits-10000", name: "10,000 credits", credits: 10000, priceMinor: 0, sortOrder: 3 },
  ],
});

/** The catalogue from BILLING_CATALOGUE_PATH (JSON), or the placeholder default. */
export function loadBillingCatalogue(path: string | undefined): BillingCatalogueConfig {
  if (!path) return DEFAULT_BILLING_CATALOGUE;
  const parsed = BillingCatalogueConfig.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `Invalid billing catalogue ${path}:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  return parsed.data;
}

/**
 * Entitlements without a subscription (the free tier). Discovery and analysis stay on because
 * they are paid per use with credits (credit packs can be bought without a plan).
 */
export function freeTierEntitlements(env: {
  BILLING_FREE_MAX_MEMBERS: number;
  EXPORT_DEFAULT_ROW_CAP: number;
}) {
  return {
    maxMembers: env.BILLING_FREE_MAX_MEMBERS,
    exportRowCap: env.EXPORT_DEFAULT_ROW_CAP,
    discoveryEnabled: true,
    websiteAnalysisEnabled: true,
    monthlyIncludedCredits: 0,
  };
}
