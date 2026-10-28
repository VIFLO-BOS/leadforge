import { Inject, Injectable } from "@nestjs/common";
import type { Document } from "@leadforge/db-mongo";
import type { DiscoveryJobSpec, ErrorDetail, ServerEnv } from "@leadforge/contracts";
import { ENV } from "../../config/env.module.js";
import {
  buildLocation,
  categoryInput,
  type BusinessInput,
  type CategoryInput,
  type EmailInput,
  type PhoneInput,
  type SocialInput,
  type WebsiteInput,
} from "../../businesses/business-input.js";
import {
  nigerianState,
  normalizeRegion,
  parsePhone,
  placeKey,
  regionKey,
  searchWords,
} from "../../normalization/index.js";
import { lgaMatchKey } from "../../overture/admin-index.js";
import {
  OvertureCatalogService,
  type OvertureSnapshotState,
} from "../../overture/overture-catalog.service.js";
import { recordAttribution } from "../../overture/overture-licensing.js";
import { releaseDate } from "../../overture/overture-normalize.js";
import {
  humanizeNode,
  resolveCategory,
  type ResolvedCategory,
} from "../../overture/overture-taxonomy.js";
import type { OverturePlaceDocument } from "../../overture/overture.types.js";
import { OverturePlaceRepository } from "../../overture/repositories/overture-place.repository.js";
import {
  SourceError,
  type MapContext,
  type MappedRecord,
  type SearchCursor,
  type SearchOptions,
  type SourceAdapter,
  type SourceDescription,
  type SourceEstimate,
  type SourceOrgContext,
  type SourcePage,
} from "../source-adapter.js";
import { OVERTURE_PLACES_POLICY } from "./overture-places.policy.js";

/** Confidence floors (research section 5.5): standard keeps about 70% of Nigeria, high about 28%. */
export const OVERTURE_CONFIDENCE_FLOOR = { standard: 0.5, high: 0.7 } as const;
/** Places between the standard floor and this are flagged LOWER_CONFIDENCE. */
export const OVERTURE_LOWER_CONFIDENCE_BELOW = 0.6;
/**
 * Observation confidence for Overture values. Overture's own score measures whether the place
 * exists, not whether a phone or email works, so it is kept in observation metadata
 * (`overture.confidence`) and the field confidence uses this fixed base (as imports do).
 */
export const OVERTURE_OBSERVATION_CONFIDENCE = 0.6;

const EARTH_RADIUS_M = 6_378_137;
/** Linked keys the estimate subtracts in one query (beyond this it reports an upper bound). */
const ESTIMATE_LINKED_LIMIT = 100_000;

/** A failed read of the staging catalogue is transient (database or network): retried with backoff. */
async function catalogue<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError(
      "SOURCE_UNAVAILABLE",
      "The Overture catalogue could not be read; the page is retried",
      true,
    );
  }
}

const FIELDS = [
  "name",
  "category",
  "address",
  "state and LGA",
  "phone",
  "email",
  "website",
  "social",
];

/** Business-facing words that are not part of LGA names ("Ikeja LGA", "Eti-Osa Local Government"). */
export function lgaQueryKey(raw: string): string {
  const key = lgaMatchKey(raw)
    .replace(/\s+(local government area|local government|lga)$/, "")
    .trim();
  return LGA_ALIASES[key] ?? key;
}

const LGA_ALIASES: Record<string, string> = {
  amac: "municipal area council",
  "abuja municipal": "municipal area council",
  "abuja municipal area council": "municipal area council",
  "abuja municipal area": "municipal area council",
  "port harcourt city": "port harcourt",
  "eti-osa": "eti osa",
};

type PageToken = [number, number, string];

function encodeToken(place: OverturePlaceDocument): string {
  const token: PageToken = [place.confidence, place.contacts?.score ?? 0, place._id];
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

function decodeToken(token: string): PageToken {
  try {
    const t = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(t) &&
      t.length === 3 &&
      typeof t[0] === "number" &&
      typeof t[1] === "number" &&
      typeof t[2] === "string"
    )
      return t as PageToken;
  } catch {
    // fall through
  }
  throw new SourceError("SOURCE_REQUEST_INVALID", "Invalid Overture page token", false);
}

/** Rows strictly after the token in (confidence desc, contact score desc, id asc) order. */
function afterClause([confidence, score, id]: PageToken): Document {
  return {
    $or: [
      { confidence: { $lt: confidence } },
      { confidence, "contacts.score": { $lt: score } },
      { confidence, "contacts.score": score, _id: { $gt: id } },
    ],
  };
}

export interface OvertureQuery {
  filter: Document;
  resolved: ResolvedCategory[];
}

/**
 * Overture Maps Places discovery over LeadForge's staging catalogue (`overture_places`, loaded
 * monthly by the Overture sync). Jobs never call Overture: search pages through the catalogue in
 * a stable order (confidence, then contact completeness, then id), resumable from a page token.
 *
 * - Categories and keywords map to Overture taxonomy nodes through the Nigerian vocabulary
 *   (overture-taxonomy.ts); unmatched words fall back to the place name (MATCHED_BY_NAME).
 * - Location: state, LGA (from Overture division boundaries), city (address locality or an LGA
 *   of that name), address words, or a circle.
 * - Confidence floor 0.5 (`high`: 0.7); closed places, duplicates and retired places are never
 *   offered; by default only places with a phone, email or real website.
 * - With an organization context, places already linked to a business (same GERS id, or the same
 *   upstream record or Facebook page) are left out, so nobody pays twice for one place.
 * - The estimate is an exact count of those places, so the credit hold is exact.
 */
@Injectable()
export class OverturePlacesAdapter implements SourceAdapter<OverturePlaceDocument> {
  readonly key = "overture_places" as const;
  readonly policy = OVERTURE_PLACES_POLICY;

  constructor(
    private readonly places: OverturePlaceRepository,
    private readonly catalog: OvertureCatalogService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  async refreshState(): Promise<void> {
    await this.catalog.snapshot();
  }

  describe(): SourceDescription {
    const snap = this.catalog.current();
    return {
      key: this.key,
      name: "Overture Maps Places",
      kind: "discovery",
      method: "api",
      collectionMethod: "dataset_snapshot",
      status: snap ? "configured" : "not_configured",
      statusReason: snap ? null : "snapshot_missing",
      statusDetail: snap
        ? `Release ${snap.release} loaded ${snap.syncedAt.toISOString().slice(0, 10)}: ${snap.live.toLocaleString("en")} Nigerian places, ${snap.offerable.toLocaleString("en")} offerable after removing duplicates and closed places.`
        : "No Overture snapshot is loaded yet, so discovery jobs cannot run. An operator runs `pnpm overture:sync`, or the worker's scheduled sync loads the latest release.",
      fieldsProvided: ["name", "category", "location", "phone", "email", "website", "social"],
      coverage:
        "Nigeria only. About 162,000 places in release 2026-10-21.0, 98% from Meta (Facebook business pages): 40% in Lagos, 10% in the FCT, and fewer than 1,000 in each of 14 states. Phones are mostly mobile numbers and most emails are free-mail addresses.",
      docsUrl: "https://docs.overturemaps.org/guides/places/",
      fixtureMode: false,
      maxResultsPerQuery: 0,
      specSupport: {
        location: ["region", "lga", "locality", "query", "geo"],
        confidence: true,
        requireContact: true,
        priorityFields: false,
        catalog: true,
      },
      snapshot: snap
        ? {
            release: snap.release,
            syncedAt: snap.syncedAt,
            places: snap.live,
            offerable: snap.offerable,
          }
        : null,
    };
  }

  validateSpec(spec: DiscoveryJobSpec): ErrorDetail[] {
    const errors: ErrorDetail[] = [];
    if (spec.location.country !== "NG") {
      errors.push({
        path: "location.country",
        message: "Overture Maps Places in LeadForge covers Nigeria only",
      });
    }
    if (spec.location.region && !nigerianState(spec.location.region)) {
      errors.push({
        path: "location.region",
        message: `"${spec.location.region}" is not a Nigerian state or the FCT`,
      });
    }
    return errors;
  }

  /** The catalogue filter for a spec (exported for tests and index checks). */
  query(spec: DiscoveryJobSpec, snapshot: OvertureSnapshotState | null): OvertureQuery {
    const resolved = spec.categories.map((c) => resolveCategory(c, snapshot?.vocabulary ?? null));
    const nodes = [...new Set(resolved.flatMap((r) => r.nodes))];
    const categoryOr: Document[] = [];
    if (nodes.length > 0) categoryOr.push({ categoryNodes: { $in: nodes } });
    for (const r of resolved)
      if (r.nameWords && r.nameWords.length > 0)
        categoryOr.push({ nameTokens: { $all: r.nameWords } });

    const and: Document[] = [
      { offerable: true },
      { confidence: { $gte: OVERTURE_CONFIDENCE_FLOOR[spec.confidence] } },
    ];
    if (spec.requireContact) and.push({ "contacts.any": true });
    and.push(
      categoryOr.length === 1
        ? categoryOr[0]!
        : { $or: categoryOr.length > 0 ? categoryOr : [{ _id: null }] },
    );
    const loc = spec.location;
    if (loc.region) and.push({ "admin.stateKey": regionKey(normalizeRegion(loc.region, "NG")) });
    if (loc.lga) and.push({ "admin.lgaKey": lgaQueryKey(loc.lga) });
    if (loc.locality)
      and.push({
        $or: [
          { "address.localityKey": placeKey(loc.locality) },
          { "admin.lgaKey": lgaQueryKey(loc.locality) },
        ],
      });
    if (loc.query) {
      const words = searchWords(loc.query);
      if (words.length > 0) and.push({ addressTokens: { $all: words } });
    }
    if (loc.geo)
      and.push({
        location: {
          $geoWithin: {
            $centerSphere: [[loc.geo.lng, loc.geo.lat], loc.geo.radiusM / EARTH_RADIUS_M],
          },
        },
      });
    if (spec.domainsInclude.length > 0)
      and.push({
        websites: { $elemMatch: { kind: "website", domain: { $in: spec.domainsInclude } } },
      });
    if (spec.domainsExclude.length > 0)
      and.push({ "websites.domain": { $nin: spec.domainsExclude } });
    return { filter: { $and: and }, resolved };
  }

  async estimate(spec: DiscoveryJobSpec, context?: SourceOrgContext): Promise<SourceEstimate> {
    const snap = await this.catalog.snapshot();
    if (!snap) {
      return {
        queries: 1,
        maxResults: 0,
        maxRequests: 0,
        providerSku: null,
        fields: FIELDS,
        warnings: ["No Overture snapshot is loaded yet."],
        exact: true,
        alreadyInDirectory: 0,
      };
    }
    const { filter, resolved } = this.query(spec, snap);
    const matching = await catalogue(() => this.places.count(filter));
    let already = 0;
    let exact = true;
    if (context && matching > 0) {
      // Places linked to a business under any id of the same real place (match keys include `gers:<id>`).
      const keys = await context.linkedMatchKeys(ESTIMATE_LINKED_LIMIT);
      if (keys === null) exact = false;
      else if (keys.length > 0)
        already = await catalogue(() =>
          this.places.count({ $and: [filter, { groupKeys: { $in: keys } }] }),
        );
    }
    const available = Math.max(0, matching - already);
    const warnings: string[] = [];
    if (!exact)
      warnings.push(
        "Your directory links too many Overture places to subtract them here; the hold is an upper bound and unused credits are returned.",
      );
    for (const r of resolved) {
      if (r.via === "name")
        warnings.push(
          `"${r.term}" matches no Overture category, so places are matched by words in their name only (lower relevance).`,
        );
    }
    if (already > 0)
      warnings.push(
        `${already.toLocaleString("en")} matching places are already in your directory and are skipped (never charged twice).`,
      );
    if (available === 0)
      warnings.push("No places in the loaded Overture release match these filters.");
    else if (available < spec.maxRecords)
      warnings.push(
        `Only ${available.toLocaleString("en")} places match, so the job holds ${available.toLocaleString("en")} credits, not ${spec.maxRecords.toLocaleString("en")}.`,
      );
    warnings.push(
      "Overture's confidence says whether a place exists, not whether its phone or email works.",
    );
    const produced = Math.min(available, spec.maxRecords);
    return {
      queries: 1,
      maxResults: available,
      maxRequests: Math.ceil(produced / this.env.OVERTURE_PAGE_SIZE),
      providerSku: null,
      fields: FIELDS,
      warnings,
      exact,
      alreadyInDirectory: already,
    };
  }

  async *search(
    spec: DiscoveryJobSpec,
    options: SearchOptions = {},
  ): AsyncGenerator<SourcePage<OverturePlaceDocument>> {
    const snap = await this.catalog.snapshot();
    if (!snap)
      throw new SourceError("SOURCE_NOT_CONFIGURED", "No Overture snapshot is loaded", false);
    const { filter } = this.query(spec, snap);
    const size = this.env.OVERTURE_PAGE_SIZE;
    let cursor: SearchCursor = options.from ?? { queryIndex: 0, pageIndex: 0, pageToken: null };
    for (;;) {
      const scan = cursor.pageToken
        ? { $and: [filter, afterClause(decodeToken(cursor.pageToken))] }
        : filter;
      const rows = await catalogue(() => this.places.findOrdered(scan, size));
      const linked =
        options.context && rows.length > 0
          ? await options.context.linkedAmong(
              rows.map((r) => ({ externalId: r._id, matchKeys: matchKeysOf(r) })),
            )
          : new Set<string>();
      const last = rows[rows.length - 1];
      const nextCursor: SearchCursor | null =
        rows.length === size && last
          ? { queryIndex: 0, pageIndex: cursor.pageIndex + 1, pageToken: encodeToken(last) }
          : null;
      yield { cursor, nextCursor, records: rows.filter((r) => !linked.has(r._id)) };
      if (!nextCursor) return;
      cursor = nextCursor;
    }
  }

  async fetchRecord(externalId: string): Promise<OverturePlaceDocument | null> {
    const [doc] = await catalogue(() => this.places.findByIds([externalId]));
    return doc && !doc.retiredAt ? doc : null;
  }

  mapToObservations(place: OverturePlaceDocument, ctx: MapContext): MappedRecord {
    // Every offered place is in the loaded release (the sync retires the ones a release drops),
    // so its values are as fresh as that release even when the row was last rewritten earlier.
    const release = this.catalog.current()?.release ?? place.release;
    const dataset = place.rootSource?.dataset ?? null;
    const license = place.rootSource?.license ?? null;
    const attribution = recordAttribution(dataset, license);
    const provenance: MappedRecord["provenance"] = {
      sourceRef: `overture:${release}:places/place/${place._id}`,
      expiresAt: null,
      externalIdExpiresAt: null,
      categoryTaxonomy: "overture",
      attribution,
      collectionMethod: "dataset_snapshot",
      confidence: OVERTURE_OBSERVATION_CONFIDENCE,
      observedAt: releaseDate(release),
      matchKeys: matchKeysOf(place),
      ref: { release, dataset, recordId: place.rootSource?.recordId ?? null, license },
      metadata: {
        overture: {
          release,
          schemaVersion: place.schemaVersion,
          gersId: place._id,
          featureVersion: place.featureVersion,
          confidence: place.confidence,
          upstream: {
            dataset,
            recordId: place.rootSource?.recordId ?? null,
            license,
            updateTime: place.rootSource?.updateTime ?? null,
            provider: place.rootSource?.provider ?? null,
            version: place.rootSource?.version ?? null,
          },
        },
      },
    };
    const base = { externalId: place._id, provenance };
    const warnings: MappedRecord["warnings"] = [];
    if (place.closed) {
      return {
        ...base,
        input: null,
        skip: {
          code: "PERMANENTLY_CLOSED",
          message: `Overture lists this place as ${place.operatingStatus?.replace(/_/g, " ") ?? "closed"}`,
        },
        warnings,
      };
    }
    if (!place.name)
      return {
        ...base,
        input: null,
        skip: { code: "MISSING_NAME", message: "The place has no usable name" },
        warnings,
      };
    if (place.confidence < OVERTURE_LOWER_CONFIDENCE_BELOW) {
      warnings.push({
        code: "LOWER_CONFIDENCE",
        message: `Overture confidence ${place.confidence.toFixed(2)} (below ${OVERTURE_LOWER_CONFIDENCE_BELOW})`,
      });
    }
    const resolved = ctx.spec.categories.map((c) =>
      resolveCategory(c, this.catalog.current()?.vocabulary ?? null),
    );
    const nodes = new Set(resolved.flatMap((r) => r.nodes));
    if (nodes.size === 0 || !place.categoryNodes.some((n) => nodes.has(n))) {
      warnings.push({
        code: "MATCHED_BY_NAME",
        message: "Matched by words in the name, not by category",
      });
    }

    const categories: CategoryInput[] = [];
    for (const node of [place.taxonomy?.primary, place.basicCategory]) {
      const c = node ? categoryInput(humanizeNode(node)) : null;
      if (c && !categories.some((x) => x.key === c.key)) categories.push({ ...c, raw: node! });
    }

    let website: WebsiteInput | null = null;
    const site = place.websites.find((w) => w.kind === "website" && w.url && w.domain);
    if (site) website = { url: site.url!, domain: site.domain!, raw: site.raw };

    const socials: SocialInput[] = place.socials
      .filter((s) => s.platform && s.url)
      .map((s) => ({ platform: s.platform!, url: s.url!, handle: s.handle, raw: s.raw }));

    const phones: PhoneInput[] = [];
    for (const p of place.phones) {
      if (!p.e164) continue;
      const parsed = parsePhone(p.raw, "NG");
      if (parsed.ok && !phones.some((x) => x.e164 === parsed.phone.e164))
        phones.push({ ...parsed.phone, raw: p.raw, whatsapp: "unknown" });
    }
    const emails: EmailInput[] = place.emails
      .filter((e) => e.address && e.domain)
      .map((e) => ({ address: e.address!, domain: e.domain!, raw: e.raw }));

    const location = buildLocation(
      {
        street: place.address.freeform,
        locality: place.address.locality,
        lga: place.admin.lgaName,
        region: place.admin.stateName,
        postalCode: place.address.postcode,
        country: "NG",
      },
      place.address.country ?? "NG",
    );
    const input: BusinessInput = {
      name: { value: place.name, normalized: place.nameKey, raw: place.name },
      categories,
      website,
      socials,
      phones,
      emails,
      location,
    };
    return { ...base, input, skip: null, warnings };
  }
}

/** Keys of the same real place: the group's GERS ids and upstream records. */
function matchKeysOf(
  place: Pick<OverturePlaceDocument, "_id" | "groupKeys" | "upstreamKey">,
): string[] {
  if (Array.isArray(place.groupKeys) && place.groupKeys.length > 0) return place.groupKeys;
  return [`gers:${place._id}`, ...(place.upstreamKey ? [place.upstreamKey] : [])];
}
