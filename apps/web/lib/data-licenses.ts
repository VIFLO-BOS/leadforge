import { DataLicensesResponse } from "@leadforge/contracts";

export type DataLicensesResult =
  { ok: true; data: DataLicensesResponse } | { ok: false; reason: "unavailable" | "invalid" };

/**
 * Server-side fetch of GET /public/data-licenses (sources, licences, notices). Fails soft: the
 * Data sources page then lists the licences known to this build and says the live list could
 * not be loaded, instead of inventing source details.
 */
export async function fetchDataLicenses(): Promise<DataLicensesResult> {
  const origin = process.env.API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${origin}/api/v1/public/data-licenses`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const json = (await res.json()) as { data?: unknown };
    const parsed = DataLicensesResponse.safeParse(json.data);
    if (!parsed.success) return { ok: false, reason: "invalid" };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** In-app link to a licence on the Data sources page. */
export function licenseAnchor(id: string): string {
  return `/legal/data-sources#license-${id}`;
}
