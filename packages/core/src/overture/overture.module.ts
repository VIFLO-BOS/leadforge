import { Module } from "@nestjs/common";
import { OvertureCatalogService } from "./overture-catalog.service.js";
import { DataLicensesService } from "./data-licenses.service.js";
import { OvertureSyncService } from "./overture-sync.service.js";
import { OverturePlaceRepository } from "./repositories/overture-place.repository.js";
import { OvertureSyncRunRepository } from "./repositories/overture-sync-run.repository.js";

/**
 * Overture Maps Places staging catalogue: the monthly sync (loads a release into
 * `overture_places`, records `overture_sync_runs`) and the catalogue discovery reads (snapshot
 * state, categories, states and LGAs). Reading the release files (DuckDB) lives in apps/worker.
 */
@Module({
  providers: [
    OverturePlaceRepository,
    OvertureSyncRunRepository,
    OvertureSyncService,
    OvertureCatalogService,
    DataLicensesService,
  ],
  exports: [
    OverturePlaceRepository,
    OvertureSyncService,
    OvertureCatalogService,
    DataLicensesService,
  ],
})
export class OvertureModule {}
