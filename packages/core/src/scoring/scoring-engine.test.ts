import { describe, expect, it } from "vitest";
import { ObjectId } from "@leadforge/db-mongo";
import {
  DEFAULT_SCORING_WEIGHTS,
  SCORE_EXPLANATION,
  ScoringWeights,
  UpdateScoringProfileRequest,
} from "@leadforge/contracts";
import { normalizeCreateRequest } from "../businesses/business-input.js";
import {
  buildObservations,
  createBusinessDocument,
  type ProvenanceContext,
} from "../businesses/business-model.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import { toScoreView } from "../businesses/business-view.js";
import { computeScore, type ScoringProfileInput } from "./scoring-engine.js";

const ORG = "0192c9a8-0000-7000-8000-000000000001";
const NOW = new Date("2026-10-25T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ctx = { now: NOW, freshnessDays: 180 };

function business(
  overrides: Partial<Parameters<typeof normalizeCreateRequest>[0]> = {},
  collectedAt = NOW,
): BusinessDocument {
  const { input, errors } = normalizeCreateRequest(
    {
      name: "Mama Put Kitchen",
      categories: ["Restaurant"],
      phones: ["0803 123 4567"],
      emails: ["hi@mamaput.example.test"],
      website: "mamaput.example.test",
      location: { locality: "Ikeja", region: "Lagos" },
      ...overrides,
    },
    "NG",
  );
  if (!input) throw new Error(JSON.stringify(errors));
  const c: ProvenanceContext = {
    source: "user_import",
    collectionMethod: "user_import",
    sourceRef: null,
    collectedAt,
    confidence: 0.6,
    actor: { type: "system", userId: null },
    importId: null,
    note: null,
    idSeed: null,
  };
  const id = new ObjectId("6add8b76520012303c641f9f");
  const { refs } = buildObservations(ORG, id, input, c);
  return createBusinessDocument(ORG, input, refs, c, {
    id,
    slug: "mama-put",
    createdVia: { kind: "manual", importId: null, userId: null },
  });
}

function profile(overrides: Partial<ScoringProfileInput> = {}): ScoringProfileInput {
  return {
    id: new ObjectId("6add8b76520012303c641fa0"),
    version: 3,
    weights: { ...DEFAULT_SCORING_WEIGHTS },
    categoryKeys: ["restaurant"],
    categoryLabels: ["Restaurant"],
    locations: [{ country: "NG", regionKey: "lagos", localityKey: null, label: "Lagos, NG" }],
    ...overrides,
  };
}

describe("score computation", () => {
  it("is deterministic: the same record, profile and time give the same snapshot", () => {
    const a = computeScore(business(), profile(), ctx);
    const b = computeScore(business(), profile(), ctx);
    expect(a).toEqual(b);
  });

  it("sums weight times signal into the fit score and explains every signal", () => {
    const doc = business();
    doc.latestAnalysis = {
      analysisId: new ObjectId(),
      status: "completed",
      analyzedAt: NOW,
      opportunities: ["contact_form", "online_booking"],
    };
    const score = computeScore(doc, profile(), ctx);
    const by = Object.fromEntries(score.breakdown.map((b) => [b.signal, b]));
    expect(by.contactCompleteness).toMatchObject({ weight: 20, value: 1, points: 20 });
    expect(by.contactVerification).toMatchObject({ value: 0, points: 0 });
    expect(by.websiteOpportunity).toMatchObject({ value: 0.67, points: 13.4 });
    expect(by.industryMatch).toMatchObject({ value: 1, points: 15 });
    expect(by.locationMatch).toMatchObject({ value: 1, points: 15 });
    expect(by.freshness).toMatchObject({ value: 1, points: 10 });
    expect(by.sourceReliability).toMatchObject({ value: 0.6, points: 3 });
    expect(score.fit).toBe(Math.round(20 + 0 + 20 * 0.67 + 15 + 15 + 10 + 5 * 0.6));
    expect(score.breakdown.every((b) => b.detail.length > 0)).toBe(true);
    expect(toScoreView(score).explanation).toBe(SCORE_EXPLANATION);
  });

  it("keeps data confidence a separate number that weights never change", () => {
    const doc = business();
    const base = computeScore(doc, profile(), ctx);
    const reweighted = computeScore(
      doc,
      profile({
        weights: {
          contactCompleteness: 0,
          contactVerification: 0,
          websiteOpportunity: 0,
          industryMatch: 0,
          locationMatch: 0,
          freshness: 0,
          sourceReliability: 100,
        },
      }),
      ctx,
    );
    expect(reweighted.dataConfidence).toBe(base.dataConfidence);
    expect(reweighted.fit).not.toBe(base.fit);
    // name 0.6x0.8, website 0.6x0.8, phone 0.6x0.8, email 0.6x0.8, location 0.6x0.8 -> 48
    expect(base.dataConfidence).toBe(48);
    const sparse = computeScore(
      business({ phones: [], emails: [], website: undefined, location: undefined }),
      profile(),
      ctx,
    );
    expect(sparse.dataConfidence).toBe(10);
  });

  it("decays freshness after 30 days to zero at the freshness window", () => {
    const at = (days: number) =>
      computeScore(
        business({}, new Date(NOW.getTime() - days * DAY)),
        profile(),
        ctx,
      ).breakdown.find((b) => b.signal === "freshness")!.value;
    expect(at(10)).toBe(1);
    expect(at(105)).toBe(0.5);
    expect(at(200)).toBe(0);
  });

  it("gives no industry or location points without an ICP, and says why", () => {
    const score = computeScore(
      business(),
      profile({ categoryKeys: [], categoryLabels: [], locations: [] }),
      ctx,
    );
    const by = Object.fromEntries(score.breakdown.map((b) => [b.signal, b]));
    expect(by.industryMatch).toMatchObject({
      value: 0,
      detail: "No ICP categories are configured",
    });
    expect(by.locationMatch).toMatchObject({ value: 0, detail: "No ICP locations are configured" });
    expect(by.websiteOpportunity!.detail).toBe("No completed website analysis");
  });
});

describe("scoring weight validation", () => {
  it("accepts the defaults, which sum to 100", () => {
    expect(Object.values(DEFAULT_SCORING_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(ScoringWeights.safeParse(DEFAULT_SCORING_WEIGHTS).success).toBe(true);
  });

  it("rejects weights that do not sum to 100, are out of range, fractional, missing or unknown", () => {
    const bad = [
      { ...DEFAULT_SCORING_WEIGHTS, freshness: 11 },
      { ...DEFAULT_SCORING_WEIGHTS, freshness: -10, contactCompleteness: 40 },
      {
        ...DEFAULT_SCORING_WEIGHTS,
        contactCompleteness: 120,
        websiteOpportunity: 0,
        industryMatch: 0,
        locationMatch: 0,
        contactVerification: 0,
        freshness: -20,
      },
      { ...DEFAULT_SCORING_WEIGHTS, freshness: 9.5, sourceReliability: 5.5 },
      { contactCompleteness: 100 },
      { ...DEFAULT_SCORING_WEIGHTS, popularity: 0 },
    ];
    for (const w of bad) expect(ScoringWeights.safeParse(w).success, JSON.stringify(w)).toBe(false);
    const sum = ScoringWeights.safeParse({ ...DEFAULT_SCORING_WEIGHTS, freshness: 11 });
    expect(sum.success ? "" : sum.error.issues[0]!.message).toMatch(
      /add up to 100 \(they add up to 101\)/,
    );
  });

  it("requires a version and at least weights or an ICP on update", () => {
    expect(UpdateScoringProfileRequest.safeParse({ version: 1 }).success).toBe(false);
    expect(
      UpdateScoringProfileRequest.safeParse({ weights: DEFAULT_SCORING_WEIGHTS }).success,
    ).toBe(false);
    expect(
      UpdateScoringProfileRequest.safeParse({
        version: 1,
        icp: { categories: ["Bakery"], locations: [{ region: "Lagos" }] },
      }).success,
    ).toBe(true);
    expect(
      UpdateScoringProfileRequest.safeParse({ version: 1, icp: { locations: [{}] } }).success,
    ).toBe(false);
  });
});
