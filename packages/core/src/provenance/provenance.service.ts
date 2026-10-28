import { Injectable } from "@nestjs/common";
import { ObjectId } from "@leadforge/db-mongo";
import type {
  Observation,
  ObservationListQuery,
  SourceKey,
  VerificationEvent,
  VerificationEventListQuery,
} from "@leadforge/contracts";
import { withCursor } from "../common/pagination/cursor.js";
import { toObservationView, toVerificationEventView } from "./provenance.view.js";
import type { ObservationDocument, VerificationEventDocument } from "./provenance.types.js";
import { ObservationRepository } from "./repositories/observation.repository.js";
import { VerificationEventRepository } from "./repositories/verification-event.repository.js";

/**
 * Provenance: immutable source observations and verification events. Callers are
 * responsible for checking that the business belongs to the organization before listing,
 * so a foreign business id yields 404 rather than an empty list.
 */
@Injectable()
export class ProvenanceService {
  constructor(
    private readonly observations: ObservationRepository,
    private readonly verifications: VerificationEventRepository,
  ) {}

  enrichmentObservationIds(organizationId: string, runId: ObjectId): Promise<ObjectId[]> {
    return this.observations.idsForEnrichmentRun(organizationId, runId);
  }

  /** Retention purge: redacts observation values past their source's retention window. */
  redactExpiredObservations(now: Date = new Date()): Promise<number> {
    return this.observations.redactExpired(now);
  }

  recordObservations(organizationId: string, docs: ObservationDocument[]): Promise<number> {
    return this.observations.insertMany(organizationId, docs);
  }

  /** `id` makes the event idempotent (a retried job records it once). */
  async recordVerificationEvent(
    organizationId: string,
    event: Omit<VerificationEventDocument, "_id" | "organizationId">,
    id: ObjectId = new ObjectId(),
  ): Promise<VerificationEventDocument> {
    const doc: VerificationEventDocument = { _id: id, organizationId, ...event };
    await this.verifications.insert(organizationId, doc);
    return doc;
  }

  async listObservations(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
    query: ObservationListQuery,
  ): Promise<{ items: Observation[]; nextCursor: string | null }> {
    const page = await withCursor(() =>
      this.observations.pageForBusiness(
        organizationId,
        businessId,
        { field: query.field, source: query.source },
        { pageSize: query.pageSize, cursor: query.cursor ?? null },
      ),
    );
    return { items: page.items.map((o) => toObservationView(o)), nextCursor: page.nextCursor };
  }

  async recentObservations(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
    limit = 20,
  ): Promise<ObservationDocument[]> {
    return (
      await this.observations.pageForBusiness(organizationId, businessId, {}, { pageSize: limit })
    ).items;
  }

  countObservations(organizationId: string, businessId: ObjectId | ObjectId[]): Promise<number> {
    return this.observations.countForBusiness(organizationId, businessId);
  }

  async observationCountsBySource(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
  ): Promise<Partial<Record<SourceKey, number>>> {
    const rows = await this.observations.countsBySource(organizationId, businessId);
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  async listVerificationEvents(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
    query: VerificationEventListQuery,
  ): Promise<{ items: VerificationEvent[]; nextCursor: string | null }> {
    const page = await withCursor(() =>
      this.verifications.pageForBusiness(organizationId, businessId, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    return { items: page.items.map(toVerificationEventView), nextCursor: page.nextCursor };
  }

  async recentVerificationEvents(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
    limit = 5,
  ): Promise<VerificationEventDocument[]> {
    return (
      await this.verifications.pageForBusiness(organizationId, businessId, { pageSize: limit })
    ).items;
  }
}
