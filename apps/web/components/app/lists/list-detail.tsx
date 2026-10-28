"use client";

import { EXPIRED_NAME_LABEL, PAGE_SIZE_DEFAULT, type LeadListItem } from "@leadforge/contracts";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import {
  ArrowLeft,
  Download,
  EllipsisVertical,
  Kanban,
  ListPlus,
  ListX,
  MessagesSquare,
  Pencil,
  SearchX,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Breadcrumbs,
  Button,
  ConfirmDialog,
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
  Skeleton,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { CellBox, renderBreadcrumbLink, shortLocation } from "@/components/app/businesses/shared";
import { ExportDialog } from "@/components/app/exports/export-dialog";
import { isApiError } from "@/lib/api";
import { stageLabel } from "@/lib/crm";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDate, formatRelative, plural } from "@/lib/format";
import { useLeadList, useListItems, useListItemsChange } from "@/lib/hooks/use-lists";
import { useMemberNames } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { usePipelineConfig } from "@/lib/hooks/use-pipeline";
import { AddBusinessesDialog } from "./add-businesses-dialog";
import { DeleteListDialog, ListFormDialog } from "./list-dialogs";

const PAGE_SIZES = [25, 50, 100] as const;
/** Removing this many or more from a list asks for the typed phrase. */
const PHRASE_AT = 10;

function itemName(item: LeadListItem): string {
  if (!item.business) return "Business removed or merged";
  return item.business.states.name === "expired" ? EXPIRED_NAME_LABEL : item.business.name;
}

/**
 * One lead list (/app/lists/[id]): its businesses with their pipeline stage, owner and scores;
 * remove one or a selection, add from a directory search, export the list as a ZIP, open it in
 * the pipeline. Managers and the list's owner can change it; everyone can read it.
 */
export function ListDetail({ id }: { id: string }) {
  const { me } = useWorkspace();
  const { canManageAllLists, canManageLists, canExport } = usePermissions();
  const list = useLeadList(id);
  const config = usePipelineConfig();
  const memberName = useMemberNames();
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_DEFAULT);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const items = useListItems(id, { pageSize, cursor: cursor ?? undefined });
  const remove = useListItemsChange("remove");
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [removing, setRemoving] = useState<{ ids: string[]; name?: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const l = list.data;
  const canEdit = Boolean(
    l && (canManageAllLists || (canManageLists && l.ownerUserId === me.user.id)),
  );
  const rows = items.data?.data ?? [];

  const columns = useMemo<ColumnDef<LeadListItem>[]>(
    () => [
      {
        id: "business",
        header: "Business",
        meta: { mobileTitle: true },
        cell: ({ row }) => {
          const b = row.original.business;
          return (
            <CellBox width="16rem" className="flex flex-col gap-0.5">
              {b ? (
                <Link
                  href={`/app/businesses/${b.id}`}
                  className="text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
                >
                  {itemName(row.original)}
                </Link>
              ) : (
                <span className="text-muted-foreground italic">{itemName(row.original)}</span>
              )}
              {b?.categories.length ? (
                <span className="text-muted-foreground break-words text-xs">
                  {b.categories.slice(0, 2).join(" · ")}
                </span>
              ) : null}
              {b?.suppressed ? (
                <span className="text-warning text-xs font-medium">Suppressed</span>
              ) : null}
            </CellBox>
          );
        },
      },
      {
        id: "location",
        header: "Location",
        cell: ({ row }) => (
          <CellBox width="10rem">
            {row.original.business
              ? (shortLocation(row.original.business.location) ?? (
                  <span className="text-muted-foreground">Unknown</span>
                ))
              : null}
          </CellBox>
        ),
      },
      {
        id: "pipeline",
        header: "Pipeline",
        cell: ({ row }) => {
          const lead = row.original.lead;
          return (
            <CellBox width="11rem" className="flex flex-col gap-0.5">
              {lead ? (
                <>
                  <span>{stageLabel(config.data, lead.stageKey)}</span>
                  <span className="text-muted-foreground text-xs">
                    {lead.assignedToUserId
                      ? lead.assignedToUserId === me.user.id
                        ? "Yours"
                        : memberName(lead.assignedToUserId)
                      : "Unassigned"}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Not in the pipeline</span>
              )}
            </CellBox>
          );
        },
      },
      {
        id: "scores",
        header: "Fit / data confidence",
        meta: { label: "Fit / data confidence" },
        cell: ({ row }) => {
          const s = row.original.business?.score;
          return (
            <CellBox width="9rem" className="tabular-nums">
              {s ? (
                <>
                  Fit {s.fit} · Data {s.dataConfidence}
                </>
              ) : (
                <span className="text-muted-foreground">Not scored</span>
              )}
            </CellBox>
          );
        },
      },
      {
        id: "added",
        header: "Added",
        cell: ({ row }) => (
          <CellBox width="9rem" className="flex flex-col gap-0.5">
            <span>{formatDate(row.original.addedAt)}</span>
            <span className="text-muted-foreground text-xs">
              by {memberName(row.original.addedByUserId)}
            </span>
          </CellBox>
        ),
      },
      ...(canEdit
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              meta: { label: "Actions", mobileActions: true, align: "end" as const },
              cell: ({ row }: { row: { original: LeadListItem } }) => (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${itemName(row.original)} from the list`}
                  onClick={() =>
                    setRemoving({ ids: [row.original.businessId], name: itemName(row.original) })
                  }
                >
                  <X aria-hidden />
                </Button>
              ),
            } satisfies ColumnDef<LeadListItem>,
          ]
        : []),
    ],
    [canEdit, config.data, me.user.id, memberName],
  );

  if (list.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading list" className="flex flex-col gap-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (list.isError || !l) {
    const notFound =
      isApiError(list.error) &&
      (list.error.status === 404 || list.error.code === "VALIDATION_FAILED");
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[{ label: "Lead lists", href: "/app/lists" }, { label: "Not found" }]}
          renderLink={renderBreadcrumbLink}
        />
        <PageHeader title={notFound ? "List not found" : "Lead list"} />
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title="We could not find this list"
            description="It may have been deleted, or it belongs to another workspace."
            action={
              <Button asChild>
                <Link href="/app/lists">
                  <ArrowLeft aria-hidden /> Back to lists
                </Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="Could not load this list"
            message={friendlyMessage(list.error)}
            requestId={requestIdOf(list.error)}
            onRetry={() => void list.refetch()}
          />
        )}
      </div>
    );
  }

  const itemsError = items.isError && !items.data ? items.error : null;
  const doRemove = () => {
    if (!removing) return;
    remove.mutate(
      { listId: l.id, businessIds: removing.ids },
      {
        onSuccess: (res) => {
          setRemoving(null);
          setSelection({});
          toast.success(
            `Removed ${plural(res.summary.changed, "business", "businesses")} from “${l.name}”`,
          );
        },
        onError: (err) => {
          setRemoving(null);
          toast.error("Could not remove from the list", { description: friendlyMessage(err) });
        },
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Lead lists", href: "/app/lists" }, { label: l.name }]}
            renderLink={renderBreadcrumbLink}
          />
        }
        eyebrow="Lead list"
        title={l.name}
        description={l.description ?? "No description."}
        actions={
          <>
            {canEdit ? (
              <Button onClick={() => setAddOpen(true)}>
                <ListPlus aria-hidden /> Add businesses
              </Button>
            ) : null}
            {canExport ? (
              <Button
                variant="outline"
                disabled={l.itemCount === 0}
                onClick={() => setExportOpen(true)}
              >
                <Download aria-hidden /> Export
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More list actions">
                  <EllipsisVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/app/pipeline?listId=${l.id}`}>
                    <Kanban aria-hidden /> View in pipeline
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/app/activities?listId=${l.id}`}>
                    <MessagesSquare aria-hidden /> View activity
                  </Link>
                </DropdownMenuItem>
                {canEdit ? (
                  <>
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                      <Pencil aria-hidden /> Edit list
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                      <Trash2 aria-hidden /> Delete list
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <p className="text-muted-foreground -mt-2 text-xs" data-testid="list-meta">
        {plural(l.itemCount, "business", "businesses")} · owned by{" "}
        {l.ownerUserId === me.user.id ? "you" : memberName(l.ownerUserId)} · updated{" "}
        {formatRelative(l.updatedAt)}
      </p>

      <DataTable
        caption={`Businesses in ${l.name}`}
        columns={columns}
        data={rows}
        getRowId={(r) => r.businessId}
        loading={items.isPending}
        skeletonRows={5}
        error={
          itemsError ? (
            <ErrorState
              title="Could not load the list's businesses"
              message={friendlyMessage(itemsError)}
              requestId={requestIdOf(itemsError)}
              onRetry={() => void items.refetch()}
            />
          ) : undefined
        }
        empty={
          <EmptyState
            icon={ListX}
            title="This list is empty"
            description="Add businesses with Add businesses, or select them in the directory and choose Add to list."
            action={
              canEdit ? (
                <Button onClick={() => setAddOpen(true)}>
                  <ListPlus aria-hidden /> Add businesses
                </Button>
              ) : undefined
            }
          />
        }
        enableRowSelection={canEdit}
        rowSelection={selection}
        onRowSelectionChange={(u) => setSelection(typeof u === "function" ? u(selection) : u)}
        bulkActions={({ ids }) => (
          <Button variant="destructive" size="sm" onClick={() => setRemoving({ ids })}>
            <X aria-hidden /> Remove from list
          </Button>
        )}
        mobileCards
        footer={
          itemsError || (rows.length === 0 && cursors.length === 1) ? null : (
            <Pagination
              hasPrevious={cursors.length > 1}
              hasNext={Boolean(items.data?.meta.nextCursor)}
              onPrevious={() => setCursors(cursors.slice(0, -1))}
              onNext={() => {
                const next = items.data?.meta.nextCursor;
                if (next) setCursors([...cursors, next]);
              }}
              pageSize={pageSize}
              pageSizeOptions={[...PAGE_SIZES]}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setCursors([null]);
              }}
              pageCount={rows.length}
              totalCount={l.itemCount}
              loading={items.isFetching && items.isPlaceholderData}
              itemLabel="businesses"
            />
          )
        }
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title={
          removing?.name
            ? `Remove ${removing.name} from the list?`
            : `Remove ${plural(removing?.ids.length ?? 0, "business", "businesses")} from the list?`
        }
        description="Only the list changes. The businesses, their leads and their activity stay as they are."
        confirmLabel="Remove from list"
        confirmPhrase={
          removing && removing.ids.length >= PHRASE_AT ? `REMOVE ${removing.ids.length}` : undefined
        }
        loading={remove.isPending}
        onConfirm={doRemove}
      />
      {canEdit ? (
        <>
          <AddBusinessesDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            listId={l.id}
            listName={l.name}
          />
          <ListFormDialog open={editOpen} onOpenChange={setEditOpen} list={l} />
          <DeleteListDialog list={deleteOpen ? l : null} onOpenChange={setDeleteOpen} redirect />
        </>
      ) : null}
      {canExport ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          request={{ kind: "list", listId: l.id }}
          what={`the list “${l.name}”`}
          count={l.itemCount}
        />
      ) : null}
    </div>
  );
}
