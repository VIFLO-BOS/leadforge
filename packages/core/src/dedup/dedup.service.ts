import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { cloneBson, ObjectId, type WithId } from "@leadforge/db-mongo";
import {
  EXPIRED_NAME_LABEL,
  MERGE_UNDO_WINDOW_DAYS,
  type CandidateBusiness,
  type DedupScanRequest,
  type DedupScanResponse,
  type DuplicateCandidate,
  type DuplicateCandidateListQuery,
  type MergeListQuery,
  type MergeRecord,
  type MergeRequest,
  type MergeResponse,
  type OrganizationRole,
  type UndoMergeRequest,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { isExpired, locationHasValue } from "../businesses/business-model.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import { blockingKeys } from "../normalization/similarity.js";
import { evaluatePair, pairKey } from "./candidate-scoring.js";
import { mergeRecords } from "./merge.js";
import {
  DuplicateCandidateRepository,
  type DuplicateCandidateDocument,
} from "./repositories/duplicate-candidate.repository.js";
import {
  MergeHistoryRepository,
  type MergeHistoryDocument,
} from "./repositories/merge-history.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_BATCH = 200;

export interface Actor {
  userId: string;
  role: OrganizationRole;
}

function candidateBusiness(
  doc: BusinessDocument | undefined,
  id: ObjectId,
  now: Date,
): CandidateBusiness {
  if (!doc) {
    return {
      id: id.toHexString(),
      name: null,
      nameState: "missing",
      categories: [],
      location: { formatted: null, locality: null, lga: null, region: null },
      website: null,
      phones: [],
      phonesDisplay: [],
      emails: [],
      sources: [],
      suppressed: false,
      live: false,
      createdAt: null,
    };
  }
  const nameExpired = isExpired(doc.name.expiresAt, now);
  const locLive = locationHasValue(doc.location) && !isExpired(doc.location.expiresAt, now);
  return {
    id: doc._id.toHexString(),
    name: nameExpired ? EXPIRED_NAME_LABEL : doc.name.value,
    nameState: nameExpired ? "expired" : doc.name.state,
    categories: doc.categories.filter((c) => !isExpired(c.expiresAt, now)).map((c) => c.value),
    location: {
      formatted: locLive ? doc.location.formatted : null,
      locality: locLive ? doc.location.locality : null,
      lga: locLive ? doc.location.lga : null,
      region: locLive ? doc.location.region : null,
    },
    website: doc.website && !isExpired(doc.website.expiresAt, now) ? doc.website.value : null,
    phones: doc.phones.filter((p) => !isExpired(p.expiresAt, now)).map((p) => p.e164),
    phonesDisplay: doc.phones
      .filter((p) => !isExpired(p.expiresAt, now))
      .map((p) => ({ e164: p.e164, international: p.international || p.e164 })),
    emails: doc.emails.filter((e) => !isExpired(e.expiresAt, now)).map((e) => e.address),
    sources: doc.sources,
    suppressed: doc.flags.suppressed,
    live: !doc.deletedAt,
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * Duplicate review (dedup stages 4 to 6): candidate generation from blocking keys and shared
 * identifiers, scoring with reasons, the review queue (merge, reject, defer), and merge with
 * full snapshots in merge_history so undo restores both records exactly. Nothing is merged
 * without a reviewer.
 */
@Injectable()
export class DedupService {
  constructor(
    private readonly candidates: DuplicateCandidateRepository,
    private readonly merges: MergeHistoryRepository,
    private readonly businesses: BusinessesService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  private async views(
    organizationId: string,
    docs: DuplicateCandidateDocument[],
  ): Promise<DuplicateCandidate[]> {
    const ids = docs.flatMap((d) => d.businessIds);
    const found = await this.businesses.findAnyByIds(organizationId, ids);
    const byId = new Map(found.map((b) => [b._id.toHexString(), b]));
    const now = new Date();
    return docs.map((d) => ({
      id: d._id.toHexString(),
      businessIds: [d.businessIds[0].toHexString(), d.businessIds[1].toHexString()],
      businesses: d.businessIds.map((id) => candidateBusiness(byId.get(id.toHexString()), id, now)),
      stage: d.stage,
      score: d.score,
      signals: d.signals,
      reasons: d.reasons,
      status: d.status,
      decidedByUserId: d.decidedByUserId,
      decidedAt: d.decidedAt?.toISOString() ?? null,
      mergeId: d.mergeId?.toHexString() ?? null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));
  }

  private mergeView(m: MergeHistoryDocument, viewer: Actor | null): MergeRecord {
    const now = new Date();
    // Names at merge time, from the snapshots (null when missing or expired under source retention).
    const nameOf = (
      doc: { name?: { value?: string | null; expiresAt?: Date | null } } | undefined,
    ): string | null =>
      doc?.name?.value && !isExpired(doc.name.expiresAt ?? null, now) ? doc.name.value : null;
    return {
      id: m._id.toHexString(),
      candidateId: m.candidateId?.toHexString() ?? null,
      survivorId: m.survivorId.toHexString(),
      mergedIds: m.mergedIds.map((id) => id.toHexString()),
      survivorName: nameOf(m.snapshotBefore?.survivor),
      mergedNames: m.mergedIds.map((id, i) => ({
        id: id.toHexString(),
        name: nameOf(m.snapshotBefore?.merged?.[i]),
      })),
      fieldDecisions: m.fieldDecisions.map((f) => ({
        field: f.field,
        chosenFrom: f.chosenFrom.toHexString(),
      })),
      status: m.status === "undone" ? "undone" : "applied",
      performedByUserId: m.performedByUserId,
      performedAt: m.performedAt.toISOString(),
      undoneAt: m.undoneAt?.toISOString() ?? null,
      undoneByUserId: m.undoneByUserId,
      undoForced: m.undoForced,
      canUndo: viewer ? m.status === "applied" && this.mayUndo(m, viewer) : false,
    };
  }

  /** Owners and admins can undo any merge; the person who merged can undo it for 30 days. */
  private mayUndo(m: MergeHistoryDocument, actor: Actor): boolean {
    if (actor.role === "owner" || actor.role === "admin") return true;
    return (
      m.performedByUserId === actor.userId &&
      Date.now() - m.performedAt.getTime() <= MERGE_UNDO_WINDOW_DAYS * DAY_MS
    );
  }

  async list(
    organizationId: string,
    query: DuplicateCandidateListQuery,
  ): Promise<{ items: DuplicateCandidate[]; nextCursor: string | null }> {
    let businessId: ObjectId | undefined;
    if (query.businessId)
      businessId = (await this.businesses.requireBusiness(organizationId, query.businessId))._id;
    const page = await withCursor(() =>
      this.candidates.page(
        organizationId,
        {
          statuses: query.status?.length ? query.status : ["pending"],
          businessId,
          minScore: query.minScore,
        },
        { pageSize: query.pageSize, cursor: query.cursor ?? null },
      ),
    );
    return { items: await this.views(organizationId, page.items), nextCursor: page.nextCursor };
  }

  private async requireCandidate(
    organizationId: string,
    id: string,
  ): Promise<WithId<DuplicateCandidateDocument>> {
    const doc = await this.candidates.findById(organizationId, id);
    if (!doc) throw AppError.notFound("Duplicate candidate");
    return doc;
  }

  async get(organizationId: string, id: string): Promise<DuplicateCandidate> {
    const [view] = await this.views(organizationId, [
      await this.requireCandidate(organizationId, id),
    ]);
    return view!;
  }

  // -------------------------------------------------------------------------
  // Review decisions
  // -------------------------------------------------------------------------

  private async refreshCounts(organizationId: string, ids: ObjectId[]): Promise<void> {
    for (const id of ids)
      await this.businesses.setDedupSummary(
        organizationId,
        id,
        await this.candidates.countOpenFor(organizationId, id),
      );
  }

  async reject(
    organizationId: string,
    actor: Actor,
    id: string,
    auditCtx: AuditContext,
  ): Promise<DuplicateCandidate> {
    const doc = await this.requireCandidate(organizationId, id);
    const updated = await this.candidates.transition(
      organizationId,
      doc._id,
      ["pending", "deferred"],
      {
        $set: {
          status: "rejected",
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    if (!updated) throw AppError.conflict(`This candidate is already ${doc.status}`);
    await this.refreshCounts(organizationId, updated.businessIds);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "dedup.candidate_rejected",
        resourceType: "duplicate_candidate",
        resourceId: id,
        before: { status: doc.status },
        after: { status: "rejected", businessIds: updated.businessIds.map((b) => b.toHexString()) },
      },
      auditCtx,
    );
    return this.get(organizationId, id);
  }

  async defer(
    organizationId: string,
    actor: Actor,
    id: string,
    auditCtx: AuditContext,
  ): Promise<DuplicateCandidate> {
    const doc = await this.requireCandidate(organizationId, id);
    const updated = await this.candidates.transition(
      organizationId,
      doc._id,
      ["pending", "deferred"],
      {
        $set: {
          status: "deferred",
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    if (!updated) throw AppError.conflict(`This candidate is already ${doc.status}`);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "dedup.candidate_deferred",
        resourceType: "duplicate_candidate",
        resourceId: id,
        before: { status: doc.status },
        after: { status: "deferred" },
      },
      auditCtx,
    );
    return this.get(organizationId, id);
  }

  /**
   * Accept-merge. Both full documents are snapshotted into merge_history before anything is
   * written; both writes are version-checked, and a failed second write restores the first.
   */
  async merge(
    organizationId: string,
    actor: Actor,
    id: string,
    req: MergeRequest,
    auditCtx: AuditContext,
  ): Promise<MergeResponse> {
    const candidate = await this.requireCandidate(organizationId, id);
    if (candidate.status !== "pending" && candidate.status !== "deferred")
      throw AppError.conflict(`This candidate is already ${candidate.status}`);
    const survivorId = candidate.businessIds.find(
      (b) => b.toHexString() === req.survivorId.toLowerCase(),
    );
    if (!survivorId)
      throw AppError.validation([
        { path: "survivorId", message: "Must be one of the candidate's two businesses" },
      ]);
    const mergedId = candidate.businessIds.find((b) => !b.equals(survivorId))!;
    const [survivor, merged] = await Promise.all([
      this.businesses.findAny(organizationId, survivorId),
      this.businesses.findAny(organizationId, mergedId),
    ]);
    if (!survivor || !merged || survivor.deletedAt || merged.deletedAt) {
      throw new AppError(
        "MERGE_CONFLICT",
        "One of these businesses was merged or deleted since this candidate was found",
      );
    }

    const now = new Date();
    const snapshot = {
      survivor: cloneBson(survivor) as BusinessDocument,
      merged: [cloneBson(merged) as BusinessDocument],
    };
    const result = mergeRecords(survivor, merged, req.fields ?? {}, now);
    await this.businesses.refreshSuppressionFlag(organizationId, result.survivor, actor.userId);
    const superseded = (await this.candidates.findOpenFor(organizationId, mergedId)).filter(
      (c) => !c._id.equals(candidate._id),
    );

    const history: MergeHistoryDocument = {
      _id: new ObjectId(),
      organizationId,
      candidateId: candidate._id,
      candidateStatusBefore: candidate.status,
      survivorId,
      mergedIds: [mergedId],
      snapshotBefore: snapshot,
      versionsAfter: null,
      fieldDecisions: result.fieldDecisions,
      supersededCandidates: superseded.map((c) => ({ id: c._id, status: c.status })),
      status: "applying",
      performedByUserId: actor.userId,
      performedAt: now,
      undoneAt: null,
      undoneByUserId: null,
      undoForced: false,
    };
    await this.merges.insert(organizationId, history);

    if (
      !(await this.businesses.replaceVersioned(organizationId, result.survivor, survivor.version))
    ) {
      await this.merges.transition(organizationId, history._id, ["applying"], {
        $set: { status: "failed" },
      });
      throw new AppError(
        "MERGE_CONFLICT",
        "The surviving business changed while merging; reload and try again",
      );
    }
    if (!(await this.businesses.replaceVersioned(organizationId, result.merged, merged.version))) {
      await this.businesses.replaceVersioned(
        organizationId,
        cloneBson(snapshot.survivor),
        survivor.version + 1,
      );
      await this.merges.transition(organizationId, history._id, ["applying"], {
        $set: { status: "failed" },
      });
      throw new AppError(
        "MERGE_CONFLICT",
        "The merged business changed while merging; nothing was changed. Reload and try again",
      );
    }
    const applied = await this.merges.transition(organizationId, history._id, ["applying"], {
      $set: {
        status: "applied",
        versionsAfter: { survivor: survivor.version + 1, merged: [merged.version + 1] },
      },
    });

    await this.candidates.setStatus(organizationId, [candidate._id], "merged", {
      decidedByUserId: actor.userId,
      decidedAt: now,
      mergeId: history._id,
    });
    await this.candidates.setStatus(
      organizationId,
      superseded.map((c) => c._id),
      "superseded",
      { decidedAt: now, mergeId: history._id },
    );
    await this.refreshCounts(organizationId, [
      survivorId,
      ...superseded.flatMap((c) => c.businessIds).filter((b) => !b.equals(mergedId)),
    ]);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "dedup.merged",
        resourceType: "business",
        resourceId: survivorId.toHexString(),
        before: {
          survivor: { name: survivor.name.value, version: survivor.version },
          merged: { id: mergedId.toHexString(), name: merged.name.value, version: merged.version },
        },
        after: {
          mergeId: history._id.toHexString(),
          candidateId: candidate._id.toHexString(),
          fieldDecisions: result.fieldDecisions.map((f) => ({
            field: f.field,
            chosenFrom: f.chosenFrom.toHexString(),
          })),
          supersededCandidates: superseded.length,
        },
      },
      auditCtx,
    );
    await this.businesses.afterDataChange(organizationId, [survivorId]);
    return {
      merge: this.mergeView(applied!, actor),
      candidate: await this.get(organizationId, id),
    };
  }

  /**
   * Undo: writes both snapshots back exactly (only `version` moves forward, so concurrent
   * editors still detect the change). Records changed since the merge need `force`; their later
   * changes are then discarded (their observations stay in provenance).
   */
  async undo(
    organizationId: string,
    actor: Actor,
    mergeId: string,
    req: UndoMergeRequest,
    auditCtx: AuditContext,
  ): Promise<MergeRecord> {
    const history = await this.merges.findById(organizationId, mergeId);
    if (!history || history.status === "applying" || history.status === "failed")
      throw AppError.notFound("Merge");
    if (history.status === "undone") throw AppError.conflict("This merge was already undone");
    if (!this.mayUndo(history, actor)) {
      throw AppError.forbidden(
        `Only an owner or admin, or the person who merged within ${MERGE_UNDO_WINDOW_DAYS} days, can undo this merge`,
      );
    }
    const survivorSnap = history.snapshotBefore.survivor;
    const current = await this.businesses.findAny(organizationId, history.survivorId);
    const mergedCurrent = await Promise.all(
      history.mergedIds.map((id) => this.businesses.findAny(organizationId, id)),
    );
    if (!current || mergedCurrent.some((m) => !m))
      throw new AppError("MERGE_CONFLICT", "A business in this merge no longer exists");
    const changed =
      current.version !== history.versionsAfter?.survivor ||
      mergedCurrent.some((m, i) => m!.version !== history.versionsAfter?.merged[i]);
    if (changed && !req.force) {
      throw new AppError(
        "MERGE_CONFLICT",
        "These businesses changed after the merge. Undo with force to restore the snapshots and discard those changes.",
        [{ path: "force", message: "true restores the snapshots anyway" }],
      );
    }

    const restore = async (snap: BusinessDocument, id: ObjectId) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const now = await this.businesses.findAny(organizationId, id);
        if (!now) throw new AppError("MERGE_CONFLICT", "A business in this merge no longer exists");
        if (await this.businesses.replaceVersioned(organizationId, cloneBson(snap), now.version))
          return;
      }
      throw new AppError("MERGE_CONFLICT", "A business kept changing during undo; try again");
    };
    await restore(survivorSnap, history.survivorId);
    for (let i = 0; i < history.mergedIds.length; i++)
      await restore(history.snapshotBefore.merged[i]!, history.mergedIds[i]!);

    const undone = await this.merges.transition(organizationId, history._id, ["applied"], {
      $set: {
        status: "undone",
        undoneAt: new Date(),
        undoneByUserId: actor.userId,
        undoForced: changed,
      },
    });
    if (history.candidateId)
      await this.candidates.restoreStatuses(organizationId, [
        { id: history.candidateId, status: history.candidateStatusBefore ?? "pending" },
      ]);
    await this.candidates.restoreStatuses(organizationId, history.supersededCandidates);
    await this.refreshCounts(organizationId, [history.survivorId, ...history.mergedIds]);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "dedup.merge_undone",
        resourceType: "business",
        resourceId: history.survivorId.toHexString(),
        before: { mergeId, survivorVersion: current.version },
        after: {
          restored: [history.survivorId, ...history.mergedIds].map((b) => b.toHexString()),
          forced: changed,
        },
      },
      auditCtx,
    );
    return this.mergeView(undone ?? history, actor);
  }

  async listMerges(
    organizationId: string,
    actor: Actor,
    query: MergeListQuery,
  ): Promise<{ items: MergeRecord[]; nextCursor: string | null }> {
    let businessId: ObjectId | undefined;
    if (query.businessId) {
      const found = ObjectId.isValid(query.businessId)
        ? await this.businesses.findAny(organizationId, new ObjectId(query.businessId))
        : null;
      if (!found) throw AppError.notFound("Business");
      businessId = found._id;
    }
    const page = await withCursor(() =>
      this.merges.page(
        organizationId,
        { businessId, statuses: query.status },
        { pageSize: query.pageSize, cursor: query.cursor ?? null },
      ),
    );
    return { items: page.items.map((m) => this.mergeView(m, actor)), nextCursor: page.nextCursor };
  }

  async getMerge(organizationId: string, actor: Actor, id: string): Promise<MergeRecord> {
    const m = await this.merges.findById(organizationId, id);
    if (!m || m.status === "applying" || m.status === "failed") throw AppError.notFound("Merge");
    return this.mergeView(m, actor);
  }

  // -------------------------------------------------------------------------
  // Candidate generation (worker)
  // -------------------------------------------------------------------------

  async requestScan(
    organizationId: string,
    userId: string,
    req: DedupScanRequest,
    auditCtx: AuditContext,
  ): Promise<DedupScanResponse> {
    let businessIds: string[] | null = null;
    if (req.businessIds) {
      const found = await this.businesses.findLiveByIds(
        organizationId,
        req.businessIds.map((b) => new ObjectId(b)),
      );
      if (found.length !== new Set(req.businessIds.map((b) => b.toLowerCase())).size)
        throw AppError.notFound("Business");
      businessIds = found.map((b) => b._id.toHexString());
    }
    await this.queue.enqueueFindDuplicates({ organizationId, businessIds });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "dedup.scan_requested",
        resourceType: "organization",
        resourceId: organizationId,
        after: { businesses: businessIds?.length ?? "all" },
      },
      auditCtx,
    );
    return {
      queued: true,
      scope: businessIds ? "businesses" : "organization",
      businesses: businessIds?.length ?? null,
    };
  }

  /** Finds and scores candidates for these businesses, or every live business when `ids` is null. */
  async findCandidates(
    organizationId: string,
    ids: string[] | null,
  ): Promise<{ checked: number; candidates: number }> {
    let checked = 0;
    let open = 0;
    const touched = new Map<string, ObjectId>();
    const process = async (docs: Array<WithId<BusinessDocument>>) => {
      const now = new Date();
      for (const doc of docs) {
        checked += 1;
        const keys = doc.name.normalized
          ? blockingKeys(doc.name.normalized, doc.location.localityKey, doc.location.lgaKey)
          : [];
        if (JSON.stringify(keys) !== JSON.stringify(doc.dedupKeys ?? [])) {
          await this.businesses.setDedupKeys(organizationId, doc._id, keys);
          doc.dedupKeys = keys;
        }
        for (const other of await this.businesses.findDuplicateCandidates(organizationId, doc)) {
          const evaluation = evaluatePair(doc, other, now);
          if (!evaluation) continue;
          const { key, ids: pair } = pairKey(doc._id.toHexString(), other._id.toHexString());
          if (
            await this.candidates.upsert(
              organizationId,
              [new ObjectId(pair[0]), new ObjectId(pair[1])],
              key,
              evaluation,
              now,
            )
          ) {
            open += 1;
            touched.set(doc._id.toHexString(), doc._id);
            touched.set(other._id.toHexString(), other._id);
          }
        }
      }
    };
    if (ids) {
      const valid = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
      await process(await this.businesses.findLiveByIds(organizationId, valid));
    } else {
      let after: ObjectId | null = null;
      for (;;) {
        const page = await this.businesses.pageLive(organizationId, after, SCAN_BATCH);
        if (page.length === 0) break;
        await process(page);
        after = page[page.length - 1]!._id;
        if (page.length < SCAN_BATCH) break;
      }
    }
    await this.refreshCounts(organizationId, [...touched.values()]);
    if (open > 0)
      this.logger.log(
        { organizationId, checked, candidates: open },
        "Duplicate candidates updated",
      );
    return { checked, candidates: open };
  }
}
