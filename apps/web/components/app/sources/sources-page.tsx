"use client";

import type { PagedEnvelope, SourceRegistryEntry } from "@leadforge/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, ExternalLink } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  ConfirmDialog,
  Skeleton,
  StatusIndicator,
  Switch,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { FIELD_LABELS, SOURCE_STATUS_META } from "@/lib/labels";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { queryKeys } from "@/lib/query-keys";

const KIND: Record<SourceRegistryEntry["kind"], string> = {
  discovery: "Discovery",
  enrichment: "Enrichment",
  user_supplied: "Supplied by your team",
};

const METHOD: Partial<Record<SourceRegistryEntry["method"], string>> = {
  api: "Official API",
  dataset_snapshot: "Published open-data release",
  website_fetch: "Fetches the business's own website",
  user_import: "CSV upload",
  user_edit: "Manual entry",
};

const RETENTION: Record<string, string> = {
  indefinite: "Kept indefinitely",
  limited: "Limited",
  none: "Not stored",
  not_collected: "Not collected",
};

function retentionText(days: number | null): string {
  if (days === null) return "No limit";
  if (days === 0) return "Expires when collected";
  return `${days} days after collection`;
}

function EnabledSwitch({ source }: { source: SourceRegistryEntry }) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);
  const id = `source-enabled-${source.key}`;
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch<SourceRegistryEntry>(`/sources/${encodeURIComponent(source.key)}`, {
        method: "PATCH",
        body: { enabled },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<PagedEnvelope<SourceRegistryEntry>>(
        queryKeys.sources(org.id),
        (old) =>
          old ? { ...old, data: old.data.map((s) => (s.key === updated.key ? updated : s)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.discovery.sources(org.id) });
      setConfirmOff(false);
      toast.success(`${updated.name} ${updated.enabled ? "switched on" : "switched off"}`, {
        description: updated.enabled
          ? "New discovery jobs in this workspace can use it when it can run."
          : "New discovery jobs and estimates in this workspace cannot use it.",
      });
    },
    onError: (err) => {
      setConfirmOff(false);
      toast.error(`Could not change ${source.name}`, { description: friendlyMessage(err) });
    },
  });
  return (
    <>
      <div className="bg-surface-container-low dark:bg-surface-container-high flex min-w-0 items-center justify-between gap-3 rounded-md px-3 py-2">
        <label htmlFor={id} className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">Enabled in this workspace</span>
          <span className="text-muted-foreground text-xs">
            {source.enabled
              ? "New discovery jobs can use this source when it can run."
              : "Switched off: new jobs and estimates cannot use it."}
          </span>
        </label>
        <Switch
          id={id}
          checked={source.enabled}
          disabled={toggle.isPending}
          onCheckedChange={(on) => (on ? toggle.mutate(true) : setConfirmOff(true))}
        />
      </div>
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={`Switch off ${source.name}?`}
        description="New discovery jobs and estimates in this workspace will not be able to use it. A queued job that uses it fails when it starts, and its credit hold is released. Existing business records are not changed."
        confirmLabel="Switch off"
        destructive
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate(false)}
      />
    </>
  );
}

function SourceCard({
  source,
  loadedAt,
  canManage,
}: {
  source: SourceRegistryEntry;
  loadedAt: number;
  canManage: boolean;
}) {
  const status = SOURCE_STATUS_META[source.status] ?? {
    label: source.status,
    tone: "neutral" as const,
  };
  const p = source.policy;
  // Fields added to the registry after Phase 2 may be absent from an older API; never guess them.
  const fieldRetention = p.fieldRetention ?? [];
  const terms = p.terms ?? [];
  const licensing = p.licensing ?? null;
  const hasSetting = typeof source.enabled === "boolean";
  return (
    <Card className="flex min-w-0 flex-col" data-source={source.key}>
      <CardHeader className="gap-2">
        <div className="flex min-w-0 flex-col gap-2 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="break-anywhere">{source.name}</CardTitle>
            <p className="text-muted-foreground text-xs">
              {KIND[source.kind]} · {METHOD[source.method] ?? source.method}
            </p>
          </div>
          <StatusIndicator
            tone={status.tone}
            label={status.label}
            variant="badge"
            className="self-start"
          />
        </div>
        <CardDescription>{source.statusDetail}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col gap-4">
        {canManage && source.configurable ? <EnabledSwitch source={source} /> : null}
        <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm min-[640px]:grid-cols-2">
          {hasSetting ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">In this workspace</dt>
              <dd>
                {source.status === "not_available" || source.status === "not_configured"
                  ? "Not in use: this source cannot run"
                  : source.enabled
                    ? source.configurable
                      ? "Enabled"
                      : "Enabled (always on)"
                    : source.configurable
                      ? "Disabled"
                      : "Off until the source is available"}
                {source.config ? (
                  <span className="text-muted-foreground block text-xs">
                    Changed {formatDateTime(source.config.updatedAt)}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Retention</dt>
            <dd>{retentionText(p.retentionDays)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 min-[640px]:col-span-2">
            <dt className="text-muted-foreground text-xs">Storage</dt>
            <dd className="break-anywhere">{p.storage}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 min-[640px]:col-span-2">
            <dt className="text-muted-foreground text-xs">Attribution</dt>
            <dd className="break-anywhere">{p.attribution ?? "None required"}</dd>
          </div>
          {p.rateLimit ? (
            <div className="flex min-w-0 flex-col gap-0.5 min-[640px]:col-span-2">
              <dt className="text-muted-foreground text-xs">Rate limit</dt>
              <dd className="break-anywhere">{p.rateLimit}</dd>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5 min-[640px]:col-span-2">
            <dt className="text-muted-foreground text-xs">Lawful basis</dt>
            <dd className="break-anywhere">{p.lawfulBasis}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 min-[640px]:col-span-2">
            <dt className="text-muted-foreground text-xs">Coverage</dt>
            <dd className="break-anywhere">{source.coverage}</dd>
          </div>
        </dl>

        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">Fields provided</p>
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {(source.fieldsProvided ?? []).map((f) => (
              <li key={f}>
                <Badge variant="neutral">{FIELD_LABELS[f]}</Badge>
              </li>
            ))}
          </ul>
        </div>

        {fieldRetention.length ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-muted-foreground text-xs">Retention by field</p>
            <ul className="divide-border border-border flex min-w-0 flex-col divide-y rounded-md border">
              {fieldRetention.map((r) => (
                <li key={r.field} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
                  <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                    <span className="break-anywhere text-sm font-medium">{r.field}</span>
                    <span className="text-xs">
                      {RETENTION[r.retention] ?? r.retention}
                      {r.retention === "limited" && r.days !== null ? `, ${r.days} days` : ""}
                    </span>
                  </span>
                  <span className="text-muted-foreground break-anywhere text-xs">{r.note}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {licensing ? (
          <div className="flex min-w-0 flex-col gap-1.5" data-testid="source-licensing">
            <p className="text-muted-foreground text-xs">Attribution and licences</p>
            <p className="break-anywhere text-sm">{licensing.text}</p>
            {licensing.licenses.length ? (
              <ul className="flex min-w-0 flex-col gap-1">
                {licensing.licenses.map((l) => (
                  <li key={l.id} className="min-w-0">
                    <a
                      href={l.referenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary break-anywhere inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                    >
                      {l.name}
                      <ExternalLink aria-hidden className="size-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {licensing.requirements.length ? (
              <ul className="text-muted-foreground flex min-w-0 list-disc flex-col gap-0.5 pl-5 text-xs">
                {licensing.requirements.map((r) => (
                  <li key={r} className="break-anywhere">
                    {r}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {terms.length || source.docsUrl ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-muted-foreground text-xs">Terms and documentation</p>
            <ul className="flex min-w-0 flex-col gap-1">
              {terms.map((t) => (
                <li key={t.url} className="min-w-0 text-sm">
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary break-anywhere inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    {t.title}
                    <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                  </a>
                  {t.lastModified ? (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · last modified {t.lastModified}
                    </span>
                  ) : null}
                </li>
              ))}
              {source.docsUrl ? (
                <li className="min-w-0 text-sm">
                  <a
                    href={source.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary break-anywhere inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    Developer documentation
                    <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <p className="text-muted-foreground border-border mt-auto border-t pt-3 text-xs">
          From the LeadForge source registry
          {p.termsCheckedAt ? ` · terms checked ${formatDate(p.termsCheckedAt)}` : ""} · loaded{" "}
          {formatDateTime(new Date(loadedAt).toISOString())}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Sources (/app/sources): the source registry with status, policy, retention, attribution and
 * licences. Owners and administrators switch configurable (discovery) sources on or off for the
 * workspace (PATCH /sources/:key); switching off asks for confirmation first.
 */
export function SourcesPage() {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  const canManage = can("settings:sources");
  const sources = useQuery({
    queryKey: queryKeys.sources(org.id),
    queryFn: () => apiFetchPaged<SourceRegistryEntry>("/sources"),
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Automation"
        title="Sources"
        description="Where business data comes from, what each source may store and for how long, and the attribution it requires. LeadForge only collects through sources listed here."
      />
      {sources.isPending ? (
        <div
          className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2"
          role="status"
          aria-busy="true"
          aria-label="Loading sources"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-lg" />
          ))}
        </div>
      ) : sources.isError ? (
        <ErrorState
          title="Could not load sources"
          message={friendlyMessage(sources.error)}
          requestId={requestIdOf(sources.error)}
          onRetry={() => void sources.refetch()}
        />
      ) : sources.data.data.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No sources registered"
          description="The registry is empty. This is unexpected; refresh, or contact support with the time you saw this."
        />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          {sources.data.data.map((s) => (
            <SourceCard
              key={s.key}
              source={s}
              loadedAt={sources.dataUpdatedAt}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
