import { PublicPlansResponse } from "@leadforge/contracts";

export type PlansResult =
  { ok: true; data: PublicPlansResponse } | { ok: false; reason: "unavailable" | "invalid" };

/**
 * Server-side fetch of configured plans. Fails soft: the pricing UI shows
 * "Pricing not yet published" whenever this is not ok or pricingPublished is false.
 */
export async function fetchPublicPlans(): Promise<PlansResult> {
  const origin = process.env.API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${origin}/api/v1/public/plans`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const json = (await res.json()) as { data?: unknown };
    const parsed = PublicPlansResponse.safeParse(json.data);
    if (!parsed.success) return { ok: false, reason: "invalid" };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function formatMinor(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(0)}`;
  }
}
