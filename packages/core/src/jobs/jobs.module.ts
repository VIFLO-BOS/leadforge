import { Module } from "@nestjs/common";
import { DiscoveryModule } from "../discovery/discovery.module.js";
import { ImportsModule } from "../imports/imports.module.js";
import { WebsiteAnalysisModule } from "../website-analysis/website-analysis.module.js";
import { EnrichmentModule } from "../enrichment/enrichment.module.js";
import { ExportsModule } from "../exports/exports.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { JobsService } from "./jobs.service.js";

/** The all-jobs listing across job kinds. */
@Module({
  imports: [
    DiscoveryModule,
    ImportsModule,
    WebsiteAnalysisModule,
    EnrichmentModule,
    ExportsModule,
    CrmModule,
  ],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
