import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { CoreModule, OvertureModule } from "@leadforge/core";
import { OvertureSyncRunner } from "../overture/overture-sync.runner.js";

/**
 * Loads an Overture Maps Places release into the staging catalogue, outside the queue:
 *
 *   pnpm overture:sync                      latest release from the STAC catalogue (skips one already loaded)
 *   pnpm overture:sync --force              reload even if loaded; also retires places past the 5% safety limit
 *   pnpm overture:sync --release=2026-10-21.0
 *
 * With OVERTURE_LOCAL_PLACES_PATH and OVERTURE_LOCAL_DIVISIONS_PATH set (development only), the
 * local Parquet files are loaded instead. Uses MONGODB_URI, MONGODB_DB and REDIS_URL like the worker.
 */
@Module({})
class OvertureCliModule {
  static forRoot(): DynamicModule {
    return {
      module: OvertureCliModule,
      imports: [CoreModule.forRoot(process.env), OvertureModule],
      providers: [OvertureSyncRunner],
    };
  }
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(OvertureCliModule.forRoot(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await app.init();
  const started = Date.now();
  try {
    const outcome = await app
      .get(OvertureSyncRunner)
      .run({ trigger: "manual", force: process.argv.includes("--force"), release: arg("release") });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (outcome.status === "skipped") {
      process.stdout.write(`Overture sync skipped: ${outcome.reason} (${seconds} s)\n`);
    } else {
      const { run } = outcome;
      process.stdout.write(
        [
          `Overture sync ${run.status}: release ${run.release} from ${run.origin.kind} in ${seconds} s`,
          `  read ${run.counts.read}, invalid ${run.counts.invalid}, inserted ${run.counts.inserted}, updated ${run.counts.updated}, unchanged ${run.counts.unchanged}, retired ${run.counts.retired}, restored ${run.counts.restored}`,
          `  live ${run.counts.live}, offerable ${run.counts.offerable}, duplicate groups ${run.counts.duplicateGroups} (hiding ${run.counts.duplicatesHidden}), without state ${run.counts.withoutState}, without LGA ${run.counts.withoutLga}`,
          ...run.warnings.map((w) => `  warning: ${w}`),
          ...(run.error ? [`  error: ${run.error}`] : []),
        ].join("\n") + "\n",
      );
      if (run.status === "failed") process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
