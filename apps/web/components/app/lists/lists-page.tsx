"use client";

import { LeadListListQuery, PAGE_SIZE_DEFAULT, type LeadList } from "@leadforge/contracts";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  Download,
  EllipsisVertical,
  Kanban,
  ListChecks,
  Pencil,
  Plus,
  SearchX,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Button,
  Chip,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchField,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { CellBox } from "@/components/app/businesses/shared";
import { ExportDialog } from "@/components/app/exports/export-dialog";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDate, formatNumber, formatRelative, plural } from "@/lib/format";
import { useLeadLists } from "@/lib/hooks/use-lists";
import { useMemberNames } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { DeleteListDialog, ListFormDialog } from "./list-dialogs";

type SortField = "name" | "updatedAt" | "createdAt";
interface ListsState {
  q?: string;
  sort: { field: SortField; direction: "asc" | "desc" };
  pageSize: number;
  /**
   * Owner filter: "me" (lists I own) or "all". Absent means the role's default: "My lists" for
   * sales representatives, every list for everyone else. Every role may read every list.
   */
  owner?: "me" | "all";
}

const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_SORT: ListsState["sort"] = { field: "updatedAt", direction: "desc" };

export function parseListsParams(params: URLSearchParams): ListsState {
  const raw: Record<string, unknown> = {};
  for (const k of ["q", "sort", "pageSize"]) {
    const v = params.get(k);
    if (v) raw[k] = v;
  }
  let parsed = LeadListListQuery.safeParse(raw);
  for (let i = 0; !parsed.success && i < 5; i++) {
    for (const issue of parsed.error.issues) delete raw[String(issue.path[0])];
    parsed = LeadListListQuery.safeParse(raw);
  }
  const v = parsed.success ? parsed.data : LeadListListQuery.parse({});
  return {
    q: v.q || undefined,
    sort: (v.sort as ListsState["sort"] | undefined) ?? DEFAULT_SORT,
    pageSize: (PAGE_SIZES as readonly number[]).includes(v.pageSize)
      ? v.pageSize
      : PAGE_SIZE_DEFAULT,
    owner: params.get("owner") === "me" ? "me" : params.get("owner") === "all" ? "all" : undefined,
  };
}

export function serializeListsState(s: ListsState): URLSearchParams {
  const out = new URLSearchParams();
  if (s.q) out.set("q", s.q);
  if (s.sort.field !== DEFAULT_SORT.field || s.sort.direction !== DEFAULT_SORT.direction) {
    out.set("sort", `${s.sort.field}:${s.sort.direction}`);
  }
  if (s.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(s.pageSize));
  if (s.owner) out.set("owner", s.owner);
  return out;
}

/**
 * Lead lists (/app/lists): every role reads every list in the workspace (SECURITY section 2).
 * Sales representatives start on a "My lists" filter they can clear, and manage only the lists
 * they own. Create, rename, delete and export, with name search, the owner filter and sort in the
 * URL and cursor pagination.
 */
export function ListsPage() {
  const { me } = useWorkspace();
  const { role, canManageLists, canManageAllLists, canExport } = usePermissions();
  const memberName = useMemberNames();
  const [state, setState] = useUrlState(parseListsParams, serializeListsState);
  const repDefault = role === "sales_rep";
  const ownOnly = state.owner ? state.owner === "me" : repDefault;
  const setOwner = (mine: boolean) =>
    setState({ ...state, owner: mine === repDefault ? undefined : mine ? "me" : "all" });
  const viewKey = JSON.stringify(state);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const lists = useLeadLists({
    q: state.q,
    ownerUserId: ownOnly ? me.user.id : undefined,
    sort: `${state.sort.field}:${state.sort.direction}`,
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  });
  const rows = lists.data?.data ?? [];
  const [formFor, setFormFor] = useState<LeadList | "new" | null>(null);
  const [deleting, setDeleting] = useState<LeadList | null>(null);
  const [exporting, setExporting] = useState<LeadList | null>(null);
  const error = lists.isError && !lists.data ? lists.error : null;
  const canEdit = (l: LeadList) =>
    canManageAllLists || (canManageLists && l.ownerUserId === me.user.id);

  const sorting: SortingState = [{ id: state.sort.field, desc: state.sort.direction === "desc" }];
  const columns = useMemo<ColumnDef<LeadList>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "List",
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <CellBox width="18rem" className="flex flex-col gap-0.5">
            <Link
              href={`/app/lists/${row.original.id}`}
              className="text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.description ? (
              <span className="text-muted-foreground break-words text-xs">
                {row.original.description}
              </span>
            ) : null}
          </CellBox>
        ),
      },
      {
        id: "itemCount",
        header: "Businesses",
        enableSorting: false,
        meta: { align: "end", label: "Businesses" },
        cell: ({ row }) => formatNumber(row.original.itemCount),
      },
      {
        id: "owner",
        header: "Owner",
        enableSorting: false,
        cell: ({ row }) => (
          <CellBox width="11rem">
            {row.original.ownerUserId === me.user.id ? "You" : memberName(row.original.ownerUserId)}
          </CellBox>
        ),
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <CellBox width="8rem" className="flex flex-col gap-0.5">
            <span>{formatDate(row.original.updatedAt)}</span>
            <span className="text-muted-foreground text-xs">
              {formatRelative(row.original.updatedAt)}
            </span>
          </CellBox>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { label: "Actions", mobileActions: true, align: "end" },
        cell: ({ row }) => (
          <ListActions
            list={row.original}
            canEdit={canEdit(row.original)}
            canExport={canExport}
            onEdit={() => setFormFor(row.original)}
            onDelete={() => setDeleting(row.original)}
            onExport={() => setExporting(row.original)}
          />
        ),
      },
    ],
    // canEdit closes over permissions that are stable for a page view.
    [me.user.id, memberName, canExport, canManageAllLists, canManageLists],
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Workspace"
        title="Lead lists"
        description={
          repDefault
            ? "Lists of businesses to work. You manage the lists you own; every list in the workspace can be opened."
            : "Named groups of businesses to work, assign or export together. Sales representatives manage the lists they own."
        }
        actions={
          canManageLists ? (
            <Button onClick={() => setFormFor("new")}>
              <Plus aria-hidden /> New list
            </Button>
          ) : undefined
        }
      />
      <DataTable
        caption="Lead lists"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={lists.isPending}
        skeletonRows={5}
        sorting={sorting}
        onSortingChange={(updater) => {
          const next = typeof updater === "function" ? updater(sorting) : updater;
          const first = next[0];
          setState({
            ...state,
            sort:
              first && (first.id === "name" || first.id === "updatedAt" || first.id === "createdAt")
                ? { field: first.id, direction: first.desc ? "desc" : "asc" }
                : DEFAULT_SORT,
          });
        }}
        error={
          error ? (
            <ErrorState
              title={isForbidden(error) ? "You cannot view lists" : "Could not load lists"}
              message={friendlyMessage(error)}
              requestId={requestIdOf(error)}
              onRetry={isForbidden(error) ? undefined : () => void lists.refetch()}
            />
          ) : undefined
        }
        empty={
          state.q ? (
            <EmptyState
              size="compact"
              icon={SearchX}
              title="No lists match"
              description={`No list name starts with “${state.q}”.`}
              action={
                <Button variant="outline" onClick={() => setState({ ...state, q: undefined })}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No lead lists yet"
              description="Create a list, then add businesses to it from the directory (select rows, then Add to list) or from a business page."
              action={
                canManageLists ? (
                  <Button onClick={() => setFormFor("new")}>
                    <Plus aria-hidden /> New list
                  </Button>
                ) : undefined
              }
            />
          )
        }
        mobileCards
        toolbar={
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
              <div className="min-w-0 max-w-sm flex-1">
                <SearchField
                  label="Search lists by name"
                  defaultValue={state.q ?? ""}
                  onDebouncedChange={(q) => setState({ ...state, q: q || undefined })}
                />
              </div>
              <Chip
                variant="filter"
                selected={ownOnly}
                onClick={() => setOwner(!ownOnly)}
                className="self-start min-[480px]:self-auto"
                data-testid="my-lists-filter"
              >
                My lists
              </Chip>
            </div>
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {lists.isPending
                ? "Loading lists"
                : [
                    ownOnly ? "Lists you own" : null,
                    state.q ? `names starting with “${state.q}”` : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || null}
            </p>
          </div>
        }
        footer={
          error || (rows.length === 0 && cursors.length === 1) ? null : (
            <Pagination
              hasPrevious={cursors.length > 1}
              hasNext={Boolean(lists.data?.meta.nextCursor)}
              onPrevious={() => setPager({ key: viewKey, cursors: cursors.slice(0, -1) })}
              onNext={() => {
                const next = lists.data?.meta.nextCursor;
                if (next) setPager({ key: viewKey, cursors: [...cursors, next] });
              }}
              pageSize={state.pageSize}
              pageSizeOptions={[...PAGE_SIZES]}
              onPageSizeChange={(pageSize) => setState({ ...state, pageSize })}
              pageCount={rows.length}
              loading={lists.isFetching && lists.isPlaceholderData}
              itemLabel="lists"
            />
          )
        }
      />
      <ListFormDialog
        open={formFor !== null}
        onOpenChange={(o) => !o && setFormFor(null)}
        list={formFor === "new" ? null : formFor}
      />
      <DeleteListDialog list={deleting} onOpenChange={(o) => !o && setDeleting(null)} />
      <ExportDialog
        open={exporting !== null}
        onOpenChange={(o) => !o && setExporting(null)}
        request={exporting ? { kind: "list", listId: exporting.id } : null}
        what={exporting ? `the list “${exporting.name}”` : "the list"}
        count={exporting?.itemCount}
      />
    </div>
  );
}

export function ListActions({
  list,
  canEdit,
  canExport,
  onEdit,
  onDelete,
  onExport,
}: {
  list: LeadList;
  canEdit: boolean;
  canExport: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${list.name}`}>
          <EllipsisVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/app/pipeline?listId=${list.id}`}>
            <Kanban aria-hidden /> View in pipeline
          </Link>
        </DropdownMenuItem>
        {canExport ? (
          <DropdownMenuItem disabled={list.itemCount === 0} onSelect={onExport}>
            <Download aria-hidden /> Export {plural(list.itemCount, "business", "businesses")}
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden /> Edit list
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 aria-hidden /> Delete list
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
