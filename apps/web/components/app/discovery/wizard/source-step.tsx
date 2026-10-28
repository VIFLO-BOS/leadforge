"use client";

import {
  DISCOVERY_LIMITS,
  type DiscoverySourceOption,
  type ObservationField,
} from "@leadforge/contracts";
import { Database } from "lucide-react";
import Link from "next/link";
import { Banner, Button, Checkbox, ErrorState, Skeleton, StatusIndicator, cn } from "@leadforge/ui";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDate, formatNumber } from "@/lib/format";
import { FIELD_LABELS, SOURCE_STATUS_META } from "@/lib/labels";

/** Why a source cannot be chosen, from the API's own status (never guessed). */
export function unavailableReason(source: DiscoverySourceOption): string | null {
  if (source.runnable) return null;
  if (!source.enabled) return "Switched off for this workspace.";
  return source.statusDetail || "This source cannot run right now.";
}

function fieldList(fields: readonly string[]): string {
  return fields.map((f) => FIELD_LABELS[f as ObservationField] ?? f).join(", ");
}

export interface SourceStepProps {
  sources: DiscoverySourceOption[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selected: string[];
  onToggle: (key: string, on: boolean) => void;
  fieldError?: string;
  canManageSources: boolean;
}

/**
 * Step 1: choose sources. Everything comes from GET /discovery/sources; a source that cannot run
 * is shown with the API's reason and cannot be selected.
 */
export function SourceStep({
  sources,
  loading,
  error,
  onRetry,
  selected,
  onToggle,
  fieldError,
  canManageSources,
}: SourceStepProps) {
  if (loading) {
    return (
      <div
        className="flex flex-col gap-3"
        role="status"
        aria-busy="true"
        aria-label="Loading sources"
      >
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }
  if (error || !sources) {
    return (
      <ErrorState
        title="Could not load discovery sources"
        message={friendlyMessage(error)}
        requestId={requestIdOf(error)}
        onRetry={onRetry}
      />
    );
  }

  const runnable = sources.filter((s) => s.runnable);
  const errorId = "discovery-sources-error";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {sources.length === 0 || runnable.length === 0 ? (
        <Banner
          tone="warning"
          title="No discovery source can run right now"
          description={
            sources.length === 0
              ? "No discovery source is registered for this workspace."
              : "Every source below needs to be configured or switched on before a job can run. LeadForge never shows results from a source that is not working."
          }
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/app/sources">
                <Database aria-hidden /> {canManageSources ? "Manage sources" : "View sources"}
              </Link>
            </Button>
          }
        />
      ) : null}

      <fieldset
        className="flex min-w-0 flex-col gap-3"
        aria-describedby={fieldError ? errorId : undefined}
      >
        <legend className="mb-1 text-sm font-medium">
          Sources to search{" "}
          <span className="text-muted-foreground font-normal">
            (up to {DISCOVERY_LIMITS.maxSources})
          </span>
        </legend>
        <ul className="flex min-w-0 flex-col gap-3">
          {sources.map((s) => {
            const id = `discovery-source-${s.key}`;
            const reason = unavailableReason(s);
            const checked = selected.includes(s.key);
            const status = SOURCE_STATUS_META[s.status] ?? {
              label: s.status,
              tone: "neutral" as const,
            };
            return (
              <li
                key={s.key}
                data-source={s.key}
                data-runnable={s.runnable}
                className={cn(
                  "transition-ui flex min-w-0 items-start gap-3 rounded-lg border p-3 min-[360px]:p-4",
                  checked ? "border-primary bg-primary-subtle" : "border-border",
                  reason ? "bg-surface-container-low" : null,
                )}
              >
                <span className="flex h-6 shrink-0 items-center pl-1">
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={Boolean(reason)}
                    onCheckedChange={(v) => onToggle(s.key, v === true)}
                    aria-describedby={`${id}-detail`}
                    aria-invalid={fieldError ? true : undefined}
                  />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <label htmlFor={id} className="break-anywhere text-sm font-medium leading-6">
                      {s.name}
                    </label>
                    <StatusIndicator tone={status.tone} label={status.label} size="sm" />
                  </div>
                  <div id={`${id}-detail`} className="flex min-w-0 flex-col gap-2">
                    {reason ? (
                      <StatusIndicator
                        tone="warning"
                        size="sm"
                        label={reason}
                        data-unavailable-reason
                      />
                    ) : (
                      <p className="text-muted-foreground break-anywhere text-xs">
                        {s.statusDetail}
                      </p>
                    )}
                    <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1.5 text-xs min-[640px]:grid-cols-2">
                      <div className="flex min-w-0 flex-col">
                        <dt className="text-muted-foreground">Results per category</dt>
                        <dd>
                          {s.maxResultsPerQuery > 0
                            ? `Up to ${formatNumber(s.maxResultsPerQuery)}`
                            : "No per-query cap"}
                        </dd>
                      </div>
                      {s.snapshot ? (
                        <div className="flex min-w-0 flex-col min-[640px]:col-span-2">
                          <dt className="text-muted-foreground">Data snapshot</dt>
                          <dd className="break-anywhere">
                            Release {s.snapshot.release}, loaded {formatDate(s.snapshot.syncedAt)}:{" "}
                            {formatNumber(s.snapshot.offerable)} of{" "}
                            {formatNumber(s.snapshot.places)} places can be offered
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex min-w-0 flex-col">
                        <dt className="text-muted-foreground">Provides</dt>
                        <dd className="break-anywhere">
                          {fieldList(s.providesFields) || "Not stated"}
                        </dd>
                      </div>
                      <div className="flex min-w-0 flex-col min-[640px]:col-span-2">
                        <dt className="text-muted-foreground">Attribution shown with results</dt>
                        <dd className="break-anywhere">
                          {s.licensing?.text ?? s.attribution ?? "None required"}
                          {s.licensing?.licenses.length ? (
                            <span className="text-muted-foreground block">
                              Licences: {s.licensing.licenses.map((l) => l.name).join(", ")}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                      <div className="flex min-w-0 flex-col min-[640px]:col-span-2">
                        <dt className="text-muted-foreground">Retention</dt>
                        <dd className="break-anywhere">{s.retentionSummary}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {fieldError ? (
          <p id={errorId} role="alert" className="text-destructive text-sm">
            {fieldError}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
