/**
 * Nigeria's states, shared by the API and the web app (the browser imports contracts, not core).
 * LGAs are not listed here: they come from the loaded Overture snapshot through
 * GET /discovery/locations, with the spellings and place counts of that release.
 */

/** Nigeria's 36 states and the Federal Capital Territory: the canonical names the API stores and returns. */
export const NIGERIAN_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
  "Federal Capital Territory",
] as const;
export type NigerianState = (typeof NIGERIAN_STATES)[number];

/**
 * ISO 3166-2 code of each state: the `code` GET /discovery/locations returns, and the `region`
 * Overture division areas carry.
 */
export const NIGERIAN_STATE_CODES: Readonly<Record<NigerianState, string>> = {
  Abia: "NG-AB",
  Adamawa: "NG-AD",
  "Akwa Ibom": "NG-AK",
  Anambra: "NG-AN",
  Bauchi: "NG-BA",
  Bayelsa: "NG-BY",
  Benue: "NG-BE",
  Borno: "NG-BO",
  "Cross River": "NG-CR",
  Delta: "NG-DE",
  Ebonyi: "NG-EB",
  Edo: "NG-ED",
  Ekiti: "NG-EK",
  Enugu: "NG-EN",
  "Federal Capital Territory": "NG-FC",
  Gombe: "NG-GO",
  Imo: "NG-IM",
  Jigawa: "NG-JI",
  Kaduna: "NG-KD",
  Kano: "NG-KN",
  Katsina: "NG-KT",
  Kebbi: "NG-KE",
  Kogi: "NG-KO",
  Kwara: "NG-KW",
  Lagos: "NG-LA",
  Nasarawa: "NG-NA",
  Niger: "NG-NI",
  Ogun: "NG-OG",
  Ondo: "NG-ON",
  Osun: "NG-OS",
  Oyo: "NG-OY",
  Plateau: "NG-PL",
  Rivers: "NG-RI",
  Sokoto: "NG-SO",
  Taraba: "NG-TA",
  Yobe: "NG-YO",
  Zamfara: "NG-ZA",
};

/** The `key` GET /discovery/locations gives a state: its name in lower case ("federal capital territory"). */
export function nigerianStateKey(state: NigerianState): string {
  return state.toLowerCase();
}
