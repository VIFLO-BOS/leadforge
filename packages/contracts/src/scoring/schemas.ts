import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CountryCode } from "../auth/schemas.js";

/**
 * Lead scoring (docs/PRODUCT_REQUIREMENTS.md section 7). Two separate numbers, never blended:
 * - Fit score (0 to 100): sum of weight times signal over the seven signals below, with the
 *   organization's weights.
 * - Data confidence (0 to 100): quality of the record itself (field confidence and state),
 *   independent of the weights.
 */
export const SCORING_SIGNALS = [
  "contactCompleteness",
  "contactVerification",
  "websiteOpportunity",
  "industryMatch",
  "locationMatch",
  "freshness",
  "sourceReliability",
] as const;
export const ScoringSignal = z.enum(SCORING_SIGNALS);
export type ScoringSignal = z.infer<typeof ScoringSignal>;

export const SCORING_SIGNAL_LABELS: Record<ScoringSignal, string> = {
  contactCompleteness: "Contact completeness",
  contactVerification: "Contact verification",
  websiteOpportunity: "Website opportunity",
  industryMatch: "Industry match",
  locationMatch: "Location match",
  freshness: "Freshness",
  sourceReliability: "Source reliability",
};

/** Defaults from the product requirements; they sum to 100. */
export const DEFAULT_SCORING_WEIGHTS: Record<ScoringSignal, number> = {
  contactCompleteness: 20,
  contactVerification: 15,
  websiteOpportunity: 20,
  industryMatch: 15,
  locationMatch: 15,
  freshness: 10,
  sourceReliability: 5,
};

/** Shown with every score. */
export const SCORE_EXPLANATION =
  "Score reflects fit with your configured criteria. It is not a prediction of purchase intent.";

const weight = z
  .number()
  .int("Weights are whole numbers")
  .min(0, "At least 0")
  .max(100, "At most 100");

/** Every weight 0 to 100, and together exactly 100. */
export const ScoringWeights = z
  .object({
    contactCompleteness: weight,
    contactVerification: weight,
    websiteOpportunity: weight,
    industryMatch: weight,
    locationMatch: weight,
    freshness: weight,
    sourceReliability: weight,
  })
  .strict()
  .superRefine((w, ctx) => {
    const sum = SCORING_SIGNALS.reduce((s, k) => s + w[k], 0);
    if (sum !== 100)
      ctx.addIssue({
        code: "custom",
        path: [],
        message: `Weights must add up to 100 (they add up to ${sum})`,
      });
  });
export type ScoringWeights = z.infer<typeof ScoringWeights>;

/** An ideal-customer-profile location: every part given must match (country, state, city). */
export const IcpLocation = z
  .object({
    country: CountryCode.optional(),
    region: z.string().trim().min(2).max(120).optional(),
    locality: z.string().trim().min(2).max(120).optional(),
  })
  .strict()
  .refine((l) => Boolean(l.country || l.region || l.locality), {
    message: "Give a country, state or city",
  });
export type IcpLocation = z.infer<typeof IcpLocation>;

export const ScoringIcp = z
  .object({
    /** Category labels; matched case-insensitively against business categories. */
    categories: z.array(z.string().trim().min(2).max(80)).max(50).default([]),
    locations: z.array(IcpLocation).max(50).default([]),
  })
  .strict();
export type ScoringIcp = z.infer<typeof ScoringIcp>;

export const ScoringRecomputeStatus = z.enum(["idle", "queued", "running", "completed", "failed"]);
export type ScoringRecomputeStatus = z.infer<typeof ScoringRecomputeStatus>;

export const ScoringProfile = z.object({
  id: ObjectIdString,
  name: z.string(),
  isDefault: z.boolean(),
  weights: z.object(
    Object.fromEntries(SCORING_SIGNALS.map((s) => [s, z.number().int()])) as Record<
      ScoringSignal,
      z.ZodNumber
    >,
  ),
  icp: z.object({
    categories: z.array(z.string()),
    locations: z.array(
      z.object({
        country: z.string().nullable(),
        region: z.string().nullable(),
        locality: z.string().nullable(),
      }),
    ),
  }),
  /** Increases on every change; scores record the version they were computed with. */
  version: z.number().int(),
  recompute: z.object({
    status: ScoringRecomputeStatus,
    profileVersion: z.number().int().nullable(),
    processed: z.number().int(),
    total: z.number().int().nullable(),
    requestedAt: IsoDateTime.nullable(),
    startedAt: IsoDateTime.nullable(),
    finishedAt: IsoDateTime.nullable(),
    error: z.string().nullable(),
  }),
  updatedByUserId: UuidString.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ScoringProfile = z.infer<typeof ScoringProfile>;

/** `PATCH /scoring/profile`: any of weights and ICP; `version` guards against lost updates. */
export const UpdateScoringProfileRequest = z
  .object({
    weights: ScoringWeights.optional(),
    icp: ScoringIcp.optional(),
    /** The version the editor loaded; a different current version is 409 CONFLICT. */
    version: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.weights !== undefined || v.icp !== undefined, {
    message: "Send weights, icp or both",
  });
export type UpdateScoringProfileRequest = z.infer<typeof UpdateScoringProfileRequest>;

export const ScoreSignalBreakdown = z.object({
  signal: ScoringSignal,
  label: z.string(),
  weight: z.number().int(),
  /** Signal value 0 to 1. */
  value: z.number().min(0).max(1),
  /** weight x value, two decimals. */
  points: z.number(),
  /** Plain-language reason for the value. */
  detail: z.string(),
});
export type ScoreSignalBreakdown = z.infer<typeof ScoreSignalBreakdown>;

export const DataConfidenceField = z.object({
  field: z.enum(["name", "website", "phone", "email", "location"]),
  state: z.string(),
  confidence: z.number(),
  /** confidence x state factor. */
  quality: z.number(),
});
export type DataConfidenceField = z.infer<typeof DataConfidenceField>;

/** Score snapshot embedded on the business and returned by GET /businesses/:id/score. */
export const ScoreSnapshot = z.object({
  fit: z.number().int().min(0).max(100),
  dataConfidence: z.number().int().min(0).max(100),
  computedAt: IsoDateTime,
  profileId: ObjectIdString,
  profileVersion: z.number().int(),
  breakdown: z.array(ScoreSignalBreakdown),
  dataConfidenceDetail: z.object({ basis: z.string(), fields: z.array(DataConfidenceField) }),
  /** One sentence per signal that contributed, highest first. */
  summary: z.string(),
  /** Always SCORE_EXPLANATION. */
  explanation: z.string(),
});
export type ScoreSnapshot = z.infer<typeof ScoreSnapshot>;

export const RecomputeResponse = z.object({
  queued: z.boolean(),
  profileVersion: z.number().int(),
});
export type RecomputeResponse = z.infer<typeof RecomputeResponse>;
