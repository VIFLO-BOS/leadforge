"use client";

import type { DuplicateCandidate } from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, CopyCheck, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@leadforge/ui";
import { CellBox, renderBreadcrumbLink } from "@/components/app/businesses/shared";
import {
  UNDO_RULE,
  candidateName,
  candidateStatusMeta,
  parseDedupView,
  serializeDedupView,
  stageLabel,
  type DedupView,
} from "@/lib/dedup";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDate, formatRelative } from "@/lib/format";
import { useCandidates, useDedupScan } from "@/lib/hooks/use-dedup";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { MergeHistory } from "./merge-history";

const VIEW_STATUSES: Record<Exclude<DedupView, "history">, string[]> = {
  pending: ["pending"],
  deferred: ["deferred"],
  merged: ["merged", "superseded"],
  rejected: ["rejected"],
};

const VIEW_LABELS: Record<DedupView, string> = {
  pending: "Pending",
  deferred: "Deferred",
  merged: "Merged",
  rejected: "Not duplicates",
  history: "Merge history",
};

function PairCell({ c }: { c: DuplicateCandidate }) {
  const [a, b] = c.businesses;
  return (
    <CellBox width="18rem" className="flex flex-col gap-0.5">
      <Link
        href={`/app/businesses/duplicates/${c.id}`}
        className="text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
      >
        {a ? candidateName(a) : "Business A"}
      </Link>
      <span className="text-muted-foreground break-words text-xs">
        and {b ? candidateName(b) : "business B"}
      </span>
    </CellBox>
  );
}

const COLUMNS: ColumnDef<DuplicateCandidate>[] = [
  {
    id: "pair",
    header: "Pair",
    meta: { mobileTitle: true, label: "Pair" },
    cell: ({ row }) => <PairCell c={row.original} />,
  },
  {
    id: "why",
    header: "Why",
    meta: { label: "Why" },
    cell: ({ row }) => (
      <CellBox width="18rem" className="flex flex-col gap-0.5">
        <span>{stageLabel(row.original.stage)}</span>
        {row.original.reasons[0] ? (
          <span className="text-muted-foreground break-words text-xs">
            {row.original.reasons[0]}
          </span>
        ) : null}
      </CellBox>
    ),
  },
  {
    id: "score",
    header: "Match",
    meta: { label: "Match score", align: "end" },
    cell: ({ row }) => (
      <span className="tabular-nums">{Math.round(row.original.score * 100)}%</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => (
      <Badge variant="neutral">{candidateStatusMeta(row.original.status).label}</Badge>
    ),
  },
  {
    id: "found",
    header: "Found",
    meta: { label: "Found" },
    cell: ({ row }) => (
      <CellBox width="8rem" className="flex flex-col gap-0.5">
        <span>{formatDate(row.original.createdAt)}</span>
        <span className="text-muted-foreground text-xs">
          {formatRelative(row.original.createdAt)}
        </span>
      </CellBox>
    ),
  },
  {
    id: "review",
    header: () => <span className="sr-only">Review</span>,
    meta: { label: "Review", align: "end", mobileActions: true },
    cell: ({ row }) => (
      <Button asChild variant="text" size="sm">
        <Link
          href={`/app/businesses/duplicates/${row.original.id}`}
          aria-label={`Review ${candidateName(row.original.businesses[0] ?? { name: null, nameState: "missing" })} pair`}
        >
          Review <ArrowRight aria-hidden />
        </Link>
      </Button>
    ),
  },
];

function CandidateCard({ c }: { c: DuplicateCandidate }) {
  const [a, b] = c.businesses;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          href={`/app/businesses/duplicates/${c.id}`}
          className="break-anywhere rounded-xs text-sm font-medium hover:underline"
        >
          {a ? candidateName(a) : "Business A"}
        </Link>
        <span className="text-muted-foreground break-anywhere text-xs">
          and {b ? candidateName(b) : "business B"}
        </span>
      </div>
      <p className="text-[13px]">
        {stageLabel(c.stage)} · <span className="tabular-nums">{Math.round(c.score * 100)}%</span>{" "}
        match
      </p>
      {c.reasons[0] ? (
        <p className="text-muted-foreground break-anywhere text-xs">{c.reasons[0]}</p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Badge variant="neutral">{candidateStatusMeta(c.status).label}</Badge>
        <Button asChild variant="outline" size="sm">
          <Link href={`/app/businesses/duplicates/${c.id}`}>Review</Link>
        </Button>
      </div>
    </div>
  );
}

function CandidateList({ view }: { view: Exclude<DedupView, "history"> }) {
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: view,
    cursors: [null],
  });
  const cursors = pager.key === view ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const list = useCandidates({
    status: VIEW_STATUSES[view],
    pageSize: 25,
    cursor: cursor ?? undefined,
  });
  const rows = list.data?.data ?? [];
  const listError = list.isError && !list.data ? list.error : null;
  return (
    <DataTable
      caption={`${VIEW_LABELS[view]} duplicate candidates`}
      columns={COLUMNS}
      data={rows}
      getRowId={(r) => r.id}
      loading={list.isPending}
      skeletonRows={5}
      error={
        listError ? (
          <ErrorState
            title={
              isForbidden(listError)
                ? "You cannot view duplicate candidates"
                : "Could not load duplicate candidates"
            }
            message={friendlyMessage(listError)}
            requestId={requestIdOf(listError)}
            onRetry={isForbidden(listError) ? undefined : () => void list.refetch()}
          />
        ) : undefined
      }
      empty={
        <EmptyState
          size={view === "pending" ? "default" : "compact"}
          icon={CopyCheck}
          title={
            view === "pending"
              ? "Nothing to review"
              : view === "deferred"
                ? "No deferred pairs"
                : view === "merged"
                  ? "No merged pairs yet"
                  : "No pairs marked as not duplicates"
          }
          description={
            view === "pending"
              ? "Possible duplicates appear here after imports, discovery, corrections and enrichment. A pair is proposed only when the records share a phone, email or website domain, or a similar name in the same place."
              : "Pairs move here when a reviewer decides on them."
          }
        />
      }
      mobileCards={{ render: (row) => <CandidateCard c={row} /> }}
      footer={
        listError || (rows.length === 0 && cursors.length === 1) ? null : (
          <Pagination
            hasPrevious={cursors.length > 1}
            hasNext={Boolean(list.data?.meta.nextCursor)}
            onPrevious={() => setPager({ key: view, cursors: cursors.slice(0, -1) })}
            onNext={() => {
              const next = list.data?.meta.nextCursor;
              if (next) setPager({ key: view, cursors: [...cursors, next] });
            }}
            pageSize={25}
            pageCount={rows.length}
            loading={list.isFetching && list.isPlaceholderData}
            itemLabel={rows.length === 1 ? "pair" : "pairs"}
          />
        )
      }
    />
  );
}

/**
 * Duplicate review (/app/businesses/duplicates): candidate pairs by status (pending, deferred,
 * merged, not duplicates) highest score first, and the merge history with undo. The view is in
 * the URL (`?view=`).
 */
export function DuplicatesPage() {
  const { canWriteDedup } = usePermissions();
  const [view, setView] = useUrlState(parseDedupView, serializeDedupView);
  const scan = useDedupScan();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Businesses", href: "/app/businesses" },
              { label: "Duplicate review" },
            ]}
            renderLink={renderBreadcrumbLink}
          />
        }
        eyebrow="Workspace"
        title="Duplicate review"
        description="Possible duplicates with the evidence behind each pair. Nothing is merged without a reviewer, and every merge can be undone."
        actions={
          canWriteDedup ? (
            <Button
              variant="outline"
              loading={scan.isPending}
              onClick={() =>
                scan.mutate(undefined, {
                  onSuccess: () =>
                    toast.success("Scan queued", {
                      description:
                        "New pairs appear under Pending once the worker has checked every business.",
                    }),
                  onError: (err) =>
                    toast.error("Could not start a scan", { description: friendlyMessage(err) }),
                })
              }
            >
              <ScanSearch aria-hidden /> Scan for duplicates
            </Button>
          ) : undefined
        }
      />
      <Tabs value={view} onValueChange={(v) => setView(v as DedupView, { push: true })}>
        <TabsList aria-label="Duplicate review views">
          {(Object.keys(VIEW_LABELS) as DedupView[]).map((v) => (
            <TabsTrigger key={v} value={v}>
              {VIEW_LABELS[v]}
            </TabsTrigger>
          ))}
        </TabsList>
        {(["pending", "deferred", "merged", "rejected"] as const).map((v) => (
          <TabsContent key={v} value={v}>
            {view === v ? <CandidateList view={v} /> : null}
          </TabsContent>
        ))}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Merge history</CardTitle>
              <CardDescription>Newest first. {UNDO_RULE}</CardDescription>
            </CardHeader>
            <CardContent>{view === "history" ? <MergeHistory /> : null}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
