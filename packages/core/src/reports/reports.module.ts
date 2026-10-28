import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { ImportsModule } from "../imports/imports.module.js";
import { DiscoveryModule } from "../discovery/discovery.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { WebsiteAnalysisModule } from "../website-analysis/website-analysis.module.js";
import { EnrichmentModule } from "../enrichment/enrichment.module.js";
import { ExportsModule } from "../exports/exports.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { ReportsService } from "./reports.service.js";

@Module({
  imports: [
    BusinessesModule,
    ImportsModule,
    DiscoveryModule,
    CreditsModule,
    WebsiteAnalysisModule,
    EnrichmentModule,
    ExportsModule,
    OrganizationsModule,
    JobsModule,
    CrmModule,
  ],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
