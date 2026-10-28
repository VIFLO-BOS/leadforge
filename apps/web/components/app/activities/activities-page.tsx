"use client";

import {
  ActivityType,
  ObjectIdString,
  PAGE_SIZE_DEFAULT,
  UuidString,
  type Activity,
} from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { MessagesSquare, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterDateRange,
  FilterMenu,
  MEDIA,
  PageHeader,
  Pagination,
  useMediaQuery,
  type ActiveFilter,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { CellBox } from "@/components/app/businesses/shared";
import { ActivityActions } from "@/components/app/crm/activity-actions";
import { ActivityDetails, activityIcon, useActivityText } from "@/components/app/crm/activity-feed";
import { activityBusinessName, activityTypeLabel } from "@/lib/crm";
import { dayEndIso, dayStartIso, describeDays, parseDay } from "@/lib/date-range";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useActivities } from "@/lib/hooks/use-activities";
import { useLeadLists } from "@/lib/hooks/use-lists";
import { useMembers } from "@/lib/hooks/use-members";
import { useUrlState } from "@/lib/hooks/use-url-state";

type Type = Activity["type"];

export interface ActivitiesState {
  type: Type[];
  userId?: string;
  businessId?: string;
  listId?: string;
  from?: string;
  to?: string;
  pageSize: number;
}

const PAGE_SIZES = [25, 50, 100] as const;

export function parseActivitiesParams(params: URLSearchParams): ActivitiesState {
  const types = params.getAll("type").filter((t): t is Type => ActivityType.safeParse(t).success);
  const user = UuidString.safeParse(params.get("userId") ?? "");
  const business = ObjectIdString.safeParse(params.get("businessId") ?? "");
  const list = ObjectIdString.safeParse(params.get("listId") ?? "");
  const size = Number(params.get("pageSize"));
  return {
    type: [...new Set(types)],
    userId: user.success ? user.data : undefined,
    businessId: business.success ? business.data : undefined,
    listId: list.success ? list.data : undefined,
    from: parseDay(params.get("from")),
    to: parseDay(params.get("to")),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZE_DEFAULT,
  };
}

export function serializeActivitiesState(s: ActivitiesState): URLSearchParams {
  const out = new URLSearchParams();
  for (const t of s.type) out.append("type", t);
  if (s.userId) out.set("userId", s.userId);
  if (s.businessId) out.set("businessId", s.businessId);
  if (s.listId) out.set("listId", s.listId);
  if (s.from) out.set("from", s.from);
  if (s.to) out.set("to", s.to);
  if (s.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(s.pageSize));
  return out;
}

/**
 * Activities (/app/activities): everything logged across the workspace, newest first, plus stage
 * changes and assignments. Filters (type, author, business, list, dates) live in the URL; cursor
 * pagination. Authors, owners and administrators can edit or delete what people logged.
 */
export function ActivitiesPage() {
  const { me } = useWorkspace();
  const compact = useMediaQuery(MEDIA.belowMd);
  const [state, setState] = useUrlState(parseActivitiesParams, serializeActivitiesState);
  const viewKey = JSON.stringify(state);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const list = useActivities({
    type: state.type.length ? state.type : undefined,
    userId: state.userId,
    businessId: state.businessId,
    listId: state.listId,
    from: dayStartIso(state.from),
    to: dayEndIso(state.to),
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  });
  const members = useMembers();
  const lists = useLeadLists({ pageSize: 50, sort: "name:asc" });
  const text = useActivityText();
  const rows = list.data?.data ?? [];
  const error = list.isError && !list.data ? list.error : null;
  const set = (next: Partial<ActivitiesState>) => setState({ ...state, ...next });
  const appearance = compact ? "field" : "chip";
  const memberLabel = (id: string) =>
    id === me.user.id
      ? "You"
      : (members.data?.data.find((m) => m.userId === id)?.name ?? "A team member");
  const listLabel = (id: string) =>
    lists.data?.data.find((l) => l.id === id)?.name ?? "Selected list";
  const businessLabel =
    state.businessId && rows[0]?.businessId === state.businessId
      ? activityBusinessName(rows[0])
      : "Selected business";

  const clearAll = () =>
    set({
      type: [],
      userId: undefined,
      businessId: undefined,
      listId: undefined,
      from: undefined,
      to: undefined,
    });
  const applied: ActiveFilter[] = [
    ...state.type.map((t) => ({
      id: `type-${t}`,
      label: `Type: ${activityTypeLabel(t)}`,
      onRemove: () => set({ type: state.type.filter((x) => x !== t) }),
    })),
    ...(state.userId
      ? [
          {
            id: "user",
            label: `By: ${memberLabel(state.userId)}`,
            onRemove: () => set({ userId: undefined }),
          },
        ]
      : []),
    ...(state.businessId
      ? [
          {
            id: "business",
            label: `Business: ${businessLabel}`,
            onRemove: () => set({ businessId: undefined }),
          },
        ]
      : []),
    ...(state.listId
      ? [
          {
            id: "list",
            label: `List: ${listLabel(state.listId)}`,
            onRemove: () => set({ listId: undefined }),
          },
        ]
      : []),
    ...(state.from || state.to
      ? [
          {
            id: "dates",
            label: `Date: ${describeDays(state.from, state.to)}`,
            onRemove: () => set({ from: undefined, to: undefined }),
          },
        ]
      : []),
  ];

  const columns = useMemo<ColumnDef<Activity>[]>(
    () => [
      {
        id: "activity",
        header: "Activity",
        meta: { mobileTitle: true },
        cell: ({ row }) => {
          const a = row.original;
          const Icon = activityIcon(a.type);
          return (
            <CellBox width="15rem" className="flex items-start gap-2">
              <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <span className="break-words font-medium">{text.summary(a)}</span>
            </CellBox>
          );
        },
      },
      {
        id: "business",
        header: "Business",
        cell: ({ row }) => (
          <CellBox width="13rem">
            {row.original.business ? (
              <Link
                href={`/app/businesses/${row.original.businessId}?tab=activities`}
                className="text-foreground hover:text-primary rounded-xs break-words hover:underline"
              >
                {activityBusinessName(row.original)}
              </Link>
            ) : (
              <span className="text-muted-foreground italic">
                {activityBusinessName(row.original)}
              </span>
            )}
          </CellBox>
        ),
      },
      {
        id: "details",
        header: "Details",
        cell: ({ row }) => (
          <CellBox width="18rem">
            <ActivityDetails activity={row.original} />
          </CellBox>
        ),
      },
      {
        id: "when",
        header: "When",
        cell: ({ row }) => (
          <CellBox width="9rem" className="flex flex-col gap-0.5">
            <time dateTime={row.original.occurredAt}>
              {formatDateTime(row.original.occurredAt)}
            </time>
            <span className="text-muted-foreground text-xs">
              {formatRelative(row.original.occurredAt)}
            </span>
          </CellBox>
        ),
      },
      {
        id: "author",
        header: "By",
        cell: ({ row }) => {
          const who = text.member(row.original.authorUserId);
          return <CellBox width="9rem">{who.charAt(0).toUpperCase() + who.slice(1)}</CellBox>;
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: "Actions", mobileActions: true, align: "end" },
        cell: ({ row }) => (
          <ActivityActions
            activity={row.original}
            label={`${text.summary(row.original)} on ${activityBusinessName(row.original)}`}
          />
        ),
      },
    ],
    [text],
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Sales"
        title="Activities"
        description="Notes, calls, WhatsApp messages, emails and meetings logged across the workspace, with stage changes and assignments. Log new ones from a business page or the pipeline."
      />
      <DataTable
        caption="Activities"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={list.isPending}
        skeletonRows={6}
        error={
          error ? (
            <ErrorState
              title={
                isForbidden(error) ? "You cannot view activities" : "Could not load activities"
              }
              message={friendlyMessage(error)}
              requestId={requestIdOf(error)}
              onRetry={isForbidden(error) ? undefined : () => void list.refetch()}
            />
          ) : undefined
        }
        empty={
          applied.length ? (
            <EmptyState
              size="compact"
              icon={SearchX}
              title="No activity matches"
              description="Try another type, person or date range."
              action={
                <Button variant="outline" onClick={clearAll}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="No activity yet"
              description="Log a call, WhatsApp message, email, meeting or note from a business page or a pipeline card. Stage changes and assignments appear here too."
              action={
                <Button asChild>
                  <Link href="/app/pipeline">Open the pipeline</Link>
                </Button>
              }
            />
          )
        }
        mobileCards
        toolbar={
          <div className="flex min-w-0 flex-col gap-2">
            <FilterBar
              filters={applied}
              onClearAll={applied.length ? clearAll : undefined}
              sheetTitle="Filter activities"
            >
              <FilterMenu
                label="Type"
                appearance={appearance}
                sections={[
                  {
                    id: "type",
                    type: "multiple",
                    options: ActivityType.options.map((t) => ({
                      value: t,
                      label: activityTypeLabel(t),
                    })),
                    value: state.type,
                    onValueChange: (v) => set({ type: v as Type[] }),
                  },
                ]}
              />
              <FilterMenu
                label="By"
                appearance={appearance}
                loading={members.isPending}
                sections={[
                  {
                    id: "user",
                    type: "single",
                    anyLabel: "Anyone",
                    options: (members.data?.data ?? []).map((m) => ({
                      value: m.userId,
                      label: m.userId === me.user.id ? `${m.name} (you)` : m.name,
                    })),
                    value: state.userId ? [state.userId] : [],
                    onValueChange: ([v]) => set({ userId: v }),
                  },
                ]}
              />
              <FilterMenu
                label="List"
                appearance={appearance}
                loading={lists.isPending}
                emptyMessage="No lead lists yet"
                sections={[
                  {
                    id: "list",
                    type: "single",
                    anyLabel: "Any list",
                    options: (lists.data?.data ?? []).map((l) => ({ value: l.id, label: l.name })),
                    value: state.listId ? [state.listId] : [],
                    onValueChange: ([v]) => set({ listId: v }),
                  },
                ]}
              />
              <FilterDateRange
                label="Date"
                appearance={appearance}
                value={{ from: state.from, to: state.to }}
                describe={(v) => describeDays(v.from, v.to)}
                onApply={(v) => set({ from: v.from, to: v.to })}
              />
            </FilterBar>
            <p className="text-muted-foreground min-w-0 text-xs" aria-live="polite">
              {list.isPending ? "Loading activities" : rows.length ? "Newest first" : null}
            </p>
          </div>
        }
        footer={
          error || (rows.length === 0 && cursors.length === 1) ? null : (
            <Pagination
              hasPrevious={cursors.length > 1}
              hasNext={Boolean(list.data?.meta.nextCursor)}
              onPrevious={() => setPager({ key: viewKey, cursors: cursors.slice(0, -1) })}
              onNext={() => {
                const next = list.data?.meta.nextCursor;
                if (next) setPager({ key: viewKey, cursors: [...cursors, next] });
              }}
              pageSize={state.pageSize}
              pageSizeOptions={[...PAGE_SIZES]}
              onPageSizeChange={(pageSize) => set({ pageSize })}
              pageCount={rows.length}
              loading={list.isFetching && list.isPlaceholderData}
              itemLabel="activities"
            />
          )
        }
      />
    </div>
  );
}
