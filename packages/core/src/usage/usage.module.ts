import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module.js";
import { DiscoveryModule } from "../discovery/discovery.module.js";
import { EnrichmentModule } from "../enrichment/enrichment.module.js";
import { ExportsModule } from "../exports/exports.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { UsageService } from "./usage.service.js";
import { UsageDailyRepository } from "./repositories/usage-daily.repository.js";

/** Usage aggregates (PostgreSQL usage_daily) for the Usage page. */
@Module({
  imports: [CreditsModule, DiscoveryModule, EnrichmentModule, ExportsModule, OrganizationsModule],
  providers: [UsageService, UsageDailyRepository],
  exports: [UsageService],
})
export class UsageModule {}
