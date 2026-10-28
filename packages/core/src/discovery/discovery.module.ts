import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { DiscoveryService } from "./discovery.service.js";
import { DiscoveryRunner } from "./discovery.runner.js";
import { DiscoveryQueueHandler } from "./discovery.queue-handler.js";
import { DiscoveryReconciliationService } from "./discovery-reconciliation.service.js";
import { DiscoveryJobRepository } from "./repositories/discovery-job.repository.js";
import { DiscoveryItemRepository } from "./repositories/discovery-item.repository.js";

/**
 * Discovery jobs: lifecycle, queueing, page processing, item results, retries, cancellation,
 * credit settlement and reconciliation. Owns discovery_jobs and discovery_job_items; writes
 * businesses through BusinessesService and credits through CreditsService.
 */
@Module({
  imports: [
    BusinessesModule,
    OrganizationsModule,
    SourcesModule,
    CreditsModule,
    NotificationsModule,
    EntitlementsModule,
  ],
  providers: [
    DiscoveryService,
    DiscoveryRunner,
    DiscoveryQueueHandler,
    DiscoveryReconciliationService,
    DiscoveryJobRepository,
    DiscoveryItemRepository,
  ],
  exports: [
    DiscoveryService,
    DiscoveryRunner,
    DiscoveryQueueHandler,
    DiscoveryReconciliationService,
  ],
})
export class DiscoveryModule {}
