"use client";

import {
  CountryCode,
  ImportField,
  ImportMapping,
  MULTI_COLUMN_IMPORT_FIELDS,
  type ImportJob,
  type ImportMappingEntry,
} from "@leadforge/contracts";
import { ArrowLeft, CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextField,
  cn,
} from "@leadforge/ui";
import { formatBytes, formatNumber, plural } from "@/lib/format";
import { IMPORT_FIELD_LABELS } from "@/lib/labels";

/** One entry per file column: the field it maps to, or "" to skip the column. */
export type ColumnMapping = (ImportField | "")[];

const SKIP = "__skip";
const DELIMITER: Record<ImportJob["delimiter"], string> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
};

export function mappingFromEntries(columns: number, entries: ImportMappingEntry[]): ColumnMapping {
  const out: ColumnMapping = Array.from({ length: columns }, () => "");
  for (const e of entries) if (e.column < columns) out[e.column] = e.field;
  return out;
}

export function entriesFromMapping(mapping: ColumnMapping): ImportMappingEntry[] {
  return mapping.flatMap((field, column) => (field ? [{ column, field }] : []));
}

/** Problems that block continuing, from the contracts' ImportMapping schema. */
export function mappingIssues(mapping: ColumnMapping): string[] {
  const entries = entriesFromMapping(mapping);
  if (entries.length === 0) return ["Map at least the business name column."];
  const parsed = ImportMapping.safeParse(entries);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((i) => i.message))];
}

/** Per-column message when a single-value field is chosen for more than one column. */
function duplicateNote(mapping: ColumnMapping, column: number, headers: string[]): string | null {
  const field = mapping[column];
  if (!field || MULTI_COLUMN_IMPORT_FIELDS.includes(field)) return null;
  const others = mapping
    .map((f, i) => (f === field && i !== column ? i : -1))
    .filter((i) => i >= 0);
  if (others.length === 0) return null;
  return `${IMPORT_FIELD_LABELS[field]} is also mapped from ${others
    .map((i) => `“${headers[i] || `Column ${i + 1}`}”`)
    .join(", ")}. Only one column can map to it.`;
}

export interface MappingStepProps {
  job: ImportJob;
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  defaultCountry: string;
  onDefaultCountryChange: (country: string) => void;
  onBack: () => void;
  /** Runs the preview. Resolves when it is done; errors are shown by the caller. */
  onContinue: () => void;
  continuing: boolean;
  /** Rows the preview checks. */
  previewRows: number;
  error?: React.ReactNode;
}

/**
 * Column mapping: the API's suggestion is preselected and editable per column. Exactly one
 * column must map to the business name; phone, email and category may come from several
 * columns, every other field from one. Validation comes from the contracts schema.
 */
export function MappingStep({
  job,
  mapping,
  onMappingChange,
  defaultCountry,
  onDefaultCountryChange,
  onBack,
  onContinue,
  continuing,
  previewRows,
  error,
}: MappingStepProps) {
  const [attempted, setAttempted] = useState(false);
  const issuesId = useId();
  const issues = mappingIssues(mapping);
  const countryCheck = CountryCode.safeParse(defaultCountry);
  const countryError = countryCheck.success ? undefined : countryCheck.error.issues[0]?.message;
  const suggested = mappingFromEntries(job.headers.length, job.suggestedMapping);
  const nameColumn = mapping.findIndex((f) => f === "name");
  const mappedCount = mapping.filter(Boolean).length;

  const samplesFor = (column: number) =>
    job.sampleRows
      .map((row) => row[column]?.trim() ?? "")
      .filter(Boolean)
      .slice(0, 3);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="text-muted-foreground flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-foreground break-anywhere font-medium">{job.fileName}</span>
        <span>{formatBytes(job.sizeBytes)}</span>
        <span>{plural(job.rowCount, "data row", "data rows")}</span>
        <span>{plural(job.headers.length, "column", "columns")}</span>
        <span>
          {DELIMITER[job.delimiter]} separated, {job.encoding}
        </span>
        {job.blankRowsSkipped ? (
          <span>{plural(job.blankRowsSkipped, "blank row", "blank rows")} skipped</span>
        ) : null}
      </div>

      <div
        className={cn(
          "flex min-w-0 items-start gap-3 rounded-md p-3 text-sm",
          nameColumn >= 0 ? "bg-success-subtle" : "bg-warning-subtle",
        )}
        role="status"
      >
        {nameColumn >= 0 ? (
          <CircleCheck aria-hidden className="text-success mt-0.5 size-5 shrink-0" />
        ) : (
          <CircleAlert aria-hidden className="text-warning mt-0.5 size-5 shrink-0" />
        )}
        <p className="min-w-0">
          {nameColumn >= 0
            ? `Business name comes from “${job.headers[nameColumn] || `Column ${nameColumn + 1}`}”. ${plural(mappedCount, "column", "columns")} will be imported; unmapped columns are ignored.`
            : "Choose the column that holds the business name. It is the only required field."}
        </p>
      </div>

      <ol
        className="divide-border border-border flex min-w-0 flex-col divide-y rounded-lg border"
        aria-label="Columns in the file"
      >
        {job.headers.map((header, column) => {
          const value = mapping[column] ?? "";
          const note = duplicateNote(mapping, column, job.headers);
          const samples = samplesFor(column);
          const selectId = `map-col-${column}`;
          const isSuggested = Boolean(value) && suggested[column] === value;
          return (
            <li
              key={column}
              className="grid min-w-0 grid-cols-1 gap-3 p-3 sm:p-4 min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] min-[640px]:items-center min-[640px]:gap-6"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs tabular-nums">
                    Column {column + 1}
                  </span>
                  <span className="break-anywhere text-sm font-medium">
                    {header || "Untitled column"}
                  </span>
                </p>
                <p className="text-muted-foreground break-anywhere text-xs">
                  {samples.length ? (
                    <>
                      <span className="sr-only">Sample values: </span>
                      {samples.join(" · ")}
                    </>
                  ) : (
                    "Empty in the first rows"
                  )}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={selectId} className="sr-only">
                  Import “{header || `Column ${column + 1}`}” as
                </label>
                <Select
                  value={value || SKIP}
                  onValueChange={(v) => {
                    const next = [...mapping];
                    next[column] = v === SKIP ? "" : (v as ImportField);
                    onMappingChange(next);
                  }}
                >
                  <SelectTrigger
                    id={selectId}
                    aria-invalid={note ? true : undefined}
                    aria-describedby={note ? `${selectId}-note` : undefined}
                    className={cn(!value && "text-muted-foreground")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP}>Don&apos;t import</SelectItem>
                    {ImportField.options.map((f) => (
                      <SelectItem key={f} value={f}>
                        {IMPORT_FIELD_LABELS[f]}
                        {f === "name" ? " (required)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {note ? (
                  <p id={`${selectId}-note`} className="text-destructive text-xs" role="alert">
                    {note}
                  </p>
                ) : isSuggested ? (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <Sparkles aria-hidden className="size-3.5" /> Suggested from the header
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex min-w-0 max-w-sm flex-col gap-1">
        <TextField
          id="import-country"
          label="Default country"
          value={defaultCountry}
          maxLength={2}
          onChange={(e) => onDefaultCountryChange(e.target.value.toUpperCase())}
          error={countryError}
          hint="Two-letter code used for phone numbers without a country code and rows without a country column."
        />
      </div>

      {attempted && issues.length ? (
        <div
          id={issuesId}
          role="alert"
          className="bg-destructive-subtle flex min-w-0 flex-col gap-1 rounded-md p-3 text-sm"
        >
          <p className="font-medium">Fix the mapping to continue</p>
          <ul className="list-disc pl-5">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error}

      <div className="flex min-w-0 flex-col-reverse gap-2 min-[480px]:flex-row min-[480px]:justify-between">
        <Button variant="text" onClick={onBack} disabled={continuing}>
          <ArrowLeft aria-hidden /> Choose another file
        </Button>
        <Button
          onClick={() => {
            setAttempted(true);
            if (issues.length === 0 && !countryError) onContinue();
          }}
          loading={continuing}
          aria-describedby={attempted && issues.length ? issuesId : undefined}
        >
          Check rows
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Checking validates up to the first {formatNumber(previewRows)} rows without importing
        anything.
        {job.rowCount > previewRows ? " Every row is validated again during the import." : ""}
      </p>
    </div>
  );
}
