/**
 * Linear-time DNS name checks (no nested or bounded-repeat regexes, so no ReDoS surface).
 */

const LABEL_CHARS = /^[a-z0-9_-]+$/;
const LETTERS = /^[a-z]+$/;
const PUNY_CHARS = /^[a-z0-9-]+$/;

/** One hostname label: 1 to 63 of [a-z0-9-_], not starting or ending with a hyphen. */
export function isDnsLabel(label: string): boolean {
  return (
    label.length >= 1 &&
    label.length <= 63 &&
    LABEL_CHARS.test(label) &&
    !label.startsWith("-") &&
    !label.endsWith("-")
  );
}

/** Top-level domain: 2 to 63 letters, or an IDN TLD in punycode (xn--). */
export function isTld(label: string): boolean {
  if (label.startsWith("xn--"))
    return label.length >= 6 && label.length <= 63 && PUNY_CHARS.test(label);
  return label.length >= 2 && label.length <= 63 && LETTERS.test(label);
}

/** Every label valid and the last one a TLD. Hostnames only (no underscore in email domains). */
export function isDomainName(host: string, options: { allowUnderscore?: boolean } = {}): boolean {
  const labels = host.split(".");
  if (labels.length < 2 || host.length > 253) return false;
  if (!labels.every((l) => isDnsLabel(l) && (options.allowUnderscore || !l.includes("_"))))
    return false;
  return isTld(labels[labels.length - 1]!);
}
