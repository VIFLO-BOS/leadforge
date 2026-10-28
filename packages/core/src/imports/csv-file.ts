import { parse } from "csv-parse/sync";
import { IMPORT_LIMITS } from "@leadforge/contracts";
import { cleanText } from "../normalization/text.js";

export type CsvDelimiter = "," | ";" | "\t";

export interface ParsedCsvRow {
  /** Spreadsheet row number: the header is row 1, the first data row is row 2. */
  rowNumber: number;
  cells: string[];
}

export interface ParsedCsv {
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
  delimiter: CsvDelimiter;
  headers: string[];
  rows: ParsedCsvRow[];
  blankRowsSkipped: number;
}

export type ImportFileErrorCode = "IMPORT_INVALID" | "UNSUPPORTED_MEDIA_TYPE" | "PAYLOAD_TOO_LARGE";

/** A whole-file problem. Row-level problems are never thrown; they are reported per row. */
export class ImportFileError extends Error {
  constructor(
    readonly code: ImportFileErrorCode,
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "ImportFileError";
  }
}

const MAGIC: Array<{ bytes: number[]; label: string }> = [
  {
    bytes: [0x50, 0x4b, 0x03, 0x04],
    label: "an Excel workbook or ZIP archive (save it as CSV first)",
  },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], label: "a legacy Excel workbook (save it as CSV first)" },
  { bytes: [0x25, 0x50, 0x44, 0x46], label: "a PDF" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], label: "a PNG image" },
  { bytes: [0xff, 0xd8, 0xff], label: "a JPEG image" },
  { bytes: [0x1f, 0x8b], label: "a gzip archive" },
];

/** Content sniffing: the upload must be text, whatever its declared MIME type says. */
export function sniffContent(buf: Buffer): void {
  for (const { bytes, label } of MAGIC) {
    if (bytes.every((b, i) => buf[i] === b)) {
      throw new ImportFileError(
        "UNSUPPORTED_MEDIA_TYPE",
        `This file looks like ${label}, not CSV.`,
      );
    }
  }
}

/** Detects the BOM or falls back from strict UTF-8 to Windows-1252 (Excel's "CSV" on Windows). */
export function decodeCsvBuffer(buf: Buffer): { text: string; encoding: ParsedCsv["encoding"] } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buf.subarray(3)), encoding: "utf-8" };
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  }
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) {
    throw new ImportFileError(
      "UNSUPPORTED_MEDIA_TYPE",
      "This file contains binary data. Upload a CSV saved as UTF-8 or Windows-1252 text.",
    );
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buf), encoding: "windows-1252" };
  }
}

/** Picks comma, semicolon or tab by counting each outside quotes on the header line. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length && i < 65_536; i++) {
    const ch = text[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) counts[ch] += 1;
  }
  const best = (Object.entries(counts) as Array<[CsvDelimiter, number]>).sort(
    (a, b) => b[1] - a[1],
  )[0]!;
  return best[1] > 0 ? best[0] : ",";
}

/**
 * Parses an uploaded CSV. Handles UTF-8 (with or without BOM), UTF-16 with BOM and
 * Windows-1252; comma, semicolon or tab delimiters; quoted fields with embedded delimiters,
 * quotes and newlines. Blank lines are skipped and counted. Rows keep their spreadsheet row
 * numbers so errors can be found in Excel. Cells longer than the limit are kept one
 * character over it so the row normalizer reports them.
 */
export function parseCsvFile(buf: Buffer): ParsedCsv {
  if (buf.length === 0) throw new ImportFileError("IMPORT_INVALID", "The file is empty.");
  if (buf.length > IMPORT_LIMITS.maxFileBytes) {
    throw new ImportFileError(
      "PAYLOAD_TOO_LARGE",
      `The file is larger than ${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)} MB.`,
    );
  }
  sniffContent(buf);
  const { text, encoding } = decodeCsvBuffer(buf);
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim().length === 0) throw new ImportFileError("IMPORT_INVALID", "The file is empty.");
  const delimiter = detectDelimiter(body);

  let records: string[][];
  try {
    records = parse(body, {
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      max_record_size: 1_000_000,
    });
  } catch (err) {
    const line = (err as { lines?: number }).lines;
    const reason =
      err instanceof Error
        ? err.message.replace(/^Invalid Record Length:.*$/, "Row length mismatch")
        : "Unreadable CSV";
    throw new ImportFileError(
      "IMPORT_INVALID",
      `The CSV could not be read${line ? ` near line ${line}` : ""}: ${reason}`,
      line,
    );
  }

  const headerIndex = records.findIndex((r) => r.some((c) => cleanText(c).length > 0));
  if (headerIndex === -1)
    throw new ImportFileError("IMPORT_INVALID", "The file has no header row.");
  const headerRecord = records[headerIndex]!;
  // Trailing empty header cells (from trailing delimiters) are not columns.
  let width = headerRecord.length;
  while (width > 1 && cleanText(headerRecord[width - 1]!).length === 0) width -= 1;
  if (width > IMPORT_LIMITS.maxColumns) {
    throw new ImportFileError(
      "IMPORT_INVALID",
      `The file has ${width} columns; the limit is ${IMPORT_LIMITS.maxColumns}.`,
    );
  }
  const headers = headerRecord
    .slice(0, width)
    .map((h, i) => cleanText(h).slice(0, 200) || `Column ${i + 1}`);

  const rows: ParsedCsvRow[] = [];
  let blankRowsSkipped = 0;
  for (let i = headerIndex + 1; i < records.length; i++) {
    const record = records[i]!;
    if (record.every((c) => cleanText(c).length === 0)) {
      blankRowsSkipped += 1;
      continue;
    }
    rows.push({
      rowNumber: i + 1,
      cells: record
        .slice(0, IMPORT_LIMITS.maxColumns + 1)
        .map((c) => c.slice(0, IMPORT_LIMITS.maxCellLength + 1)),
    });
    if (rows.length > IMPORT_LIMITS.maxRows) {
      throw new ImportFileError(
        "PAYLOAD_TOO_LARGE",
        `The file has more than ${IMPORT_LIMITS.maxRows.toLocaleString("en")} data rows. Split it into smaller files.`,
      );
    }
  }
  if (rows.length === 0)
    throw new ImportFileError("IMPORT_INVALID", "The file has a header but no data rows.");

  return { encoding, delimiter, headers, rows, blankRowsSkipped };
}
