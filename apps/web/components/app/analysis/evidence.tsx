"use client";

import type { Detection, Evidence, Opportunity, WebsiteAnalysis } from "@leadforge/contracts";
import { ArrowDownRight, ExternalLink, Lightbulb } from "lucide-react";
import Link from "next/link";
import { Badge, StatusIndicator, cn } from "@leadforge/ui";
import { EVIDENCE_TYPE_LABELS, OBSERVED_META, detectionName, percent } from "@/lib/analysis";
import { formatDateTime, safeHttpUrl } from "@/lib/format";
import { humanizeKey } from "@/lib/labels";

/*
 * Evidence is untrusted text taken from someone else's website. It is always rendered as React
 * text (escaped), never as HTML, and page links are followed only when they are http(s).
 */

/** A page URL from the evidence: a link when it is http(s), else plain text. */
export function PageLink({ url, className }: { url: string; className?: string }) {
  const href = safeHttpUrl(url);
  if (!href) return <span className={cn("break-anywhere", className)}>{url}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        "text-primary break-anywhere rounded-xs inline-flex items-baseline gap-1 underline-offset-4 hover:underline",
        className,
      )}
    >
      <span className="break-anywhere">{url}</span>
      <ExternalLink aria-hidden className="size-3 shrink-0 self-center" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** One piece of evidence: its kind, the snippet as escaped text, and the page it came from. */
export function EvidenceItem({ evidence }: { evidence: Evidence }) {
  const typeLabel =
    EVIDENCE_TYPE_LABELS[evidence.type as keyof typeof EVIDENCE_TYPE_LABELS] ??
    humanizeKey(evidence.type);
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2" data-evidence-type={evidence.type}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline" className="shrink-0">
          {typeLabel}
        </Badge>
        {evidence.type === "url" ? (
          <PageLink url={evidence.value} className="text-[13px]" />
        ) : (
          <code
            className="bg-surface-container-high text-foreground break-anywhere rounded-xs min-w-0 whitespace-pre-wrap px-1.5 py-0.5 font-mono text-[12px] leading-5"
            data-testid="evidence-snippet"
          >
            {evidence.value}
          </code>
        )}
      </div>
      {evidence.page && evidence.page !== evidence.value ? (
        <p className="text-muted-foreground min-w-0 text-xs">
          On <PageLink url={evidence.page} />
        </p>
      ) : null}
    </li>
  );
}

export function EvidenceList({ evidence, limit }: { evidence: Evidence[]; limit?: number }) {
  const shown = limit ? evidence.slice(0, limit) : evidence;
  if (shown.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">No evidence was recorded for this check.</p>
    );
  }
  return (
    <ul className="divide-border flex min-w-0 flex-col divide-y" aria-label="Evidence">
      {shown.map((e, i) => (
        <EvidenceItem key={`${e.type}-${i}`} evidence={e} />
      ))}
      {limit && evidence.length > limit ? (
        <li className="text-muted-foreground py-2 text-xs">
          {evidence.length - limit} more on the full analysis
        </li>
      ) : null}
    </ul>
  );
}

/** Observed yes/no/unknown, always icon plus text. */
export function ObservedStatus({ observed }: { observed: Detection["observed"] }) {
  const meta = OBSERVED_META[observed] ?? OBSERVED_META.unknown;
  return (
    <StatusIndicator
      tone={meta.tone}
      icon={meta.icon}
      label={meta.label}
      title={meta.description}
      size="sm"
      data-observed={observed}
    />
  );
}

export function detectionAnchor(key: string): string {
  return `detection-${key}`;
}

/**
 * One detection with its observation label (phrased as what was or was not detected), the
 * observed state, confidence, the observed value (platform version) and every piece of evidence.
 */
export function DetectionItem({ detection }: { detection: Detection }) {
  return (
    <li
      id={detectionAnchor(detection.key)}
      className="flex min-w-0 scroll-mt-24 flex-col gap-2 py-4 first:pt-0 last:pb-0"
      data-detection={detection.key}
      data-observed={detection.observed}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.06em]">
          {detectionName(detection.key)}
        </p>
        <h3 className="text-foreground text-sm font-medium">{detection.label}</h3>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <ObservedStatus observed={detection.observed} />
        <span className="text-muted-foreground text-xs tabular-nums">
          Confidence {percent(detection.confidence)}
        </span>
        <span className="text-muted-foreground text-xs">
          Analyzed{" "}
          <time dateTime={detection.analyzedAt}>{formatDateTime(detection.analyzedAt)}</time>
        </span>
      </div>
      {detection.observedValue ? (
        <p className="text-sm">
          Observed value:{" "}
          <code className="bg-surface-container-high break-anywhere rounded-xs px-1.5 py-0.5 font-mono text-[12px]">
            {detection.observedValue}
          </code>
        </p>
      ) : null}
      <EvidenceList evidence={detection.evidence} />
    </li>
  );
}

/**
 * An opportunity suggestion: its title, rationale and confidence, linked to the detections it
 * rests on (on the full analysis page, or in-page when `inPage`).
 */
export function OpportunityItem({
  opportunity,
  analysis,
  inPage = false,
  showEvidence = false,
}: {
  opportunity: Opportunity;
  analysis: Pick<WebsiteAnalysis, "id" | "detections">;
  inPage?: boolean;
  showEvidence?: boolean;
}) {
  const supporting = opportunity.detectionKeys
    .map((k) => analysis.detections.find((d) => d.key === k))
    .filter((d): d is Detection => Boolean(d));
  return (
    <li
      className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0"
      data-opportunity={opportunity.key}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="bg-primary-container text-primary-container-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
          <Lightbulb aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-medium">{opportunity.title}</h3>
          <p className="text-muted-foreground text-sm">{opportunity.rationale}</p>
          <p className="text-muted-foreground text-xs tabular-nums">
            Confidence {percent(opportunity.confidence)}
          </p>
        </div>
      </div>
      {supporting.length ? (
        <div className="flex min-w-0 flex-col gap-1 min-[480px]:pl-11">
          <p className="text-muted-foreground text-xs">Based on</p>
          <ul className="flex min-w-0 flex-col gap-1">
            {supporting.map((d) => (
              <li key={d.key} className="flex min-w-0 flex-col gap-1">
                <Link
                  href={
                    inPage
                      ? `#${detectionAnchor(d.key)}`
                      : `/app/analysis/${analysis.id}#${detectionAnchor(d.key)}`
                  }
                  className="text-primary rounded-xs inline-flex min-w-0 items-start gap-1 text-sm hover:underline"
                >
                  <ArrowDownRight aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="break-anywhere">{d.label}</span>
                </Link>
                {showEvidence ? <EvidenceList evidence={d.evidence} limit={2} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** The honest limitation every analysis view states. */
export const STATIC_HTML_NOTE =
  "The analysis reads the HTML the website's server sends, on up to 5 pages. It does not run JavaScript or load external stylesheets, so features built with scripts may not be detected. Not detecting a feature does not prove the business lacks it.";
