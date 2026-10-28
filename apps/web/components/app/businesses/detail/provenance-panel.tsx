"use client";

import {
  ObservationField,
  SourceKey,
  type BusinessDetail,
  type Observation,
  type VerificationEvent,
} from "@leadforge/contracts";
import {
  BadgeCheck,
  FileSpreadsheet,
  Globe,
  History,
  MapPin,
  Pencil,
  ShieldCheck,
  ShieldX,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FilterMenu,
  Skeleton,
  Timeline,
  type TimelineItem,
} from "@leadforge/ui";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, plural, safeHttpUrl } from "@/lib/format";
import { useObservations, useVerificationEvents } from "@/lib/hooks/use-businesses";
import { licenseAnchor } from "@/lib/data-licenses";
import { FIELD_LABELS, WHATSAPP_LABELS, sourceLabel } from "@/lib/labels";

/** Partial: a source added later falls back to a generic icon, tone and wording. */
const SOURCE_ICON: Partial<Record<SourceKey, LucideIcon>> = {
  overture_places: MapPin,
  user_edit: Pencil,
  user_import: FileSpreadsheet,
  google_places: MapPin,
  website: Globe,
};

const SOURCE_TONE: Partial<Record<SourceKey, TimelineItem["tone"]>> = {
  user_edit: "primary",
  user_import: "info",
  google_places: "neutral",
  website: "success",
};

const SOURCE_VERB: Partial<Record<SourceKey, string>> = {
  overture_places: "from Overture Maps Places",
  user_edit: "set by a team member",
  user_import: "imported from a CSV",
  google_places: "collected from Google Places",
  website: "found on the business website",
};

/** Renders a normalized value: a string, a category list or location parts. */
export function formatObservationValue(value: Observation["normalizedValue"]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  const parts = ["street", "locality", "lga", "region", "postalCode", "country"]
    .map((k) => value[k])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (parts.length) return parts.join(", ");
  return JSON.stringify(value);
}

function observationItem(o: Observation): TimelineItem {
  const field = FIELD_LABELS[o.field];
  const rawNormalized = formatObservationValue(o.normalizedValue);
  const normalized =
    o.field === "whatsapp" && rawNormalized && rawNormalized in WHATSAPP_LABELS
      ? WHATSAPP_LABELS[rawNormalized as keyof typeof WHATSAPP_LABELS]
      : rawNormalized;
  const removed = o.action === "remove";
  return {
    id: o.id,
    icon: SOURCE_ICON[o.source] ?? History,
    tone: removed ? "warning" : (SOURCE_TONE[o.source] ?? "neutral"),
    timestamp: o.collectedAt,
    timestampLabel: formatDateTime(o.collectedAt),
    title: removed
      ? `${field} removed by a team member`
      : `${field} ${SOURCE_VERB[o.source] ?? `from ${sourceLabel(o.source)}`}`,
    description: (
      <div className="flex min-w-0 flex-col gap-1.5 pt-1" data-observation-source={o.source}>
        {o.redacted ? (
          <p className="text-sm">
            Value removed under the source&apos;s retention policy; this record of it is kept.
          </p>
        ) : (
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 text-[13px] min-[480px]:grid-cols-[auto_minmax(0,1fr)]">
            {o.fieldKey && o.field === "whatsapp" ? (
              <>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="break-anywhere text-foreground font-mono">{o.fieldKey}</dd>
              </>
            ) : null}
            {!removed ? (
              <>
                <dt className="text-muted-foreground">Normalized</dt>
                <dd className="break-anywhere text-foreground">
                  {normalized ?? <span className="text-muted-foreground">None</span>}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">As observed</dt>
            <dd className="break-anywhere text-foreground font-mono">
              {o.rawValue ?? <span className="text-muted-foreground font-sans">Not recorded</span>}
            </dd>
            {o.note ? (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd className="break-anywhere text-foreground">{o.note}</dd>
              </>
            ) : null}
            {o.evidence ? (
              <>
                <dt className="text-muted-foreground">Found on</dt>
                <dd className="text-foreground break-anywhere flex flex-col">
                  {safeHttpUrl(o.evidence.page) ? (
                    <a
                      href={safeHttpUrl(o.evidence.page) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="link-inline"
                    >
                      {o.evidence.page}
                    </a>
                  ) : (
                    <span>{o.evidence.page}</span>
                  )}
                  {o.evidence.selector ? (
                    <span className="text-muted-foreground break-anywhere font-mono text-xs">
                      Element: {o.evidence.selector}
                    </span>
                  ) : null}
                  {o.evidence.snippet ? (
                    <span className="text-muted-foreground" data-testid="observation-snippet">
                      “{o.evidence.snippet}”
                    </span>
                  ) : null}
                </dd>
              </>
            ) : null}
            {o.verification ? (
              <>
                <dt className="text-muted-foreground">Verification</dt>
                <dd className="text-foreground">
                  {o.verification.method}: {o.verification.status}
                </dd>
              </>
            ) : null}
          </dl>
        )}
      </div>
    ),
    meta: (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-foreground font-medium">{sourceLabel(o.source)}</span>
        <span>· {o.actor.type === "user" ? "by a team member" : "by the system"}</span>
        <span>· confidence {Math.round(o.confidence * 100)}%</span>
        {o.importId ? (
          <Link href={`/app/businesses/import?id=${o.importId}`} className="link-inline">
            · View import
          </Link>
        ) : null}
        {o.attribution ? <span className="break-anywhere">· {o.attribution}</span> : null}
        {o.licensing ? (
          <span className="break-anywhere" data-testid="observation-licensing">
            ·{" "}
            {[
              o.licensing.release ? `release ${o.licensing.release}` : null,
              o.licensing.dataset ? `dataset ${o.licensing.dataset}` : null,
              o.licensing.recordId ? `record ${o.licensing.recordId}` : null,
            ]
              .filter(Boolean)
              .join(", ")}
            {o.licensing.license ? (
              <>
                {" "}
                <Link href={licenseAnchor(o.licensing.license)} className="link-inline">
                  {o.licensing.license}
                </Link>
              </>
            ) : null}
          </span>
        ) : null}
        {o.retainValueUntil ? <span>· kept until {formatDateTime(o.retainValueUntil)}</span> : null}
      </span>
    ),
  };
}

/**
 * Provenance: every observation of every field, newest first, with the source, collection
 * time, raw and normalized values. Corrections appear as `user_edit` observations.
 */
export function ProvenancePanel({ detail }: { detail: BusinessDetail }) {
  const [field, setField] = useState<string[]>([]);
  const [source, setSource] = useState<string[]>([]);
  const filter = { field: field[0], source: source[0] };
  const obs = useObservations(detail.id, filter);
  const items = obs.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provenance</CardTitle>
        <CardDescription>
          {plural(detail.provenance.totalObservations, "observation", "observations")} from{" "}
          {detail.sources.map((s) => sourceLabel(s.source)).join(", ") || "no sources"}. Every
          value, where it came from, when it was collected and how it was recorded.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <div
          className="flex min-w-0 flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter provenance"
        >
          <FilterMenu
            label="Field"
            sections={[
              {
                id: "field",
                type: "single",
                anyLabel: "All fields",
                options: ObservationField.options.map((f) => ({
                  value: f,
                  label: FIELD_LABELS[f],
                })),
                value: field,
                onValueChange: setField,
              },
            ]}
          />
          <FilterMenu
            label="Source"
            sections={[
              {
                id: "source",
                type: "single",
                anyLabel: "All sources",
                options: SourceKey.options.map((s) => ({ value: s, label: sourceLabel(s) })),
                value: source,
                onValueChange: setSource,
              },
            ]}
          />
        </div>
        {obs.isPending ? (
          <div
            className="flex flex-col gap-5"
            role="status"
            aria-busy="true"
            aria-label="Loading provenance"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-48 max-w-full" />
                  <Skeleton className="h-3 w-72 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : obs.isError ? (
          <ErrorState
            title="Could not load provenance"
            message={friendlyMessage(obs.error)}
            requestId={requestIdOf(obs.error)}
            onRetry={() => void obs.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            size="compact"
            icon={History}
            title={field.length || source.length ? "No observations match" : "No observations yet"}
            description={
              field.length || source.length
                ? "Try another field or source."
                : "Observations appear when a source, an import or a team member records a value."
            }
          />
        ) : (
          <>
            <Timeline items={items.map(observationItem)} aria-label="Observations, newest first" />
            {obs.hasNextPage ? (
              <Button
                variant="outline"
                className="self-start"
                loading={obs.isFetchingNextPage}
                onClick={() => void obs.fetchNextPage()}
              >
                Load older observations
              </Button>
            ) : (
              <p className="text-muted-foreground text-xs">
                Showing all {plural(items.length, "observation", "observations")}
                {field.length || source.length ? " that match" : ""}.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const RESULT_META: Record<
  VerificationEvent["result"],
  { tone: TimelineItem["tone"]; icon: LucideIcon; label: string }
> = {
  passed: { tone: "success", icon: ShieldCheck, label: "passed" },
  failed: { tone: "destructive", icon: ShieldX, label: "failed" },
  inconclusive: { tone: "warning", icon: CircleHelp, label: "inconclusive" },
};

/** Verification history: each check, its method, result, actor and time. */
export function VerificationPanel({ detail }: { detail: BusinessDetail }) {
  const events = useVerificationEvents(detail.id);
  const items = events.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verification history</CardTitle>
        <CardDescription>
          Checks run against this business&apos;s contact details. A value is verified only when a
          check passes; being discovered or imported is not verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {events.isPending ? (
          <Skeleton className="h-24" />
        ) : events.isError ? (
          <ErrorState
            title="Could not load verification history"
            message={friendlyMessage(events.error)}
            requestId={requestIdOf(events.error)}
            onRetry={() => void events.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            size="compact"
            icon={BadgeCheck}
            title="No checks have run yet"
            description="Checks appear here when contacts are collected from the business's own website (phones and WhatsApp) or an email address is checked (format, mail server, disposable domain). Run them from Contact collection on the Overview tab."
          />
        ) : (
          <>
            <Timeline
              aria-label="Verification events, newest first"
              items={items.map((e) => {
                const meta = RESULT_META[e.result];
                return {
                  id: e.id,
                  icon: meta.icon,
                  tone: meta.tone,
                  timestamp: e.occurredAt,
                  timestampLabel: formatDateTime(e.occurredAt),
                  title: `${FIELD_LABELS[e.field]} check ${meta.label}`,
                  description: (
                    <span className="flex flex-col gap-0.5">
                      {e.fieldKey ? (
                        <span className="break-anywhere font-mono text-[13px]">{e.fieldKey}</span>
                      ) : null}
                      {e.details ? <span>{e.details}</span> : null}
                    </span>
                  ),
                  meta: `Method: ${e.method} · ${e.actorType === "user" ? "run by a team member" : "run by the system"}`,
                };
              })}
            />
            {events.hasNextPage ? (
              <Button
                variant="outline"
                className="self-start"
                loading={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                Load older checks
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
