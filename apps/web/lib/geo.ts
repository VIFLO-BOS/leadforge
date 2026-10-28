/**
 * Nigeria's 36 states and the Federal Capital Territory, in the canonical spelling the API stores.
 * The list lives in packages/contracts, shared with the API.
 */
export {
  NIGERIAN_STATES,
  NIGERIAN_STATE_CODES,
  nigerianStateKey,
  type NigerianState,
} from "@leadforge/contracts";

const COUNTRY_NAMES =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

/** "Nigeria" for "NG"; the code itself when the runtime has no region names. */
export function countryName(code: string): string {
  try {
    return COUNTRY_NAMES?.of(code) ?? code;
  } catch {
    return code;
  }
}
