import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { ProvenanceModule } from "../provenance/provenance.module.js";
import { SafeFetchModule } from "../safe-fetch/safe-fetch.module.js";
import { WebsiteAnalysisModule } from "../website-analysis/website-analysis.module.js";
import { EnrichmentQueueHandler } from "./enrichment.queue-handler.js";
import { EnrichmentRunner } from "./enrichment.runner.js";
import { EnrichmentService } from "./enrichment.service.js";
import { EnrichmentRunRepository } from "./repositories/enrichment-run.repository.js";

/**
 * Contact enrichment: website contacts extraction, email checks, and the per-business refresh
 * (which also requests a website analysis). Owns enrichment_runs; writes businesses through
 * BusinessesService and verification events through ProvenanceService.
 */
@Module({
  imports: [
    BusinessesModule,
    OrganizationsModule,
    ProvenanceModule,
    SafeFetchModule,
    WebsiteAnalysisModule,
  ],
  providers: [EnrichmentService, EnrichmentRunner, EnrichmentQueueHandler, EnrichmentRunRepository],
  exports: [EnrichmentService, EnrichmentRunner, EnrichmentQueueHandler],
})
export class EnrichmentModule {}
