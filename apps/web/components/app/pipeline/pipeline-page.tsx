"use client";

import {
  ObjectIdString,
  StageKey,
  UuidString,
  type Lead,
  type PipelineConfig,
} from "@leadforge/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  EllipsisVertical,
  Kanban,
  MessageSquarePlus,
  PanelRightOpen,
  PencilLine,
  SearchX,
  UserPlus,
} from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterMenu,
  FormField,
  Heading,
  HeadingLevel,
  Kbd,
  LiveAnnouncement,
  MEDIA,
  PageHeader,
  ScrollRegion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
  initials,
  useMediaQuery,
  useMotionSafe,
  type ActiveFilter,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { AssignLeadDialog } from "@/components/app/crm/assign-lead-dialog";
import { LeadDetailsDialog, type LeadField } from "@/components/app/crm/lead-details-dialog";
import { MoveToMenu, useLeadMover } from "@/components/app/crm/lead-move";
import { LogActivityDialog } from "@/components/app/crm/log-activity-dialog";
import { formatMoney } from "@/lib/billing";
import { leadBusinessName, neighbourStage, PRIORITY_LABELS } from "@/lib/crm";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatNumber, formatRelative, plural } from "@/lib/format";
import { useLeadList, useLeadLists } from "@/lib/hooks/use-lists";
import { useAssignableMembers, useMemberNames } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  BOARD_PER_STAGE,
  useColumnMore,
  usePipelineBoard,
  type BoardColumn as Column,
  type BoardFilters,
} from "@/lib/hooks/use-pipeline";
import { useUrlState } from "@/lib/hooks/use-url-state";

export interface PipelineState {
  assignedToUserId?: string;
  unassigned: boolean;
  listId?: string;
  /** The stage shown on narrow screens (one column at a time). */
  stage?: string;
}

/** URL state: owner (`assignedToUserId`, as notification links use), `unassigned`, `listId`, `stage`. */
export function parsePipelineParams(params: URLSearchParams): PipelineState {
  const owner = UuidString.safeParse(params.get("assignedToUserId") ?? "");
  const list = ObjectIdString.safeParse(params.get("listId") ?? "");
  const stage = StageKey.safeParse(params.get("stage") ?? "");
  const unassigned = params.get("unassigned") === "true";
  return {
    assignedToUserId: owner.success && !unassigned ? owner.data : undefined,
    unassigned,
    listId: list.success ? list.data : undefined,
    stage: stage.success ? stage.data : undefined,
  };
}

export function serializePipelineState(state: PipelineState): URLSearchParams {
  const out = new URLSearchParams();
  if (state.unassigned) out.set("unassigned", "true");
  else if (state.assignedToUserId) out.set("assignedToUserId", state.assignedToUserId);
  if (state.listId) out.set("listId", state.listId);
  if (state.stage) out.set("stage", state.stage);
  return out;
}

const UNASSIGNED = "__unassigned";

type Control = "previous" | "next" | "menu";
interface FocusRequest {
  id: string;
  control: Control;
}

/** Leads in a column: the board's first page, then pages loaded with Show more (deduplicated). */
function useColumnLeads(column: Column, filters: BoardFilters) {
  const [enabled, setEnabled] = useState(false);
  const more = useColumnMore(column.stage.key, filters, column.nextCursor, enabled);
  const leads = useMemo(() => {
    const seen = new Set(column.leads.map((l) => l.id));
    const extra = (more.data?.pages ?? [])
      .flatMap((p) => p.data)
      .filter((l) => l.stageKey === column.stage.key && !seen.has(l.id) && (seen.add(l.id), true));
    return [...column.leads, ...extra];
  }, [column.leads, column.stage.key, more.data]);
  const remaining = Math.max(0, column.count - leads.length);
  const canLoad = enabled ? Boolean(more.hasNextPage) : Boolean(column.nextCursor);
  return {
    leads,
    remaining,
    hasMore: remaining > 0 && canLoad,
    loading: more.isFetching,
    error: more.error,
    load: () => (enabled ? void more.fetchNextPage() : setEnabled(true)),
  };
}

/**
 * Lead pipeline (/app/pipeline): one column per active stage with counts and cursor "Show more".
 * Every card moves with its previous and next buttons, the "Move to…" menu, or the keyboard
 * (focus a card's button, then `]` forward or `[` back). Moves are version-checked; focus follows
 * the card to its new column and each move is announced. Under 768px the board shows one stage
 * at a time, chosen with a Stage select. Filters (owner, unassigned, list) live in the URL.
 */
export function PipelinePage() {
  const { me } = useWorkspace();
  const { canWorkLeads, canAssignLeads } = usePermissions();
  const narrow = useMediaQuery(MEDIA.belowMd);
  const motionSafe = useMotionSafe();
  const [state, setState] = useUrlState(parsePipelineParams, serializePipelineState);
  const filters: BoardFilters = useMemo(
    () => ({
      assignedToUserId: state.unassigned ? undefined : state.assignedToUserId,
      unassigned: state.unassigned || undefined,
      listId: state.listId,
    }),
    [state.assignedToUserId, state.unassigned, state.listId],
  );
  const board = usePipelineBoard(filters);
  const config = board.data?.config;
  const members = useAssignableMembers();
  const memberName = useMemberNames();
  const lists = useLeadLists({ pageSize: 50, sort: "name:asc" });
  const chosenList = useLeadList(state.listId);
  const [message, setMessage] = useState("");
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null);
  const lastControl = useRef<Control>("menu");
  const stateRef = useRef(state);
  stateRef.current = state;
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const [detailsFor, setDetailsFor] = useState<{ lead: Lead; focus?: LeadField } | null>(null);
  const mover = useLeadMover(
    config,
    setMessage,
    (lead) => {
      setFocusReq({ id: lead.id, control: lastControl.current });
      // On a narrow screen the view follows the card to its new stage, so focus can follow too.
      if (narrowRef.current) setState({ ...stateRef.current, stage: lead.stageKey });
    },
    (lead, focus) => setDetailsFor({ lead, focus }),
  );
  const [assignFor, setAssignFor] = useState<Lead | null>(null);
  const [logFor, setLogFor] = useState<Lead | null>(null);

  const columns = board.data?.columns ?? [];
  const total = columns.reduce((n, c) => n + c.count, 0);
  const filtered = Boolean(filters.assignedToUserId || filters.unassigned || filters.listId);
  const selected = columns.find((c) => c.stage.key === state.stage) ?? columns[0];
  const filterKey = JSON.stringify(filters);

  const set = (next: Partial<PipelineState>) => setState({ ...state, ...next });
  const listName = (id: string) =>
    lists.data?.data.find((l) => l.id === id)?.name ?? chosenList.data?.name ?? "Selected list";
  const ownerLabel = state.unassigned
    ? "Unassigned"
    : state.assignedToUserId
      ? state.assignedToUserId === me.user.id
        ? "You"
        : memberName(state.assignedToUserId)
      : null;

  const applied: ActiveFilter[] = [
    ...(ownerLabel
      ? [
          {
            id: "owner",
            label: `Owner: ${ownerLabel}`,
            onRemove: () => set({ assignedToUserId: undefined, unassigned: false }),
          },
        ]
      : []),
    ...(state.listId
      ? [
          {
            id: "list",
            label: `List: ${listName(state.listId)}`,
            onRemove: () => set({ listId: undefined }),
          },
        ]
      : []),
  ];

  const ownerOptions = [
    { value: me.user.id, label: "You" },
    { value: UNASSIGNED, label: "Unassigned" },
    ...members.assignable
      .filter((m) => m.userId !== me.user.id)
      .map((m) => ({ value: m.userId, label: m.name })),
  ];
  const listOptions = [
    ...(lists.data?.data ?? []).map((l) => ({ value: l.id, label: l.name })),
    ...(state.listId && !lists.data?.data.some((l) => l.id === state.listId)
      ? [{ value: state.listId, label: listName(state.listId) }]
      : []),
  ];

  const cardProps = {
    config,
    filters,
    canWork: canWorkLeads,
    canAssign: canAssignLeads,
    meId: me.user.id,
    meName: me.user.name,
    memberName,
    pendingId: mover.pendingId,
    focusReq,
    onFocused: () => setFocusReq(null),
    onMove: (
      lead: Lead,
      target: { direction: "next" | "previous" } | { stageKey: string },
      control: Control,
    ) => {
      lastControl.current = control;
      mover.move(lead, target);
    },
    onAssign: setAssignFor,
    onLog: setLogFor,
    onEdit: (lead: Lead, focus?: LeadField) => setDetailsFor({ lead, focus }),
    animate: motionSafe,
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Sales"
        title="Lead pipeline"
        description="Each business you work is a lead in one stage. Stages are kept apart from the business details and from its score."
        actions={
          <Button asChild variant="outline">
            <Link href="/app/businesses">
              <Building2 aria-hidden /> Add leads
            </Link>
          </Button>
        }
      />
      <LiveAnnouncement message={message} data-testid="pipeline-announcer" />

      <div className="flex min-w-0 flex-col gap-2">
        <FilterBar
          filters={applied}
          onClearAll={
            applied.length
              ? () => set({ assignedToUserId: undefined, unassigned: false, listId: undefined })
              : undefined
          }
          sheetTitle="Filter the pipeline"
        >
          <FilterMenu
            label="Owner"
            appearance={narrow ? "field" : "chip"}
            loading={members.isPending}
            sections={[
              {
                id: "owner",
                type: "single",
                anyLabel: "Anyone",
                options: ownerOptions,
                value: state.unassigned
                  ? [UNASSIGNED]
                  : state.assignedToUserId
                    ? [state.assignedToUserId]
                    : [],
                onValueChange: ([v]) =>
                  set(
                    v === UNASSIGNED
                      ? { unassigned: true, assignedToUserId: undefined }
                      : { unassigned: false, assignedToUserId: v },
                  ),
              },
            ]}
          />
          <FilterMenu
            label="List"
            appearance={narrow ? "field" : "chip"}
            loading={lists.isPending}
            emptyMessage="No lead lists yet"
            sections={[
              {
                id: "list",
                type: "single",
                anyLabel: "Any list",
                options: listOptions,
                value: state.listId ? [state.listId] : [],
                onValueChange: ([v]) => set({ listId: v }),
              },
            ]}
          />
        </FilterBar>
        <p className="text-muted-foreground min-w-0 text-xs" aria-live="polite">
          {board.data ? `${plural(total, "lead", "leads")}${filtered ? " match" : ""} · ` : null}
          {canWorkLeads ? (
            <span>
              Keyboard: on a card, press <Kbd>]</Kbd> to move it forward or <Kbd>[</Kbd> to move it
              back.
            </span>
          ) : (
            <span>
              Your role can view the pipeline; moving leads needs an owner, administrator or sales
              representative.
            </span>
          )}
        </p>
      </div>

      {board.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the pipeline"
          className="flex min-w-0 gap-3 overflow-hidden"
        >
          {Array.from({ length: narrow ? 1 : 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full shrink-0 rounded-lg md:w-[18rem]" />
          ))}
        </div>
      ) : board.error ? (
        <ErrorState
          title={
            isForbidden(board.error)
              ? "You cannot view the pipeline"
              : "Could not load the pipeline"
          }
          message={friendlyMessage(board.error)}
          requestId={requestIdOf(board.error)}
          onRetry={isForbidden(board.error) ? undefined : board.refetch}
        />
      ) : total === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No leads match"
            description="No lead in any stage matches these filters."
            action={
              <Button
                variant="outline"
                onClick={() =>
                  set({ assignedToUserId: undefined, unassigned: false, listId: undefined })
                }
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Kanban}
            title="No leads in the pipeline yet"
            description="Add a business from its page (Pipeline card), or select businesses in the directory and assign them or move them to a stage in bulk."
            action={
              <Button asChild>
                <Link href="/app/businesses">Go to businesses</Link>
              </Button>
            }
          />
        )
      ) : narrow ? (
        <div className="flex min-w-0 flex-col gap-3">
          <FormField id="pipeline-stage" label="Stage">
            <Select value={selected?.stage.key} onValueChange={(stage) => set({ stage })}>
              <SelectTrigger id="pipeline-stage" className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c.stage.key} value={c.stage.key}>
                    {c.stage.label} · {formatNumber(c.count)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {selected ? (
            <BoardColumn
              key={`${selected.stage.key}-${filterKey}`}
              column={selected}
              full
              {...cardProps}
            />
          ) : null}
        </div>
      ) : (
        <ScrollRegion label="Pipeline board" className="bg-surface-container-lowest">
          <LayoutGroup>
            <div className="flex w-max gap-3 p-3" data-testid="pipeline-board">
              {columns.map((c) => (
                <BoardColumn key={`${c.stage.key}-${filterKey}`} column={c} {...cardProps} />
              ))}
            </div>
          </LayoutGroup>
        </ScrollRegion>
      )}

      {canAssignLeads && assignFor ? (
        <AssignLeadDialog
          open={assignFor !== null}
          onOpenChange={(o) => !o && setAssignFor(null)}
          lead={assignFor}
          businessId={assignFor.businessId}
          businessName={leadBusinessName(assignFor)}
        />
      ) : null}
      {canWorkLeads && detailsFor ? (
        <LeadDetailsDialog
          lead={detailsFor.lead}
          config={config}
          open={detailsFor !== null}
          onOpenChange={(o) => !o && setDetailsFor(null)}
          focus={detailsFor.focus}
          onSaved={(saved) => setMessage(`Saved the lead details of ${leadBusinessName(saved)}.`)}
        />
      ) : null}
      {canWorkLeads && logFor ? (
        <LogActivityDialog
          open={logFor !== null}
          onOpenChange={(o) => !o && setLogFor(null)}
          business={{
            id: logFor.businessId,
            name: leadBusinessName(logFor),
            suppressed: logFor.business?.suppressed ?? false,
            phones: [],
            emails: [],
          }}
        />
      ) : null}
    </div>
  );
}

interface CardSharedProps {
  config: PipelineConfig | undefined;
  filters: BoardFilters;
  canWork: boolean;
  canAssign: boolean;
  meId: string;
  meName: string;
  memberName: (id: string | null) => string;
  pendingId: string | null;
  focusReq: FocusRequest | null;
  onFocused: () => void;
  onMove: (
    lead: Lead,
    target: { direction: "next" | "previous" } | { stageKey: string },
    control: Control,
  ) => void;
  onAssign: (lead: Lead) => void;
  onLog: (lead: Lead) => void;
  onEdit: (lead: Lead, focus?: LeadField) => void;
  animate: boolean;
}

function BoardColumn({
  column,
  full,
  ...shared
}: { column: Column; full?: boolean } & CardSharedProps) {
  const headingId = useId();
  const { leads, remaining, hasMore, loading, error, load } = useColumnLeads(
    column,
    shared.filters,
  );
  const label = column.stage.label;
  return (
    <section
      aria-labelledby={headingId}
      data-stage={column.stage.key}
      className={cn(
        "bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-lg",
        full ? "w-full p-2 min-[360px]:p-3" : "w-[18rem] shrink-0 p-3",
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 px-1">
        <Heading id={headingId} className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
          <span className="break-anywhere">{label}</span>
          <span
            className="text-muted-foreground text-xs font-normal tabular-nums"
            data-testid="stage-count"
          >
            {formatNumber(column.count)}
            <span className="sr-only"> {column.count === 1 ? "lead" : "leads"}</span>
          </span>
        </Heading>
        {column.stage.kind !== "open" ? (
          <Badge variant={column.stage.kind === "won" ? "success" : "neutral"}>
            {column.stage.kind === "won" ? "Closed: won" : "Closed: lost"}
          </Badge>
        ) : null}
      </div>
      <HeadingLevel>
        {leads.length ? (
          <ul aria-label={`${label} leads`} className="flex min-w-0 flex-col gap-2">
            {leads.map((lead) => (
              <motion.li
                key={lead.id}
                layout={shared.animate ? "position" : false}
                layoutId={shared.animate ? `lead-${lead.id}` : undefined}
                transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
                className="min-w-0"
              >
                <LeadCard lead={lead} {...shared} />
              </motion.li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-1 text-xs">No leads in this stage.</p>
        )}
      </HeadingLevel>
      {error ? (
        <p role="alert" className="text-destructive px-1 text-xs">
          {friendlyMessage(error)}
        </p>
      ) : null}
      {hasMore ? (
        <Button variant="text" size="sm" className="self-start" loading={loading} onClick={load}>
          Show {formatNumber(Math.min(BOARD_PER_STAGE, remaining))} more
          <span className="sr-only"> in {label}</span>
        </Button>
      ) : null}
    </section>
  );
}

function LeadCard({
  lead,
  config,
  canWork,
  canAssign,
  meId,
  meName,
  memberName,
  pendingId,
  focusReq,
  onFocused,
  onMove,
  onAssign,
  onLog,
  onEdit,
}: { lead: Lead } & CardSharedProps) {
  const titleId = useId();
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const name = leadBusinessName(lead);
  const prev = neighbourStage(config, lead.stageKey, "previous");
  const next = neighbourStage(config, lead.stageKey, "next");
  const pending = pendingId === lead.id;
  const owner = lead.assignedToUserId
    ? lead.assignedToUserId === meId
      ? "You"
      : memberName(lead.assignedToUserId)
    : null;
  const b = lead.business;

  // Focus follows a moved card to its new column (it remounts there).
  useEffect(() => {
    if (focusReq?.id !== lead.id) return;
    const want =
      focusReq.control === "previous" ? prevRef : focusReq.control === "next" ? nextRef : menuRef;
    const el =
      want.current && !want.current.disabled ? want.current : (menuRef.current ?? linkRef.current);
    el?.focus();
    onFocused();
  }, [focusReq, lead.id, lead.stageKey, onFocused]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canWork || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== "]" && e.key !== "[") return;
    const direction = e.key === "]" ? "next" : "previous";
    if (!(direction === "next" ? next : prev)) return;
    e.preventDefault();
    onMove(lead, { direction }, direction);
  };

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={pending || undefined}
      data-lead-id={lead.id}
      onKeyDown={onKeyDown}
      className={cn(
        "bg-surface border-border transition-ui flex min-w-0 flex-col gap-2 rounded-md border p-3",
        pending && "opacity-70",
      )}
    >
      <Heading id={titleId} className="text-sm font-medium leading-snug">
        {b ? (
          <Link
            ref={linkRef}
            href={`/app/businesses/${b.id}`}
            className={cn(
              "break-anywhere rounded-xs hover:underline",
              b.nameState === "expired" ? "text-muted-foreground italic" : "hover:text-primary",
            )}
          >
            {name}
          </Link>
        ) : (
          <span className="text-muted-foreground italic">{name}</span>
        )}
      </Heading>
      {b && (b.categories.length || b.locality || b.region) ? (
        <p className="text-muted-foreground break-anywhere text-xs">
          {[b.categories[0], b.locality ?? b.region].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Owner</dt>
        <dd className="flex min-w-0 items-center gap-1.5" data-testid="card-owner">
          {owner ? (
            <>
              <Avatar size="sm" aria-hidden>
                <AvatarFallback>
                  {initials(lead.assignedToUserId === meId ? meName : owner)}
                </AvatarFallback>
              </Avatar>
              <span className="break-anywhere">{owner}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Fit</dt>
        <dd className="tabular-nums">
          {b?.fit !== null && b?.fit !== undefined ? (
            <>
              {Math.round(b.fit)}
              <span className="text-muted-foreground"> / 100</span>
            </>
          ) : (
            <span className="text-muted-foreground">Not scored</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Activity</dt>
        <dd>
          {lead.lastActivityAt ? (
            <time dateTime={lead.lastActivityAt}>{formatRelative(lead.lastActivityAt)}</time>
          ) : (
            <span className="text-muted-foreground">None yet</span>
          )}
        </dd>
        {lead.nextActionAt ? (
          <>
            <dt className="text-muted-foreground">Next</dt>
            <dd>
              <time dateTime={lead.nextActionAt}>{formatRelative(lead.nextActionAt)}</time>
            </dd>
          </>
        ) : null}
        {lead.stageKind === "won" && lead.wonValueMinor !== null && lead.currency ? (
          <>
            <dt className="text-muted-foreground">Value</dt>
            <dd className="tabular-nums" data-testid="card-won-value">
              {formatMoney(lead.wonValueMinor, lead.currency)}
            </dd>
          </>
        ) : null}
        {lead.stageKind === "lost" && lead.lostReason ? (
          <>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="line-clamp-2 break-words" title={lead.lostReason}>
              {lead.lostReason}
            </dd>
          </>
        ) : null}
      </dl>
      {canWork &&
      ((lead.stageKind === "won" && lead.wonValueMinor === null) ||
        (lead.stageKind === "lost" && !lead.lostReason)) ? (
        <Button
          variant="text"
          size="sm"
          className="-ml-2 self-start"
          data-testid="card-follow-up"
          onClick={() => onEdit(lead, lead.stageKind === "won" ? "wonValue" : "lostReason")}
        >
          {lead.stageKind === "won" ? "Record won value…" : "Record lost reason…"}
          <span className="sr-only"> for {name}</span>
        </Button>
      ) : null}
      {b?.suppressed || lead.priority === "high" ? (
        <div className="flex flex-wrap gap-1.5">
          {b?.suppressed ? <Badge variant="warning">Suppressed</Badge> : null}
          {lead.priority === "high" ? (
            <Badge variant="primary">{PRIORITY_LABELS.high}</Badge>
          ) : null}
        </div>
      ) : null}
      <div className="border-border -mx-1 flex min-w-0 flex-wrap items-center gap-1 border-t px-1 pt-2">
        {canWork ? (
          <>
            <Button
              ref={prevRef}
              variant="ghost"
              size="icon-sm"
              disabled={!prev}
              data-move="previous"
              aria-label={
                prev ? `Move ${name} back to ${prev.label}` : `${name} is in the first stage`
              }
              onClick={() => onMove(lead, { direction: "previous" }, "previous")}
            >
              <ArrowLeft aria-hidden />
            </Button>
            <Button
              ref={nextRef}
              variant="ghost"
              size="icon-sm"
              disabled={!next}
              data-move="next"
              aria-label={
                next ? `Move ${name} forward to ${next.label}` : `${name} is in the last stage`
              }
              onClick={() => onMove(lead, { direction: "next" }, "next")}
            >
              <ArrowRight aria-hidden />
            </Button>
            <MoveToMenu
              lead={lead}
              config={config}
              compact
              triggerRef={menuRef}
              onMove={(stageKey) => onMove(lead, { stageKey }, "menu")}
            />
          </>
        ) : null}
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`}>
              <EllipsisVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {b ? (
              <DropdownMenuItem asChild>
                <Link href={`/app/businesses/${b.id}`}>
                  <PanelRightOpen aria-hidden /> Open business
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canAssign ? (
              <DropdownMenuItem onSelect={() => onAssign(lead)}>
                <UserPlus aria-hidden /> Assign…
              </DropdownMenuItem>
            ) : null}
            {canWork ? (
              <DropdownMenuItem onSelect={() => onEdit(lead)}>
                <PencilLine aria-hidden /> Edit details…
              </DropdownMenuItem>
            ) : null}
            {canWork && b ? (
              <DropdownMenuItem onSelect={() => onLog(lead)}>
                <MessageSquarePlus aria-hidden /> Log activity…
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
