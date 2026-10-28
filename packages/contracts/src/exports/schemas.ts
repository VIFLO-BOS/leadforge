import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";
import { BusinessListFilter } from "../businesses/schemas.js";
import type { ErrorCode } from "../common/errors.js";

/** Synchronous CSV exports stop here; larger exports arrive with async export jobs. */
export const EXPORT_SYNC_ROW_CAP = 1_000;

export const ExportColumn = z.enum([
  "id",
  "name",
  "categories",
  "street",
  "locality",
  "lga",
  "region",
  "country",
  "website",
  "website_state",
  "phone",
  "phone_state",
  "phones_all",
  "whatsapp",
  "email",
  "email_state",
  "emails_all",
  "sources",
  /** Source records behind the row, as `<source>:<id>` (Overture GERS ids). */
  "source_records",
  /** Upstream datasets of those records, e.g. "meta" or "Foursquare". */
  "source_datasets",
  /** Licences of the row's open data, e.g. "CDLA-Permissive-2.0". */
  "source_licenses",
  /** Overture release the row's Overture values came from. */
  "overture_release",
  /** Attribution lines required with the row's data. */
  "attribution",
  /** Where the licence texts are published (absolute URLs). */
  "license_urls",
  "last_verified_at",
  "created_at",
  "updated_at",
]);
export type ExportColumn = z.infer<typeof ExportColumn>;

export const DEFAULT_EXPORT_COLUMNS: readonly ExportColumn[] = ExportColumn.options;

/**
 * Export the directory as CSV. Either `ids` (selected rows) or `filter` (the directory
 * filters). Suppressed businesses are always excluded.
 */
export const ExportBusinessesRequest = z.object({
  filter: BusinessListFilter.default({ suppression: "exclude" }),
  ids: z.array(ObjectIdString).min(1).max(EXPORT_SYNC_ROW_CAP).optional(),
  columns: z.array(ExportColumn).min(1).max(ExportColumn.options.length).optional(),
});
export type ExportBusinessesRequest = z.infer<typeof ExportBusinessesRequest>;

// ---------------------------------------------------------------------------
// Async export jobs (Phase 5)
// ---------------------------------------------------------------------------

/**
 * Release-1 defaults. The row cap per organization comes from the `export_row_cap`
 * entitlement (plans arrive in Phase 6); without one the API uses EXPORT_DEFAULT_ROW_CAP.
 */
export const EXPORT_LIMITS = {
  /** Default row cap per async export when no entitlement is set. */
  defaultRowCap: 10_000,
  /** Ids in a `selection` export request. */
  selectionMax: 5_000,
  /** Signed download links are valid this long by default (15 minutes). */
  downloadUrlTtlSeconds: 900,
  /** Files are deleted this long after they are built (7 days). */
  fileRetentionHours: 168,
} as const;

/** `directory`: the directory filters; `list`: one lead list; `selection`: chosen ids. */
export const ExportKind = z.enum(["directory", "list", "selection"]);
export type ExportKind = z.infer<typeof ExportKind>;

const columns = z.array(ExportColumn).min(1).max(ExportColumn.options.length).optional();

/**
 * `POST /exports`. Sales Representatives (`exports:create_assigned`) get only businesses whose
 * lead is assigned to them, whatever the selection. Suppressed businesses are never exported.
 */
export const CreateExportRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("directory"),
    filter: BusinessListFilter.default({ suppression: "exclude" }),
    columns,
  }),
  z.object({ kind: z.literal("list"), listId: ObjectIdString, columns }),
  z.object({
    kind: z.literal("selection"),
    ids: z
      .array(ObjectIdString)
      .min(1)
      .max(EXPORT_LIMITS.selectionMax)
      .refine(
        (ids) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length,
        "Each business can be listed once",
      ),
    columns,
  }),
]);
export type CreateExportRequest = z.infer<typeof CreateExportRequest>;

/** `expired`: the file was deleted after the retention window; run the export again. */
export const ExportStatus = z.enum(["queued", "running", "completed", "failed", "expired"]);
export type ExportStatus = z.infer<typeof ExportStatus>;

export const ExportJob = z.object({
  id: ObjectIdString,
  kind: ExportKind,
  status: ExportStatus,
  /** A ZIP with the CSV, ATTRIBUTION.txt and a LICENSES folder for the open-data licences that apply. */
  format: z.literal("zip"),
  /** `assigned`: limited to leads assigned to the requester (Sales Representative). */
  scope: z.enum(["all", "assigned"]),
  selection: z.object({
    listId: ObjectIdString.nullable(),
    listName: z.string().nullable(),
    idsCount: z.number().int().nullable(),
    filter: BusinessListFilter.nullable(),
  }),
  columns: z.array(ExportColumn),
  rowCap: z.number().int(),
  /** Rows matched when the export was requested. */
  matchedAtRequest: z.number().int(),
  /** Rows in the file; null until built. */
  rowCount: z.number().int().nullable(),
  /** True when more rows matched at build time than the cap allowed. */
  truncated: z.boolean(),
  progress: z.object({ processed: z.number().int(), total: z.number().int().nullable() }),
  file: z
    .object({
      name: z.string(),
      bytes: z.number().int(),
      sha256: z.string(),
      expiresAt: IsoDateTime,
      /** False once the file has been deleted. */
      available: z.boolean(),
      /** Licences bundled in LICENSES/ (empty when no row carries open data). */
      licenses: z.array(z.string()),
    })
    .nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedByUserId: UuidString,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type ExportJob = z.infer<typeof ExportJob>;

export const ExportListQuery = z.object({
  status: queryArray(ExportStatus, 5),
  ...CursorQuery.shape,
});
export type ExportListQuery = z.infer<typeof ExportListQuery>;

/** `GET /exports/:id/download-url`: a link bound to the caller, the organization and the export. */
export const ExportDownloadLink = z.object({
  url: z.string(),
  expiresAt: IsoDateTime,
});
export type ExportDownloadLink = z.infer<typeof ExportDownloadLink>;

/** Query of the signed download URL (`GET /exports/:id/download`). */
export const ExportDownloadQuery = z.object({
  /** The organization the link was issued in (bound by the signature). */
  org: UuidString,
  /** Unix seconds. */
  expires: z.coerce.number().int().min(0),
  sig: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/),
});
export type ExportDownloadQuery = z.infer<typeof ExportDownloadQuery>;

/**
 * Stage 8: when a browser navigates to a signed export link (`Sec-Fetch-Mode: navigate`, or an
 * `Accept` that prefers text/html) and the download fails with one of these codes, the API answers
 * `303 See Other` to `<APP_URL>/app/jobs/exports/<id>?downloadError=<code>` instead of the JSON
 * error. A damaged link (its query fails validation) is reported as DOWNLOAD_LINK_INVALID.
 */
export const EXPORT_DOWNLOAD_ERROR_CODES = [
  "DOWNLOAD_LINK_INVALID",
  "DOWNLOAD_LINK_EXPIRED",
  "EXPORT_EXPIRED",
  "EXPORT_NOT_READY",
] as const satisfies readonly ErrorCode[];
export const ExportDownloadErrorCode = z.enum(EXPORT_DOWNLOAD_ERROR_CODES);
export type ExportDownloadErrorCode = z.infer<typeof ExportDownloadErrorCode>;
