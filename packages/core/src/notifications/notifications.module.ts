import { Module } from "@nestjs/common";
import { IdentityModule } from "../auth/identity.module.js";
import { NotificationsService } from "./notifications.service.js";
import { NotificationRepository } from "./repositories/notification.repository.js";
import { NotificationPreferenceRepository } from "./repositories/notification-preference.repository.js";

/** In-app notifications (Mongo) and preferences (PostgreSQL); emails go through the mail queue. */
@Module({
  imports: [IdentityModule],
  providers: [NotificationsService, NotificationRepository, NotificationPreferenceRepository],
  exports: [NotificationsService],
})
export class NotificationsModule {}
