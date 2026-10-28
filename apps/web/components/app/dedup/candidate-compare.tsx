"use client";

import type { CandidateBusiness, DuplicateCandidate } from "@leadforge/contracts";
import { Equal, EyeOff, Unlink } from "lucide-react";
import Link from "next/link";
import { Badge, StatusIndicator } from "@leadforge/ui";
import { candidateName, signalLabel } from "@/lib/dedup";
import { formatDate } from "@/lib/format";
import { sourceLabel } from "@/lib/labels";

type Field = {
  key: string;
  label: string;
  /** What is shown. */
  value: (b: CandidateBusiness) => string[];
  /** What is compared for "Same", when it differs from what is shown (phones compare as E.164). */
  compare?: (b: CandidateBusiness) => string[];
};

/** Phones in display form ("+234 803 123 4567") when the API sends it (Phase 6), else E.164. */
export function displayPhones(b: CandidateBusiness): string[] {
  if (!b.phonesDisplay?.length) return b.phones;
  return b.phones.map(
    (e164) => b.phonesDisplay?.find((p) => p.e164 === e164)?.international ?? e164,
  );
}

const FIELDS: Field[] = [
  { key: "name", label: "Name", value: (b) => [candidateName(b)] },
  { key: "categories", label: "Categories", value: (b) => b.categories },
  {
    key: "location",
    label: "Location",
    value: (b) => {
      const text =
        b.location.formatted ??
        [b.location.locality, b.location.lga, b.location.region].filter(Boolean).join(", ");
      return text ? [text] : [];
    },
  },
  { key: "website", label: "Website", value: (b) => (b.website ? [b.website] : []) },
  { key: "phones", label: "Phones", value: displayPhones, compare: (b) => b.phones },
  { key: "emails", label: "Emails", value: (b) => b.emails },
  { key: "sources", label: "Sources", value: (b) => b.sources.map((s) => sourceLabel(s)) },
  { key: "created", label: "Added", value: (b) => (b.createdAt ? [formatDate(b.createdAt)] : []) },
];

function same(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const norm = (v: string) => v.trim().toLowerCase();
  const sb = new Set(b.map(norm));
  return a.some((v) => sb.has(norm(v)));
}

function Values({ values, empty }: { values: string[]; empty: string }) {
  if (!values.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <ul className="flex min-w-0 flex-col gap-0.5">
      {values.map((v) => (
        <li key={v} className="break-anywhere">
          {v}
        </li>
      ))}
    </ul>
  );
}

function BusinessHeading({ b, side }: { b: CandidateBusiness; side: "A" | "B" }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-xs font-normal">Business {side}</span>
      {b.live ? (
        <Link
          href={`/app/businesses/${b.id}`}
          className="text-primary break-anywhere rounded-xs font-medium hover:underline"
        >
          {candidateName(b)}
        </Link>
      ) : (
        <span className="break-anywhere font-medium">{candidateName(b)}</span>
      )}
      <span className="flex flex-wrap gap-1">
        {!b.live ? (
          <Badge variant="neutral">
            <Unlink aria-hidden /> No longer in the directory
          </Badge>
        ) : null}
        {b.suppressed ? (
          <Badge variant="warning">
            <EyeOff aria-hidden /> Suppressed
          </Badge>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The two businesses of a candidate side by side. From 640px a comparison table (one row per
 * field, values that match marked "Same"); below that, one card per business. Values come from
 * the candidate as the API returns it (both records' current values).
 */
export function CandidateCompare({ candidate }: { candidate: DuplicateCandidate }) {
  const [a, b] = candidate.businesses;
  if (!a || !b) {
    return <p className="text-muted-foreground text-sm">The pair could not be loaded.</p>;
  }
  const overture = [a, b].some((x) => x.sources.includes("overture_places"));
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="candidate-compare">
      <div className="hidden min-[640px]:block">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <caption className="sr-only">Side-by-side comparison of the two businesses</caption>
          <colgroup>
            <col className="w-28" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="border-border border-b align-bottom">
              <th
                scope="col"
                className="text-muted-foreground px-3 pb-3 text-left text-xs font-medium"
              >
                Field
              </th>
              <th scope="col" className="px-3 pb-3 text-left text-sm">
                <BusinessHeading b={a} side="A" />
              </th>
              <th scope="col" className="px-3 pb-3 text-left text-sm">
                <BusinessHeading b={b} side="B" />
              </th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => {
              const va = f.value(a);
              const vb = f.value(b);
              const match =
                f.key !== "created" &&
                f.key !== "sources" &&
                same(f.compare?.(a) ?? va, f.compare?.(b) ?? vb);
              return (
                <tr
                  key={f.key}
                  className="border-border border-b align-top last:border-b-0"
                  data-field={f.key}
                >
                  <th
                    scope="row"
                    className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium"
                  >
                    <span className="flex flex-col gap-1">
                      {f.label}
                      {match ? (
                        <StatusIndicator tone="info" icon={Equal} label="Same" size="sm" />
                      ) : null}
                    </span>
                  </th>
                  <td className="min-w-0 px-3 py-2.5">
                    <Values values={va} empty="Not recorded" />
                  </td>
                  <td className="min-w-0 px-3 py-2.5">
                    <Values values={vb} empty="Not recorded" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[640px]:hidden">
        {[a, b].map((biz, i) => (
          <section
            key={biz.id}
            aria-label={`Business ${i === 0 ? "A" : "B"}`}
            className="bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-md p-3"
          >
            <BusinessHeading b={biz} side={i === 0 ? "A" : "B"} />
            <dl className="flex min-w-0 flex-col gap-2 text-[13px]">
              {FIELDS.filter((f) => f.key !== "name").map((f) => {
                const other = i === 0 ? b : a;
                const match =
                  f.key !== "created" &&
                  f.key !== "sources" &&
                  same((f.compare ?? f.value)(biz), (f.compare ?? f.value)(other));
                return (
                  <div key={f.key} className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                      {f.label}
                      {match ? (
                        <StatusIndicator tone="info" icon={Equal} label="Same" size="sm" />
                      ) : null}
                    </dt>
                    <dd className="min-w-0">
                      <Values values={f.value(biz)} empty="Not recorded" />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
      {overture ? (
        <p className="text-muted-foreground text-xs" data-testid="compare-attribution">
          Some values: Source: Overture Maps Foundation (overturemaps.org).{" "}
          <Link href="/legal/data-sources" className="link-inline rounded-xs">
            Data sources and licences
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Signals behind the proposal: what matched and how closely. */
export function CandidateSignals({ candidate }: { candidate: DuplicateCandidate }) {
  if (!candidate.signals.length) return null;
  return (
    <ul className="divide-border flex min-w-0 flex-col divide-y text-[13px]" aria-label="Signals">
      {candidate.signals.map((s, i) => (
        <li
          key={`${s.kind}-${i}`}
          className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
          data-signal={s.kind}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{signalLabel(s.kind)}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {s.kind === "name_similarity"
                ? `${Math.round(s.similarity * 100)}% similar`
                : "Exact match"}
            </span>
          </span>
          <span className="text-muted-foreground break-anywhere text-xs">
            A: {s.aValue ?? "not recorded"} · B: {s.bValue ?? "not recorded"}
          </span>
        </li>
      ))}
    </ul>
  );
}
