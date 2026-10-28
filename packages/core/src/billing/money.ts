/**
 * Money helpers. Amounts are integers in minor units (kobo for NGN); BigInt in PostgreSQL and
 * plain integers in the API. No floating point anywhere: formatting splits with integer
 * arithmetic.
 */

/** Minor units per major unit for the currencies Paystack settles (all use 2 decimals). */
const MINOR_DIGITS: Record<string, number> = { NGN: 2, GHS: 2, KES: 2, ZAR: 2, USD: 2, XOF: 0 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

/** "1234567" -> "1,234,567" (no regular expression, no floating point). */
function groupThousands(digits: string): string {
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= 3)
    parts.unshift(digits.slice(Math.max(0, end - 3), end));
  return parts.join(",");
}

/** "NGN 15,000.00" from 1500000n. */
export function formatMinor(amount: bigint | number, currency: string): string {
  const value = typeof amount === "bigint" ? amount : BigInt(amount);
  const digits = minorDigits(currency);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const major = groupThousands((abs / scale).toString());
  const minor = digits > 0 ? `.${(abs % scale).toString().padStart(digits, "0")}` : "";
  return `${negative ? "-" : ""}${currency.toUpperCase()} ${major}${minor}`;
}

/** Converts a database BigInt to a JSON-safe integer (throws beyond 2^53, which no price reaches). */
export function minorToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("Amount out of the safe integer range");
  }
  return Number(value);
}

/**
 * Credits to take back for a refund of `refunded` out of `paid`, when the payment granted
 * `granted` credits: proportional, rounded half up, never more than what is left to reverse.
 * A refund that completes the payment takes back exactly the remainder.
 */
export function proportionalReversal(input: {
  granted: number;
  paid: bigint;
  refunded: bigint;
  alreadyReversed: number;
  completesPayment: boolean;
}): number {
  const remaining = Math.max(0, input.granted - input.alreadyReversed);
  if (input.completesPayment) return remaining;
  if (input.paid <= 0n) return 0;
  const units = (BigInt(input.granted) * input.refunded * 2n + input.paid) / (input.paid * 2n);
  return Math.min(remaining, Number(units));
}

/** Adds one plan interval to a date (UTC calendar months; the 31st clamps to the month's last day). */
export function addInterval(start: Date, interval: "monthly" | "yearly"): Date {
  const months = interval === "yearly" ? 12 : 1;
  const d = new Date(start.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
