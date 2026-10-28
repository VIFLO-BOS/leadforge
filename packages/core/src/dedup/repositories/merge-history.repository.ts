import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type CursorPage,
  type Document,
  type Filter,
  type UpdateFilter,
  type WithId,
} from "@leadforge/db-mongo";
import type { DuplicateCandidateStatus } from "@leadforge/contracts";
import type { BusinessDocument } from "../../businesses/business.types.js";

export interface MergeHistoryDocument {
  _id: ObjectId;
  organizationId: string;
  candidateId: ObjectId | null;
  candidateStatusBefore: DuplicateCandidateStatus | null;
  survivorId: ObjectId;
  mergedIds: ObjectId[];
  /** Full documents as they were before the merge; undo writes them back. */
  snapshotBefore: { survivor: BusinessDocument; merged: BusinessDocument[] };
  /** Versions written by the merge; undo without `force` requires them unchanged. */
  versionsAfter: { survivor: number; merged: number[] } | null;
  fieldDecisions: Array<{ field: "name" | "website" | "location"; chosenFrom: ObjectId }>;
  /** Other open candidates of the merged record, closed by the merge, with their status before. */
  supersededCandidates: Array<{ id: ObjectId; status: DuplicateCandidateStatus }>;
  status: "applying" | "applied" | "undone" | "failed";
  performedByUserId: string;
  performedAt: Date;
  undoneAt: Date | null;
  undoneByUserId: string | null;
  undoForced: boolean;
}

@Injectable()
export class MergeHistoryRepository extends OrgScopedRepository<MergeHistoryDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.mergeHistory);
  }

  async insert(organizationId: string, doc: MergeHistoryDocument): Promise<void> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    await this.collection.insertOne(doc as WithId<MergeHistoryDocument>);
  }

  async transition(
    organizationId: string,
    id: ObjectId,
    from: MergeHistoryDocument["status"][],
    update: UpdateFilter<MergeHistoryDocument>,
  ): Promise<WithId<MergeHistoryDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        status: { $in: from },
      } as Filter<MergeHistoryDocument>),
      update,
      { returnDocument: "after" },
    );
  }

  async page(
    organizationId: string,
    filter: {
      businessId?: ObjectId | undefined;
      statuses?: Array<"applied" | "undone"> | undefined;
    },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<MergeHistoryDocument>>> {
    const query: Document = {
      status: { $in: filter.statuses?.length ? filter.statuses : ["applied", "undone"] },
    };
    if (filter.businessId)
      query.$or = [{ survivorId: filter.businessId }, { mergedIds: filter.businessId }];
    return this.findPage(organizationId, query as Filter<MergeHistoryDocument>, {
      ...opts,
      sortField: "performedAt",
      direction: -1,
      // The snapshots are whole business documents; a page needs only their names (history view).
      projection: {
        organizationId: 1,
        candidateId: 1,
        survivorId: 1,
        mergedIds: 1,
        fieldDecisions: 1,
        status: 1,
        performedByUserId: 1,
        performedAt: 1,
        undoneAt: 1,
        undoneByUserId: 1,
        undoForced: 1,
        "snapshotBefore.survivor.name": 1,
        "snapshotBefore.merged.name": 1,
      },
    });
  }
}
