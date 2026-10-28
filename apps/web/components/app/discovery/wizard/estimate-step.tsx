"use client";

import type {
  DiscoveryBlocker,
  DiscoveryEstimate,
  DiscoverySourceOption,
} from "@leadforge/contracts";
import {
  CircleAlert,
  Coins,
  Database,
  RefreshCw,
  Rows3,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Skeleton,
  Stat,
  StatusIndicator,
} from "@leadforge/ui";
import {
  BillingBlockBanner,
  BuyCreditsAction,
  isBillingBlockCode,
} from "@/components/app/billing/billing-shared";
import { discoverySourceName, issueLabel } from "@/lib/discovery";
import { formatWait, friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatNumber, formatRelative } from "@/lib/format";

export interface CreditsShortfallProps {
  required: number;
  available: number;
  onLowerLimit?: () => void;
}

/** Required versus available credits, with Buy credits for owners and administrators. */
export function CreditsShortfall({ required, available, onLowerLimit }: CreditsShortfallProps) {
  return (
    <Banner
      tone="warning"
      icon={Wallet}
      title="Not enough credits"
      data-testid="credits-shortfall"
      description={
        <span className="flex flex-col gap-1">
          <span>
            This job holds <strong className="font-medium">{formatNumber(required)}</strong>{" "}
            {required === 1 ? "credit" : "credits"} and{" "}
            <strong className="font-medium">{formatNumber(available)}</strong>{" "}
            {available === 1 ? "is" : "are"} available. Lower the limit, or add credits.
          </span>
        </span>
      }
      actions={
        <>
          {onLowerLimit ? (
            <Button variant="outline" size="sm" onClick={onLowerLimit}>
              Lower the limit
            </Button>
          ) : null}
          <BuyCreditsAction />
        </>
      }
    />
  );
}

const SOURCE_BLOCKERS = new Set([
  "SOURCE_NOT_CONFIGURED",
  "SOURCE_DISABLED",
  "SOURCE_POLICY_BLOCKED",
  "SOURCE_UNAVAILABLE",
]);

export function BlockerList({
  blockers,
  sources,
  onGoToStep,
}: {
  blockers: DiscoveryBlocker[];
  sources: DiscoverySourceOption[] | undefined;
  onGoToStep: (step: number) => void;
}) {
  const sourceProblem = blockers.some((b) => SOURCE_BLOCKERS.has(b.code));
  const validation = blockers.some((b) => b.code === "VALIDATION_FAILED");
  return (
    <Banner
      tone="destructive"
      title="This job cannot be created yet"
      data-testid="estimate-blockers"
      description={
        <ul className="mt-1 flex min-w-0 flex-col gap-2">
          {blockers.map((b, i) => (
            <li key={`${b.code}-${b.source ?? "all"}-${i}`} className="flex min-w-0 flex-col">
              <span className="font-medium">
                {issueLabel(b.code)}
                {b.source ? ` · ${discoverySourceName(b.source, sources)}` : ""}
              </span>
              <span className="break-anywhere">{b.message}</span>
            </li>
          ))}
        </ul>
      }
      actions={
        sourceProblem || validation ? (
          <>
            {sourceProblem ? (
              <Button variant="outline" size="sm" onClick={() => onGoToStep(0)}>
                Change sources
              </Button>
            ) : null}
            {validation ? (
              <Button variant="outline" size="sm" onClick={() => onGoToStep(1)}>
                Edit the search
              </Button>
            ) : null}
            {sourceProblem ? (
              <Button asChild variant="text" size="sm">
                <Link href="/app/sources">
                  <Database aria-hidden /> Sources
                </Link>
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

/** Blockers, a credit shortfall and an unavailable estimate: everything that stops creation. */
export function EstimateProblems({
  estimate,
  sources,
  onGoToStep,
}: {
  estimate: DiscoveryEstimate;
  sources: DiscoverySourceOption[] | undefined;
  onGoToStep: (step: number) => void;
}) {
  const c = estimate.credits;
  const insufficient = estimate.blockers.some((b) => b.code === "INSUFFICIENT_CREDITS");
  const billingBlockers = estimate.blockers.filter((b) => isBillingBlockCode(b.code));
  const otherBlockers = estimate.blockers.filter(
    (b) => b.code !== "INSUFFICIENT_CREDITS" && !isBillingBlockCode(b.code),
  );
  if (
    !otherBlockers.length &&
    !billingBlockers.length &&
    !insufficient &&
    c.sufficient &&
    estimate.estimateAvailable
  ) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {billingBlockers.map((b, i) => (
        <BillingBlockBanner key={`${b.code}-${i}`} blocker={b} />
      ))}
      {otherBlockers.length ? (
        <BlockerList blockers={otherBlockers} sources={sources} onGoToStep={onGoToStep} />
      ) : null}
      {insufficient || !c.sufficient ? (
        <CreditsShortfall
          required={c.hold}
          available={c.balance}
          onLowerLimit={() => onGoToStep(2)}
        />
      ) : null}
      {!estimate.estimateAvailable ? (
        <Banner
          tone="info"
          title="No selected source can run"
          description="These numbers are the upper bound for the spec; nothing can run until a source is available."
        />
      ) : null}
    </div>
  );
}

export interface EstimateStepProps {
  estimate: DiscoveryEstimate | undefined;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  retryIn: number;
  updatedAt: number;
  sources: DiscoverySourceOption[] | undefined;
  onRefresh: () => void;
  onGoToStep: (step: number) => void;
}

/**
 * Step 4: POST /discovery/jobs/estimate. Shows the credit hold, the balance, whether it is
 * enough, what each source will be asked for, warnings and blockers. Blockers prevent creation
 * and say why. The estimate is an upper bound: only produced records are charged.
 */
export function EstimateStep({
  estimate,
  loading,
  fetching,
  error,
  retryIn,
  updatedAt,
  sources,
  onRefresh,
  onGoToStep,
}: EstimateStepProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="Estimating">
        <div className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }
  if (error && !estimate) {
    return (
      <ErrorState
        title="Could not estimate this job"
        message={
          retryIn > 0
            ? `Too many requests. You can try again in ${formatWait(retryIn)}.`
            : friendlyMessage(error)
        }
        requestId={requestIdOf(error)}
        onRetry={retryIn > 0 ? undefined : onRefresh}
      />
    );
  }
  if (!estimate) return null;

  const c = estimate.credits;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="estimate">
      <EstimateProblems estimate={estimate} sources={sources} onGoToStep={onGoToStep} />

      <div className="grid min-w-0 grid-cols-1 gap-3 min-[640px]:grid-cols-3">
        <Stat
          label="Credits held"
          icon={Coins}
          value={formatNumber(c.hold)}
          hint={`${c.perRecord} credit per record produced; the unused part returns when the job settles`}
        />
        <Stat
          label="Available now"
          icon={Wallet}
          value={formatNumber(c.balance)}
          hint={c.sufficient ? "Enough for this hold" : "Not enough for this hold"}
        />
        <Stat
          label="Most records"
          icon={Rows3}
          value={formatNumber(estimate.maxRecords)}
          hint="Your limit, capped by what the sources can return"
        />
      </div>

      <section aria-labelledby="estimate-sources-title" className="flex min-w-0 flex-col gap-3">
        <h3 id="estimate-sources-title" className="text-sm font-medium">
          Per source
        </h3>
        <ul className="flex min-w-0 flex-col gap-3">
          {estimate.sources.map((s) => (
            <li key={s.source} className="min-w-0">
              <Card variant="filled" className="min-w-0">
                <CardHeader className="gap-2 pb-2">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <CardTitle className="break-anywhere">{s.name}</CardTitle>
                    <StatusIndicator
                      variant="badge"
                      tone={s.runnable ? "success" : "warning"}
                      label={s.runnable ? "Can run" : s.enabled ? "Cannot run" : "Switched off"}
                    />
                  </div>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-3">
                  <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-sm min-[640px]:grid-cols-4">
                    <div className="flex min-w-0 flex-col">
                      <dt className="text-muted-foreground text-xs">Queries</dt>
                      <dd className="tabular-nums">{formatNumber(s.queries)}</dd>
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <dt className="text-muted-foreground text-xs">
                        {s.exact ? "Matching places" : "Most results"}
                      </dt>
                      <dd className="tabular-nums">
                        {formatNumber(s.maxResults)}
                        {s.exact ? (
                          <span className="text-muted-foreground text-xs"> exact</span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <dt className="text-muted-foreground text-xs">Most requests</dt>
                      <dd className="tabular-nums">
                        {s.maxRequests > 0 ? formatNumber(s.maxRequests) : "None"}
                      </dd>
                    </div>
                    {s.providerSku ? (
                      <div className="flex min-w-0 flex-col">
                        <dt className="text-muted-foreground text-xs">Provider tier</dt>
                        <dd className="break-anywhere">{s.providerSku}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {s.alreadyInDirectory > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {formatNumber(s.alreadyInDirectory)} more matching{" "}
                      {s.alreadyInDirectory === 1 ? "place is" : "places are"} already in your
                      directory and will not be offered again.
                    </p>
                  ) : null}
                  {s.fields.length ? (
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-muted-foreground text-xs">Fields requested</p>
                      <p className="break-anywhere font-mono text-xs">{s.fields.join(", ")}</p>
                    </div>
                  ) : null}
                  {s.warnings.length ? (
                    <ul className="flex min-w-0 flex-col gap-1.5">
                      {s.warnings.map((w) => (
                        <li key={w}>
                          <StatusIndicator tone="warning" size="sm" label={w} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {estimate.warnings.length ? (
        <section aria-labelledby="estimate-warnings-title" className="flex min-w-0 flex-col gap-2">
          <h3 id="estimate-warnings-title" className="text-sm font-medium">
            Warnings
          </h3>
          <ul className="flex min-w-0 flex-col gap-1.5">
            {estimate.warnings.map((w) => (
              <li key={w}>
                <StatusIndicator tone="warning" icon={TriangleAlert} size="sm" label={w} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="border-border flex min-w-0 flex-col gap-3 border-t pt-4 min-[640px]:flex-row min-[640px]:items-start min-[640px]:justify-between">
        <p className="text-muted-foreground max-w-prose text-xs">
          <CircleAlert aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
          {estimate.basis} Estimated {formatRelative(new Date(updatedAt).toISOString())}.
        </p>
        <Button
          variant="text"
          size="sm"
          onClick={onRefresh}
          loading={fetching}
          disabled={retryIn > 0}
          className="shrink-0 self-start"
        >
          <RefreshCw aria-hidden /> {retryIn > 0 ? `Refresh in ${retryIn}s` : "Refresh estimate"}
        </Button>
      </div>
    </div>
  );
}
