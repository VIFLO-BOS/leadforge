import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";
import { CountryCode } from "../auth/schemas.js";
import { PhoneType, WhatsAppStatus } from "../businesses/fields.js";

/** Hard limits for CSV import in release 1. Enforced server-side. */
export const IMPORT_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 100,
  maxCellLength: 2_000,
  /** Values per multi-valued cell (for example "0803..., 0812..."). */
  maxValuesPerCell: 5,
  acceptedExtensions: [".csv", ".tsv", ".txt"],
  previewMaxRows: 200,
  /** Staged rows and per-row results are kept this long after upload. */
  rowRetentionDays: 30,
} as const;

/** Business fields a CSV column can map to. Unmapped columns are ignored. */
export const ImportField = z.enum([
  "name",
  "category",
  "website",
  "phone",
  "email",
  "whatsapp",
  "street",
  "locality",
  "lga",
  "region",
  "country",
  "postalCode",
]);
export type ImportField = z.infer<typeof ImportField>;

/** Fields that may be mapped from more than one column. */
export const MULTI_COLUMN_IMPORT_FIELDS: readonly ImportField[] = ["category", "phone", "email"];

export const ImportMappingEntry = z.object({
  /** Zero-based column index in the uploaded file. */
  column: z
    .number()
    .int()
    .min(0)
    .max(IMPORT_LIMITS.maxColumns - 1),
  field: ImportField,
});
export type ImportMappingEntry = z.infer<typeof ImportMappingEntry>;

export const ImportMapping = z
  .array(ImportMappingEntry)
  .min(1)
  .max(IMPORT_LIMITS.maxColumns)
  .superRefine((entries, ctx) => {
    const columns = new Set<number>();
    const counts = new Map<ImportField, number>();
    entries.forEach((entry, i) => {
      if (columns.has(entry.column)) {
        ctx.addIssue({ code: "custom", path: [i, "column"], message: "Column is mapped twice" });
      }
      columns.add(entry.column);
      counts.set(entry.field, (counts.get(entry.field) ?? 0) + 1);
    });
    if ((counts.get("name") ?? 0) !== 1) {
      ctx.addIssue({ code: "custom", path: [], message: "Map exactly one column to name" });
    }
    for (const [field, count] of counts) {
      if (count > 1 && !MULTI_COLUMN_IMPORT_FIELDS.includes(field)) {
        ctx.addIssue({ code: "custom", path: [], message: `Only one column can map to ${field}` });
      }
    }
  });
export type ImportMapping = z.infer<typeof ImportMapping>;

export const ImportStatus = z.enum([
  "uploaded",
  "queued",
  "processing",
  "completed",
  "completed_with_errors",
  "failed",
]);
export type ImportStatus = z.infer<typeof ImportStatus>;

export const ImportRowOutcome = z.enum(["created", "updated", "suppressed", "failed"]);
export type ImportRowOutcome = z.infer<typeof ImportRowOutcome>;

export const ImportIssueCode = z.enum([
  "REQUIRED",
  "CELL_TOO_LONG",
  "FORMULA_INJECTION",
  "INVALID_PHONE",
  "INVALID_EMAIL",
  "INVALID_WEBSITE",
  "INVALID_COUNTRY",
  "COLUMN_COUNT_MISMATCH",
  "TOO_MANY_VALUES",
  "POSSIBLE_DUPLICATE",
  "SOCIAL_PROFILE",
  "SUPPRESSED",
]);
export type ImportIssueCode = z.infer<typeof ImportIssueCode>;

export const ImportRowIssue = z.object({
  /** Zero-based column, or null for row-level issues. */
  column: z.number().int().nullable(),
  header: z.string().nullable(),
  field: ImportField.nullable(),
  code: ImportIssueCode,
  message: z.string(),
});
export type ImportRowIssue = z.infer<typeof ImportRowIssue>;

export const ImportProgress = z.object({
  total: z.number().int(),
  processed: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  suppressed: z.number().int(),
  failed: z.number().int(),
  /** 0 to 100. */
  percent: z.number().int(),
});
export type ImportProgress = z.infer<typeof ImportProgress>;

export const ImportJob = z.object({
  id: ObjectIdString,
  status: ImportStatus,
  fileName: z.string(),
  sizeBytes: z.number().int(),
  /** Detected text encoding: utf-8, utf-16le, utf-16be or windows-1252. */
  encoding: z.string(),
  /** Detected delimiter: comma, semicolon or tab. */
  delimiter: z.enum([",", ";", "\t"]),
  headers: z.array(z.string()),
  /** Data rows (blank lines excluded). Spreadsheet row numbers start at 2. */
  rowCount: z.number().int(),
  blankRowsSkipped: z.number().int(),
  /** First rows as uploaded, for the mapping screen. */
  sampleRows: z.array(z.array(z.string())),
  suggestedMapping: z.array(ImportMappingEntry),
  mapping: z.array(ImportMappingEntry).nullable(),
  defaultCountry: z.string().nullable(),
  progress: ImportProgress,
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdByUserId: UuidString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  queuedAt: IsoDateTime.nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  /** Staged rows and the per-row report are deleted after this time. */
  rowsExpireAt: IsoDateTime,
});
export type ImportJob = z.infer<typeof ImportJob>;

export const ImportListQuery = z.object({
  status: queryArray(ImportStatus, 6),
  ...CursorQuery.shape,
});
export type ImportListQuery = z.infer<typeof ImportListQuery>;

export const ImportPreviewRequest = z.object({
  mapping: ImportMapping,
  /** Region for phone numbers without a country code and rows without a country column. */
  defaultCountry: CountryCode.default("NG"),
  limit: z.number().int().min(1).max(IMPORT_LIMITS.previewMaxRows).default(50),
});
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequest>;

export const NormalizedImportRow = z.object({
  name: z.string().nullable(),
  categories: z.array(z.string()),
  website: z.string().nullable(),
  domain: z.string().nullable(),
  phones: z.array(
    z.object({
      e164: z.string(),
      international: z.string(),
      country: z.string().nullable(),
      type: PhoneType,
      whatsapp: WhatsAppStatus,
    }),
  ),
  emails: z.array(z.string()),
  socials: z.array(z.object({ platform: z.string(), url: z.string() })),
  location: z.object({
    street: z.string().nullable(),
    locality: z.string().nullable(),
    lga: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string().nullable(),
    postalCode: z.string().nullable(),
  }),
});
export type NormalizedImportRow = z.infer<typeof NormalizedImportRow>;

export const ImportPreviewRow = z.object({
  rowNumber: z.number().int(),
  valid: z.boolean(),
  /** What committing would do with this row given the current data. */
  expectedOutcome: z.enum(["create", "update", "suppressed", "invalid"]),
  matchedBusinessId: ObjectIdString.nullable(),
  values: NormalizedImportRow,
  errors: z.array(ImportRowIssue),
  warnings: z.array(ImportRowIssue),
});
export type ImportPreviewRow = z.infer<typeof ImportPreviewRow>;

export const ImportPreviewResponse = z.object({
  rows: z.array(ImportPreviewRow),
  summary: z.object({
    totalRows: z.number().int(),
    checked: z.number().int(),
    valid: z.number().int(),
    invalid: z.number().int(),
  }),
});
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponse>;

export const ImportCommitRequest = z.object({
  mapping: ImportMapping,
  defaultCountry: CountryCode.default("NG"),
  /** The importing user attests a lawful basis for the data (security policy section 6). */
  attestLawfulBasis: z.literal(true, {
    message: "Confirm you have a lawful basis to import this data",
  }),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequest>;

export const ImportRowResult = z.object({
  rowNumber: z.number().int(),
  /** Null while the row is still waiting to be processed. */
  outcome: ImportRowOutcome.nullable(),
  businessId: ObjectIdString.nullable(),
  cells: z.array(z.string()),
  errors: z.array(ImportRowIssue),
  warnings: z.array(ImportRowIssue),
  processedAt: IsoDateTime.nullable(),
});
export type ImportRowResult = z.infer<typeof ImportRowResult>;

export const ImportRowsQuery = z.object({
  outcome: queryArray(ImportRowOutcome, 4),
  ...CursorQuery.shape,
});
export type ImportRowsQuery = z.infer<typeof ImportRowsQuery>;
