import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { SafeFetchModule } from "../safe-fetch/safe-fetch.module.js";
import { AnalysisQueueHandler } from "./analysis.queue-handler.js";
import { AnalysisReconciliationService } from "./analysis-reconciliation.service.js";
import { WebsiteAnalysisRunner } from "./website-analysis.runner.js";
import { WebsiteAnalysisService } from "./website-analysis.service.js";
import { WebsiteAnalysisRepository } from "./repositories/website-analysis.repository.js";

/**
 * Website analysis: SSRF-safe crawl, detections with evidence and confidence, opportunity
 * suggestions, 1-credit hold/capture/release. Owns website_analyses; writes the latest
 * analysis summary on the business through BusinessesService.
 */
@Module({
  imports: [
    BusinessesModule,
    CreditsModule,
    NotificationsModule,
    OrganizationsModule,
    SafeFetchModule,
    EntitlementsModule,
  ],
  providers: [
    WebsiteAnalysisService,
    WebsiteAnalysisRunner,
    AnalysisQueueHandler,
    AnalysisReconciliationService,
    WebsiteAnalysisRepository,
  ],
  exports: [
    WebsiteAnalysisService,
    WebsiteAnalysisRunner,
    AnalysisQueueHandler,
    AnalysisReconciliationService,
  ],
})
export class WebsiteAnalysisModule {}
