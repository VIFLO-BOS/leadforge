"use client";

import type { Notification } from "@leadforge/contracts";
import {
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  CircleCheck,
  CircleX,
  Settings,
  TriangleAlert,
  UserCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { forwardRef, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  MEDIA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  cn,
  toast,
  useMediaQuery,
} from "@leadforge/ui";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { notificationTypeLabel } from "@/lib/labels";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useUnreadCount,
} from "@/lib/hooks/use-notifications";

/** Icon and tone per notification type: failures, results with problems, clean results. */
export function notificationVisual(type: string): {
  icon: LucideIcon;
  className: string;
  label: string;
} {
  const named = notificationTypeLabel(type);
  if (type === "lead.assigned")
    return { icon: UserCheck, className: "text-primary", label: named ?? "Assigned to you" };
  if (type === "organization.deletion_requested") {
    return {
      icon: CalendarClock,
      className: "text-warning",
      label: named ?? "Scheduled for deletion",
    };
  }
  if (type.endsWith(".failed") || type.endsWith("_failed")) {
    return { icon: CircleX, className: "text-destructive", label: named ?? "Failed" };
  }
  if (
    type.endsWith("_with_warnings") ||
    type.endsWith("_with_errors") ||
    type.endsWith(".attention")
  ) {
    return {
      icon: TriangleAlert,
      className: "text-warning",
      label: named ?? "Finished with problems",
    };
  }
  return { icon: CircleCheck, className: "text-success", label: named ?? "Finished" };
}

/** "99+" above 99, as the bell badge has room for three characters. */
export function unreadBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Links come from the API; only same-app dashboard paths are followed. */
function safeHref(href: string | null): string | null {
  return href && /^\/app(\/|\?|$)/.test(href) ? href : null;
}

function NotificationItem({
  n,
  onOpen,
  onMarkRead,
  marking,
}: {
  n: Notification;
  onOpen: () => void;
  onMarkRead: () => void;
  marking: boolean;
}) {
  const unread = n.readAt === null;
  const visual = notificationVisual(n.type);
  const Icon = visual.icon;
  const href = safeHref(n.href);
  const content = (
    <>
      <span className="bg-surface-container-high relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full">
        <Icon aria-hidden className={cn("size-4", visual.className)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn("break-anywhere text-sm", unread ? "font-medium" : "text-muted-foreground")}
        >
          <span className="sr-only">
            {unread ? "Unread. " : ""}
            {visual.label}:{" "}
          </span>
          {n.title}
        </span>
        {n.body ? (
          <span className="text-muted-foreground break-anywhere text-xs">{n.body}</span>
        ) : null}
        <time
          className="text-muted-foreground text-xs"
          dateTime={n.createdAt}
          title={formatDateTime(n.createdAt)}
        >
          {formatRelative(n.createdAt)}
        </time>
      </span>
    </>
  );
  return (
    <li
      className="relative flex min-w-0 items-start"
      data-unread={unread || undefined}
      data-type={n.type}
    >
      {unread ? (
        <span aria-hidden className="bg-primary absolute left-1.5 top-5 size-2 rounded-full" />
      ) : null}
      {href ? (
        <Link
          href={href}
          onClick={() => {
            if (unread) onMarkRead();
            onOpen();
          }}
          className="state-layer transition-ui flex min-w-0 flex-1 items-start gap-3 rounded-md py-3 pl-5 pr-2"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-5 pr-2">{content}</div>
      )}
      {unread ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="mt-2.5 shrink-0"
          aria-label={`Mark as read: ${n.title}`}
          disabled={marking}
          onClick={onMarkRead}
        >
          <CheckCheck aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** The panel: filter, list with load-more, mark read and mark all read. */
export function NotificationPanel({ onClose, enabled }: { onClose: () => void; enabled: boolean }) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const list = useNotificationList(filter === "unread", enabled);
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  const unreadCount = unread.data?.unread ?? 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="notification-panel">
      <div className="flex min-w-0 flex-col gap-3 px-4 pb-2 pt-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 pr-10 min-[480px]:pr-0">
          <h2 className="shrink-0 text-base font-medium">Notifications</h2>
          <Button
            variant="text"
            size="sm"
            disabled={unreadCount === 0 || markAll.isPending}
            loading={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onError: (err) =>
                  toast.error("Could not mark notifications as read", {
                    description: friendlyMessage(err),
                  }),
              })
            }
          >
            <CheckCheck aria-hidden /> Mark all read
          </Button>
        </div>
        <SegmentedControl<"all" | "unread">
          aria-label="Show"
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: "All" },
            {
              value: "unread",
              label: unreadCount ? `Unread (${unreadBadge(unreadCount)})` : "Unread",
            },
          ]}
        />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.isPending ? (
          <div
            className="flex flex-col gap-2 px-2 py-2"
            role="status"
            aria-busy="true"
            aria-label="Loading notifications"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-md" />
            ))}
          </div>
        ) : list.isError ? (
          <div className="p-2">
            <ErrorState
              title="Could not load notifications"
              message={friendlyMessage(list.error)}
              requestId={requestIdOf(list.error)}
              onRetry={() => void list.refetch()}
            />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            size="compact"
            icon={BellOff}
            title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
            description="You are notified here when your discovery jobs, imports and bulk website analyses finish. Notifications are kept for 90 days."
          />
        ) : (
          <>
            <ul className="divide-border flex min-w-0 flex-col divide-y" aria-label="Notifications">
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  onOpen={onClose}
                  marking={markRead.isPending && markRead.variables === n.id}
                  onMarkRead={() =>
                    markRead.mutate(n.id, {
                      onError: (err) =>
                        toast.error("Could not mark the notification as read", {
                          description: friendlyMessage(err),
                        }),
                    })
                  }
                />
              ))}
            </ul>
            {list.hasNextPage ? (
              <div className="flex justify-center py-2">
                <Button
                  variant="text"
                  size="sm"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  Load older notifications
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="border-border flex shrink-0 items-center border-t px-2 py-2">
        <Button asChild variant="text" size="sm">
          <Link href="/app/settings?tab=notifications" onClick={onClose}>
            <Settings aria-hidden /> Notification settings
          </Link>
        </Button>
      </div>
    </div>
  );
}

const BellButton = forwardRef<
  HTMLButtonElement,
  { label: string; count: number } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ label, count, ...props }, ref) => (
  <Button
    ref={ref}
    variant="ghost"
    size="icon"
    aria-label={label}
    className="relative"
    data-testid="notification-bell"
    {...props}
  >
    <Bell aria-hidden />
    {count ? (
      <span
        aria-hidden
        className="bg-destructive text-destructive-foreground absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-medium tabular-nums leading-none"
      >
        {unreadBadge(count)}
      </span>
    ) : null}
  </Button>
));
BellButton.displayName = "BellButton";

/**
 * Top-bar bell with the unread count (polled every 45 seconds and on window focus). Opens a
 * popover from 480px and a full-screen sheet below. `open` can be controlled so the account
 * menu can open it at widths where the bell is hidden.
 */
export function NotificationCenter({
  open,
  onOpenChange,
  showTrigger = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const narrow = useMediaQuery(MEDIA.narrow);
  const unread = useUnreadCount();
  const count = unread.data?.unread ?? 0;
  const label = count
    ? `Notifications, ${count > 999 ? "more than 999" : count} unread`
    : "Notifications";

  const bellProps = { label, count };
  if (narrow || !showTrigger) {
    return (
      <>
        {showTrigger ? <BellButton {...bellProps} onClick={() => onOpenChange(true)} /> : null}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="full" hideClose aria-describedby={undefined} className="bg-surface">
            <SheetTitle className="sr-only">Notifications</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2.5 z-10"
              aria-label="Close notifications"
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden />
            </Button>
            <NotificationPanel onClose={() => onOpenChange(false)} enabled={open} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <BellButton {...bellProps} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[min(560px,calc(100dvh-88px))] w-[400px] flex-col p-0"
        aria-label="Notifications"
      >
        <NotificationPanel onClose={() => onOpenChange(false)} enabled={open} />
      </PopoverContent>
    </Popover>
  );
}
