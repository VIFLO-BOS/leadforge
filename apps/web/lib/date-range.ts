/*
 * Day ranges for list filters kept in the URL as `from` and `to` (yyyy-mm-dd, the browser's local
 * days). The API takes inclusive ISO instants, so a day becomes its first and last millisecond.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A valid yyyy-mm-dd, or undefined. */
export function parseDay(value: string | null | undefined): string | undefined {
  if (!value || !DAY.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? value
    : undefined;
}

export function dayStartIso(day: string | undefined): string | undefined {
  if (!day) return undefined;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function dayEndIso(day: string | undefined): string | undefined {
  if (!day) return undefined;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/** "12 Oct 2026 to 20 Oct 2026", "from 12 Oct 2026", "until 20 Oct 2026". */
export function describeDays(from: string | undefined, to: string | undefined): string {
  const fmt = (day: string) => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(y, m - 1, d),
    );
  };
  if (from && to) return `${fmt(from)} to ${fmt(to)}`;
  if (from) return `from ${fmt(from)}`;
  if (to) return `until ${fmt(to)}`;
  return "any time";
}
