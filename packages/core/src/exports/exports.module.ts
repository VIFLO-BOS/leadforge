import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { ImportsModule } from "../imports/imports.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ExportsService } from "./exports.service.js";
import { ExportBuilder, ExportQueueHandler } from "./export.builder.js";
import { ExportJobRepository } from "./repositories/export-job.repository.js";

/** Synchronous CSV exports and async export jobs (worker build, object storage, signed downloads). */
@Module({
  imports: [
    BusinessesModule,
    ImportsModule,
    CrmModule,
    EntitlementsModule,
    OrganizationsModule,
    NotificationsModule,
  ],
  providers: [ExportsService, ExportJobRepository, ExportBuilder, ExportQueueHandler],
  exports: [ExportsService, ExportBuilder, ExportQueueHandler],
})
export class ExportsModule {}
