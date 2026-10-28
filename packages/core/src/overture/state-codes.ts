import { NIGERIAN_STATE_CODES as CODES } from "@leadforge/contracts";

/**
 * ISO 3166-2 codes of Nigeria's 36 states and the Federal Capital Territory, keyed by the
 * canonical state name. Defined in contracts (shared with the web app); this view takes any string
 * key, so lookups by a name read from data need no cast. Matches the `region` value Overture
 * divisions carry on state and LGA areas.
 */
export const NIGERIAN_STATE_CODES: Readonly<Record<string, string>> = CODES;
