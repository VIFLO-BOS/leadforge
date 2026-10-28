import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import {
  ENV,
  OvertureSyncService,
  resolveStacRelease,
  type OvertureSyncRunDocument,
} from "@leadforge/core";
import {
  openDuckDbSnapshot,
  remoteSnapshotInput,
  type DuckDbSnapshotInput,
} from "./duckdb-snapshot.js";

export type OvertureSyncOutcome =
  | { status: "loaded"; run: OvertureSyncRunDocument }
  | { status: "skipped"; release: string; reason: string };

/**
 * Decides what to load and loads it: a local Parquet file when OVERTURE_LOCAL_PLACES_PATH is set
 * (development only; the env schema refuses it in production), otherwise the latest release named
 * by the STAC catalogue, read from AWS (Azure as the fallback). A release that already loaded is
 * skipped unless forced, so the daily schedule costs one small STAC request on most days.
 */
@Injectable()
export class OvertureSyncRunner {
  constructor(
    private readonly sync: OvertureSyncService,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  async run(options: {
    trigger: OvertureSyncRunDocument["trigger"];
    force?: boolean;
    release?: string;
  }): Promise<OvertureSyncOutcome> {
    // Close runs left `running` by a stopped process first, even when this attempt then skips.
    await this.sync.expireStaleRuns();
    if (this.env.OVERTURE_LOCAL_PLACES_PATH && this.env.OVERTURE_LOCAL_DIVISIONS_PATH) {
      if (this.env.NODE_ENV === "production")
        throw new Error("Local Overture files are refused in production");
      const input: DuckDbSnapshotInput = {
        kind: "local",
        placesFiles: [this.env.OVERTURE_LOCAL_PLACES_PATH],
        divisionFiles: [this.env.OVERTURE_LOCAL_DIVISIONS_PATH],
        release: options.release ?? this.env.OVERTURE_LOCAL_RELEASE ?? null,
        schemaVersion: null,
        location: `local file ${this.env.OVERTURE_LOCAL_PLACES_PATH}`,
        countRows: true,
      };
      const snapshot = await this.open(input);
      if (!options.force && (await this.sync.loadedForRelease(snapshot.release))) {
        await snapshot.close?.();
        return {
          status: "skipped",
          release: snapshot.release,
          reason: `Release ${snapshot.release} is already loaded (use --force to reload)`,
        };
      }
      return {
        status: "loaded",
        run: await this.sync.load(snapshot, { trigger: options.trigger, force: options.force }),
      };
    }

    const stac = await resolveStacRelease(this.env.OVERTURE_STAC_URL, { release: options.release });
    if (!options.force && (await this.sync.loadedForRelease(stac.release))) {
      return {
        status: "skipped",
        release: stac.release,
        reason: `Release ${stac.release} is already loaded`,
      };
    }
    let snapshot;
    try {
      snapshot = await this.open(remoteSnapshotInput(stac, "aws"));
    } catch (err) {
      this.logger.warn(
        { err, release: stac.release },
        "Reading the release from AWS failed; trying the Azure mirror",
      );
      snapshot = await this.open(remoteSnapshotInput(stac, "azure"));
    }
    const run = await this.sync.load(snapshot, { trigger: options.trigger, force: options.force });
    if (run.status === "failed")
      throw new Error(`Overture sync of ${stac.release} failed: ${run.error ?? "unknown error"}`);
    return { status: "loaded", run };
  }

  /** Opens the snapshot with a log line before and after: remote division and footer reads can take minutes. */
  private async open(input: DuckDbSnapshotInput) {
    const started = Date.now();
    this.logger.log(
      {
        release: input.release,
        location: input.location,
        placesFiles: input.placesFiles.length,
        divisionFiles: input.divisionFiles.length,
      },
      "Opening Overture snapshot",
    );
    const snapshot = await openDuckDbSnapshot(input);
    this.logger.log(
      {
        release: snapshot.release,
        divisions: snapshot.divisions.length,
        expectedRows: snapshot.expectedRows,
        seconds: Math.round((Date.now() - started) / 1000),
      },
      "Overture snapshot open",
    );
    return snapshot;
  }
}
