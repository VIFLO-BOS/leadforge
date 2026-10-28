import {
  MULTI_COLUMN_IMPORT_FIELDS,
  type ImportField,
  type ImportMappingEntry,
} from "@leadforge/contracts";
import { normalizeKey } from "../normalization/text.js";

const SYNONYMS: Record<ImportField, string[]> = {
  name: [
    "name",
    "business name",
    "business",
    "company",
    "company name",
    "organisation",
    "organization",
    "organisation name",
    "organization name",
    "trading name",
    "brand",
    "store name",
    "shop name",
  ],
  category: [
    "category",
    "categories",
    "industry",
    "sector",
    "business type",
    "type",
    "niche",
    "line of business",
  ],
  website: ["website", "web", "site", "url", "website url", "homepage", "web address", "domain"],
  phone: [
    "phone",
    "phone number",
    "phone no",
    "telephone",
    "tel",
    "mobile",
    "mobile number",
    "cell",
    "contact number",
    "contact phone",
    "gsm",
    "phone 1",
    "phone 2",
    "phone1",
    "phone2",
  ],
  email: ["email", "e mail", "email address", "mail", "contact email", "email 1", "email 2"],
  whatsapp: ["whatsapp", "whatsapp number", "wa", "whatsapp phone"],
  street: [
    "address",
    "street",
    "street address",
    "address line 1",
    "address 1",
    "location address",
  ],
  locality: ["city", "town", "locality", "area", "neighbourhood", "neighborhood"],
  lga: ["lga", "local government", "local government area", "l g a"],
  region: ["state", "region", "province", "county"],
  country: ["country", "country code", "nation"],
  postalCode: ["postal code", "postcode", "zip", "zip code", "post code"],
};

const LOOKUP = new Map<string, ImportField>();
for (const [field, names] of Object.entries(SYNONYMS) as Array<[ImportField, string[]]>) {
  for (const n of names) LOOKUP.set(n, field);
}

function headerKey(header: string): string {
  return normalizeKey(header)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Suggests a mapping from header names. A single-valued field is suggested once (the first
 * matching column); phone, email and category may come from several columns. Unrecognized
 * columns are left unmapped. The user confirms or edits the mapping before preview.
 */
export function suggestMapping(headers: string[]): ImportMappingEntry[] {
  const used = new Set<ImportField>();
  const out: ImportMappingEntry[] = [];
  headers.forEach((header, column) => {
    const field = LOOKUP.get(headerKey(header));
    if (!field) return;
    if (used.has(field) && !MULTI_COLUMN_IMPORT_FIELDS.includes(field)) return;
    used.add(field);
    out.push({ column, field });
  });
  return out;
}
