import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OrganizationsModule } from "./organizations.module.js";
import { OrganizationLifecycleService } from "./organization-lifecycle.service.js";
import { OrganizationPurgeService } from "./organization-purge.service.js";
import { OrganizationExportService } from "./organization-export.service.js";
import {
  OrganizationExportBuilder,
  OrganizationExportQueueHandler,
} from "./organization-export.builder.js";
import { OrganizationDataRepository } from "./repositories/organization-data.repository.js";
import { OrganizationErasureRepository } from "./repositories/organization-erasure.repository.js";
import { OrganizationExportRepository } from "./repositories/organization-export.repository.js";
import { OrganizationRecordsRepository } from "./repositories/organization-records.repository.js";

/**
 * Stage 10: the organization deletion workflow (request, cancel, reminders, purge) and the
 * whole-organization data export. Separate from OrganizationsModule, which authz and most feature
 * modules import, because the purge reaches billing, storage and every organization-scoped store.
 */
@Module({
  imports: [OrganizationsModule, NotificationsModule, BillingModule, BusinessesModule],
  providers: [
    OrganizationLifecycleService,
    OrganizationPurgeService,
    OrganizationExportService,
    OrganizationExportBuilder,
    OrganizationExportQueueHandler,
    OrganizationDataRepository,
    OrganizationErasureRepository,
    OrganizationExportRepository,
    OrganizationRecordsRepository,
  ],
  exports: [
    OrganizationLifecycleService,
    OrganizationPurgeService,
    OrganizationExportService,
    OrganizationExportBuilder,
    OrganizationExportQueueHandler,
    OrganizationDataRepository,
    OrganizationErasureRepository,
  ],
})
export class OrganizationLifecycleModule {}
