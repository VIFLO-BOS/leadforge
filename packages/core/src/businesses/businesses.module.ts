import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { ProvenanceModule } from "../provenance/provenance.module.js";
import { OvertureModule } from "../overture/overture.module.js";
import { BusinessesService } from "./businesses.service.js";
import { BusinessRepository } from "./repositories/business.repository.js";
import { ActiveAnalysisRepository } from "./repositories/active-analysis.repository.js";
import { SuppressionRepository } from "./repositories/suppression.repository.js";

/**
 * Canonical business profiles, field states, corrections and suppression.
 * Owns businesses and suppression_entries; reads provenance through ProvenanceService.
 */
@Module({
  imports: [ProvenanceModule, OrganizationsModule, OvertureModule],
  providers: [
    BusinessesService,
    BusinessRepository,
    SuppressionRepository,
    ActiveAnalysisRepository,
  ],
  exports: [BusinessesService],
})
export class BusinessesModule {}
