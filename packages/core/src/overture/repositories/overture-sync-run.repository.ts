import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  type Collection,
  type Filter,
  type ObjectId,
} from "@leadforge/db-mongo";
import type { OvertureSyncRunDocument } from "../overture.types.js";

/**
 * Overture sync runs (`overture_sync_runs`). Platform-level operational records, like the
 * staging catalogue they describe (see OverturePlaceRepository): not organization data.
 */
@Injectable()
export class OvertureSyncRunRepository {
  private readonly collection: Collection<OvertureSyncRunDocument>;

  constructor(mongo: MongoService) {
    this.collection = mongo.collection<OvertureSyncRunDocument>(Collections.overtureSyncRuns);
  }

  async insert(doc: OvertureSyncRunDocument): Promise<void> {
    await this.collection.insertOne(doc);
  }

  /**
   * Starts a run (status `running`) if no other run is `running`: the unique partial index
   * `one_running_sync` admits one such document, so this is the sync's lease. It is held in
   * MongoDB, next to the catalogue it protects, so two processes that share the database but not
   * the Redis database still exclude each other. False when another run holds it.
   */
  async acquire(doc: OvertureSyncRunDocument): Promise<boolean> {
    try {
      await this.collection.insertOne(doc);
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  }

  /** Refreshes a running run's heartbeat; false when the run is no longer `running` (the lease was taken over). */
  async heartbeat(id: ObjectId, at: Date): Promise<boolean> {
    const res = await this.collection.updateOne(
      { _id: id, status: "running" } as Filter<OvertureSyncRunDocument>,
      { $set: { heartbeatAt: at } },
    );
    return res.matchedCount === 1;
  }

  /** Records the outcome of a run that still holds the lease; false if another process expired it meanwhile. */
  async finish(id: ObjectId, set: Partial<OvertureSyncRunDocument>): Promise<boolean> {
    const res = await this.collection.updateOne(
      { _id: id, status: "running" } as Filter<OvertureSyncRunDocument>,
      { $set: set },
    );
    return res.matchedCount === 1;
  }

  async update(id: ObjectId, set: Partial<OvertureSyncRunDocument>): Promise<void> {
    await this.collection.updateOne({ _id: id } as Filter<OvertureSyncRunDocument>, { $set: set });
  }

  /** The newest run that loaded data (completed, with or without warnings). */
  async latestLoaded(): Promise<OvertureSyncRunDocument | null> {
    return this.collection.findOne(
      {
        status: { $in: ["completed", "completed_with_warnings"] },
      } as Filter<OvertureSyncRunDocument>,
      {
        sort: { finishedAt: -1 },
      },
    );
  }

  async loadedForRelease(release: string): Promise<OvertureSyncRunDocument | null> {
    return this.collection.findOne(
      {
        release,
        status: { $in: ["completed", "completed_with_warnings"] },
      } as Filter<OvertureSyncRunDocument>,
      {
        sort: { finishedAt: -1 },
      },
    );
  }

  async recent(limit = 20): Promise<OvertureSyncRunDocument[]> {
    return this.collection
      .find({}, { projection: { summary: 0 } })
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Marks runs left `running` by a process that stopped (crash, kill, lost connection) as failed:
   * their last heartbeat (or, for runs recorded before heartbeats, their start) is older than
   * `staleBefore`. Called before every sync attempt, including one that then skips.
   */
  async failStale(staleBefore: Date, now = new Date()): Promise<number> {
    const res = await this.collection.updateMany(
      {
        status: "running",
        $or: [
          { heartbeatAt: { $lt: staleBefore } },
          { heartbeatAt: null, startedAt: { $lt: staleBefore } },
        ],
      } as Filter<OvertureSyncRunDocument>,
      [
        {
          $set: {
            status: "failed",
            error: {
              $concat: [
                "The sync process stopped before finishing (no heartbeat since ",
                {
                  $dateToString: {
                    date: { $ifNull: ["$heartbeatAt", "$startedAt"] },
                    format: "%Y-%m-%dT%H:%M:%SZ",
                  },
                },
                ")",
              ],
            },
            finishedAt: now,
            durationMs: { $subtract: [now, "$startedAt"] },
          },
        },
      ],
    );
    return res.modifiedCount;
  }
}
