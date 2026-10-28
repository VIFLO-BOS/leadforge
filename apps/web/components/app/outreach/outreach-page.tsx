"use client";

import {
  ObjectIdString,
  OutreachChannel,
  OutreachStatus,
  PAGE_SIZE_DEFAULT,
  UuidString,
  type OutreachRecord,
} from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { SearchX, Send } from "lucide-react";
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
import { LogActivityDialog } from "@/components/app/crm/log-activity-dialog";
import {
  CHANNEL_ICONS,
  NextAttemptButton,
  OutreachStatusBadge,
  OutreachStatusMenu,
} from "@/components/app/crm/outreach-parts";
import { activityBusinessName, channelLabel, outcomeLabel, outreachStatusMeta } from "@/lib/crm";
import { dayEndIso, dayStartIso, describeDays, parseDay } from "@/lib/date-range";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useOutreach } from "@/lib/hooks/use-activities";
import { useLeadLists } from "@/lib/hooks/use-lists";
import { useMemberNames, useMembers } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";

type Channel = OutreachRecord["channel"];
type Status = OutreachRecord["status"];

export interface OutreachState {
  channel: Channel[];
  status: Status[];
  userId?: string;
  businessId?: string;
  listId?: string;
  from?: string;
  to?: string;
  pageSize: number;
}

const PAGE_SIZES = [25, 50, 100] as const;

export function parseOutreachParams(params: URLSearchParams): OutreachState {
  const channels = params
    .getAll("channel")
    .filter((c): c is Channel => OutreachChannel.safeParse(c).success);
  const statuses = params
    .getAll("status")
    .filter((s): s is Status => OutreachStatus.safeParse(s).success);
  const user = UuidString.safeParse(params.get("userId") ?? "");
  const business = ObjectIdString.safeParse(params.get("businessId") ?? "");
  const list = ObjectIdString.safeParse(params.get("listId") ?? "");
  const size = Number(params.get("pageSize"));
  return {
    channel: [...new Set(channels)],
    status: [...new Set(statuses)],
    userId: user.success ? user.data : undefined,
    businessId: business.success ? business.data : undefined,
    listId: list.success ? list.data : undefined,
    from: parseDay(params.get("from")),
    to: parseDay(params.get("to")),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZE_DEFAULT,
  };
}

export function serializeOutreachState(s: OutreachState): URLSearchParams {
  const out = new URLSearchParams();
  for (const c of s.channel) out.append("channel", c);
  for (const st of s.status) out.append("status", st);
  if (s.userId) out.set("userId", s.userId);
  if (s.businessId) out.set("businessId", s.businessId);
  if (s.listId) out.set("listId", s.listId);
  if (s.from) out.set("from", s.from);
  if (s.to) out.set("to", s.to);
  if (s.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(s.pageSize));
  return out;
}

/**
 * Outreach records (/app/outreach): one record per business and channel with its status,
 * attempts, last outcome and next attempt. Filters in the URL, cursor pagination; members who
 * work leads log attempts and change statuses here.
 */
export function OutreachPage() {
  const { me } = useWorkspace();
  const { canWorkLeads } = usePermissions();
  const compact = useMediaQuery(MEDIA.belowMd);
  const [state, setState] = useUrlState(parseOutreachParams, serializeOutreachState);
  const viewKey = JSON.stringify(state);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const records = useOutreach({
    channel: state.channel.length ? state.channel : undefined,
    status: state.status.length ? state.status : undefined,
    userId: state.userId,
    businessId: state.businessId,
    listId: state.listId,
    from: dayStartIso(state.from),
    to: dayEndIso(state.to),
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  });
  const members = useMembers();
  const memberName = useMemberNames();
  const lists = useLeadLists({ pageSize: 50, sort: "name:asc" });
  const [attemptOn, setAttemptOn] = useState<OutreachRecord | null>(null);
  const rows = records.data?.data ?? [];
  const error = records.isError && !records.data ? records.error : null;
  const set = (next: Partial<OutreachState>) => setState({ ...state, ...next });
  const appearance = compact ? "field" : "chip";

  const clearAll = () =>
    set({
      channel: [],
      status: [],
      userId: undefined,
      businessId: undefined,
      listId: undefined,
      from: undefined,
      to: undefined,
    });
  const ownerLabel = (id: string) => (id === me.user.id ? "You" : memberName(id));
  const businessLabel =
    state.businessId && rows[0]?.businessId === state.businessId
      ? activityBusinessName(rows[0])
      : "Selected business";
  const applied: ActiveFilter[] = [
    ...state.channel.map((c) => ({
      id: `ch-${c}`,
      label: `Channel: ${channelLabel(c)}`,
      onRemove: () => set({ channel: state.channel.filter((x) => x !== c) }),
    })),
    ...state.status.map((s) => ({
      id: `st-${s}`,
      label: `Status: ${outreachStatusMeta(s).label}`,
      onRemove: () => set({ status: state.status.filter((x) => x !== s) }),
    })),
    ...(state.userId
      ? [
          {
            id: "owner",
            label: `Owner: ${ownerLabel(state.userId)}`,
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
            label: `List: ${lists.data?.data.find((l) => l.id === state.listId)?.name ?? "Selected list"}`,
            onRemove: () => set({ listId: undefined }),
          },
        ]
      : []),
    ...(state.from || state.to
      ? [
          {
            id: "dates",
            label: `Last attempt: ${describeDays(state.from, state.to)}`,
            onRemove: () => set({ from: undefined, to: undefined }),
          },
        ]
      : []),
  ];

  const columns = useMemo<ColumnDef<OutreachRecord>[]>(
    () => [
      {
        id: "business",
        header: "Business",
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <CellBox width="14rem">
            {row.original.business ? (
              <Link
                href={`/app/businesses/${row.original.businessId}?tab=activities`}
                className="text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
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
        id: "channel",
        header: "Channel",
        cell: ({ row }) => {
          const Icon = CHANNEL_ICONS[row.original.channel] ?? Send;
          return (
            <CellBox width="8rem" className="flex items-center gap-1.5">
              <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
              {channelLabel(row.original.channel)}
            </CellBox>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <CellBox width="9rem">
            <OutreachStatusBadge status={row.original.status} />
          </CellBox>
        ),
      },
      {
        id: "attempts",
        header: "Attempts",
        meta: { align: "end" },
        cell: ({ row }) => formatNumber(row.original.attempts),
      },
      {
        id: "last",
        header: "Last attempt",
        cell: ({ row }) => (
          <CellBox width="10rem" className="flex flex-col gap-0.5">
            {row.original.lastAttemptAt ? (
              <>
                <time dateTime={row.original.lastAttemptAt}>
                  {formatRelative(row.original.lastAttemptAt)}
                </time>
                <span className="text-muted-foreground text-xs">
                  {row.original.lastOutcome
                    ? outcomeLabel(row.original.lastOutcome)
                    : "No outcome recorded"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">None yet</span>
            )}
          </CellBox>
        ),
      },
      {
        id: "next",
        header: "Next attempt",
        cell: ({ row }) => (
          <CellBox width="9rem">
            {row.original.nextAttemptAt ? (
              formatDateTime(row.original.nextAttemptAt)
            ) : (
              <span className="text-muted-foreground">Not planned</span>
            )}
          </CellBox>
        ),
      },
      {
        id: "owner",
        header: "Owner",
        cell: ({ row }) => <CellBox width="9rem">{ownerLabel(row.original.ownerUserId)}</CellBox>,
      },
      ...(canWorkLeads
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              meta: { label: "Actions", mobileActions: true, align: "end" as const },
              cell: ({ row }: { row: { original: OutreachRecord } }) => (
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="tonal"
                    aria-label={`Log attempt: ${channelLabel(row.original.channel)} to ${activityBusinessName(row.original)}`}
                    onClick={() => setAttemptOn(row.original)}
                  >
                    Log attempt
                  </Button>
                  <OutreachStatusMenu
                    record={row.original}
                    name={activityBusinessName(row.original)}
                  />
                  <NextAttemptButton
                    record={row.original}
                    name={activityBusinessName(row.original)}
                  />
                </span>
              ),
            } satisfies ColumnDef<OutreachRecord>,
          ]
        : []),
    ],
    [canWorkLeads, memberName, me.user.id],
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Sales"
        title="Outreach records"
        description="One record per business and channel. Each outbound call, WhatsApp message or email logged counts as an attempt; statuses show where each conversation stands."
      />
      <DataTable
        caption="Outreach records"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={records.isPending}
        skeletonRows={6}
        error={
          error ? (
            <ErrorState
              title={
                isForbidden(error)
                  ? "You cannot view outreach records"
                  : "Could not load outreach records"
              }
              message={friendlyMessage(error)}
              requestId={requestIdOf(error)}
              onRetry={isForbidden(error) ? undefined : () => void records.refetch()}
            />
          ) : undefined
        }
        empty={
          applied.length ? (
            <EmptyState
              size="compact"
              icon={SearchX}
              title="No outreach records match"
              description="Try another channel, status, owner or date range."
              action={
                <Button variant="outline" onClick={clearAll}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Send}
              title="No outreach yet"
              description="A record starts when someone logs an outbound call, WhatsApp message or email on a business."
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
          <FilterBar
            filters={applied}
            onClearAll={applied.length ? clearAll : undefined}
            sheetTitle="Filter outreach records"
          >
            <FilterMenu
              label="Channel"
              appearance={appearance}
              sections={[
                {
                  id: "channel",
                  type: "multiple",
                  options: OutreachChannel.options.map((c) => ({
                    value: c,
                    label: channelLabel(c),
                  })),
                  value: state.channel,
                  onValueChange: (v) => set({ channel: v as Channel[] }),
                },
              ]}
            />
            <FilterMenu
              label="Status"
              appearance={appearance}
              sections={[
                {
                  id: "status",
                  type: "multiple",
                  options: OutreachStatus.options.map((s) => ({
                    value: s,
                    label: outreachStatusMeta(s).label,
                  })),
                  value: state.status,
                  onValueChange: (v) => set({ status: v as Status[] }),
                },
              ]}
            />
            <FilterMenu
              label="Owner"
              appearance={appearance}
              loading={members.isPending}
              sections={[
                {
                  id: "owner",
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
              label="Last attempt"
              appearance={appearance}
              value={{ from: state.from, to: state.to }}
              describe={(v) => describeDays(v.from, v.to)}
              onApply={(v) => set({ from: v.from, to: v.to })}
            />
          </FilterBar>
        }
        footer={
          error || (rows.length === 0 && cursors.length === 1) ? null : (
            <Pagination
              hasPrevious={cursors.length > 1}
              hasNext={Boolean(records.data?.meta.nextCursor)}
              onPrevious={() => setPager({ key: viewKey, cursors: cursors.slice(0, -1) })}
              onNext={() => {
                const next = records.data?.meta.nextCursor;
                if (next) setPager({ key: viewKey, cursors: [...cursors, next] });
              }}
              pageSize={state.pageSize}
              pageSizeOptions={[...PAGE_SIZES]}
              onPageSizeChange={(pageSize) => set({ pageSize })}
              pageCount={rows.length}
              loading={records.isFetching && records.isPlaceholderData}
              itemLabel="records"
            />
          )
        }
      />
      {canWorkLeads && attemptOn ? (
        <LogActivityDialog
          open={attemptOn !== null}
          onOpenChange={(o) => !o && setAttemptOn(null)}
          business={{
            id: attemptOn.businessId,
            name: activityBusinessName(attemptOn),
            suppressed: false,
            phones: attemptOn.channel !== "email" && attemptOn.target ? [attemptOn.target] : [],
            emails: attemptOn.channel === "email" && attemptOn.target ? [attemptOn.target] : [],
          }}
          outreach={attemptOn}
        />
      ) : null}
    </div>
  );
}
