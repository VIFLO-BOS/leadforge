import {
  EXPIRED_NAME_LABEL,
  SCORE_EXPLANATION,
  SCORING_SIGNAL_LABELS,
  type AnalysisSummary,
  type ScoreSnapshot,
  type BusinessDetail,
  type BusinessEmailField,
  type BusinessListItem,
  type BusinessPhoneField,
  type FieldMeta,
  type FieldState,
  type SourceKey,
  type SourceSummaryItem,
  type SuppressionEntry,
} from "@leadforge/contracts";
import type {
  ObservationDocument,
  VerificationEventDocument,
} from "../provenance/provenance.types.js";
import { emailKind } from "../normalization/email-kind.js";
import {
  DIVISIONS_ATTRIBUTION,
  OVERTURE_SOURCE_LINE,
  attributionLineFor,
  licenseRef,
} from "../overture/overture-licensing.js";
import { toObservationView, toVerificationEventView } from "../provenance/provenance.view.js";
import { bestState, deriveFieldState, STATE_RANK, type StateContext } from "./field-state.js";
import { isExpired, locationHasValue } from "./business-model.js";
import type {
  BusinessDocument,
  StoredAnalysisSummary,
  StoredEmail,
  StoredFieldMeta,
  StoredPhone,
  StoredScore,
} from "./business.types.js";

/** Basis sentence for data confidence (kept with the view so every response explains it). */
export const DATA_CONFIDENCE_BASIS_TEXT =
  "Average over name, website, phone, email and address of the field's confidence times a state factor (verified 1, unverified 0.8, stale 0.5, conflicting 0.4; missing or expired 0). It describes the record, not the lead, and is never added to the fit score.";

export function toScoreView(score: StoredScore): ScoreSnapshot {
  return {
    fit: score.fit,
    dataConfidence: score.dataConfidence,
    computedAt: score.computedAt.toISOString(),
    profileId: score.profileId.toHexString(),
    profileVersion: score.profileVersion,
    breakdown: score.breakdown.map((b) => ({ ...b, label: SCORING_SIGNAL_LABELS[b.signal] })),
    dataConfidenceDetail: {
      basis: DATA_CONFIDENCE_BASIS_TEXT,
      fields: score.dataConfidenceFields.map((f) => ({ ...f })),
    },
    summary: score.summary,
    explanation: SCORE_EXPLANATION,
  };
}

export function toAnalysisSummaryView(a: StoredAnalysisSummary): AnalysisSummary {
  return {
    analysisId: a.analysisId.toHexString(),
    status: a.status,
    analyzedAt: a.analyzedAt ? a.analyzedAt.toISOString() : null,
    opportunities: [...a.opportunities],
  };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function metaView(meta: StoredFieldMeta, state: FieldState): FieldMeta {
  return {
    state,
    confidence: meta.confidence,
    observationIds: meta.observationIds.map((id) => id.toHexString()),
    lastObservedAt: iso(meta.lastObservedAt),
    lastVerifiedAt: iso(meta.lastVerifiedAt),
    expiresAt: iso(meta.expiresAt),
  };
}

/** Expired values are hidden; their metadata stays visible so the UI can offer a refresh. */
function visible<T>(state: FieldState, value: T): T | null {
  return state === "expired" ? null : value;
}

function phoneState(p: StoredPhone, ctx: StateContext): FieldState {
  return deriveFieldState(p, true, ctx);
}
function emailState(e: StoredEmail, ctx: StateContext): FieldState {
  return deriveFieldState(e, true, ctx);
}

/** Best-state value first, then most recently observed. */
function primary<T extends StoredFieldMeta>(items: T[], stateOf: (x: T) => FieldState): T | null {
  let best: T | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const rank = STATE_RANK[stateOf(item)];
    if (
      rank < bestRank ||
      (rank === bestRank &&
        (item.lastObservedAt?.getTime() ?? 0) > (best?.lastObservedAt?.getTime() ?? 0))
    ) {
      best = item;
      bestRank = rank;
    }
  }
  return best;
}

export function summaryStates(doc: BusinessDocument, ctx: StateContext) {
  return {
    name: deriveFieldState(doc.name, Boolean(doc.name.value), ctx),
    website: deriveFieldState(doc.website, Boolean(doc.website), ctx),
    phone: bestState(doc.phones.map((p) => phoneState(p, ctx))),
    email: bestState(doc.emails.map((e) => emailState(e, ctx))),
    location: deriveFieldState(doc.location, locationHasValue(doc.location), ctx),
  };
}

export function toListItem(doc: BusinessDocument, ctx: StateContext): BusinessListItem {
  const states = summaryStates(doc, ctx);
  const phone = primary(doc.phones, (p) => phoneState(p, ctx));
  const email = primary(doc.emails, (e) => emailState(e, ctx));
  const phoneSt = phone ? phoneState(phone, ctx) : "missing";
  const emailSt = email ? emailState(email, ctx) : "missing";
  return {
    id: doc._id.toHexString(),
    name: states.name === "expired" ? EXPIRED_NAME_LABEL : doc.name.value,
    slug: doc.slug,
    categories: doc.categories.filter((c) => !isExpired(c.expiresAt, ctx.now)).map((c) => c.value),
    location: {
      formatted: visible(states.location, doc.location.formatted),
      locality: visible(states.location, doc.location.locality),
      lga: visible(states.location, doc.location.lga),
      region: visible(states.location, doc.location.region),
      country: visible(states.location, doc.location.country),
    },
    website: doc.website
      ? {
          value: visible(states.website, doc.website.value),
          domain: visible(states.website, doc.website.domain),
          state: states.website,
        }
      : null,
    phone: phone
      ? {
          value: visible(phoneSt, phone.e164),
          international: visible(phoneSt, phone.international),
          state: phoneSt,
          whatsapp: phone.whatsapp.status,
        }
      : null,
    phoneCount: doc.phones.length,
    email: email ? { value: visible(emailSt, email.address), state: emailSt } : null,
    emailCount: doc.emails.length,
    whatsapp: doc.whatsappStatus,
    states: {
      name: states.name,
      website: states.website,
      phone: states.phone,
      email: states.email,
      location: states.location,
    },
    score: doc.score ? { fit: doc.score.fit, dataConfidence: doc.score.dataConfidence } : null,
    sources: doc.sources,
    sourceCount: doc.sources.length,
    suppressed: doc.flags.suppressed,
    lastVerifiedAt: iso(doc.lastVerifiedAt),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export interface DetailExtras {
  freshnessDays: number;
  recentObservations: ObservationDocument[];
  totalObservations: number;
  observationCounts: Partial<Record<SourceKey, number>>;
  recentVerificationEvents: VerificationEventDocument[];
  suppressionEntries: SuppressionEntry[];
  /** Status of snapshot-source references, keyed `<source>:<externalId>` (Overture retirement). */
  refStatus?: Map<string, "active" | "retired">;
}

/**
 * Attribution a record must show: Overture (with each linked record's dataset line, the
 * boundary credit for states and LGAs, and the licences) and Google Maps for legacy Google values.
 */
export function recordAttributions(doc: BusinessDocument): BusinessDetail["attributions"] {
  const out: BusinessDetail["attributions"] = [];
  const overture = doc.externalRefs.filter((r) => r.source === "overture_places");
  if (overture.length > 0 || doc.sources.includes("overture_places")) {
    const lines = [
      ...new Set(
        overture
          .map((r) => attributionLineFor(r.dataset ?? null, r.license ?? null))
          .filter((l): l is string => Boolean(l)),
      ),
    ];
    const licenses = [
      ...new Set(
        overture.map((r) => r.license).filter((l): l is NonNullable<typeof l> => Boolean(l)),
      ),
    ];
    out.push({
      source: "overture_places",
      text: OVERTURE_SOURCE_LINE,
      lines: [...lines, DIVISIONS_ATTRIBUTION],
      licenses: [...licenses, "ODbL-1.0" as const, "CC-BY-4.0" as const].map(licenseRef),
    });
  }
  if (doc.sources.includes("google_places"))
    out.push({ source: "google_places", text: "Google Maps", lines: [], licenses: [] });
  return out;
}

export function toDetail(
  doc: BusinessDocument,
  ctx: StateContext,
  extras: DetailExtras,
): BusinessDetail {
  const states = summaryStates(doc, ctx);
  const loc = doc.location;
  const locState = states.location;
  const phones: BusinessPhoneField[] = doc.phones.map((p) => {
    const state = phoneState(p, ctx);
    return {
      ...metaView(p, state),
      value: visible(state, p.e164),
      rawValue: visible(state, p.raw),
      e164: visible(state, p.e164),
      national: visible(state, p.national),
      international: visible(state, p.international),
      country: p.country,
      type: p.type,
      whatsapp: {
        status: p.whatsapp.status,
        evidenceObservationId: p.whatsapp.evidenceObservationId?.toHexString() ?? null,
        assertedByUserId: p.whatsapp.assertedByUserId,
        assertedAt: iso(p.whatsapp.assertedAt),
      },
    };
  });
  const emails: BusinessEmailField[] = doc.emails.map((e) => {
    const state = emailState(e, ctx);
    return {
      ...metaView(e, state),
      value: visible(state, e.address),
      rawValue: visible(state, e.raw),
      address: visible(state, e.address),
      domain: e.domain,
      kind: emailKind(e.domain),
      verification: e.verification
        ? {
            method: e.verification.method,
            result: e.verification.result,
            checkedAt: e.verification.checkedAt.toISOString(),
          }
        : null,
    };
  });
  const sources: SourceSummaryItem[] = (
    Object.entries(doc.sourceSeen) as Array<[SourceKey, { firstSeenAt: Date; lastSeenAt: Date }]>
  )
    .map(([source, seen]) => ({
      source,
      observationCount: extras.observationCounts[source] ?? 0,
      firstSeenAt: seen.firstSeenAt.toISOString(),
      lastSeenAt: seen.lastSeenAt.toISOString(),
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  return {
    id: doc._id.toHexString(),
    slug: doc.slug,
    name: {
      ...metaView(doc.name, states.name),
      value: visible(states.name, doc.name.value),
      rawValue: visible(states.name, doc.name.rawValue),
    },
    categories: doc.categories
      .filter((c) => !isExpired(c.expiresAt, ctx.now))
      .map((c) => ({
        value: c.value,
        key: c.key,
        taxonomy: c.taxonomy,
        observationIds: c.observationIds.map((id) => id.toHexString()),
      })),
    location: {
      ...metaView(loc, locState),
      value:
        locationHasValue(loc) && locState !== "expired"
          ? {
              formatted: loc.formatted,
              street: loc.street,
              locality: loc.locality,
              lga: loc.lga,
              region: loc.region,
              country: loc.country,
              postalCode: loc.postalCode,
            }
          : null,
      rawValue: visible(locState, loc.rawValue),
      alternatives: loc.alternatives
        .filter((a) => !isExpired(a.expiresAt, ctx.now))
        .map((a) => ({
          value: a.value,
          rawValue: a.rawValue,
          observationIds: a.observationIds.map((id) => id.toHexString()),
          lastObservedAt: iso(a.lastObservedAt),
        })),
    },
    website: doc.website
      ? {
          ...metaView(doc.website, states.website),
          value: visible(states.website, doc.website.value),
          rawValue: visible(states.website, doc.website.rawValue),
          domain: visible(states.website, doc.website.domain),
          alternatives: doc.website.alternatives
            .filter((a) => !isExpired(a.expiresAt, ctx.now))
            .map((a) => ({
              value: a.value,
              rawValue: a.rawValue,
              observationIds: a.observationIds.map((id) => id.toHexString()),
              lastObservedAt: iso(a.lastObservedAt),
            })),
        }
      : {
          state: "missing",
          confidence: 0,
          observationIds: [],
          lastObservedAt: null,
          lastVerifiedAt: null,
          expiresAt: null,
          value: null,
          rawValue: null,
          domain: null,
          alternatives: [],
        },
    phones,
    emails,
    socials: doc.socials
      .filter((s) => !isExpired(s.expiresAt, ctx.now))
      .map((s) => {
        const state = deriveFieldState(s, true, ctx);
        return { ...metaView(s, state), platform: s.platform, url: s.url, handle: s.handle };
      }),
    whatsapp: doc.whatsappStatus,
    states,
    sources,
    provenance: {
      totalObservations: extras.totalObservations,
      recent: extras.recentObservations.map((o) => toObservationView(o, ctx.now)),
    },
    recentVerificationEvents: extras.recentVerificationEvents.map(toVerificationEventView),
    suppression: {
      suppressed: doc.flags.suppressed,
      reason: doc.flags.suppressedReason,
      suppressedAt: iso(doc.flags.suppressedAt),
      suppressedByUserId: doc.flags.suppressedByUserId,
      entries: extras.suppressionEntries,
    },
    score: doc.score && isFullScore(doc.score) ? toScoreView(doc.score) : null,
    latestAnalysis: doc.latestAnalysis ? toAnalysisSummaryView(doc.latestAnalysis) : null,
    dedup: {
      status: doc.dedup.status,
      candidateCount: doc.dedup.candidateCount,
      absorbedIds: (doc.dedup.absorbedIds ?? []).map((id) => id.toHexString()),
    },
    createdVia: {
      kind: doc.createdVia.kind,
      importId: doc.createdVia.importId?.toHexString() ?? null,
      userId: doc.createdVia.userId,
      discoveryJobId: doc.createdVia.discoveryJobId?.toHexString() ?? null,
    },
    externalRefs: doc.externalRefs.map((r) => ({
      source: r.source,
      externalId: r.externalId,
      lastFetchedAt: r.lastFetchedAt.toISOString(),
      expiresAt: iso(r.expiresAt),
      release: r.release ?? null,
      dataset: r.dataset ?? null,
      recordId: r.recordId ?? null,
      license: r.license ?? null,
      status: extras.refStatus?.get(`${r.source}:${r.externalId}`) ?? "unknown",
    })),
    attributions: recordAttributions(doc),
    freshnessDays: extras.freshnessDays,
    lastVerifiedAt: iso(doc.lastVerifiedAt),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Phase 2 sample data may carry a bare `{ fit, dataConfidence }`; only full snapshots are shown in detail. */
function isFullScore(score: StoredScore): boolean {
  return (
    Array.isArray(score.breakdown) && score.computedAt instanceof Date && Boolean(score.profileId)
  );
}
