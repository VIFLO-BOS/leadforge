import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ImportsService } from "./imports.service.js";
import { ImportJobRepository } from "./repositories/import-job.repository.js";
import { ImportRowRepository } from "./repositories/import-row.repository.js";

/** CSV import. Owns import_jobs and import_rows; writes businesses through BusinessesService. */
@Module({
  imports: [BusinessesModule, OrganizationsModule, NotificationsModule],
  providers: [ImportsService, ImportJobRepository, ImportRowRepository],
  exports: [ImportsService],
})
export class ImportsModule {}
