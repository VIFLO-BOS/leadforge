"use client";

import { ANALYSIS_LIMITS, type CreateAnalysisResponse } from "@leadforge/contracts";
import { CircleCheck, Clock, Globe, SkipForward } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StatusIndicator,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { skipLabel } from "@/lib/analysis";
import { creditShortfall, friendlyMessage, isBillingBlock, isForbidden } from "@/lib/errors";
import { isPendingDeletion } from "@/lib/org-lifecycle";
import { PendingDeletionNotice } from "@/components/app/pending-deletion-notice";
import { BillingBlockBanner } from "@/components/app/billing/billing-shared";
import { formatNumber, plural } from "@/lib/format";
import { useRequestAnalysis } from "@/lib/hooks/use-analysis";
import { useCreditBalance } from "@/lib/hooks/use-credits";

export interface BulkAnalyzeDialogProps {
  /** Selected business ids (across pages). */
  ids: string[];
  /** Names the caller knows (rows on the current page), keyed by id, for the results list. */
  names: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful request so the caller can clear the selection. */
  onDone?: () => void;
}

/**
 * Bulk website analysis for up to 50 selected businesses: a confirmation with the credit
 * estimate (1 credit held per new analysis), then the results (started, already in progress,
 * skipped with reasons) and a link to the batch on the analyses page.
 */
export function BulkAnalyzeDialog({
  ids,
  names,
  open,
  onOpenChange,
  onDone,
}: BulkAnalyzeDialogProps) {
  const request = useRequestAnalysis();
  const balance = useCreditBalance(open);
  const [result, setResult] = useState<CreateAnalysisResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const tooMany = ids.length > ANALYSIS_LIMITS.bulkMax;
  const maxCredits = ids.length * ANALYSIS_LIMITS.creditsPerAnalysis;

  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
    }
  }, [open]);

  const submit = () => {
    setError(null);
    request.mutate(
      { businessIds: ids },
      {
        onSuccess: (res) => {
          setResult(res);
          onDone?.();
        },
        onError: setError,
      },
    );
  };

  const nameOf = (id: string) => names[id] ?? names[id.toLowerCase()] ?? `Business ${id.slice(-6)}`;
  const shortfall = creditShortfall(error);

  return (
    <Dialog open={open} onOpenChange={(o) => (request.isPending ? undefined : onOpenChange(o))}>
      <DialogContent size="md" data-testid="bulk-analyze-dialog">
        {result ? (
          <BulkResult result={result} nameOf={nameOf} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <DialogHeader className="pr-12">
              <DialogTitle>Analyze {plural(ids.length, "website", "websites")}?</DialogTitle>
              <DialogDescription>
                Each analysis fetches the business&apos;s own website (static HTML only) and reports
                what it observed, with evidence.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4 pb-2">
              {tooMany ? (
                <Banner
                  tone="warning"
                  title={`Select at most ${ANALYSIS_LIMITS.bulkMax} businesses`}
                  description={`${formatNumber(ids.length)} are selected. Clear some and try again; one request analyzes up to ${ANALYSIS_LIMITS.bulkMax}.`}
                />
              ) : (
                <dl className="bg-surface-container-low grid min-w-0 grid-cols-1 gap-3 rounded-md p-4 text-sm min-[400px]:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-muted-foreground text-xs">Credits held at most</dt>
                    <dd className="text-xl tabular-nums" data-testid="bulk-credit-estimate">
                      {formatNumber(maxCredits)}
                    </dd>
                    <dd className="text-muted-foreground text-xs">1 credit per new analysis</dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-muted-foreground text-xs">Available now</dt>
                    <dd className="text-xl tabular-nums">
                      {balance.data ? formatNumber(balance.data.balance) : "Checking"}
                    </dd>
                    <dd className="text-muted-foreground text-xs">From your credit balance</dd>
                  </div>
                </dl>
              )}
              <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm">
                <li>
                  A credit is held when an analysis is queued, charged when it completes and
                  released if it fails.
                </li>
                <li>
                  Businesses without a website, suppressed businesses and businesses already being
                  analyzed are skipped at no cost.
                </li>
                <li>You get a notification when every analysis of this request has finished.</li>
              </ul>
              {error && isPendingDeletion(error) ? (
                <PendingDeletionNotice error={error} outcome="Nothing was queued." />
              ) : error && isBillingBlock(error) ? (
                <BillingBlockBanner error={error} />
              ) : error ? (
                <Banner
                  tone="destructive"
                  title={
                    shortfall
                      ? "Not enough credits"
                      : isForbidden(error)
                        ? "Your role cannot run website analyses"
                        : "Could not start the analyses"
                  }
                  description={
                    shortfall
                      ? `These analyses need ${formatNumber(shortfall.required)} credits and ${formatNumber(shortfall.available)} are available. Nothing was queued. Select fewer businesses.`
                      : friendlyMessage(error)
                  }
                />
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button
                variant="text"
                onClick={() => onOpenChange(false)}
                disabled={request.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={submit}
                loading={request.isPending}
                disabled={
                  tooMany ||
                  ids.length === 0 ||
                  (isApiError(error) && (Boolean(shortfall) || isBillingBlock(error)))
                }
              >
                <Globe aria-hidden /> Analyze websites
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkResult({
  result,
  nameOf,
  onClose,
}: {
  result: CreateAnalysisResponse;
  nameOf: (id: string) => string;
  onClose: () => void;
}) {
  const inProgress = new Set(result.alreadyInProgress);
  const started = result.analyses.filter((a) => !inProgress.has(a.id));
  const running = result.analyses.filter((a) => inProgress.has(a.id));
  const batchHref = result.batchId ? `/app/analysis?batchId=${result.batchId}` : null;
  return (
    <>
      <DialogHeader className="pr-12">
        <DialogTitle>
          {started.length
            ? `${plural(started.length, "analysis", "analyses")} started`
            : "No new analyses started"}
        </DialogTitle>
        <DialogDescription>
          {plural(result.credits.held, "credit is", "credits are")} held for this request.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 pb-2" data-testid="bulk-analyze-result">
        <ul className="flex min-w-0 flex-col gap-2 text-sm">
          <li className="flex min-w-0 items-start gap-2">
            <StatusIndicator
              tone="success"
              icon={CircleCheck}
              label={`Started: ${formatNumber(started.length)}`}
            />
          </li>
          <li className="flex min-w-0 items-start gap-2">
            <StatusIndicator
              tone="info"
              icon={Clock}
              label={`Already in progress: ${formatNumber(running.length)}`}
            />
          </li>
          <li className="flex min-w-0 items-start gap-2">
            <StatusIndicator
              tone="neutral"
              icon={SkipForward}
              label={`Skipped: ${formatNumber(result.skipped.length)}`}
            />
          </li>
        </ul>
        {running.length ? (
          <p className="text-muted-foreground text-xs">
            Already being analyzed (no new credit held):{" "}
            {running.map((a) => a.business?.name ?? nameOf(a.businessId)).join(", ")}
          </p>
        ) : null}
        {result.skipped.length ? (
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">Skipped, not charged</h3>
            <ul className="divide-border flex min-w-0 flex-col divide-y text-sm">
              {result.skipped.map((s) => (
                <li key={s.businessId} className="flex min-w-0 flex-col gap-0.5 py-2">
                  <Link
                    href={`/app/businesses/${s.businessId}`}
                    className="text-primary break-anywhere rounded-xs hover:underline"
                  >
                    {nameOf(s.businessId)}
                  </Link>
                  <span className="text-muted-foreground text-xs">{skipLabel(s.code)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
        {batchHref ? (
          <Button asChild>
            <Link href={batchHref}>View these analyses</Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/app/analysis">All analyses</Link>
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
