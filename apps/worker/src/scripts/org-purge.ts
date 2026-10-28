import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { UuidString } from "@leadforge/contracts";
import { CoreModule, OrganizationLifecycleModule, OrganizationPurgeService } from "@leadforge/core";

/**
 * Operator tool for the organization purge (docs/OPERATIONS.md, "Organization deletion"):
 *
 *   pnpm org:purge <organizationId> --reapply     run every purge step again (after restoring an older backup)
 *   pnpm org:purge <organizationId>               resume a purge past its grace period now, instead of waiting for the scan
 *
 * Ids come from the erasure receipts in object storage (`erasures/<organizationId>.json`) or the
 * `organization_erasures` table. Prints only ids, statuses and counts. Uses the worker's environment
 * (DATABASE_URL, MONGODB_URI, MONGODB_DB, REDIS_URL, OBJECT_STORAGE_*, PAYSTACK_*).
 */
@Module({})
class PurgeCliModule {
  static forRoot(): DynamicModule {
    return {
      module: PurgeCliModule,
      imports: [CoreModule.forRoot(process.env), OrganizationLifecycleModule],
    };
  }
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const reapply = process.argv.includes("--reapply");
  if (ids.length === 0 || ids.some((id) => !UuidString.safeParse(id).success)) {
    throw new Error("Usage: pnpm org:purge <organizationId> [more ids] [--reapply]");
  }
  const app = await NestFactory.createApplicationContext(PurgeCliModule.forRoot(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await app.init();
  try {
    const purge = app.get(OrganizationPurgeService);
    for (const id of ids) {
      const outcome = await purge.purge(id, { trigger: reapply ? "reapply" : "schedule" });
      process.stdout.write(`${JSON.stringify(outcome)}\n`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
