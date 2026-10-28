"use client";

import type {
  DiscoveryEstimate,
  DiscoveryJobSpecInput,
  DiscoverySourceOption,
} from "@leadforge/contracts";
import { CalendarClock, Pencil, Play } from "lucide-react";
import { Badge, Banner, Button, ErrorState, RadioGroup, RadioGroupItem } from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { discoverySourceName, locationSummary } from "@/lib/discovery";
import {
  creditShortfall,
  formatWait,
  friendlyMessage,
  isForbidden,
  requestIdOf,
  sourcesInError,
} from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { countryName } from "@/lib/geo";
import { BillingBlockBanner } from "@/components/app/billing/billing-shared";
import { PendingDeletionNotice } from "@/components/app/pending-deletion-notice";
import { CreditsShortfall } from "./estimate-step";

const PRIORITY_LABELS: Record<string, string> = {
  phone: "Phone",
  website: "Website",
  email: "Email",
  whatsapp: "WhatsApp",
};

function Row({
  label,
  children,
  onEdit,
  editLabel,
}: {
  label: string;
  children: React.ReactNode;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <div className="border-border flex min-w-0 flex-col gap-1 border-b py-3 first:pt-0 min-[640px]:flex-row min-[640px]:items-start min-[640px]:gap-4">
      <dt className="text-muted-foreground w-40 shrink-0 text-xs min-[640px]:pt-0.5 min-[640px]:text-sm">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-start justify-between gap-2">
        <span className="break-anywhere min-w-0 text-sm">{children}</span>
        {onEdit ? (
          <Button
            variant="text"
            size="sm"
            className="-mt-1 shrink-0"
            onClick={onEdit}
            aria-label={editLabel ?? `Edit ${label.toLowerCase()}`}
          >
            <Pencil aria-hidden /> <span className="max-[359.98px]:sr-only">Edit</span>
          </Button>
        ) : null}
      </dd>
    </div>
  );
}

/** What went wrong when creating, with the next step for each documented error code. */
export function CreateError({
  error,
  retryIn,
  sources,
  onGoToStep,
}: {
  error: unknown;
  retryIn: number;
  sources: DiscoverySourceOption[] | undefined;
  onGoToStep: (step: number) => void;
}) {
  if (!isApiError(error)) {
    return (
      <ErrorState
        title="Could not create the job"
        message={friendlyMessage(error)}
        requestId={requestIdOf(error)}
      />
    );
  }
  switch (error.code) {
    case "ENTITLEMENT_REQUIRED":
    case "CREDIT_BALANCE_NEGATIVE":
      return <BillingBlockBanner error={error} />;
    case "ORGANIZATION_PENDING_DELETION":
      return (
        <PendingDeletionNotice
          error={error}
          outcome="No job was created and nothing was charged."
        />
      );
    case "INSUFFICIENT_CREDITS": {
      const s = creditShortfall(error);
      return s ? (
        <CreditsShortfall
          required={s.required}
          available={s.available}
          onLowerLimit={() => onGoToStep(2)}
        />
      ) : (
        <ErrorState
          title="Not enough credits"
          message={friendlyMessage(error)}
          requestId={requestIdOf(error)}
        />
      );
    }
    case "SOURCE_NOT_CONFIGURED":
    case "SOURCE_DISABLED": {
      const names = sourcesInError(error).map((k) => discoverySourceName(k, sources));
      return (
        <Banner
          tone="destructive"
          title={
            error.code === "SOURCE_DISABLED"
              ? "A selected source is switched off"
              : "A selected source is not configured"
          }
          description={`${names.length ? `${names.join(", ")}: ` : ""}${
            error.code === "SOURCE_DISABLED"
              ? "an owner or administrator switched it off for this workspace."
              : "it has no credentials, so it cannot run."
          } Choose another source.`}
          actions={
            <Button variant="outline" size="sm" onClick={() => onGoToStep(0)}>
              Change sources
            </Button>
          }
        />
      );
    }
    case "SOURCE_POLICY_BLOCKED": {
      const names = sourcesInError(error).map((k) => discoverySourceName(k, sources));
      return (
        <Banner
          tone="destructive"
          title="A selected source's terms do not allow this use"
          description={`${names.length ? `${names.join(", ")}: ` : ""}the provider's terms forbid storing its business data in a directory, so LeadForge never runs it. Choose another source.`}
          actions={
            <Button variant="outline" size="sm" onClick={() => onGoToStep(0)}>
              Change sources
            </Button>
          }
        />
      );
    }
    case "RATE_LIMITED":
      return (
        <Banner
          tone="warning"
          title="Too many discovery jobs right now"
          description={
            retryIn > 0
              ? `Your workspace reached its hourly limit for new discovery jobs. You can try again in ${formatWait(retryIn)}.`
              : "You can try again now."
          }
        />
      );
    case "CONFLICT":
      return (
        <Banner
          tone="warning"
          title="This submission was already used for a different job"
          description="The details changed after a previous attempt. Check them and choose Create discovery job again."
        />
      );
    case "VALIDATION_FAILED":
      return (
        <Banner
          tone="destructive"
          title="Some details need attention"
          description={`${friendlyMessage(error)} The fields that need a change are marked.`}
        />
      );
    default:
      return (
        <ErrorState
          title={
            isForbidden(error)
              ? "Your role cannot create discovery jobs"
              : "Could not create the job"
          }
          message={friendlyMessage(error)}
          requestId={requestIdOf(error)}
        />
      );
  }
}

export interface ReviewStepProps {
  spec: DiscoveryJobSpecInput;
  sources: DiscoverySourceOption[] | undefined;
  estimate: DiscoveryEstimate | undefined;
  onGoToStep: (step: number) => void;
  error: React.ReactNode;
}

/** Step 5: the whole spec, the estimate it was checked against, and when to run. */
export function ReviewStep({ spec, sources, estimate, onGoToStep, error }: ReviewStepProps) {
  const where = locationSummary({ country: spec.location.country ?? "NG", ...spec.location });
  const include = spec.domainsInclude ?? [];
  const exclude = spec.domainsExclude ?? [];
  const balanceAfter = estimate ? estimate.credits.balance - estimate.credits.hold : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {error}
      <dl className="flex min-w-0 flex-col" aria-label="Job details">
        <Row label="Name" onEdit={() => onGoToStep(1)} editLabel="Edit the name">
          <span className="font-medium">{spec.name}</span>
        </Row>
        <Row label="Sources" onEdit={() => onGoToStep(0)} editLabel="Edit sources">
          {spec.sources.map((k) => discoverySourceName(k, sources)).join(", ")}
        </Row>
        <Row label="What to find" onEdit={() => onGoToStep(1)} editLabel="Edit categories">
          {spec.categories.join(", ")}
        </Row>
        <Row label="Where" onEdit={() => onGoToStep(1)} editLabel="Edit the place">
          {[where, countryName(spec.location.country ?? "NG")].filter(Boolean).join(", ")}
        </Row>
        <Row label="Record limit" onEdit={() => onGoToStep(2)} editLabel="Edit the record limit">
          {formatNumber(spec.maxRecords)} records
        </Row>
        {spec.priorityFields ? (
          <Row label="Contact fields" onEdit={() => onGoToStep(2)} editLabel="Edit contact fields">
            {spec.priorityFields.map((f) => PRIORITY_LABELS[f] ?? f).join(", ") ||
              "None (basic details only)"}
          </Row>
        ) : null}
        {spec.confidence || spec.requireContact !== undefined ? (
          <Row
            label="Quality filters"
            onEdit={() => onGoToStep(2)}
            editLabel="Edit quality filters"
          >
            {[
              spec.confidence
                ? `${spec.confidence === "high" ? "High" : "Standard"} place confidence`
                : null,
              spec.requireContact === true
                ? "only places with a phone, email or website"
                : spec.requireContact === false
                  ? "places without contact details included"
                  : null,
            ]
              .filter(Boolean)
              .join("; ")}
          </Row>
        ) : null}
        {include.length || exclude.length ? (
          <Row label="Domain rules" onEdit={() => onGoToStep(2)} editLabel="Edit domain rules">
            {[
              include.length ? `Only ${include.join(", ")}` : null,
              exclude.length ? `Skip ${exclude.join(", ")}` : null,
            ]
              .filter(Boolean)
              .join(". ")}
          </Row>
        ) : null}
        <Row label="Credits" onEdit={() => onGoToStep(3)} editLabel="Edit the estimate">
          {estimate ? (
            <>
              {formatNumber(estimate.credits.hold)} held while the job runs;{" "}
              {formatNumber(balanceAfter ?? 0)} left available. You are charged only for records
              produced.
            </>
          ) : (
            "Estimate not loaded"
          )}
        </Row>
      </dl>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">When to run</legend>
        <RadioGroup value="now" aria-label="When to run" className="flex flex-col gap-3">
          <label htmlFor="discovery-run-now" className="flex min-w-0 items-start gap-3">
            <span className="flex h-5 shrink-0 items-center pl-1">
              <RadioGroupItem id="discovery-run-now" value="now" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Play aria-hidden className="size-4" /> Run now
              </span>
              <span className="text-muted-foreground text-xs">
                Queued as soon as you create it. Progress updates every 2 seconds.
              </span>
            </span>
          </label>
          <label htmlFor="discovery-run-scheduled" className="flex min-w-0 items-start gap-3">
            <span className="flex h-5 shrink-0 items-center pl-1">
              <RadioGroupItem id="discovery-run-scheduled" value="scheduled" disabled />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm font-medium">
                <CalendarClock aria-hidden className="size-4" /> Schedule
                <Badge variant="outline">Coming soon</Badge>
              </span>
              <span className="text-muted-foreground text-xs">
                Scheduled and recurring jobs arrive in a later release.
              </span>
            </span>
          </label>
        </RadioGroup>
      </fieldset>
    </div>
  );
}
