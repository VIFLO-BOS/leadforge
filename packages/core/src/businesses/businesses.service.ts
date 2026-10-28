import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { Logger } from "nestjs-pino";
import { isDuplicateKeyError, ObjectId, type Document, type WithId } from "@leadforge/db-mongo";
import {
  EXPORT_SYNC_ROW_CAP,
  type BulkSuppressRequest,
  type BulkSuppressResult,
  type BusinessDetail,
  type BusinessFacets,
  type BusinessListFilter,
  type BusinessListItem,
  type BusinessListQuery,
  type CorrectionRequest,
  type CreateBusinessRequest,
  type FacetBucket,
  type LeadBusiness,
  type ObservationListQuery,
  type QualityHistograms,
  type SuppressRequest,
  type SuppressionEntry,
  type VerificationEventListQuery,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { REDIS } from "../redis/redis.module.js";
import { QueueService } from "../queue/queue.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { ProvenanceService } from "../provenance/provenance.service.js";
import type { ObservationDocument } from "../provenance/provenance.types.js";
import {
  canonicalizeWebsite,
  normalizeBusinessName,
  normalizeEmail,
  parsePhone,
  slugify,
} from "../normalization/index.js";
import type {
  BusinessDocument,
  StoredAnalysisSummary,
  StoredExternalRef,
  StoredScore,
} from "./business.types.js";
import { OverturePlaceRepository } from "../overture/repositories/overture-place.repository.js";
import {
  buildLocation,
  categoryInput,
  MAX_CATEGORIES,
  normalizeCreateRequest,
  type BusinessInput,
  type CategoryInput,
} from "./business-input.js";
import {
  alreadyApplied,
  applyCorrection,
  applyEmailCheck,
  mergeWebsiteContacts,
  type WebsiteContactsChange,
  type WebsiteContactsInput,
  isExpired,
  purgeExpiredValues,
  buildObservations,
  correctionObservationValue,
  CorrectionTargetError,
  createBusinessDocument,
  mergeIntoBusiness,
  observationDoc,
  SOURCE_CONFIDENCE,
  type NormalizedCorrection,
  type ObservationRefs,
  type ProvenanceContext,
} from "./business-model.js";
import { buildBusinessFilter, searchTerms, SORT_PATHS } from "./business-query.js";
import { recordAttributions, toDetail, toListItem, toScoreView } from "./business-view.js";
import type { StateContext } from "./field-state.js";
import { BusinessRepository } from "./repositories/business.repository.js";
import { ActiveAnalysisRepository } from "./repositories/active-analysis.repository.js";
import {
  SuppressionRepository,
  type SuppressionEntryDocument,
} from "./repositories/suppression.repository.js";

/** One business to ingest from an import row, a manual create or (later) discovery. */
export interface IngestItem {
  input: BusinessInput;
  ctx: ProvenanceContext;
  /** Id used if a new business is created; deterministic for import rows. */
  newId: ObjectId;
  createdVia: BusinessDocument["createdVia"];
  /** Manual creation refuses an exact duplicate instead of merging into it. */
  onExactMatch?: "merge" | "reject";
}

export interface IngestWarning {
  code: "POSSIBLE_DUPLICATE" | "SUPPRESSED";
  message: string;
}

/** Business name and state for result lists (discovery items). */
export interface BusinessSummary {
  id: string;
  name: string | null;
  nameState: import("@leadforge/contracts").FieldState;
}

export interface IngestResult {
  outcome: "created" | "updated" | "suppressed" | "duplicate_rejected";
  businessId: ObjectId | null;
  warnings: IngestWarning[];
  /**
   * True when the item matched a business that already carried the same source record (same id,
   * or a shared match key such as an Overture upstream record) linked before this item's
   * discovery job: the place was already in the directory, so discovery must not charge for it.
   */
  linkedBefore: boolean;
}

/** A source record candidate: its id and the other keys of the same real place. */
export interface LinkLookup {
  externalId: string;
  matchKeys: string[];
}

export interface ExportRow {
  item: BusinessListItem;
  street: string | null;
  phones: string[];
  emails: string[];
  /** Source records behind the row (Overture provenance and licences for the export columns). */
  refs: StoredExternalRef[];
  attributions: BusinessDetail["attributions"];
}

const FACETS_TTL_SECONDS = 60;
const TOTAL_EXACT_LIMIT = 10_000;
const MAX_WRITE_ATTEMPTS = 3;

@Injectable()
export class BusinessesService {
  constructor(
    private readonly businesses: BusinessRepository,
    private readonly suppressions: SuppressionRepository,
    private readonly provenance: ProvenanceService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly overturePlaces: OverturePlaceRepository,
    private readonly activeAnalyses: ActiveAnalysisRepository,
  ) {}

  /**
   * After a data change: recompute the scores of these businesses and look for duplicate
   * candidates (worker queues `scoring` and `dedup`). A queue failure is logged, never thrown,
   * so it cannot undo a write that already happened.
   */
  async afterDataChange(
    organizationId: string,
    ids: ObjectId[],
    options: { dedup?: boolean } = {},
  ): Promise<void> {
    if (ids.length === 0) return;
    const businessIds = [...new Set(ids.map((id) => id.toHexString()))];
    try {
      await this.queue.enqueueScoreBusinesses({ organizationId, businessIds });
      if (options.dedup !== false)
        await this.queue.enqueueFindDuplicates({ organizationId, businessIds });
    } catch (err) {
      this.logger.error(
        { err, organizationId, businesses: businessIds.length },
        "Could not enqueue scoring and dedup follow-ups",
      );
    }
  }

  /** The business and the businesses merged into it: provenance is listed across all of them. */
  private provenanceIds(doc: BusinessDocument): ObjectId[] {
    return [doc._id, ...(doc.dedup.absorbedIds ?? [])];
  }

  async stateContext(organizationId: string): Promise<StateContext & { country: string }> {
    const settings = await this.organizations.getDataSettings(organizationId);
    return { now: new Date(), freshnessDays: settings.freshnessDays, country: settings.country };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    organizationId: string,
    query: BusinessListQuery,
  ): Promise<{
    items: BusinessListItem[];
    nextCursor: string | null;
    total?: number;
    totalApprox?: number;
  }> {
    const ctx = await this.stateContext(organizationId);
    const filter = buildBusinessFilter(query, ctx);
    const sort = query.sort ?? { field: "updatedAt", direction: "desc" as const };
    const page = await withCursor(() =>
      this.businesses.page(organizationId, filter, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
        sortField: SORT_PATHS[sort.field],
        direction: sort.direction === "asc" ? 1 : -1,
      }),
    );
    const result: {
      items: BusinessListItem[];
      nextCursor: string | null;
      total?: number;
      totalApprox?: number;
    } = {
      items: page.items.map((d) => toListItem(d, ctx)),
      nextCursor: page.nextCursor,
    };
    // Totals only on the first page; later pages reuse the first page's count.
    if (!query.cursor) {
      // With an `ids` filter the _id index is the selective one, so the search hint is left off.
      const count = await this.businesses.countMatching(
        organizationId,
        filter,
        TOTAL_EXACT_LIMIT + 1,
        {
          searchHint: searchTerms(query.q).length > 0 && !query.ids?.length,
        },
      );
      if (count > TOTAL_EXACT_LIMIT) result.totalApprox = TOTAL_EXACT_LIMIT;
      else result.total = count;
    }
    return result;
  }

  /** Facet computations in flight per organization (one aggregation serves concurrent callers). */
  private readonly facetsInFlight = new Map<string, Promise<BusinessFacets>>();

  async facets(organizationId: string): Promise<BusinessFacets> {
    const key = `lf:facets:${organizationId}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as BusinessFacets;
      } catch {
        // recompute below
      }
    }
    // When the cache is cold, concurrent requests share one aggregation instead of each running
    // it (measured at 100k businesses: 1.6 s each; a stampede pushed p95 past 4 s under load).
    const running = this.facetsInFlight.get(organizationId);
    if (running) return running;
    const computing = this.computeFacets(organizationId, key).finally(() =>
      this.facetsInFlight.delete(organizationId),
    );
    this.facetsInFlight.set(organizationId, computing);
    return computing;
  }

  private async computeFacets(organizationId: string, key: string): Promise<BusinessFacets> {
    const raw = await this.businesses.facets(organizationId);
    const buckets = (
      rows: Array<{ _id: string | null; label: string | null; count: number }>,
    ): FacetBucket[] =>
      rows
        .filter(
          (r): r is { _id: string; label: string | null; count: number } =>
            typeof r._id === "string",
        )
        .map((r) => ({ value: r._id, label: r.label ?? r._id, count: r.count }));
    const facets: BusinessFacets = {
      total: raw.total[0]?.n ?? 0,
      categories: buckets(raw.categories),
      regions: buckets(raw.regions),
      localities: buckets(raw.localities),
      sources: buckets(raw.sources),
      whatsapp: buckets(raw.whatsapp),
      generatedAt: new Date().toISOString(),
      maxAgeSeconds: FACETS_TTL_SECONDS,
    };
    await this.redis
      .set(key, JSON.stringify(facets), "EX", FACETS_TTL_SECONDS)
      .catch(() => undefined);
    return facets;
  }

  private async invalidateFacets(organizationId: string): Promise<void> {
    await this.redis.del(`lf:facets:${organizationId}`).catch(() => undefined);
  }

  /** 404 for missing, deleted or other-organization ids (never 403, to avoid leaking existence). */
  async requireBusiness(organizationId: string, id: string): Promise<WithId<BusinessDocument>> {
    const doc = await this.businesses.findLive(organizationId, id);
    if (!doc) throw AppError.notFound("Business");
    return doc;
  }

  async getDetail(
    organizationId: string,
    id: string,
    viewer?: { userId: string; ctx: AuditContext },
  ): Promise<BusinessDetail> {
    const doc = await this.requireBusiness(organizationId, id);
    const detail = await this.buildDetail(organizationId, doc);
    if (viewer) {
      // Security policy section 7: access to contact fields on detail views is audited.
      await this.audit.record(
        {
          organizationId,
          actorUserId: viewer.userId,
          actorType: "user",
          action: "business.contacts_viewed",
          resourceType: "business",
          resourceId: doc._id.toHexString(),
        },
        viewer.ctx,
      );
    }
    return detail;
  }

  private async buildDetail(
    organizationId: string,
    doc: BusinessDocument,
  ): Promise<BusinessDetail> {
    const ctx = await this.stateContext(organizationId);
    const overtureIds = doc.externalRefs
      .filter((r) => r.source === "overture_places")
      .map((r) => r.externalId);
    const [recent, total, counts, verifications, entries, retirement, active] = await Promise.all([
      this.provenance.recentObservations(organizationId, this.provenanceIds(doc), 20),
      this.provenance.countObservations(organizationId, this.provenanceIds(doc)),
      this.provenance.observationCountsBySource(organizationId, this.provenanceIds(doc)),
      this.provenance.recentVerificationEvents(organizationId, this.provenanceIds(doc), 5),
      this.suppressions.findMatching(organizationId, {
        businessId: doc._id,
        domain: doc.website?.domain ?? null,
        phones: doc.phones.map((p) => p.e164),
        emails: doc.emails.map((e) => e.address),
      }),
      this.overturePlaces.retirementOf(overtureIds),
      this.activeAnalyses.findActive(organizationId, doc._id),
    ]);
    const detail = toDetail(doc, ctx, {
      refStatus: new Map(
        overtureIds.map((id) => [
          `overture_places:${id}`,
          retirement.get(id)?.retired ? ("retired" as const) : ("active" as const),
        ]),
      ),
      freshnessDays: ctx.freshnessDays,
      recentObservations: recent,
      totalObservations: total,
      observationCounts: counts,
      recentVerificationEvents: verifications,
      suppressionEntries: entries.map(toSuppressionView),
    });
    // The queued or running analysis, if any; without a finished one it is the latest itself.
    const activeId =
      active && (active.status === "queued" || active.status === "running")
        ? active._id.toHexString()
        : null;
    detail.latestAnalysis = detail.latestAnalysis
      ? { ...detail.latestAnalysis, activeAnalysisId: activeId }
      : activeId && active
        ? {
            analysisId: activeId,
            status: active.status,
            analyzedAt: null,
            opportunities: [],
            activeAnalysisId: activeId,
          }
        : null;
    return detail;
  }

  async listObservations(organizationId: string, id: string, query: ObservationListQuery) {
    const doc = await this.requireBusiness(organizationId, id);
    return this.provenance.listObservations(organizationId, this.provenanceIds(doc), query);
  }

  async listVerificationEvents(
    organizationId: string,
    id: string,
    query: VerificationEventListQuery,
  ) {
    const doc = await this.requireBusiness(organizationId, id);
    return this.provenance.listVerificationEvents(organizationId, this.provenanceIds(doc), query);
  }

  // -------------------------------------------------------------------------
  // Ingest (imports, manual creation, seed)
  // -------------------------------------------------------------------------

  /**
   * Ingests a batch with two lookups (suppression and exact identifiers) instead of two per
   * item. Exact dedup: an item merges into an existing business when they share the website
   * domain, a phone or an email (checked in that order) AND their normalized names match.
   * A shared identifier with a different name creates a new business and a
   * POSSIBLE_DUPLICATE warning; names alone never merge. Items matching a suppression entry
   * are skipped. Idempotent for deterministic ids and observation seeds. With `dryRun` nothing
   * is written, which is how the import preview predicts create, update or suppressed.
   */
  async ingestBatch(
    organizationId: string,
    items: IngestItem[],
    options: { dryRun?: boolean } = {},
  ): Promise<IngestResult[]> {
    if (items.length === 0) return [];
    const domains = new Set<string>();
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const { input } of items) {
      if (input.website) domains.add(input.website.domain);
      for (const p of input.phones) phones.add(p.e164);
      for (const e of input.emails) emails.add(e.address);
    }

    const refsBySource = new Map<string, { ids: string[]; keys: string[] }>();
    for (const { ctx } of items) {
      if (!ctx.externalRef) continue;
      const entry = refsBySource.get(ctx.externalRef.source) ?? { ids: [], keys: [] };
      entry.ids.push(ctx.externalRef.externalId);
      entry.keys.push(...(ctx.externalRef.matchKeys ?? []));
      refsBySource.set(ctx.externalRef.source, entry);
    }

    const [entries, byIdentifier, ...byRef] = await Promise.all([
      this.suppressions.findMatchingMany(organizationId, {
        domains: [...domains],
        phones: [...phones],
        emails: [...emails],
      }),
      this.businesses.findByIdentifiersMany(organizationId, {
        domains: [...domains],
        phones: [...phones],
        emails: [...emails],
      }),
      ...[...refsBySource].map(([source, refs]) =>
        this.businesses.findByExternalRefs(organizationId, source, refs.ids, refs.keys),
      ),
    ]);
    const candidates = [...byIdentifier];
    for (const doc of byRef.flat())
      if (!candidates.some((c) => c._id.equals(doc._id))) candidates.push(doc);
    const suppressed = new Set(entries.map((e) => `${e.kind}:${e.value}`));

    const index = new IdentifierIndex();
    const versions = new Map<string, number>();
    const loaded = new Map<string, BusinessDocument>();
    for (const doc of candidates) {
      loaded.set(doc._id.toHexString(), doc);
      versions.set(doc._id.toHexString(), doc.version);
      index.add(doc);
    }

    const created = new Map<string, BusinessDocument>();
    const dirty = new Map<
      string,
      Array<{ input: BusinessInput; refs: ObservationRefs; ctx: ProvenanceContext }>
    >();
    const observations: ObservationDocument[] = [];
    const results: IngestResult[] = [];

    for (const item of items) {
      const { input } = item;
      const warnings: IngestWarning[] = [];
      const hit = suppressedIdentifier(input, suppressed);
      if (hit) {
        results.push({
          outcome: "suppressed",
          businessId: null,
          warnings: [{ code: "SUPPRESSED", message: `Skipped: ${hit} is on the suppression list` }],
          linkedBefore: false,
        });
        continue;
      }

      const { match, others, matchedRef } = index.find(input, item.ctx.externalRef ?? null);
      for (const other of others.slice(0, 2)) {
        warnings.push({
          code: "POSSIBLE_DUPLICATE",
          message: other.distinctRecord
            ? `Shares ${other.via} and the name with "${other.doc.name.value}" but is a different ${other.distinctRecord} record, so it was kept separate`
            : `Shares ${other.via} with "${other.doc.name.value}" but the names differ, so it was kept separate`,
        });
      }

      if (match) {
        const key = match._id.toHexString();
        if (match.flags.suppressed || suppressed.has(`business:${key}`)) {
          results.push({
            outcome: "suppressed",
            businessId: match._id,
            warnings: [
              {
                code: "SUPPRESSED",
                message: `Skipped: matches suppressed business "${match.name.value}"`,
              },
            ],
            linkedBefore: false,
          });
          continue;
        }
        if (item.onExactMatch === "reject") {
          results.push({
            outcome: "duplicate_rejected",
            businessId: match._id,
            warnings,
            linkedBefore: false,
          });
          continue;
        }
        const jobId = item.ctx.discoveryJobId ?? null;
        const linkedBefore =
          matchedRef !== null &&
          !match._id.equals(item.newId) &&
          !(jobId && matchedRef.discoveryJobId && matchedRef.discoveryJobId.equals(jobId));
        const { observations: obs, refs } = buildObservations(
          organizationId,
          match._id,
          input,
          item.ctx,
        );
        observations.push(...obs);
        if (!alreadyApplied(match, refs)) {
          mergeIntoBusiness(match, input, refs, item.ctx);
          index.add(match);
          if (!created.has(key)) {
            const list = dirty.get(key) ?? [];
            list.push({ input, refs, ctx: item.ctx });
            dirty.set(key, list);
          }
        }
        results.push({
          outcome: match._id.equals(item.newId) ? "created" : "updated",
          businessId: match._id,
          warnings,
          linkedBefore,
        });
        continue;
      }

      const { observations: obs, refs } = buildObservations(
        organizationId,
        item.newId,
        input,
        item.ctx,
      );
      observations.push(...obs);
      const doc = createBusinessDocument(organizationId, input, refs, item.ctx, {
        id: item.newId,
        slug: slugify(input.name.value, input.location?.locality ?? null),
        createdVia: item.createdVia,
      });
      created.set(doc._id.toHexString(), doc);
      index.add(doc);
      results.push({ outcome: "created", businessId: doc._id, warnings, linkedBefore: false });
    }

    // A dry run (import preview) decides outcomes against current data without writing.
    if (options.dryRun) return results;

    await this.insertNew(organizationId, [...created.values()]);
    for (const [key, merges] of dirty) {
      await this.persistMerge(organizationId, loaded.get(key)!, versions.get(key)!, merges);
    }
    await this.provenance.recordObservations(organizationId, observations);
    if (created.size > 0 || dirty.size > 0) {
      await this.invalidateFacets(organizationId);
      const changed = [...created.values(), ...[...dirty.keys()].map((k) => loaded.get(k)!)].map(
        (d) => d._id,
      );
      await this.afterDataChange(organizationId, changed);
    }
    return results;
  }

  private async insertNew(organizationId: string, docs: BusinessDocument[]): Promise<void> {
    if (docs.length === 0) return;
    // Make slugs unique within the batch and against existing rows before inserting.
    const taken = new Set(
      await this.businesses.existingSlugs(
        organizationId,
        docs.map((d) => d.slug),
      ),
    );
    for (const doc of docs) {
      if (taken.has(doc.slug)) doc.slug = `${doc.slug}-${doc._id.toHexString().slice(-6)}`;
      taken.add(doc.slug);
    }
    const failed = await this.businesses.insertManyUnordered(organizationId, docs);
    for (const { doc, error } of failed) {
      if (isDuplicateKeyError(error, "_id")) continue; // created by an earlier attempt of the same item
      if (!isDuplicateKeyError(error, "slug")) throw error;
      doc.slug = `${doc.slug}-${new ObjectId().toHexString().slice(-8)}`;
      await this.businesses.insert(organizationId, doc);
    }
  }

  private async persistMerge(
    organizationId: string,
    doc: BusinessDocument,
    version: number,
    merges: Array<{ input: BusinessInput; refs: ObservationRefs; ctx: ProvenanceContext }>,
  ): Promise<void> {
    let current = doc;
    let expected = version;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      if (await this.businesses.replaceIfVersion(organizationId, current, expected)) return;
      const fresh = await this.businesses.findById(organizationId, doc._id);
      if (!fresh) return; // deleted concurrently; nothing to merge into
      for (const m of merges)
        if (!alreadyApplied(fresh, m.refs)) mergeIntoBusiness(fresh, m.input, m.refs, m.ctx);
      current = fresh;
      expected = fresh.version;
    }
    throw new AppError(
      "CONFLICT",
      "The business changed too often while importing; retry the import",
    );
  }

  /**
   * Which candidates are already linked to a live business in the organization: same source and
   * id, or a shared match key. Links made by `exceptJobId` (the job asking) do not count, so a
   * page it reprocesses yields the same records.
   */
  async linkedAmong(
    organizationId: string,
    source: string,
    candidates: LinkLookup[],
    exceptJobId: ObjectId | null,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    if (candidates.length === 0) return out;
    const docs = await this.businesses.findByExternalRefs(
      organizationId,
      source,
      candidates.map((c) => c.externalId),
      candidates.flatMap((c) => c.matchKeys),
    );
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const doc of docs) {
      for (const ref of doc.externalRefs) {
        if (ref.source !== source) continue;
        if (exceptJobId && ref.discoveryJobId && ref.discoveryJobId.equals(exceptJobId)) continue;
        ids.add(ref.externalId);
        for (const k of ref.matchKeys ?? []) keys.add(k);
      }
    }
    for (const c of candidates) {
      if (ids.has(c.externalId) || c.matchKeys.some((k) => keys.has(k))) out.add(c.externalId);
    }
    return out;
  }

  /** Every match key of a source's links to live businesses in the organization, or null above `limit`. */
  linkedMatchKeys(organizationId: string, source: string, limit: number): Promise<string[] | null> {
    return this.businesses.linkedMatchKeys(organizationId, source, limit);
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  async create(
    organizationId: string,
    userId: string,
    req: CreateBusinessRequest,
    auditCtx: AuditContext,
  ): Promise<BusinessDetail> {
    const settings = await this.stateContext(organizationId);
    const { input, errors } = normalizeCreateRequest(req, req.country ?? settings.country);
    if (!input) throw AppError.validation(errors);
    const collectedAt = new Date();
    const [result] = await this.ingestBatch(organizationId, [
      {
        input,
        newId: new ObjectId(),
        createdVia: { kind: "manual", importId: null, userId },
        onExactMatch: "reject",
        ctx: {
          source: "user_edit",
          collectionMethod: "user_edit",
          sourceRef: null,
          collectedAt,
          confidence: SOURCE_CONFIDENCE.user_edit,
          actor: { type: "user", userId },
          importId: null,
          note: req.note ?? null,
          idSeed: null,
        },
      },
    ]);
    if (!result || result.outcome === "suppressed") {
      throw new AppError(
        "CONFLICT",
        "This business matches a suppression entry and cannot be added",
        [{ path: "name", message: result?.warnings[0]?.message ?? "Suppressed" }],
      );
    }
    if (result.outcome === "duplicate_rejected") {
      throw new AppError("CONFLICT", "A business with this name and contact already exists", [
        { path: "existingBusinessId", message: result.businessId!.toHexString() },
      ]);
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "business.created",
        resourceType: "business",
        resourceId: result.businessId!.toHexString(),
        after: { name: input.name.value },
      },
      auditCtx,
    );
    return this.getDetail(organizationId, result.businessId!.toHexString());
  }

  /** Normalizes a correction request; throws VALIDATION_FAILED with the reason. */
  private normalizeCorrection(
    req: CorrectionRequest,
    doc: BusinessDocument,
    defaultCountry: string,
  ): NormalizedCorrection {
    const fail = (path: string, message: string): never => {
      throw AppError.validation([{ path, message }]);
    };
    switch (req.field) {
      case "name": {
        const n = normalizeBusinessName(req.value);
        if (!n.normalized) fail("value", "Name needs letters or digits");
        return { field: "name", value: n, raw: req.value };
      }
      case "website": {
        if (req.value === null) return { field: "website", value: null };
        const w = canonicalizeWebsite(req.value);
        if (!w.ok) return fail("value", w.reason);
        if (w.kind === "social")
          return fail("value", `That is a ${w.platform} profile, not a website`);
        return { field: "website", value: { url: w.url, domain: w.domain, raw: req.value } };
      }
      case "phone": {
        const target = req.target
          ? (parseTarget(req.target, doc, req.country ?? doc.location.country ?? defaultCountry) ??
            fail("target", "That phone number is not on this business"))
          : null;
        if (req.value === null) return { field: "phone", target, value: null };
        const p = parsePhone(req.value, req.country ?? doc.location.country ?? defaultCountry);
        if (!p.ok) return fail("value", p.reason);
        return {
          field: "phone",
          target,
          value: { ...p.phone, raw: req.value, whatsapp: "unknown" },
        };
      }
      case "email": {
        const target = req.target ? req.target.trim().toLowerCase() : null;
        if (req.value === null) return { field: "email", target, value: null };
        const e = normalizeEmail(req.value);
        if (!e.ok) return fail("value", e.reason);
        return {
          field: "email",
          target,
          value: { address: e.address, domain: e.domain, raw: req.value },
        };
      }
      case "whatsapp": {
        const target =
          parseTarget(req.target, doc, doc.location.country ?? defaultCountry) ??
          fail("target", "That phone number is not on this business");
        return { field: "whatsapp", target, value: req.value };
      }
      case "categories": {
        const cats: CategoryInput[] = [];
        for (const raw of req.value) {
          const c = categoryInput(raw);
          if (c && !cats.some((x) => x.key === c.key)) cats.push(c);
        }
        return { field: "categories", value: cats.slice(0, MAX_CATEGORIES) };
      }
      case "location": {
        const v = req.value;
        const anyPart = Boolean(v.street || v.locality || v.lga || v.region || v.postalCode);
        const country = v.country ?? (anyPart ? (doc.location.country ?? defaultCountry) : null);
        return {
          field: "location",
          value: buildLocation(
            {
              street: v.street ?? null,
              locality: v.locality ?? null,
              lga: v.lga ?? null,
              region: v.region ?? null,
              postalCode: v.postalCode ?? null,
              country,
            },
            v.country ?? null,
          ),
        };
      }
    }
  }

  /**
   * A correction records a `user_edit` observation and updates the canonical field. The
   * new value is `unverified`. If it matches a suppression entry the business becomes
   * suppressed.
   */
  async correct(
    organizationId: string,
    userId: string,
    id: string,
    req: CorrectionRequest,
    auditCtx: AuditContext,
  ): Promise<BusinessDetail> {
    const settings = await this.stateContext(organizationId);
    let doc = await this.requireBusiness(organizationId, id);
    const correction = this.normalizeCorrection(req, doc, settings.country);
    const obsId = new ObjectId();
    const ctx: ProvenanceContext = {
      source: "user_edit",
      collectionMethod: "user_edit",
      sourceRef: null,
      collectedAt: new Date(),
      confidence: SOURCE_CONFIDENCE.user_edit,
      actor: { type: "user", userId },
      importId: null,
      note: req.note ?? null,
      idSeed: null,
    };

    let change: { before: unknown; after: unknown } | null = null;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS && !change; attempt++) {
      const version = doc.version;
      let applied: { before: unknown; after: unknown };
      try {
        applied = applyCorrection(doc, correction, obsId, ctx);
      } catch (err) {
        if (err instanceof CorrectionTargetError)
          throw AppError.validation([{ path: err.path, message: err.message }]);
        throw err;
      }
      await this.applySuppressionFlag(organizationId, doc, userId);
      if (await this.businesses.replaceIfVersion(organizationId, doc, version)) {
        change = applied;
        break;
      }
      doc = await this.requireBusiness(organizationId, id);
    }
    if (!change)
      throw new AppError(
        "CONFLICT",
        "The business was changed by someone else; reload and try again",
      );

    const obsValue = correctionObservationValue(correction);
    await this.provenance.recordObservations(organizationId, [
      observationDoc(organizationId, doc._id, ctx, {
        _id: obsId,
        ...obsValue,
        metadata: { correction: true },
      }),
    ]);
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "business.corrected",
        resourceType: "business",
        resourceId: doc._id.toHexString(),
        before: { field: req.field, value: change.before },
        after: {
          field: req.field,
          value: change.after,
          observationId: obsId.toHexString(),
          note: req.note ?? null,
        },
      },
      auditCtx,
    );
    await this.invalidateFacets(organizationId);
    await this.afterDataChange(organizationId, [doc._id]);
    return this.buildDetail(
      organizationId,
      (await this.requireBusiness(organizationId, id)) as BusinessDocument,
    );
  }

  /** Sets the suppression flag when any identifier now matches an entry (never clears it). */
  private async applySuppressionFlag(
    organizationId: string,
    doc: BusinessDocument,
    userId: string | null,
  ): Promise<void> {
    if (doc.flags.suppressed) return;
    const matches = await this.suppressions.findMatching(organizationId, {
      businessId: doc._id,
      domain: doc.website?.domain ?? null,
      phones: doc.phones.map((p) => p.e164),
      emails: doc.emails.map((e) => e.address),
    });
    if (matches.length > 0) {
      doc.flags = {
        ...doc.flags,
        suppressed: true,
        suppressedReason: matches[0]!.reason,
        suppressedAt: new Date(),
        suppressedByUserId: userId,
      };
    }
  }

  async suppress(
    organizationId: string,
    userId: string,
    id: string,
    req: SuppressRequest,
    auditCtx: AuditContext,
  ): Promise<BusinessDetail> {
    const doc = await this.requireBusiness(organizationId, id);
    const target = suppressionTarget(doc, req.scope, req.value);
    if ("error" in target)
      throw AppError.validation([{ path: target.path, message: target.error }]);
    const { value, match } = target;

    const entry = await this.suppressions.upsert(organizationId, {
      kind: req.scope,
      value,
      reason: req.reason,
      sourceBusinessId: doc._id,
      createdByUserId: userId,
    });
    const affected = await this.businesses.setSuppressed(organizationId, match, {
      suppressed: true,
      suppressedReason: req.reason,
      suppressedAt: new Date(),
      suppressedByUserId: userId,
      doNotContact: true,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "business.suppressed",
        resourceType: "business",
        resourceId: doc._id.toHexString(),
        after: {
          scope: req.scope,
          value,
          reason: req.reason,
          entryId: entry._id.toHexString(),
          businessesAffected: affected,
        },
      },
      auditCtx,
    );
    await this.invalidateFacets(organizationId);
    return this.buildDetail(organizationId, await this.requireBusiness(organizationId, id));
  }

  /**
   * Suppresses up to BULK_SUPPRESS_MAX businesses in one request, each like `suppress` (phone and
   * email scopes take the business's primary value). Outcomes are per item: a missing id or a
   * business without a value for the scope never fails the rest. One audit event records the batch.
   */
  async bulkSuppress(
    organizationId: string,
    userId: string,
    req: BulkSuppressRequest,
    auditCtx: AuditContext,
  ): Promise<BulkSuppressResult> {
    const docs = await this.businesses.findLiveByIds(
      organizationId,
      req.ids.map((i) => new ObjectId(i)),
    );
    const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));
    const results: BulkSuppressResult["results"] = [];
    let businessesAffected = 0;
    for (const id of req.ids) {
      const doc = byId.get(id.toLowerCase());
      if (!doc) {
        results.push({
          id,
          outcome: "not_found",
          value: null,
          entryId: null,
          message: "No business with this id in the organization",
        });
        continue;
      }
      const target = suppressionTarget(doc, req.scope);
      if ("error" in target) {
        results.push({
          id,
          outcome: "no_value",
          value: null,
          entryId: null,
          message: target.error,
        });
        continue;
      }
      try {
        const prior = await this.suppressions.findMatching(
          organizationId,
          suppressionLookup(req.scope, target.value, doc._id),
        );
        const existing = prior.find((e) => e.kind === req.scope && e.value === target.value);
        if (existing && doc.flags.suppressed) {
          results.push({
            id,
            outcome: "already_suppressed",
            value: target.value,
            entryId: existing._id.toHexString(),
            message: null,
          });
          continue;
        }
        const entry = await this.suppressions.upsert(organizationId, {
          kind: req.scope,
          value: target.value,
          reason: req.reason,
          sourceBusinessId: doc._id,
          createdByUserId: userId,
        });
        businessesAffected += await this.businesses.setSuppressed(organizationId, target.match, {
          suppressed: true,
          suppressedReason: req.reason,
          suppressedAt: new Date(),
          suppressedByUserId: userId,
          doNotContact: true,
        });
        results.push({
          id,
          outcome: "suppressed",
          value: target.value,
          entryId: entry._id.toHexString(),
          message: null,
        });
      } catch (err) {
        this.logger.error({ err, organizationId, businessId: id }, "Bulk suppress item failed");
        results.push({
          id,
          outcome: "failed",
          value: null,
          entryId: null,
          message: "Could not suppress this business; try again",
        });
      }
    }
    const count = (o: BulkSuppressResult["results"][number]["outcome"]) =>
      results.filter((r) => r.outcome === o).length;
    const summary: BulkSuppressResult["summary"] = {
      requested: req.ids.length,
      suppressed: count("suppressed"),
      alreadySuppressed: count("already_suppressed"),
      notFound: count("not_found"),
      noValue: count("no_value"),
      failed: count("failed"),
      businessesAffected,
    };
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "business.bulk_suppressed",
        resourceType: "business",
        resourceId: null,
        after: {
          scope: req.scope,
          reason: req.reason,
          ...summary,
          items: results.map((r) => ({ id: r.id, outcome: r.outcome, value: r.value })),
        },
      },
      auditCtx,
    );
    if (summary.suppressed > 0) await this.invalidateFacets(organizationId);
    return { results, summary };
  }

  /**
   * Removes the suppression entries created from this business and clears the flag on every
   * business no other entry still matches. Entries created from other businesses (a shared
   * domain, say) keep this business suppressed; the detail lists them.
   */
  async unsuppress(
    organizationId: string,
    userId: string,
    id: string,
    auditCtx: AuditContext,
  ): Promise<BusinessDetail> {
    const doc = await this.requireBusiness(organizationId, id);
    const own = await this.suppressions.listCreatedFromBusiness(organizationId, doc._id);
    await this.suppressions.deleteByIds(
      organizationId,
      own.map((e) => e._id),
    );

    const affectedFilter: Document[] = [{ _id: doc._id }];
    for (const e of own) {
      if (e.kind === "domain") affectedFilter.push({ "website.domain": e.value });
      if (e.kind === "phone") affectedFilter.push({ "phones.e164": e.value });
      if (e.kind === "email") affectedFilter.push({ "emails.address": e.value });
    }
    const affected = await this.businesses.findMatching(
      organizationId,
      { $or: affectedFilter, "flags.suppressed": true, deletedAt: null },
      { field: "_id", direction: 1 },
      1000,
    );
    let cleared = 0;
    for (const b of affected) {
      const remaining = await this.suppressions.findMatching(organizationId, {
        businessId: b._id,
        domain: b.website?.domain ?? null,
        phones: b.phones.map((p) => p.e164),
        emails: b.emails.map((e) => e.address),
      });
      if (remaining.length === 0) {
        cleared += await this.businesses.setSuppressed(
          organizationId,
          { _id: b._id },
          {
            suppressed: false,
            suppressedReason: null,
            suppressedAt: null,
            suppressedByUserId: null,
            doNotContact: false,
          },
        );
      }
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "business.unsuppressed",
        resourceType: "business",
        resourceId: doc._id.toHexString(),
        before: { entries: own.map((e) => ({ kind: e.kind, value: e.value, reason: e.reason })) },
        after: { businessesCleared: cleared },
      },
      auditCtx,
    );
    await this.invalidateFacets(organizationId);
    return this.buildDetail(organizationId, await this.requireBusiness(organizationId, id));
  }

  // -------------------------------------------------------------------------
  // Enrichment, analysis, scoring and dedup (called by those modules' services)
  // -------------------------------------------------------------------------

  /**
   * Applies contacts observed on the business's website (version-checked, retried), records
   * their observations, re-checks suppression and queues scoring and dedup follow-ups.
   */
  async applyWebsiteContacts(
    organizationId: string,
    businessId: ObjectId,
    input: WebsiteContactsInput,
    ctx: ProvenanceContext,
    observations: ObservationDocument[],
  ): Promise<{ change: WebsiteContactsChange; business: BusinessDocument }> {
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const doc = await this.businesses.findLive(organizationId, businessId);
      if (!doc) throw AppError.notFound("Business");
      const version = doc.version;
      const change = mergeWebsiteContacts(doc, input, ctx);
      await this.applySuppressionFlag(organizationId, doc, null);
      if (await this.businesses.replaceIfVersion(organizationId, doc, version)) {
        await this.provenance.recordObservations(organizationId, observations);
        await this.invalidateFacets(organizationId);
        await this.afterDataChange(organizationId, [doc._id]);
        return { change, business: doc };
      }
    }
    throw new AppError("CONFLICT", "The business changed too often while saving website contacts");
  }

  /** Stores email check summaries on the business's emails (states unchanged). */
  async recordEmailChecks(
    organizationId: string,
    businessId: ObjectId,
    checks: Array<{
      address: string;
      verification: { method: string; result: string; checkedAt: Date };
    }>,
  ): Promise<number> {
    if (checks.length === 0) return 0;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const doc = await this.businesses.findLive(organizationId, businessId);
      if (!doc) throw AppError.notFound("Business");
      const version = doc.version;
      const applied = checks.filter((c) => applyEmailCheck(doc, c.address, c.verification)).length;
      if (applied === 0) return 0;
      if (await this.businesses.replaceIfVersion(organizationId, doc, version)) return applied;
    }
    throw new AppError("CONFLICT", "The business changed too often while saving email checks");
  }

  /** Embeds the latest completed analysis and queues a score recompute. */
  async setLatestAnalysis(
    organizationId: string,
    businessId: ObjectId,
    summary: StoredAnalysisSummary,
  ): Promise<boolean> {
    const updated = await this.businesses.setLatestAnalysis(organizationId, businessId, summary);
    if (updated) await this.afterDataChange(organizationId, [businessId], { dedup: false });
    return updated;
  }

  setScores(
    organizationId: string,
    entries: Array<{ id: ObjectId; score: StoredScore }>,
  ): Promise<number> {
    return this.businesses.setScores(organizationId, entries);
  }

  /** Live businesses in _id order after `afterId` (organization-wide jobs). */
  pageLive(
    organizationId: string,
    afterId: ObjectId | null,
    limit: number,
  ): Promise<Array<WithId<BusinessDocument>>> {
    return this.businesses.pageLive(organizationId, afterId, limit);
  }

  findLiveByIds(organizationId: string, ids: ObjectId[]): Promise<Array<WithId<BusinessDocument>>> {
    return this.businesses.findLiveByIds(organizationId, ids);
  }

  /** Any business document in the organization, including merged (soft-deleted) ones. */
  findAny(organizationId: string, id: ObjectId): Promise<WithId<BusinessDocument> | null> {
    return this.businesses.findById(organizationId, id);
  }

  findAnyByIds(organizationId: string, ids: ObjectId[]): Promise<Array<WithId<BusinessDocument>>> {
    return this.businesses.findByIds(organizationId, ids);
  }

  findScoresOlderThan(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string }>> {
    return this.businesses.findScoresOlderThan(cutoff, limit);
  }

  async getScore(organizationId: string, id: string) {
    const doc = await this.requireBusiness(organizationId, id);
    return doc.score && Array.isArray(doc.score.breakdown) ? toScoreView(doc.score) : null;
  }

  /**
   * Possible duplicates of a business: live records sharing a similarity blocking key (a name
   * token in the same locality or LGA) or an exact phone, email or website domain. Bounded.
   */
  async findDuplicateCandidates(
    organizationId: string,
    doc: BusinessDocument,
    limit = 100,
  ): Promise<Array<WithId<BusinessDocument>>> {
    const [byKeys, byIdentifiers] = await Promise.all([
      this.businesses.findByDedupKeys(organizationId, doc.dedupKeys ?? [], doc._id, limit),
      this.businesses.findByIdentifiers(
        organizationId,
        {
          domain: doc.website?.domain ?? null,
          phones: doc.phones.map((p) => p.e164),
          emails: doc.emails.map((e) => e.address),
        },
        limit,
      ),
    ]);
    const out: Array<WithId<BusinessDocument>> = [];
    for (const d of [...byIdentifiers, ...byKeys]) {
      if (d._id.equals(doc._id) || out.some((o) => o._id.equals(d._id))) continue;
      out.push(d);
    }
    return out.slice(0, limit);
  }

  setDedupSummary(organizationId: string, id: ObjectId, candidateCount: number): Promise<void> {
    return this.businesses.setDedupSummary(organizationId, id, candidateCount);
  }

  setDedupKeys(organizationId: string, id: ObjectId, keys: string[]): Promise<void> {
    return this.businesses.setDedupKeys(organizationId, id, keys);
  }

  /**
   * Version-checked replace used by merge and undo: writes `doc` (with `version` set to
   * expectedVersion + 1) only if nobody changed the record since `expectedVersion`.
   */
  async replaceVersioned(
    organizationId: string,
    doc: BusinessDocument,
    expectedVersion: number,
  ): Promise<boolean> {
    const ok = await this.businesses.replaceIfVersion(organizationId, doc, expectedVersion);
    if (ok) await this.invalidateFacets(organizationId);
    return ok;
  }

  /** Re-checks suppression entries for a record (merge: a merged identifier may be suppressed). */
  async refreshSuppressionFlag(
    organizationId: string,
    doc: BusinessDocument,
    userId: string,
  ): Promise<void> {
    await this.applySuppressionFlag(organizationId, doc, userId);
  }

  // -------------------------------------------------------------------------
  // Exports and metrics (read by the exports and reports modules)
  // -------------------------------------------------------------------------

  /**
   * Rows for a synchronous export: never suppressed, never deleted, at most the sync cap.
   * Throws EXPORT_TOO_LARGE when the selection is bigger than the cap.
   */
  async exportRows(
    organizationId: string,
    selection: {
      ids?: string[] | undefined;
      filter: Partial<BusinessListFilter>;
      restrictIds?: ObjectId[] | undefined;
    },
    cap = EXPORT_SYNC_ROW_CAP,
  ): Promise<ExportRow[]> {
    const ctx = await this.stateContext(organizationId);
    const and: Document[] = [
      buildBusinessFilter({ ...selection.filter, suppression: "exclude" }, ctx),
    ];
    if (selection.ids) and.push({ _id: { $in: selection.ids.map((i) => new ObjectId(i)) } });
    if (selection.restrictIds) and.push({ _id: { $in: selection.restrictIds } });
    const filter = and.length === 1 ? and[0]! : { $and: and };
    const count = await this.businesses.countMatching(organizationId, filter, cap + 1);
    if (count > cap) {
      throw new AppError(
        "EXPORT_TOO_LARGE",
        `This export matches more than ${cap.toLocaleString("en")} businesses. Narrow the filters or select rows, or start an export job (POST /exports).`,
      );
    }
    const docs = await this.businesses.findMatching(
      organizationId,
      filter,
      { field: "updatedAt", direction: -1 },
      cap,
    );
    return docs.map((d) => toExportRow(d, ctx));
  }

  /**
   * Mongo filter for an export selection: live, never suppressed, the directory filters, and
   * (when given) only these ids. Callers pass `restrictIds` for lists, selections and the
   * assigned-only scope of Sales Representatives (intersected when several apply).
   */
  async exportFilter(
    organizationId: string,
    selection: { filter?: Partial<BusinessListFilter>; restrictIds?: ObjectId[][] },
  ): Promise<Document> {
    const ctx = await this.stateContext(organizationId);
    const and: Document[] = [
      buildBusinessFilter({ ...(selection.filter ?? {}), suppression: "exclude" }, ctx),
    ];
    for (const ids of selection.restrictIds ?? []) and.push({ _id: { $in: ids } });
    return and.length === 1 ? and[0]! : { $and: and };
  }

  countForExport(organizationId: string, filter: Document, limit?: number): Promise<number> {
    return this.businesses.countMatching(organizationId, filter, limit);
  }

  /** Export rows in ascending id order after `afterId` (async export builds read in pages). */
  async exportRowsAfter(
    organizationId: string,
    filter: Document,
    afterId: ObjectId | null,
    limit: number,
  ): Promise<{ rows: ExportRow[]; lastId: ObjectId | null }> {
    const ctx = await this.stateContext(organizationId);
    const docs = await this.businesses.findAfterId(organizationId, filter, afterId, limit);
    return {
      rows: docs.map((d) => toExportRow(d, ctx)),
      lastId: docs[docs.length - 1]?._id ?? null,
    };
  }

  /**
   * Stage 10 (organization data export): every live business of the organization, suppressed ones
   * included and merged-away records excluded, in `_id` order after `afterId`, as the stored fields
   * (the detail view, without its recent-provenance sample: observations are exported in full
   * separately) and as export rows. Values past their source retention are hidden exactly as on
   * every read and export.
   */
  async portabilityPage(
    organizationId: string,
    afterId: ObjectId | null,
    limit: number,
  ): Promise<{
    details: Array<Record<string, unknown>>;
    rows: ExportRow[];
    lastId: ObjectId | null;
  }> {
    const ctx = await this.stateContext(organizationId);
    const docs = await this.businesses.findAfterId(
      organizationId,
      { deletedAt: null },
      afterId,
      limit,
    );
    const details = docs.map((d) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { provenance, recentVerificationEvents, ...rest } = toDetail(d, ctx, {
        freshnessDays: ctx.freshnessDays,
        recentObservations: [],
        totalObservations: 0,
        observationCounts: {},
        recentVerificationEvents: [],
        suppressionEntries: [],
      });
      // Per-source observation counts are not computed here; observations.json has every observation.
      return {
        ...rest,
        sources: rest.sources.map(({ observationCount: _count, ...source }) => source),
      };
    });
    return {
      details,
      rows: docs.map((d) => toExportRow(d, ctx)),
      lastId: docs[docs.length - 1]?._id ?? null,
    };
  }

  /** Ids of live businesses matching directory filters (bulk selections), ascending, at most `limit`. */
  async matchingIds(
    organizationId: string,
    filter: Partial<BusinessListFilter>,
    limit: number,
  ): Promise<ObjectId[]> {
    const ctx = await this.stateContext(organizationId);
    return this.businesses.findIds(organizationId, buildBusinessFilter(filter, ctx), limit);
  }

  /** Live businesses matching directory filters (bulk selections over the cap). */
  async countMatchingFilter(
    organizationId: string,
    filter: Partial<BusinessListFilter>,
    limit?: number,
  ): Promise<number> {
    const ctx = await this.stateContext(organizationId);
    return this.businesses.countMatching(organizationId, buildBusinessFilter(filter, ctx), limit);
  }

  /** Directory rows for these ids (list pages). */
  async listRowsByIds(
    organizationId: string,
    ids: ObjectId[],
  ): Promise<Map<string, BusinessListItem>> {
    if (ids.length === 0) return new Map();
    const ctx = await this.stateContext(organizationId);
    const docs = await this.businesses.findLiveByIds(organizationId, ids);
    return new Map(docs.map((d) => [d._id.toHexString(), toListItem(d, ctx)]));
  }

  /** What a pipeline card or activity row shows about each business; expired names are null. */
  async leadCards(organizationId: string, ids: ObjectId[]): Promise<Map<string, LeadBusiness>> {
    if (ids.length === 0) return new Map();
    const ctx = await this.stateContext(organizationId);
    const docs = await this.businesses.findLiveByIds(organizationId, ids);
    const out = new Map<string, LeadBusiness>();
    for (const d of docs) {
      const item = toListItem(d, ctx);
      out.set(item.id, {
        id: item.id,
        name: item.states.name === "expired" ? null : item.name,
        nameState: item.states.name,
        categories: item.categories.slice(0, 3),
        locality: item.location.locality,
        region: item.location.region,
        fit: item.score?.fit ?? null,
        dataConfidence: item.score?.dataConfidence ?? null,
        suppressed: item.suppressed,
      });
    }
    return out;
  }

  /** True when a phone number or email address is on the organization's (or the platform) suppression list. */
  async isContactSuppressed(
    organizationId: string,
    target: { phone?: string; email?: string },
  ): Promise<boolean> {
    if (!target.phone && !target.email) return false;
    const entries = await this.suppressions.findMatching(organizationId, {
      phones: target.phone ? [target.phone] : [],
      emails: target.email ? [target.email] : [],
    });
    return entries.length > 0;
  }

  /**
   * Fit and data-confidence histograms (ten 10-point buckets each, kept separate) over live,
   * non-suppressed businesses, optionally only those created since `since`. Each bucket is one
   * count on the `{ organizationId, score.fit }` or `{ organizationId, score.dataConfidence }` index.
   */
  async qualityHistograms(organizationId: string, since: Date | null): Promise<QualityHistograms> {
    const base: Document = {
      deletedAt: null,
      "flags.suppressed": false,
      ...(since ? { createdAt: { $gte: since } } : {}),
    };
    const bounds = Array.from({ length: 10 }, (_, i) => ({
      min: i * 10,
      max: i === 9 ? 100 : i * 10 + 9,
    }));
    const range = (field: string, i: number) => ({
      ...base,
      [field]: i === 9 ? { $gte: 90, $lte: 100 } : { $gte: i * 10, $lt: (i + 1) * 10 },
    });
    const [total, scored, fit, confidence] = await Promise.all([
      this.businesses.countMatching(organizationId, base),
      this.businesses.countMatching(organizationId, { ...base, "score.fit": { $type: "number" } }),
      Promise.all(
        bounds.map((_, i) => this.businesses.countMatching(organizationId, range("score.fit", i))),
      ),
      Promise.all(
        bounds.map((_, i) =>
          this.businesses.countMatching(organizationId, range("score.dataConfidence", i)),
        ),
      ),
    ]);
    return {
      total,
      unscored: Math.max(0, total - scored),
      fit: bounds.map((b, i) => ({ ...b, count: fit[i]! })),
      dataConfidence: bounds.map((b, i) => ({ ...b, count: confidence[i]! })),
    };
  }

  /** Live, non-suppressed businesses per source, optionally created since `since`, plus the total. */
  async sourceBreakdown(
    organizationId: string,
    since: Date | null,
  ): Promise<{ total: number; sources: Array<{ source: string; businesses: number }> }> {
    const base: Document = {
      deletedAt: null,
      "flags.suppressed": false,
      ...(since ? { createdAt: { $gte: since } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.businesses.countMatching(organizationId, base),
      this.businesses.countBySource(organizationId, since),
    ]);
    return { total, sources: rows.map((r) => ({ source: r._id, businesses: r.count })) };
  }

  // -------------------------------------------------------------------------
  // Retention (source policy) and summaries
  // -------------------------------------------------------------------------

  /**
   * Removes values whose source retention has passed from up to `limit` businesses across
   * organizations (maintenance job). Each document is re-read and written with the version
   * check under its own organization. Returns how many were changed.
   */
  async purgeExpiredValues(
    now: Date = new Date(),
    limit = 500,
  ): Promise<{ checked: number; purged: number }> {
    const due = await this.businesses.findDueForRetentionPurge(now, limit);
    let purged = 0;
    const touched = new Set<string>();
    for (const { _id, organizationId } of due) {
      for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
        const doc = await this.businesses.findById(organizationId, _id);
        if (!doc) break;
        const version = doc.version;
        if (!purgeExpiredValues(doc, now)) break;
        if (await this.businesses.replaceIfVersion(organizationId, doc, version)) {
          purged += 1;
          touched.add(organizationId);
          break;
        }
      }
    }
    for (const organizationId of touched) await this.invalidateFacets(organizationId);
    return { checked: due.length, purged };
  }

  /** Names for result lists; expired names are hidden (null) like everywhere else. */
  async summaries(organizationId: string, ids: ObjectId[]): Promise<Map<string, BusinessSummary>> {
    const ctx = await this.stateContext(organizationId);
    const docs = await this.businesses.findSummaries(organizationId, ids);
    const out = new Map<string, BusinessSummary>();
    for (const d of docs) {
      const nameState = isExpired(d.name.expiresAt, ctx.now)
        ? "expired"
        : d.name.value
          ? d.name.state
          : "missing";
      out.set(d._id.toHexString(), {
        id: d._id.toHexString(),
        name: nameState === "expired" ? null : d.name.value,
        nameState,
      });
    }
    return out;
  }

  async overviewCounts(organizationId: string, since: Date) {
    const ctx = await this.stateContext(organizationId);
    const count = (filter: Partial<BusinessListFilter>) =>
      this.businesses.countMatching(organizationId, buildBusinessFilter(filter, ctx));
    const [
      total,
      suppressed,
      addedInPeriod,
      withPhone,
      withEmail,
      withWebsite,
      verifiedPhone,
      verifiedEmail,
      verifiedWebsite,
      whatsappConfirmed,
      whatsappUserAsserted,
      bySource,
    ] = await Promise.all([
      count({ suppression: "include" }),
      count({ suppression: "only" }),
      this.businesses.countMatching(organizationId, {
        deletedAt: null,
        createdAt: { $gte: since },
      }),
      count({ hasPhone: true }),
      count({ hasEmail: true }),
      count({ hasWebsite: true }),
      count({ phoneState: ["verified"] }),
      count({ emailState: ["verified"] }),
      count({ websiteState: ["verified"] }),
      count({ whatsapp: ["confirmed"] }),
      count({ whatsapp: ["user_asserted"] }),
      this.businesses.countBySource(organizationId),
    ]);
    return {
      freshnessDays: ctx.freshnessDays,
      businesses: { total, suppressed, addedInPeriod },
      contacts: {
        withPhone,
        withEmail,
        withWebsite,
        verifiedPhone,
        verifiedEmail,
        verifiedWebsite,
        whatsappConfirmed,
        whatsappUserAsserted,
      },
      sources: bySource.map((r) => ({ source: r._id, businesses: r.count })),
    };
  }
}

/** One export row. Values past their source's retention are never exported, even before the purge runs. */
function toExportRow(d: BusinessDocument, ctx: StateContext): ExportRow {
  return {
    item: toListItem(d, ctx),
    street: isExpired(d.location.expiresAt, ctx.now) ? null : d.location.street,
    phones: d.phones.filter((p) => !isExpired(p.expiresAt, ctx.now)).map((p) => p.e164),
    emails: d.emails.filter((e) => !isExpired(e.expiresAt, ctx.now)).map((e) => e.address),
    refs: d.externalRefs,
    attributions: recordAttributions(d),
  };
}

function toSuppressionView(e: WithId<SuppressionEntryDocument>): SuppressionEntry {
  return {
    id: e._id.toHexString(),
    kind: e.kind,
    value: e.value,
    reason: e.reason,
    createdByUserId: e.createdByUserId,
    createdAt: e.createdAt.toISOString(),
  };
}

function parseTarget(target: string, doc: BusinessDocument, country: string): string | null {
  if (doc.phones.some((p) => p.e164 === target)) return target;
  const parsed = parsePhone(target, country);
  if (parsed.ok && doc.phones.some((p) => p.e164 === parsed.phone.e164)) return parsed.phone.e164;
  return null;
}

/** The value a scope suppresses on this business and the filter for every business sharing it. */
function suppressionTarget(
  doc: BusinessDocument,
  scope: SuppressRequest["scope"],
  requested?: string,
): { value: string; match: Document } | { error: string; path: string } {
  switch (scope) {
    case "business":
      return { value: doc._id.toHexString(), match: { _id: doc._id } };
    case "domain":
      if (!doc.website)
        return { error: "This business has no website domain to suppress", path: "scope" };
      return { value: doc.website.domain, match: { "website.domain": doc.website.domain } };
    case "phone": {
      const target = requested
        ? doc.phones.find((p) => p.e164 === requested || p.raw === requested)
        : doc.phones[0];
      if (!target)
        return {
          error: "That phone number is not on this business",
          path: requested ? "value" : "scope",
        };
      return { value: target.e164, match: { "phones.e164": target.e164 } };
    }
    case "email": {
      const wanted = requested?.trim().toLowerCase();
      const target = wanted ? doc.emails.find((e) => e.address === wanted) : doc.emails[0];
      if (!target)
        return {
          error: "That email address is not on this business",
          path: requested ? "value" : "scope",
        };
      return { value: target.address, match: { "emails.address": target.address } };
    }
  }
}

function suppressionLookup(scope: SuppressRequest["scope"], value: string, businessId: ObjectId) {
  return {
    businessId: scope === "business" ? businessId : null,
    domain: scope === "domain" ? value : null,
    phones: scope === "phone" ? [value] : [],
    emails: scope === "email" ? [value] : [],
  };
}

function suppressedIdentifier(input: BusinessInput, suppressed: Set<string>): string | null {
  if (input.website && suppressed.has(`domain:${input.website.domain}`))
    return `domain ${input.website.domain}`;
  for (const p of input.phones) if (suppressed.has(`phone:${p.e164}`)) return `phone ${p.e164}`;
  for (const e of input.emails)
    if (suppressed.has(`email:${e.address}`)) return `email ${e.address}`;
  return null;
}

/**
 * In-memory identifier index over candidates and businesses created earlier in the batch.
 * Stage 0 is the source record (a Google place ID matches regardless of name, since the place
 * is the same); stages 1 to 3 are exact domain, phone and email with a matching normalized name.
 * Two different records of the same source (two place IDs) are never merged, so chain branches
 * sharing a name and website stay separate.
 */
class IdentifierIndex {
  private readonly byDomain = new Map<string, BusinessDocument[]>();
  private readonly byPhone = new Map<string, BusinessDocument[]>();
  private readonly byEmail = new Map<string, BusinessDocument[]>();
  private readonly byRef = new Map<string, { doc: BusinessDocument; ref: StoredExternalRef }>();
  private readonly byMatchKey = new Map<
    string,
    { doc: BusinessDocument; ref: StoredExternalRef }
  >();

  add(doc: BusinessDocument): void {
    const put = (map: Map<string, BusinessDocument[]>, key: string) => {
      const list = map.get(key) ?? [];
      if (!list.includes(doc)) list.push(doc);
      map.set(key, list);
    };
    if (doc.website) put(this.byDomain, doc.website.domain);
    for (const p of doc.phones) put(this.byPhone, p.e164);
    for (const e of doc.emails) put(this.byEmail, e.address);
    for (const r of doc.externalRefs) {
      if (!this.byRef.has(`${r.source}:${r.externalId}`))
        this.byRef.set(`${r.source}:${r.externalId}`, { doc, ref: r });
      for (const k of r.matchKeys ?? [])
        if (!this.byMatchKey.has(`${r.source}:${k}`))
          this.byMatchKey.set(`${r.source}:${k}`, { doc, ref: r });
    }
  }

  find(
    input: BusinessInput,
    ref: { source: string; externalId: string; matchKeys?: string[] } | null,
  ): {
    match: BusinessDocument | null;
    others: Array<{ doc: BusinessDocument; via: string; distinctRecord: string | null }>;
    /** The stored source reference that matched (stage 0), or null for identifier matches. */
    matchedRef: StoredExternalRef | null;
  } {
    if (ref) {
      const byRef = this.byRef.get(`${ref.source}:${ref.externalId}`);
      if (byRef) return { match: byRef.doc, others: [], matchedRef: byRef.ref };
      // The same real place under another record id (Overture: a duplicate or a later release's id).
      for (const k of ref.matchKeys ?? []) {
        const byKey = this.byMatchKey.get(`${ref.source}:${k}`);
        if (byKey) return { match: byKey.doc, others: [], matchedRef: byKey.ref };
      }
    }
    const stages: Array<{ via: string; docs: BusinessDocument[] }> = [];
    if (input.website)
      stages.push({
        via: `the website domain ${input.website.domain}`,
        docs: this.byDomain.get(input.website.domain) ?? [],
      });
    for (const p of input.phones)
      stages.push({ via: `the phone ${p.e164}`, docs: this.byPhone.get(p.e164) ?? [] });
    for (const e of input.emails)
      stages.push({ via: `the email ${e.address}`, docs: this.byEmail.get(e.address) ?? [] });

    const others: Array<{ doc: BusinessDocument; via: string; distinctRecord: string | null }> = [];
    for (const stage of stages) {
      for (const doc of stage.docs) {
        const otherRecord = ref
          ? doc.externalRefs.some((r) => r.source === ref.source && r.externalId !== ref.externalId)
          : false;
        const sameName =
          Boolean(input.name.normalized) && doc.name.normalized === input.name.normalized;
        if (sameName && !otherRecord) return { match: doc, others: [], matchedRef: null };
        if (!others.some((o) => o.doc === doc))
          others.push({ doc, via: stage.via, distinctRecord: sameName && ref ? ref.source : null });
      }
    }
    return { match: null, others, matchedRef: null };
  }
}
