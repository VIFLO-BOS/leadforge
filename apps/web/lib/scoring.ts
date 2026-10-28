import {
  SCORING_SIGNALS,
  SCORING_SIGNAL_LABELS,
  ScoringWeights,
  type ErrorDetail,
  type ScoringSignal,
} from "@leadforge/contracts";

/*
 * Scoring settings helpers. Validation always goes through the contracts' ScoringWeights schema,
 * the same one the API applies, so the client never redefines the rules (whole numbers 0 to 100,
 * adding up to exactly 100).
 */

export { SCORING_SIGNALS, SCORING_SIGNAL_LABELS };

/** What each signal measures, from docs/API_CONTRACTS.md "Scoring". */
export const SIGNAL_DESCRIPTIONS: Record<ScoringSignal, string> = {
  contactCompleteness: "How many of phone, email, website and address are present.",
  contactVerification: "Share of present contact fields that are verified.",
  websiteOpportunity:
    "Opportunities with confidence of at least 70% in the latest website analysis (3 or more count fully).",
  industryMatch: "A business category is in your ideal customer profile.",
  locationMatch: "The business is in one of your ideal customer profile locations.",
  freshness: "How recently any value was observed or verified.",
  sourceReliability: "Trust of the most reliable source behind the record.",
};

/** Raw text of each weight input (what the user typed). */
export type WeightDraft = Record<ScoringSignal, string>;

export function draftFromWeights(weights: Record<ScoringSignal, number>): WeightDraft {
  return Object.fromEntries(SCORING_SIGNALS.map((s) => [s, String(weights[s])])) as WeightDraft;
}

/** Text to number: an empty field is NaN so the schema reports it, never a silent 0. */
function toNumber(text: string): number {
  const t = text.trim();
  return t === "" ? Number.NaN : Number(t);
}

export interface WeightValidation {
  /** Parsed weights when every field is valid and they add up to 100. */
  weights: Record<ScoringSignal, number> | null;
  /** Sum of the fields that parse as numbers. */
  sum: number;
  /** Per-signal messages (range, whole numbers, empty). */
  fieldErrors: Partial<Record<ScoringSignal, string>>;
  /** Message about the set as a whole ("Weights must add up to 100 (they add up to 95)"). */
  totalError: string | null;
}

export function validateWeights(draft: WeightDraft): WeightValidation {
  const values = Object.fromEntries(SCORING_SIGNALS.map((s) => [s, toNumber(draft[s])])) as Record<
    ScoringSignal,
    number
  >;
  const sum = SCORING_SIGNALS.reduce(
    (acc, s) => acc + (Number.isFinite(values[s]) ? values[s] : 0),
    0,
  );
  const parsed = ScoringWeights.safeParse(values);
  if (parsed.success) return { weights: parsed.data, sum, fieldErrors: {}, totalError: null };
  const fieldErrors: Partial<Record<ScoringSignal, string>> = {};
  let totalError: string | null = null;
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && (SCORING_SIGNALS as readonly string[]).includes(key)) {
      const signal = key as ScoringSignal;
      if (!fieldErrors[signal]) {
        fieldErrors[signal] = Number.isNaN(values[signal])
          ? "Enter a whole number from 0 to 100"
          : issue.message;
      }
    } else if (!totalError) {
      totalError = issue.message;
    }
  }
  // The schema's sum check runs only once every field is a valid number; say it earlier too.
  if (!totalError && sum !== 100) totalError = `Weights must add up to 100 (they add up to ${sum})`;
  return { weights: null, sum, fieldErrors, totalError };
}

/**
 * Maps a 400 VALIDATION_FAILED from PATCH /scoring/profile onto the form: `weights` is the total,
 * `weights.<signal>` a field; anything else is returned as `other`.
 */
export function weightErrorsFromServer(details: ErrorDetail[] | undefined): {
  fieldErrors: Partial<Record<ScoringSignal, string>>;
  totalError: string | null;
  other: string[];
} {
  const fieldErrors: Partial<Record<ScoringSignal, string>> = {};
  let totalError: string | null = null;
  const other: string[] = [];
  for (const d of details ?? []) {
    if (d.path === "weights") totalError ??= d.message;
    else if (d.path.startsWith("weights.")) {
      const signal = d.path.slice("weights.".length);
      if ((SCORING_SIGNALS as readonly string[]).includes(signal)) {
        fieldErrors[signal as ScoringSignal] ??= d.message;
      } else totalError ??= d.message;
    } else other.push(d.message);
  }
  return { fieldErrors, totalError, other };
}
