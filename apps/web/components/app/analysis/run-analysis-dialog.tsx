"use client";

import type { WebsiteAnalysis } from "@leadforge/contracts";
import { useEffect, useState } from "react";
import { Banner, ConfirmDialog, toast } from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { creditShortfall, friendlyMessage, isBillingBlock, isForbidden } from "@/lib/errors";
import { isPendingDeletion } from "@/lib/org-lifecycle";
import { PENDING_DELETION_TITLE } from "@/components/app/pending-deletion-notice";
import { BillingBlockBanner } from "@/components/app/billing/billing-shared";
import { formatNumber } from "@/lib/format";
import { useRequestAnalysis } from "@/lib/hooks/use-analysis";
import { useCreditBalance } from "@/lib/hooks/use-credits";

export interface RunAnalysisDialogProps {
  businessId: string;
  /** The website that will be fetched, shown in the confirmation. */
  website: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The new analysis, or the one already queued or running for this business. */
  onStarted?: (analysis: WebsiteAnalysis, alreadyInProgress: boolean) => void;
  title?: string;
}

/** Readable title and message for a failed single analysis request. */
export function analysisRequestError(err: unknown): { title: string; message: string } {
  const shortfall = creditShortfall(err);
  if (shortfall) {
    return {
      title: "Not enough credits",
      message: `A website analysis needs ${formatNumber(shortfall.required)} credit and ${formatNumber(shortfall.available)} are available. Nothing was queued.`,
    };
  }
  if (isApiError(err) && err.code === "ENTITLEMENT_REQUIRED") {
    return {
      title: "Website analysis is not in the workspace's plan",
      message: `${friendlyMessage(err)} Nothing was queued.`,
    };
  }
  if (isApiError(err) && err.code === "CREDIT_BALANCE_NEGATIVE") {
    return {
      title: "Credit balance below zero",
      message: `${friendlyMessage(err)} Nothing was queued.`,
    };
  }
  if (isPendingDeletion(err)) {
    return {
      title: PENDING_DELETION_TITLE,
      message: `${friendlyMessage(err)} Nothing was queued.`,
    };
  }
  if (isApiError(err) && err.code === "WEBSITE_MISSING") {
    return {
      title: "No website to analyze",
      message:
        "This business has no usable website on record (none was observed, or it expired). Add its website with Correct details, then try again.",
    };
  }
  if (isApiError(err) && err.code === "CONFLICT") {
    return {
      title: "This business is suppressed",
      message:
        "Suppressed businesses are never fetched. Remove the suppression first if your team should contact this business.",
    };
  }
  if (isForbidden(err)) {
    return {
      title: "Your role cannot run website analyses",
      message: "Owners, administrators and researchers can. Ask one of them if you need it.",
    };
  }
  return { title: "Could not start the analysis", message: friendlyMessage(err) };
}

/**
 * Confirmation for one website analysis (1 credit held when queued, charged on completion,
 * released on failure). Errors stay inside the dialog with a readable reason.
 */
export function RunAnalysisDialog({
  businessId,
  website,
  open,
  onOpenChange,
  onStarted,
  title = "Run a website analysis?",
}: RunAnalysisDialogProps) {
  const request = useRequestAnalysis();
  const balance = useCreditBalance(open);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const run = () => {
    setError(null);
    request.mutate(
      { businessId },
      {
        onSuccess: (res) => {
          const analysis = res.analyses[0];
          const already = analysis ? res.alreadyInProgress.includes(analysis.id) : false;
          onOpenChange(false);
          toast.success(already ? "An analysis is already running" : "Website analysis queued", {
            description: already
              ? "No new credit was held. Its progress shows here."
              : "1 credit is held. It is charged when the analysis completes and released if it fails.",
          });
          if (analysis) onStarted?.(analysis, already);
        },
        onError: setError,
      },
    );
  };

  const failure = error ? analysisRequestError(error) : null;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        <>
          LeadForge fetches{" "}
          {website ? (
            <span className="break-anywhere font-medium">{website}</span>
          ) : (
            "the business's website"
          )}{" "}
          and up to 4 linked pages, then reports what it observed with evidence.
        </>
      }
      confirmLabel="Run analysis (1 credit)"
      loading={request.isPending}
      confirmDisabled={Boolean(
        failure && (creditShortfall(error) || isBillingBlock(error) || isPendingDeletion(error)),
      )}
      onConfirm={run}
    >
      <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm">
        <li>1 credit is held now, charged when the analysis completes and released if it fails.</li>
        <li>An unreachable website is a finding, so it is charged.</li>
        <li>
          Balance:{" "}
          {balance.data ? `${formatNumber(balance.data.balance)} credits available` : "checking"}
        </li>
      </ul>
      {failure && isBillingBlock(error) ? (
        <BillingBlockBanner error={error} />
      ) : failure ? (
        <Banner tone="destructive" title={failure.title} description={failure.message} />
      ) : null}
    </ConfirmDialog>
  );
}
