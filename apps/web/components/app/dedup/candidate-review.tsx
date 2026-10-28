"use client";

import type { DuplicateCandidate } from "@leadforge/contracts";
import { ArrowLeft, Clock, GitMerge, Link2, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  toast,
} from "@leadforge/ui";
import { renderBreadcrumbLink } from "@/components/app/businesses/shared";
import { isApiError } from "@/lib/api";
import { candidateStatusMeta, pairTitle, stageLabel } from "@/lib/dedup";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useCandidate, useDeferCandidate, useRejectCandidate } from "@/lib/hooks/use-dedup";
import { useMemberNames } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { CandidateCompare, CandidateSignals } from "./candidate-compare";
import { MergeDialog } from "./merge-dialog";

export function CandidateReviewSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading possible duplicate"
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}

function isNotFound(err: unknown): boolean {
  return isApiError(err) && (err.status === 404 || err.code === "VALIDATION_FAILED");
}

const CRUMBS = [
  { label: "Businesses", href: "/app/businesses" },
  { label: "Duplicate review", href: "/app/businesses/duplicates" },
];

/**
 * Review one candidate pair (/app/businesses/duplicates/[id]): the two businesses side by side,
 * the reasons and signals behind the proposal, and Merge, Not duplicates and Decide later.
 * Nothing merges without this decision.
 */
export function CandidateReview({ id }: { id: string }) {
  const candidate = useCandidate(id);
  if (candidate.isPending) return <CandidateReviewSkeleton />;
  if (candidate.isError && !candidate.data) {
    if (isNotFound(candidate.error)) {
      return (
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            items={[...CRUMBS, { label: "Not found" }]}
            renderLink={renderBreadcrumbLink}
          />
          <PageHeader title="Possible duplicate not found" />
          <EmptyState
            icon={SearchX}
            title="We could not find this pair"
            description="The link may be wrong, or the pair belongs to another workspace."
            action={
              <Button asChild>
                <Link href="/app/businesses/duplicates">
                  <ArrowLeft aria-hidden /> Back to duplicate review
                </Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Possible duplicate" />
        <ErrorState
          title="Could not load this pair"
          message={friendlyMessage(candidate.error)}
          requestId={requestIdOf(candidate.error)}
          onRetry={() => void candidate.refetch()}
        />
      </div>
    );
  }
  return <ReviewView candidate={candidate.data} />;
}

function ReviewView({ candidate: c }: { candidate: DuplicateCandidate }) {
  const router = useRouter();
  const { canWriteDedup } = usePermissions();
  const memberName = useMemberNames();
  const reject = useRejectCandidate(c.id);
  const defer = useDeferCandidate(c.id);
  const [dialog, setDialog] = useState<"merge" | "reject" | null>(null);
  const meta = candidateStatusMeta(c.status);
  const open = c.status === "pending" || c.status === "deferred";
  const title = pairTitle(c);

  const onDecisionError = (label: string) => (err: unknown) => {
    setDialog(null);
    toast.error(isForbidden(err) ? "Your role cannot review duplicates" : label, {
      description:
        isApiError(err) && err.status === 409
          ? "This pair was already decided or changed. The review has been refreshed."
          : friendlyMessage(err),
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[...CRUMBS, { label: title }]} renderLink={renderBreadcrumbLink} />
        }
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            Possible duplicate
            <Badge
              variant={
                meta.tone === "success" ? "success" : meta.tone === "info" ? "info" : "neutral"
              }
              data-testid="candidate-status"
            >
              {meta.label}
            </Badge>
          </span>
        }
        title={<span className="break-anywhere">{title}</span>}
        description={`${stageLabel(c.stage)} · match score ${Math.round(c.score * 100)}% · found ${formatDateTime(c.createdAt)}. LeadForge never merges on its own: review the evidence and decide.`}
        actions={
          canWriteDedup && open ? (
            <>
              <Button onClick={() => setDialog("merge")}>
                <GitMerge aria-hidden /> Merge…
              </Button>
              <Button variant="outline" onClick={() => setDialog("reject")}>
                <X aria-hidden /> Not duplicates
              </Button>
              {c.status === "pending" ? (
                <Button
                  variant="text"
                  loading={defer.isPending}
                  onClick={() =>
                    defer.mutate(undefined, {
                      onSuccess: () => {
                        toast.success("Deferred", {
                          description: "The pair moved to Deferred. Decide on it later.",
                        });
                        router.push("/app/businesses/duplicates");
                      },
                      onError: onDecisionError("Could not defer"),
                    })
                  }
                >
                  <Clock aria-hidden /> Decide later
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {!open ? (
        <Banner
          tone={c.status === "merged" ? "success" : "info"}
          title={meta.label}
          description={
            <span className="flex flex-col gap-1">
              <span>{meta.description}</span>
              {c.decidedAt ? (
                <span className="text-xs">
                  Decided by {memberName(c.decidedByUserId)} on {formatDateTime(c.decidedAt)}.
                </span>
              ) : null}
            </span>
          }
          actions={
            c.status === "merged" ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/app/businesses/duplicates?view=history">Merge history</Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {!canWriteDedup && open ? (
        <Banner
          tone="info"
          title="View only"
          description="Owners, administrators and researchers decide on duplicates. You can review the evidence."
        />
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Side by side</CardTitle>
            <CardDescription>
              Current values of both records. Matching values are marked Same.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CandidateCompare candidate={c} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Why they were paired</CardTitle>
            <CardDescription>
              A name match alone is never proposed; each pair shares an identifier or a place.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <ul className="flex min-w-0 flex-col gap-2 text-sm" aria-label="Reasons">
              {c.reasons.map((r) => (
                <li key={r} className="break-anywhere flex min-w-0 gap-2">
                  <Link2 aria-hidden className="text-info mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
            <CandidateSignals candidate={c} />
            <p className="text-muted-foreground border-border border-t pt-3 text-xs">
              Found by duplicate detection on {formatDateTime(c.createdAt)} · updated{" "}
              {formatDateTime(c.updatedAt)}
            </p>
          </CardContent>
        </Card>
      </div>

      {canWriteDedup && open ? (
        <>
          <MergeDialog
            candidate={c}
            open={dialog === "merge"}
            onOpenChange={(o) => setDialog(o ? "merge" : null)}
            onMerged={(res) => {
              toast.success("Businesses merged", {
                description: "Undo it from the merge history if this was a mistake.",
              });
              router.push(`/app/businesses/${res.merge.survivorId}?tab=duplicates`);
            }}
          />
          <ConfirmDialog
            open={dialog === "reject"}
            onOpenChange={(o) => setDialog(o ? "reject" : null)}
            title="Mark as not duplicates?"
            description="Both businesses stay as they are, and this pair is never proposed again."
            confirmLabel="Not duplicates"
            loading={reject.isPending}
            onConfirm={() =>
              reject.mutate(undefined, {
                onSuccess: () => {
                  setDialog(null);
                  toast.success("Marked as not duplicates");
                  router.push("/app/businesses/duplicates");
                },
                onError: onDecisionError("Could not save the decision"),
              })
            }
          />
        </>
      ) : null}
    </div>
  );
}
