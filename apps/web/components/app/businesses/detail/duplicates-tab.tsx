"use client";

import type { BusinessDetail, DuplicateCandidate } from "@leadforge/contracts";
import { ArrowRight, CopyCheck } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyableValue,
  EmptyState,
  ErrorState,
  Skeleton,
} from "@leadforge/ui";
import { MergeHistory } from "@/components/app/dedup/merge-history";
import { UNDO_RULE, candidateName, candidateStatusMeta, stageLabel } from "@/lib/dedup";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useCandidates } from "@/lib/hooks/use-dedup";

function CandidateRow({
  candidate,
  businessId,
}: {
  candidate: DuplicateCandidate;
  businessId: string;
}) {
  const other = candidate.businesses.find((b) => b.id !== businessId) ?? candidate.businesses[1];
  return (
    <li
      className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 min-[640px]:flex-row min-[640px]:items-start min-[640px]:justify-between"
      data-candidate={candidate.id}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm">
          Possibly the same as{" "}
          {other?.live ? (
            <Link
              href={`/app/businesses/${other.id}`}
              className="text-primary break-anywhere rounded-xs font-medium hover:underline"
            >
              {candidateName(other)}
            </Link>
          ) : (
            <span className="break-anywhere font-medium">
              {other ? candidateName(other) : "another business"}
            </span>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          {stageLabel(candidate.stage)} ·{" "}
          <span className="tabular-nums">{Math.round(candidate.score * 100)}%</span> match · found{" "}
          {formatDate(candidate.createdAt)}
        </p>
        <ul
          className="text-muted-foreground flex min-w-0 flex-col gap-0.5 text-xs"
          aria-label="Reasons"
        >
          {candidate.reasons.slice(0, 3).map((r) => (
            <li key={r} className="break-anywhere">
              {r}
            </li>
          ))}
        </ul>
        <span>
          <Badge variant="neutral">{candidateStatusMeta(candidate.status).label}</Badge>
        </span>
      </div>
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link href={`/app/businesses/duplicates/${candidate.id}`}>
          Review <ArrowRight aria-hidden />
        </Link>
      </Button>
    </li>
  );
}

/**
 * Duplicates tab: candidate pairs involving this business, its merge history with undo, and the
 * records already merged into it.
 */
export function DuplicatesTab({ detail }: { detail: BusinessDetail }) {
  const candidates = useCandidates({
    businessId: detail.id,
    status: ["pending", "deferred"],
    pageSize: 25,
  });
  const rows = candidates.data?.data ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="duplicates-tab">
      <Card>
        <CardHeader>
          <CardTitle>Possible duplicates</CardTitle>
          <CardDescription>
            Pairs waiting for a decision. A pair is proposed only when the records share a phone,
            email or website domain, or a similar name in the same place.{" "}
            <Link href="/app/businesses/duplicates" className="link-inline rounded-xs">
              Open the duplicate review queue
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.isPending ? (
            <Skeleton className="h-24" />
          ) : candidates.isError ? (
            <ErrorState
              title="Could not load possible duplicates"
              message={friendlyMessage(candidates.error)}
              requestId={requestIdOf(candidates.error)}
              onRetry={() => void candidates.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              size="compact"
              icon={CopyCheck}
              title="No possible duplicates"
              description="Duplicate detection runs after imports, discovery, corrections and enrichment. Nothing is waiting for review for this business."
            />
          ) : (
            <ul
              className="divide-border flex min-w-0 flex-col divide-y"
              aria-label="Possible duplicates"
            >
              {rows.map((c) => (
                <CandidateRow key={c.id} candidate={c} businessId={detail.id} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Merge history</CardTitle>
          <CardDescription>
            Merges this business took part in, newest first. {UNDO_RULE}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MergeHistory
            businessId={detail.id}
            businessName={detail.name.value ?? "this business"}
            emptyHint="This business has not been merged with another."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Records merged into this one</CardTitle>
          <CardDescription>
            Their provenance and verification history are listed with this business. Undo a merge to
            bring one back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.dedup.absorbedIds.length ? (
            <ul className="flex min-w-0 flex-col gap-2" aria-label="Absorbed records">
              {detail.dedup.absorbedIds.map((id) => (
                <li key={id} className="min-w-0">
                  <CopyableValue value={id} label="merged record ID" mono />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No other record has been merged into this one.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
