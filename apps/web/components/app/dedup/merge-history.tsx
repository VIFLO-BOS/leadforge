"use client";

import type { MergeRecord } from "@leadforge/contracts";
import { GitMerge, History, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  StatusIndicator,
  toast,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { MERGE_FIELD_LABELS, UNDO_RULE, candidateName } from "@/lib/dedup";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useCandidate, useMerges, useUndoMerge } from "@/lib/hooks/use-dedup";
import { useMemberNames } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";

/**
 * Names for the records of a merge. From Phase 6 the merge record carries them (`survivorName`,
 * `mergedNames`, null when a name was not stored or has expired); older records fall back to the
 * candidate's businesses, fetched only then.
 */
export function useMergeNames(merge: MergeRecord): Record<string, string> {
  const carried = merge.survivorName !== undefined || merge.mergedNames !== undefined;
  const candidate = useCandidate(
    merge.candidateId ?? "none",
    !carried && Boolean(merge.candidateId),
  );
  const out: Record<string, string> = {};
  if (carried) {
    if (merge.survivorName) out[merge.survivorId] = merge.survivorName;
    for (const m of merge.mergedNames ?? []) if (m.name) out[m.id] = m.name;
    return out;
  }
  if (merge.candidateId && candidate.data) {
    for (const b of candidate.data.businesses) out[b.id] = candidateName(b);
  }
  return out;
}

function nameOr(names: Record<string, string>, id: string): string {
  return names[id] ?? "Name not available";
}

/**
 * One merge: which record survived, which were merged, the field decisions, who did it and when,
 * and Undo when the caller may (the API's `canUndo`: owners and admins, or the performer within
 * 30 days). An undo over later changes answers 409 MERGE_CONFLICT; the dialog explains and offers
 * to undo anyway (`force`), which discards those changes.
 */
export function MergeRecordItem({
  merge,
  self,
}: {
  merge: MergeRecord;
  /** The business whose page lists this merge, named when the merge record has no candidate. */
  self?: { id: string; name: string };
}) {
  const { canWriteDedup } = usePermissions();
  const names = { ...(self ? { [self.id]: self.name } : {}), ...useMergeNames(merge) };
  const memberName = useMemberNames();
  const undo = useUndoMerge();
  const [step, setStep] = useState<"closed" | "confirm" | "force">("closed");
  const applied = merge.status === "applied";
  const survivor = nameOr(names, merge.survivorId);
  const merged = merge.mergedIds.map((id) => nameOr(names, id));

  const run = (force: boolean) =>
    undo.mutate(
      { merge, force },
      {
        onSuccess: () => {
          setStep("closed");
          toast.success("Merge undone", {
            description: force
              ? "Both records were restored from their snapshots; later changes were discarded (they stay in provenance)."
              : "Both records are back exactly as they were before the merge.",
          });
        },
        onError: (err) => {
          if (isApiError(err) && err.code === "MERGE_CONFLICT") {
            setStep("force");
            return;
          }
          setStep("closed");
          toast.error(
            isForbidden(err) ? "You cannot undo this merge" : "Could not undo the merge",
            {
              description: isForbidden(err) ? UNDO_RULE : friendlyMessage(err),
            },
          );
        },
      },
    );

  return (
    <li
      className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0"
      data-merge={merge.id}
      data-merge-status={merge.status}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
          <p className="break-anywhere text-sm">
            <span className="font-medium">{merged.join(", ")}</span> merged into
          </p>
          {applied ? (
            <Link
              href={`/app/businesses/${merge.survivorId}`}
              className="text-primary break-anywhere rounded-xs block w-fit max-w-full text-sm font-medium hover:underline"
            >
              {survivor}
            </Link>
          ) : (
            <span className="break-anywhere text-sm font-medium">{survivor}</span>
          )}
          <p className="text-muted-foreground text-xs">
            By {memberName(merge.performedByUserId)} on{" "}
            <time dateTime={merge.performedAt}>{formatDateTime(merge.performedAt)}</time>
            {merge.fieldDecisions.length
              ? ` · kept ${merge.fieldDecisions
                  .map(
                    (d) =>
                      `${MERGE_FIELD_LABELS[d.field].toLowerCase()} from ${d.chosenFrom === merge.survivorId ? "the survivor" : "the merged record"}`,
                  )
                  .join(", ")}`
              : ""}
          </p>
          {applied ? (
            <StatusIndicator tone="success" icon={GitMerge} label="Applied" size="sm" />
          ) : (
            <StatusIndicator
              tone="neutral"
              icon={Undo2}
              size="sm"
              label={`Undone by ${memberName(merge.undoneByUserId)}${merge.undoneAt ? ` on ${formatDateTime(merge.undoneAt)}` : ""}${merge.undoForced ? " (later changes discarded)" : ""}`}
            />
          )}
        </div>
        {applied && canWriteDedup ? (
          merge.canUndo ? (
            <Button variant="outline" size="sm" onClick={() => setStep("confirm")}>
              <Undo2 aria-hidden /> Undo merge
            </Button>
          ) : (
            <p
              className="text-muted-foreground max-w-[18rem] text-xs"
              data-testid="undo-not-allowed"
            >
              You cannot undo this merge. {UNDO_RULE}
            </p>
          )
        ) : null}
      </div>

      <ConfirmDialog
        open={step === "confirm"}
        onOpenChange={(o) => !o && setStep("closed")}
        title="Undo this merge?"
        description={`${merged.join(", ")} comes back as a separate business and ${survivor} returns to exactly how it was before the merge. The candidate pair is reopened for review.`}
        confirmLabel="Undo merge"
        loading={undo.isPending}
        onConfirm={() => run(false)}
      />
      <ConfirmDialog
        open={step === "force"}
        onOpenChange={(o) => !o && setStep("closed")}
        title="These records changed after the merge"
        description="Someone edited, enriched or merged one of these businesses after this merge. Undoing now restores both records from their snapshots and discards those later changes."
        confirmLabel="Undo anyway"
        destructive
        loading={undo.isPending}
        onConfirm={() => run(true)}
      >
        <Banner
          tone="warning"
          title="Later changes will be discarded"
          description="The observations behind them stay in each record's provenance, so nothing is lost from the audit trail. Choose Cancel to keep the merge."
        />
      </ConfirmDialog>
    </li>
  );
}

/** Merge history, newest first, optionally for one business (as survivor or merged). */
export function MergeHistory({
  businessId,
  businessName,
  emptyHint,
}: {
  businessId?: string;
  businessName?: string;
  emptyHint?: string;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const merges = useMerges({ businessId, pageSize: 10, cursor: cursor ?? undefined });
  const rows = merges.data?.data ?? [];

  if (merges.isPending) {
    return (
      <div
        className="flex flex-col gap-3"
        role="status"
        aria-busy="true"
        aria-label="Loading merge history"
      >
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }
  if (merges.isError && !merges.data) {
    return (
      <ErrorState
        title="Could not load the merge history"
        message={friendlyMessage(merges.error)}
        requestId={requestIdOf(merges.error)}
        onRetry={() => void merges.refetch()}
      />
    );
  }
  if (rows.length === 0 && cursors.length === 1) {
    return (
      <EmptyState
        size="compact"
        icon={History}
        title="No merges yet"
        description={
          emptyHint ?? "Merges appear here with who made them, so any of them can be undone."
        }
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ul className="divide-border flex min-w-0 flex-col divide-y" aria-label="Merge history">
        {rows.map((m) => (
          <MergeRecordItem
            key={m.id}
            merge={m}
            self={businessId && businessName ? { id: businessId, name: businessName } : undefined}
          />
        ))}
      </ul>
      {cursors.length > 1 || merges.data?.meta.nextCursor ? (
        <Pagination
          hasPrevious={cursors.length > 1}
          hasNext={Boolean(merges.data?.meta.nextCursor)}
          onPrevious={() => setCursors(cursors.slice(0, -1))}
          onNext={() => {
            const next = merges.data?.meta.nextCursor;
            if (next) setCursors([...cursors, next]);
          }}
          pageSize={10}
          pageCount={rows.length}
          loading={merges.isFetching && merges.isPlaceholderData}
          itemLabel={rows.length === 1 ? "merge" : "merges"}
        />
      ) : null}
    </div>
  );
}
