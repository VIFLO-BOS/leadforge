import {
  getCountries,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js/max";
import type { PhoneType } from "@leadforge/contracts";
import { cleanText } from "./text.js";

export interface ParsedPhone {
  e164: string;
  national: string;
  international: string;
  /** ISO country of the number itself (not the parsing default). */
  country: string | null;
  type: PhoneType;
}

export type PhoneResult = { ok: true; phone: ParsedPhone } | { ok: false; reason: string };

const TYPE_MAP: Record<string, PhoneType> = {
  MOBILE: "mobile",
  FIXED_LINE: "fixed_line",
  FIXED_LINE_OR_MOBILE: "fixed_line_or_mobile",
  TOLL_FREE: "toll_free",
  VOIP: "voip",
};

export function isPhoneCountry(code: string): boolean {
  return isSupportedCountry(code);
}

export function phoneCountries(): string[] {
  return getCountries();
}

function toParsed(pn: PhoneNumber): ParsedPhone {
  const type = pn.getType();
  return {
    e164: pn.number,
    national: pn.formatNational(),
    international: pn.formatInternational(),
    country: pn.country ?? null,
    type: type ? (TYPE_MAP[type] ?? "other") : "unknown",
  };
}

/**
 * Country-aware phone parsing with full metadata. Numbers without a country code are read
 * in `defaultCountry`; numbers with one (`+44...`, `00 44...`, or `234...` for Nigeria) keep
 * their own country. Only numbers that are valid for their numbering plan are accepted.
 */
export function parsePhone(raw: string, defaultCountry: string): PhoneResult {
  const text = cleanText(raw).replace(/^tel:/i, "");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 5) return { ok: false, reason: "Not a phone number" };
  if (digits.length > 17) return { ok: false, reason: "Too many digits for a phone number" };
  // Letters are only allowed as extension markers ("ext. 12", "x12").
  if (/[a-z]/i.test(text.replace(/ext\.?|x/gi, ""))) {
    return { ok: false, reason: "Contains letters" };
  }

  const region = isSupportedCountry(defaultCountry) ? (defaultCountry as CountryCode) : undefined;
  const attempts: Array<[string, CountryCode | undefined]> = [[text, region]];
  if (!text.startsWith("+")) {
    // "00" international prefix, or a bare country code ("2348031234567").
    if (digits.startsWith("00")) attempts.push([`+${digits.slice(2)}`, undefined]);
    attempts.push([`+${digits}`, undefined]);
  }

  for (const [candidate, country] of attempts) {
    const pn = parsePhoneNumberFromString(candidate, country);
    if (pn?.isValid()) return { ok: true, phone: toParsed(pn) };
  }
  return {
    ok: false,
    reason: region
      ? `Not a valid phone number for ${region} or with a country code`
      : "Not a valid phone number",
  };
}

/** Digits of the national format with its trunk prefix ("0803 123 4567" becomes "08031234567"). */
export function nationalDigits(national: string): string {
  return national.replace(/\D/g, "");
}
