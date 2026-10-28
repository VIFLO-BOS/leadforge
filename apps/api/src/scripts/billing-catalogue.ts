/**
 * `pnpm billing:catalogue`: upserts plans and credit packs from BILLING_CATALOGUE_PATH (a JSON
 * file with the shape of DEFAULT_BILLING_CATALOGUE in packages/core/src/billing/catalogue.ts),
 * or the built-in placeholder catalogue when it is unset. Safe in any environment: it never
 * deletes, never touches provider plan codes, and prints what it changed.
 */
import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  BillingCatalogueService,
  BillingModule,
  CoreModule,
  loadBillingCatalogue,
} from "@leadforge/core";

@Module({})
class CatalogueModule {
  static forRoot(): DynamicModule {
    return { module: CatalogueModule, imports: [CoreModule.forRoot(process.env), BillingModule] };
  }
}

async function main(): Promise<void> {
  const path = process.env.BILLING_CATALOGUE_PATH;
  const catalogue = loadBillingCatalogue(path);
  const app = await NestFactory.createApplicationContext(CatalogueModule.forRoot(), {
    logger: ["error", "warn"],
  });
  try {
    const report = await app.get(BillingCatalogueService, { strict: false }).sync(catalogue);
    process.stdout.write(
      `Billing catalogue synced from ${path ?? "the built-in placeholder catalogue"}.\n` +
        `  Plans: ${report.plans.created} created, ${report.plans.updated} updated\n` +
        `  Credit packs: ${report.creditPacks.created} created, ${report.creditPacks.updated} updated\n` +
        `  Placeholders (pricing not published): ${report.placeholders}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
