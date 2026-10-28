"use client";

import type {
  ImportJob,
  ImportPreviewResponse,
  ImportPreviewRow,
  ImportRowIssue,
} from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  ChoiceField,
  DataTable,
  EmptyState,
  SegmentedControl,
  Stat,
} from "@leadforge/ui";
import { formatNumber, plural } from "@/lib/format";
import { IMPORT_ISSUE_LABELS } from "@/lib/labels";
import { CellBox } from "../shared";

const OUTCOME: Record<
  ImportPreviewRow["expectedOutcome"],
  { label: string; variant: "success" | "info" | "warning" | "destructive" }
> = {
  create: { label: "New business", variant: "success" },
  update: { label: "Updates existing", variant: "info" },
  suppressed: { label: "Skipped: suppressed", variant: "warning" },
  invalid: { label: "Will fail", variant: "destructive" },
};

export function IssueList({
  errors,
  warnings,
}: {
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
}) {
  if (errors.length === 0 && warnings.length === 0) {
    return <span className="text-muted-foreground">No issues</span>;
  }
  return (
    <ul className="flex min-w-0 flex-col gap-1.5">
      {errors.map((e, i) => (
        <li key={`e${i}`} className="flex min-w-0 items-start gap-1.5">
          <CircleAlert aria-hidden className="text-destructive mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="font-medium">{IMPORT_ISSUE_LABELS[e.code]}</span>
            {e.header ? <span className="text-muted-foreground"> in “{e.header}”</span> : null}
            <span className="sr-only"> (error)</span>
            <span className="text-muted-foreground break-anywhere block text-xs">{e.message}</span>
          </span>
        </li>
      ))}
      {warnings.map((w, i) => (
        <li key={`w${i}`} className="flex min-w-0 items-start gap-1.5">
          <TriangleAlert aria-hidden className="text-warning mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="font-medium">{IMPORT_ISSUE_LABELS[w.code]}</span>
            {w.header ? <span className="text-muted-foreground"> in “{w.header}”</span> : null}
            <span className="sr-only"> (warning)</span>
            <span className="text-muted-foreground break-anywhere block text-xs">{w.message}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const columns: ColumnDef<ImportPreviewRow>[] = [
  {
    id: "row",
    header: "Row",
    meta: { label: "Row", align: "end", cellClassName: "w-16" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.rowNumber}</span>,
  },
  {
    id: "business",
    header: "Business",
    meta: { label: "Business", mobileTitle: true },
    cell: ({ row }) => {
      const v = row.original.values;
      return (
        <CellBox width="12rem" className="flex flex-col gap-0.5">
          <span className="font-medium">
            {v.name ?? <span className="text-muted-foreground italic">No name</span>}
          </span>
          {v.categories.length ? (
            <span className="text-muted-foreground text-xs">{v.categories.join(" · ")}</span>
          ) : null}
        </CellBox>
      );
    },
  },
  {
    id: "outcome",
    header: "Result",
    meta: { label: "Result" },
    cell: ({ row }) => {
      const o = OUTCOME[row.original.expectedOutcome];
      return (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Badge variant={o.variant}>{o.label}</Badge>
          {row.original.matchedBusinessId ? (
            <Link
              href={`/app/businesses/${row.original.matchedBusinessId}`}
              className="text-primary text-xs hover:underline"
              target="_blank"
            >
              Matched business
            </Link>
          ) : null}
        </div>
      );
    },
  },
  {
    id: "issues",
    header: "Issues",
    meta: { label: "Issues" },
    cell: ({ row }) => (
      <CellBox width="17rem">
        <IssueList errors={row.original.errors} warnings={row.original.warnings} />
      </CellBox>
    ),
  },
  {
    id: "contacts",
    header: "Contacts",
    meta: { label: "Contacts" },
    cell: ({ row }) => {
      const v = row.original.values;
      const lines = [
        ...v.phones.map((p) => p.international),
        ...v.emails,
        ...(v.domain ? [v.domain] : []),
        ...v.socials.map((s) => s.url),
      ];
      return lines.length ? (
        <CellBox width="14rem">
          <ul className="flex flex-col gap-0.5">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </CellBox>
      ) : (
        <span className="text-muted-foreground">None</span>
      );
    },
  },
  {
    id: "location",
    header: "Location",
    meta: { label: "Location" },
    cell: ({ row }) => {
      const l = row.original.values.location;
      const text = [l.locality, l.region, l.country].filter(Boolean).join(", ");
      return text ? (
        <CellBox width="9rem">{text}</CellBox>
      ) : (
        <span className="text-muted-foreground">None</span>
      );
    },
  },
];

export interface ReviewStepProps {
  job: ImportJob;
  preview: ImportPreviewResponse;
  attested: boolean;
  onAttestedChange: (v: boolean) => void;
  onBack: () => void;
  onCommit: () => void;
  committing: boolean;
  error?: React.ReactNode;
}

/** Preview of the first rows with per-row validation issues and the predicted outcome. */
export function ReviewStep({
  job,
  preview,
  attested,
  onAttestedChange,
  onBack,
  onCommit,
  committing,
  error,
}: ReviewStepProps) {
  const [view, setView] = useState<"all" | "issues">(
    preview.summary.invalid > 0 ? "issues" : "all",
  );
  const rows = useMemo(
    () =>
      view === "issues"
        ? preview.rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0)
        : preview.rows,
    [preview.rows, view],
  );
  const counts = useMemo(() => {
    const c = { create: 0, update: 0, suppressed: 0, invalid: 0 };
    for (const r of preview.rows) c[r.expectedOutcome] += 1;
    return c;
  }, [preview.rows]);
  const { summary } = preview;
  const partial = summary.checked < summary.totalRows;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="New businesses"
          value={formatNumber(counts.create)}
          hint={`in the first ${formatNumber(summary.checked)} rows`}
        />
        <Stat
          label="Updates to existing"
          value={formatNumber(counts.update)}
          hint="Exact match on name plus domain, phone or email"
        />
        <Stat label="Skipped as suppressed" value={formatNumber(counts.suppressed)} />
        <Stat
          label="Rows with errors"
          value={formatNumber(summary.invalid)}
          hint="Reported, never partly imported"
        />
      </div>
      <p className="text-muted-foreground text-sm">
        {partial
          ? `Checked the first ${formatNumber(summary.checked)} of ${plural(summary.totalRows, "row", "rows")}. Every row is validated again during the import, and rows with errors are listed in the results.`
          : `Checked all ${plural(summary.totalRows, "row", "rows")}.`}
      </p>

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <SegmentedControl<"all" | "issues">
          aria-label="Rows to show"
          value={view}
          onValueChange={setView}
          size="sm"
          options={[
            { value: "all", label: `All (${preview.rows.length})` },
            {
              value: "issues",
              label: `Issues (${preview.rows.filter((r) => r.errors.length || r.warnings.length).length})`,
            },
          ]}
        />
      </div>

      <DataTable
        caption="Rows checked before import"
        columns={columns}
        data={rows}
        getRowId={(r) => String(r.rowNumber)}
        mobileCards
        enableDensityToggle={false}
        enableColumnVisibility={false}
        empty={
          <EmptyState
            size="compact"
            icon={CircleCheck}
            title="No issues in the checked rows"
            description="Switch to All to see every checked row."
          />
        }
      />

      <div className="bg-surface-container-low flex min-w-0 flex-col gap-4 rounded-lg p-4">
        <ChoiceField
          id="import-attest"
          label="I confirm we have a lawful basis to import and process this data"
          description={
            <>
              For example, the businesses published these details for business contact, or they are
              existing customers. See the{" "}
              <Link href="/legal/data-collection" className="link-inline" target="_blank">
                data collection policy
              </Link>
              .
            </>
          }
          control={
            <Checkbox checked={attested} onCheckedChange={(v) => onAttestedChange(v === true)} />
          }
        />
        {error}
        <div className="flex min-w-0 flex-col-reverse gap-2 min-[480px]:flex-row min-[480px]:justify-between">
          <Button variant="text" onClick={onBack} disabled={committing}>
            <ArrowLeft aria-hidden /> Change mapping
          </Button>
          <Button onClick={onCommit} disabled={!attested} loading={committing}>
            Import {plural(job.rowCount, "row", "rows")}
          </Button>
        </div>
      </div>
    </div>
  );
}
