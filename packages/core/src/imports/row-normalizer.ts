import {
  IMPORT_LIMITS,
  type ImportField,
  type ImportIssueCode,
  type ImportMappingEntry,
  type ImportRowIssue,
  type NormalizedImportRow,
} from "@leadforge/contracts";
import {
  BUSINESS_NAME_MAX,
  canonicalizeWebsite,
  cleanText,
  isBlankOrPlaceholder,
  looksLikeFormula,
  normalizeBusinessName,
  normalizeEmail,
  parseCountry,
  parsePhone,
  splitMultiValue,
} from "../normalization/index.js";
import {
  buildLocation,
  categoryInput,
  CATEGORY_MAX_LENGTH,
  MAX_CATEGORIES,
  type BusinessInput,
  type CategoryInput,
  type EmailInput,
  type PhoneInput,
  type SocialInput,
  type WebsiteInput,
} from "../businesses/business-input.js";

export interface RowNormalizationResult {
  valid: boolean;
  /** Present only when the row is valid. */
  input: BusinessInput | null;
  preview: NormalizedImportRow;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
}

const YES = new Set(["yes", "y", "true", "1", "x", "\u2713", "available"]);
const NO = new Set(["no", "n", "false", "0"]);

/**
 * Normalizes one CSV row with the user's mapping. A row is valid only when every mapped
 * value is valid: invalid rows are reported with per-cell errors and are never imported
 * partially or dropped silently. Placeholder cells ("N/A", "-", "nil") count as blank.
 */
export function normalizeImportRow(
  cells: string[],
  headers: string[],
  mapping: ImportMappingEntry[],
  defaultCountry: string,
): RowNormalizationResult {
  const errors: ImportRowIssue[] = [];
  const warnings: ImportRowIssue[] = [];
  const issue = (
    list: ImportRowIssue[],
    code: ImportIssueCode,
    message: string,
    column: number | null = null,
    field: ImportField | null = null,
  ) =>
    list.push({
      column,
      header: column === null ? null : (headers[column] ?? null),
      field,
      code,
      message,
    });

  const extra = cells.slice(headers.length);
  if (cells.length < headers.length || extra.some((c) => cleanText(c).length > 0)) {
    issue(
      errors,
      "COLUMN_COUNT_MISMATCH",
      `Row has ${cells.length} cells but the header has ${headers.length} columns`,
    );
    return { valid: false, input: null, preview: emptyPreview(), errors, warnings };
  }

  // Collect usable raw values per field, rejecting oversized and formula-like cells first.
  const values = new Map<ImportField, Array<{ raw: string; column: number }>>();
  for (const { column, field } of mapping) {
    const raw = cells[column] ?? "";
    if (raw.length > IMPORT_LIMITS.maxCellLength) {
      issue(
        errors,
        "CELL_TOO_LONG",
        `Longer than ${IMPORT_LIMITS.maxCellLength} characters`,
        column,
        field,
      );
      continue;
    }
    if (isBlankOrPlaceholder(raw)) continue;
    const phoneLike = field === "phone" || field === "whatsapp";
    if (looksLikeFormula(raw, { allowLeadingPlus: phoneLike })) {
      issue(
        errors,
        "FORMULA_INJECTION",
        "Starts with a spreadsheet formula character (=, +, -, @, tab or carriage return)",
        column,
        field,
      );
      continue;
    }
    const list = values.get(field) ?? [];
    list.push({ raw, column });
    values.set(field, list);
  }
  const first = (field: ImportField) => values.get(field)?.[0];

  // Country first: it decides how phone numbers and states are read.
  let rowCountry: string | null = null;
  const countryCell = first("country");
  if (countryCell) {
    rowCountry = parseCountry(countryCell.raw);
    if (!rowCountry) {
      issue(
        errors,
        "INVALID_COUNTRY",
        `"${cleanText(countryCell.raw)}" is not a recognized country`,
        countryCell.column,
        "country",
      );
    }
  }
  const parseRegion = rowCountry ?? defaultCountry;

  // Name.
  const nameCell = first("name");
  let name: BusinessInput["name"] | null = null;
  if (!nameCell) {
    const nameMapping = mapping.find((m) => m.field === "name");
    const alreadyReported = errors.some((e) => e.field === "name");
    if (!alreadyReported)
      issue(errors, "REQUIRED", "Business name is required", nameMapping?.column ?? null, "name");
  } else {
    const n = normalizeBusinessName(nameCell.raw);
    if (n.value.length > BUSINESS_NAME_MAX) {
      issue(
        errors,
        "CELL_TOO_LONG",
        `Name is longer than ${BUSINESS_NAME_MAX} characters`,
        nameCell.column,
        "name",
      );
    } else if (!n.normalized) {
      issue(errors, "REQUIRED", "Business name has no letters or digits", nameCell.column, "name");
    } else {
      name = { ...n, raw: nameCell.raw };
    }
  }

  // Categories.
  const categories: CategoryInput[] = [];
  for (const cell of values.get("category") ?? []) {
    for (const part of splitMultiValue(cell.raw)) {
      if (part.length > CATEGORY_MAX_LENGTH) {
        issue(
          errors,
          "CELL_TOO_LONG",
          `Category "${part.slice(0, 30)}..." is longer than ${CATEGORY_MAX_LENGTH} characters`,
          cell.column,
          "category",
        );
        continue;
      }
      const c = categoryInput(part);
      if (c && !categories.some((x) => x.key === c.key)) categories.push(c);
    }
  }
  if (categories.length > MAX_CATEGORIES) {
    issue(
      warnings,
      "TOO_MANY_VALUES",
      `Only the first ${MAX_CATEGORIES} categories are kept`,
      null,
      "category",
    );
    categories.length = MAX_CATEGORIES;
  }

  // Website (social profiles go to socials).
  let website: WebsiteInput | null = null;
  const socials: SocialInput[] = [];
  const websiteCell = first("website");
  if (websiteCell) {
    const w = canonicalizeWebsite(websiteCell.raw);
    if (!w.ok) {
      issue(errors, "INVALID_WEBSITE", `Website: ${w.reason}`, websiteCell.column, "website");
    } else if (w.kind === "website") {
      website = { url: w.url, domain: w.domain, raw: websiteCell.raw };
    } else {
      socials.push({ platform: w.platform, url: w.url, handle: w.handle, raw: websiteCell.raw });
      issue(
        warnings,
        "SOCIAL_PROFILE",
        `This is a ${w.platform} profile, so it is saved as a social profile, not the website`,
        websiteCell.column,
        "website",
      );
    }
  }

  // Phones.
  const phones: PhoneInput[] = [];
  const addPhone = (
    raw: string,
    column: number,
    field: ImportField,
    whatsapp: PhoneInput["whatsapp"],
  ) => {
    const p = parsePhone(raw, parseRegion);
    if (!p.ok) {
      issue(errors, "INVALID_PHONE", `"${cleanText(raw)}": ${p.reason}`, column, field);
      return;
    }
    const existing = phones.find((x) => x.e164 === p.phone.e164);
    if (existing) {
      if (whatsapp === "user_asserted") existing.whatsapp = "user_asserted";
    } else {
      phones.push({ ...p.phone, raw, whatsapp });
    }
  };
  for (const cell of values.get("phone") ?? []) {
    const parts = splitMultiValue(cell.raw);
    if (parts.length > IMPORT_LIMITS.maxValuesPerCell) {
      issue(
        errors,
        "TOO_MANY_VALUES",
        `More than ${IMPORT_LIMITS.maxValuesPerCell} phone numbers in one cell`,
        cell.column,
        "phone",
      );
      continue;
    }
    for (const part of parts) addPhone(part, cell.column, "phone", "unknown");
  }

  // WhatsApp: a number marks that number; yes/true marks the first phone. Either way the
  // status is user_asserted (stated by the importing user), never confirmed.
  const whatsappCell = first("whatsapp");
  if (whatsappCell) {
    const flag = cleanText(whatsappCell.raw).toLowerCase();
    if (YES.has(flag)) {
      if (phones[0]) phones[0].whatsapp = "user_asserted";
      else
        issue(
          warnings,
          "REQUIRED",
          "WhatsApp is marked yes but the row has no phone number",
          whatsappCell.column,
          "whatsapp",
        );
    } else if (!NO.has(flag)) {
      for (const part of splitMultiValue(whatsappCell.raw).slice(
        0,
        IMPORT_LIMITS.maxValuesPerCell,
      )) {
        addPhone(part, whatsappCell.column, "whatsapp", "user_asserted");
      }
    }
  }

  // Emails.
  const emails: EmailInput[] = [];
  for (const cell of values.get("email") ?? []) {
    const parts = splitMultiValue(cell.raw);
    if (parts.length > IMPORT_LIMITS.maxValuesPerCell) {
      issue(
        errors,
        "TOO_MANY_VALUES",
        `More than ${IMPORT_LIMITS.maxValuesPerCell} email addresses in one cell`,
        cell.column,
        "email",
      );
      continue;
    }
    for (const part of parts) {
      const e = normalizeEmail(part);
      if (!e.ok)
        issue(errors, "INVALID_EMAIL", `"${cleanText(part)}": ${e.reason}`, cell.column, "email");
      else if (!emails.some((x) => x.address === e.address))
        emails.push({ address: e.address, domain: e.domain, raw: part });
    }
  }

  // Location.
  const anyLocation = ["street", "locality", "lga", "region", "postalCode"].some((f) =>
    values.has(f as ImportField),
  );
  const location = buildLocation(
    {
      street: first("street")?.raw ?? null,
      locality: first("locality")?.raw ?? null,
      lga: first("lga")?.raw ?? null,
      region: first("region")?.raw ?? null,
      postalCode: first("postalCode")?.raw ?? null,
      country: rowCountry ?? (anyLocation ? defaultCountry : null),
    },
    countryCell?.raw ?? null,
  );

  const preview: NormalizedImportRow = {
    name: name?.value ?? null,
    categories: categories.map((c) => c.value),
    website: website?.url ?? null,
    domain: website?.domain ?? null,
    phones: phones.map((p) => ({
      e164: p.e164,
      international: p.international,
      country: p.country,
      type: p.type,
      whatsapp: p.whatsapp,
    })),
    emails: emails.map((e) => e.address),
    socials: socials.map((s) => ({ platform: s.platform, url: s.url })),
    location: {
      street: location?.street ?? null,
      locality: location?.locality ?? null,
      lga: location?.lga ?? null,
      region: location?.region ?? null,
      country: location?.country ?? null,
      postalCode: location?.postalCode ?? null,
    },
  };

  const valid = errors.length === 0 && name !== null;
  return {
    valid,
    input: valid ? { name: name!, categories, website, socials, phones, emails, location } : null,
    preview,
    errors,
    warnings,
  };
}

function emptyPreview(): NormalizedImportRow {
  return {
    name: null,
    categories: [],
    website: null,
    domain: null,
    phones: [],
    emails: [],
    socials: [],
    location: {
      street: null,
      locality: null,
      lga: null,
      region: null,
      country: null,
      postalCode: null,
    },
  };
}
