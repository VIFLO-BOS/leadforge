import { Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  Notification,
  NotificationListQuery,
  NotificationPreferences,
  NotificationUnreadCount,
  ObjectIdString,
  UpdateNotificationPreferences,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  CurrentOrg,
  CurrentUser,
  NotificationsService,
  RequirePermission,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only alias keeps the Zod schema out of Swagger's query-parameter expansion.
type ListQuery = NotificationListQuery;

/** The signed-in user's notifications in the current organization. */
@ApiTags("notifications")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission("notifications:read")
  @ApiOperation({ summary: "My notifications, newest first (unread=true for unread only)" })
  @ApiZodQuery(NotificationListQuery)
  @ApiZodResponse(200, Notification.array())
  async list(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(NotificationListQuery) query: ListQuery,
  ) {
    const page = await this.notifications.list(org.organizationId, user.id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("unread-count")
  @RequirePermission("notifications:read")
  @ApiOperation({ summary: "Unread count for the bell badge (capped at 1000)" })
  @ApiZodResponse(200, NotificationUnreadCount)
  unreadCount(@CurrentOrg() org: OrganizationScope, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(org.organizationId, user.id);
  }

  @Post("read-all")
  @RequirePermission("notifications:read")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark all my notifications read" })
  markAllRead(@CurrentOrg() org: OrganizationScope, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(org.organizationId, user.id);
  }

  @Post(":id/read")
  @RequirePermission("notifications:read")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark one notification read (404 if it is not mine)" })
  @ApiZodResponse(200, Notification)
  markRead(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
  ) {
    return this.notifications.markRead(org.organizationId, user.id, id);
  }

  @Get("preferences")
  @RequirePermission("notifications:read")
  @ApiOperation({ summary: "My notification preferences in this organization (defaults: all on)" })
  @ApiZodResponse(200, NotificationPreferences)
  preferences(@CurrentOrg() org: OrganizationScope, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.getPreferences(org.organizationId, user.id);
  }

  @Put("preferences")
  @RequirePermission("notifications:read")
  @ApiOperation({ summary: "Update my notification preferences (partial)" })
  @ApiZodBody(UpdateNotificationPreferences)
  @ApiZodResponse(200, NotificationPreferences)
  updatePreferences(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(UpdateNotificationPreferences) body: UpdateNotificationPreferences,
  ) {
    return this.notifications.updatePreferences(org.organizationId, user.id, body);
  }
}
