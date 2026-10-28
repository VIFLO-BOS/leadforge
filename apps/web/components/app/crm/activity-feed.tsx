"use client";

import type { Activity } from "@leadforge/contracts";
import {
  ArrowRightLeft,
  MessagesSquare,
  ShieldAlert,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Timeline,
  type TimelineItem,
} from "@leadforge/ui";
import { activitySummary, isSystemActivity, stageLabel } from "@/lib/crm";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useBusinessActivities } from "@/lib/hooks/use-activities";
import { useMemberNames } from "@/lib/hooks/use-members";
import { usePipelineConfig } from "@/lib/hooks/use-pipeline";
import { ActivityActions } from "./activity-actions";
import { TYPE_ICONS } from "./log-activity-dialog";

export function activityIcon(type: string): LucideIcon {
  if (type === "stage_change") return ArrowRightLeft;
  if (type === "assignment") return UserCheck;
  return TYPE_ICONS[type] ?? MessagesSquare;
}

/** Shared summary helpers bound to the workspace's stage labels and member names. */
export function useActivityText() {
  const config = usePipelineConfig();
  const member = useMemberNames();
  return useMemo(
    () => ({
      summary: (a: Activity) =>
        activitySummary(
          a,
          (k) => stageLabel(config.data, k),
          (u) => member(u),
        ),
      member,
    }),
    [config.data, member],
  );
}

/** The body, target and override reason of an activity, as text (never HTML). */
export function ActivityDetails({ activity }: { activity: Activity }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {activity.body ? (
        <span className="text-foreground break-anywhere whitespace-pre-wrap text-[13px]">
          {activity.body}
        </span>
      ) : null}
      {activity.target ? (
        <span className="break-anywhere text-xs">To {activity.target}</span>
      ) : null}
      {activity.suppressionOverride ? (
        <span className="text-warning inline-flex min-w-0 items-start gap-1 text-xs">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-anywhere">
            Logged despite suppression: {activity.suppressionOverride.reason}
          </span>
        </span>
      ) : null}
      {activity.editedAt ? (
        <span className="text-muted-foreground text-xs">
          Edited {formatDateTime(activity.editedAt)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A business's activity timeline (GET /activities?businessId), newest first: logged notes, calls,
 * WhatsApp messages, emails and meetings, plus the system's stage changes and assignments. Each
 * entry names its author; authors, owners and admins can edit or delete what people logged.
 */
export function ActivityFeed({ businessId }: { businessId: string }) {
  const feed = useBusinessActivities(businessId);
  const text = useActivityText();
  const activities = feed.data?.pages.flatMap((p) => p.data) ?? [];

  if (feed.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading activity"
        className="flex flex-col gap-4"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-md" />
        ))}
      </div>
    );
  }
  if (feed.isError && !feed.data) {
    return (
      <ErrorState
        title="Could not load the activity"
        message={friendlyMessage(feed.error)}
        requestId={requestIdOf(feed.error)}
        onRetry={() => void feed.refetch()}
      />
    );
  }
  if (!activities.length) {
    return (
      <EmptyState
        size="compact"
        icon={MessagesSquare}
        title="No activity yet"
        description="Notes, calls, WhatsApp messages, emails and meetings logged on this business appear here, with stage changes and assignments."
      />
    );
  }

  const items: TimelineItem[] = activities.map((a) => {
    const summary = text.summary(a);
    return {
      id: a.id,
      icon: activityIcon(a.type),
      tone: isSystemActivity(a) ? "neutral" : a.suppressionOverride ? "warning" : "primary",
      timestamp: a.occurredAt,
      timestampLabel: formatDateTime(a.occurredAt),
      title: summary,
      description: <ActivityDetails activity={a} />,
      meta: (
        <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2">
          <span>
            {isSystemActivity(a) ? "By" : "Logged by"} {text.member(a.authorUserId)}
          </span>
          <ActivityActions activity={a} label={`${summary}, ${formatDateTime(a.occurredAt)}`} />
        </span>
      ),
    };
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Timeline items={items} aria-label="Activity" data-testid="activity-timeline" />
      {feed.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          loading={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          Show older activity
        </Button>
      ) : null}
    </div>
  );
}
