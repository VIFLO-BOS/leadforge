/**
 * Spreadsheet formula-injection (CSV injection) defenses.
 * Cells beginning with =, +, -, @, tab or carriage return can be executed as formulas by
 * Excel, LibreOffice and Google Sheets.
 */

export const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"] as const;

/** A strict E.164 number is data, not a formula, so it is exported unchanged. */
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Import-side check on a raw cell. Leading whitespace is ignored except tab and carriage
 * return, which are triggers themselves. `allowLeadingPlus` is for phone columns, where
 * `+234...` is the normal international form.
 */
export function looksLikeFormula(
  raw: string,
  options: { allowLeadingPlus?: boolean } = {},
): boolean {
  if (raw.startsWith("\t") || raw.startsWith("\r")) return true;
  const first = raw.trimStart().charAt(0);
  if (first === "=" || first === "@" || first === "-") return true;
  if (first === "+") return !options.allowLeadingPlus;
  return false;
}

/** Export-side neutralization: prefix a single quote so spreadsheets treat the cell as text. */
export function neutralizeCell(value: string): string {
  if (value.length === 0) return value;
  if (!FORMULA_TRIGGERS.includes(value.charAt(0) as (typeof FORMULA_TRIGGERS)[number]))
    return value;
  if (E164.test(value)) return value;
  return `'${value}`;
}

/** RFC 4180 quoting after neutralization. */
export function csvCell(value: string | null | undefined): string {
  const safe = neutralizeCell(value ?? "");
  return /[",\r\n]/.test(safe) || /^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One CSV line (CRLF terminated). */
export function csvLine(values: Array<string | null | undefined>): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}
