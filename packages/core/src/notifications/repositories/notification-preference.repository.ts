import { Injectable } from "@nestjs/common";
import { PrismaService, type NotificationPreference } from "@leadforge/db-postgres";

/** notification_preferences (PostgreSQL), one row per user and organization. */
@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organizationId: string, userId: string): Promise<NotificationPreference | null> {
    return this.prisma.notificationPreference.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }

  upsert(
    organizationId: string,
    userId: string,
    values: {
      emailJobEvents: boolean;
      emailBilling: boolean;
      inappAll: boolean;
      emailAssignments: boolean;
    },
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      create: { userId, organizationId, ...values },
      update: values,
    });
  }
}
