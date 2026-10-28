import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PipelineService } from "./pipeline.service.js";
import { LeadsService } from "./leads.service.js";
import { ListsService } from "./lists.service.js";
import { ActivitiesService } from "./activities.service.js";
import { BulkOperationsService } from "./bulk-operations.service.js";
import { BulkQueueHandler, BulkRunner } from "./bulk.runner.js";
import { PipelineConfigRepository } from "./repositories/pipeline-config.repository.js";
import { LeadRepository } from "./repositories/lead.repository.js";
import { LeadListItemRepository, LeadListRepository } from "./repositories/lead-list.repository.js";
import { ActivityRepository } from "./repositories/activity.repository.js";
import { OutreachRepository } from "./repositories/outreach.repository.js";
import {
  BulkItemRepository,
  BulkOperationRepository,
} from "./repositories/bulk-operation.repository.js";

/** CRM (Phase 5): pipeline, leads, lists, activities, outreach and bulk operations. */
@Module({
  imports: [BusinessesModule, OrganizationsModule, NotificationsModule],
  providers: [
    PipelineService,
    LeadsService,
    ListsService,
    ActivitiesService,
    BulkOperationsService,
    BulkRunner,
    BulkQueueHandler,
    PipelineConfigRepository,
    LeadRepository,
    LeadListRepository,
    LeadListItemRepository,
    ActivityRepository,
    OutreachRepository,
    BulkOperationRepository,
    BulkItemRepository,
  ],
  exports: [
    PipelineService,
    LeadsService,
    ListsService,
    ActivitiesService,
    BulkOperationsService,
    BulkRunner,
    BulkQueueHandler,
  ],
})
export class CrmModule {}
