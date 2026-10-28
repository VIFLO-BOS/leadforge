import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { ObjectId, type AnyBulkWriteOperation } from "@leadforge/db-mongo";
import { AdminIndex } from "./admin-index.js";
import { normalizeOverturePlace, type NormalizedPlace } from "./overture-normalize.js";
import { curatedNodes } from "./overture-taxonomy.js";
import { OvertureCatalogService } from "./overture-catalog.service.js";
import type {
  OverturePlaceDocument,
  OvertureSnapshot,
  OvertureSyncCounts,
  OvertureSyncRunDocument,
} from "./overture.types.js";
import {
  HASH_PREFIX,
  OverturePlaceRepository,
  type GroupingRow,
} from "./repositories/overture-place.repository.js";
import { OvertureSyncRunRepository } from "./repositories/overture-sync-run.repository.js";

/** Another sync holds the lease (a run with a recent heartbeat is `running`). */
export class OvertureSyncBusyError extends Error {
  constructor() {
    super("Another Overture sync is running");
    this.name = "OvertureSyncBusyError";
  }
}

/** The sync lost its lease: another process expired the run and may be loading the catalogue. */
export class OvertureSyncLeaseLostError extends Error {
  constructor() {
    super(
      "This sync's run was expired by another process (no heartbeat within the lease); stopped to avoid two writers",
    );
    this.name = "OvertureSyncLeaseLostError";
  }
}

/** A `running` run whose heartbeat is older than this is treated as dead and marked failed. */
export const OVERTURE_SYNC_LEASE_MS = 10 * 60 * 1000;
/** How often a running sync refreshes its heartbeat. */
export const OVERTURE_SYNC_HEARTBEAT_MS = 30 * 1000;
const WRITE_BATCH = 1000;
/** Write batches in flight at once: inserts are index-bound on the server, so a few run in parallel. */
const WRITE_CONCURRENCY = 4;
/** Retirement is skipped (and reported) when the release lost more than this share of live places. */
const MAX_REMOVED_SHARE = 0.05;
/** Row-count drift reported as a warning. */
const MAX_COUNT_DRIFT = 0.15;
/** Snapshots smaller than this skip the share checks (fixtures, first loads). */
const SANITY_MIN_ROWS = 1000;

/**
 * Bulk writes to the staging catalogue skip the journal wait: the catalogue is rebuilt from the
 * published release and every load is idempotent, so a crash only means rerunning the sync.
 */
const STAGING_WRITE_CONCERN = { w: 1, j: false } as const;

function emptyCounts(): OvertureSyncCounts {
  return {
    read: 0,
    invalid: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
    restored: 0,
    withoutState: 0,
    withoutLga: 0,
    duplicateGroups: 0,
    duplicatesHidden: 0,
    offerable: 0,
    live: 0,
  };
}

/**
 * Loads one Overture release into the staging catalogue (`overture_places`):
 * 1. assigns each place a state and LGA by point-in-polygon against the release's division areas;
 * 2. normalizes it and upserts by GERS id, skipping places whose content hash did not change;
 * 3. groups duplicates (same upstream record, or the same numeric Facebook page and name across
 *    two datasets) and keeps one representative per group offerable;
 * 4. marks places missing from the release as retired (never deleted), unless the release lost
 *    more than 5% of live places, in which case retirement waits for a forced run;
 * 5. records the run with counts, warnings and the state, LGA and category summary.
 * Idempotent: loading the same release again changes nothing and reports every place unchanged.
 * One sync at a time: a lease in MongoDB (one `running` run, kept alive by a heartbeat every
 * 30 seconds; a run silent for 10 minutes is marked failed by the next attempt).
 */
@Injectable()
export class OvertureSyncService {
  constructor(
    private readonly places: OverturePlaceRepository,
    private readonly runs: OvertureSyncRunRepository,
    private readonly catalog: OvertureCatalogService,
    private readonly logger: Logger,
  ) {}

  /**
   * Marks runs left `running` by a stopped process (no heartbeat within the lease) as failed.
   * Every sync attempt calls it first, including one that skips an already loaded release.
   */
  async expireStaleRuns(now = new Date()): Promise<number> {
    const expired = await this.runs.failStale(
      new Date(now.getTime() - OVERTURE_SYNC_LEASE_MS),
      now,
    );
    if (expired > 0)
      this.logger.warn({ expired }, "Marked Overture sync runs with no heartbeat as failed");
    return expired;
  }

  latestLoaded(): Promise<OvertureSyncRunDocument | null> {
    return this.runs.latestLoaded();
  }

  loadedForRelease(release: string): Promise<OvertureSyncRunDocument | null> {
    return this.runs.loadedForRelease(release);
  }

  recentRuns(limit = 20): Promise<OvertureSyncRunDocument[]> {
    return this.runs.recent(limit);
  }

  async load(
    snapshot: OvertureSnapshot,
    options: { trigger: OvertureSyncRunDocument["trigger"]; force?: boolean },
  ): Promise<OvertureSyncRunDocument> {
    const started = Date.now();
    const run: OvertureSyncRunDocument = {
      _id: new ObjectId(),
      release: snapshot.release,
      schemaVersion: snapshot.schemaVersion,
      origin: snapshot.origin,
      trigger: options.trigger,
      status: "running",
      counts: emptyCounts(),
      warnings: [],
      error: null,
      summary: null,
      startedAt: new Date(started),
      heartbeatAt: new Date(started),
      finishedAt: null,
      durationMs: null,
    };
    try {
      await this.expireStaleRuns(new Date(started));
      if (!(await this.runs.acquire(run))) throw new OvertureSyncBusyError();
    } catch (err) {
      await snapshot.close?.().catch(() => undefined);
      throw err;
    }
    const lease = this.keepAlive(run._id);
    try {
      await this.apply(snapshot, run, options.force === true, lease.check);
      lease.check();
      run.status = run.warnings.length > 0 ? "completed_with_warnings" : "completed";
    } catch (err) {
      run.status = "failed";
      run.error = err instanceof Error ? err.message.slice(0, 2000) : String(err);
      this.logger.error({ err, release: snapshot.release }, "Overture sync failed");
    } finally {
      lease.stop();
      run.finishedAt = new Date();
      run.durationMs = Date.now() - started;
      // Only while the run still holds the lease: an expired run keeps the failure another process recorded.
      const recorded = await this.runs
        .finish(run._id, {
          status: run.status,
          counts: run.counts,
          warnings: run.warnings,
          error: run.error,
          summary: run.summary,
          heartbeatAt: run.finishedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
        })
        .catch((err: unknown) => {
          this.logger.error({ err }, "Could not record the Overture sync run");
          return true;
        });
      if (!recorded)
        this.logger.warn(
          { runId: run._id.toHexString() },
          "The Overture sync run had been expired by another process; its outcome was not recorded",
        );
      await snapshot.close?.().catch(() => undefined);
      this.catalog.invalidate();
    }
    this.logger.log(
      {
        release: run.release,
        status: run.status,
        counts: run.counts,
        durationMs: run.durationMs,
        warnings: run.warnings,
      },
      "Overture sync finished",
    );
    return run;
  }

  /**
   * Heartbeat for a running sync. `check` throws once a heartbeat found the run no longer
   * `running` (another process expired it), so the load stops at the next batch.
   */
  private keepAlive(runId: ObjectId): { check: () => void; stop: () => void } {
    let lost = false;
    let beating = false;
    const timer = setInterval(() => {
      if (beating) return;
      beating = true;
      this.runs
        .heartbeat(runId, new Date())
        .then((held) => {
          if (!held) lost = true;
        })
        .catch((err: unknown) =>
          this.logger.warn({ err }, "Overture sync heartbeat failed; retrying"),
        )
        .finally(() => {
          beating = false;
        });
    }, OVERTURE_SYNC_HEARTBEAT_MS);
    timer.unref?.();
    return {
      check: () => {
        if (lost) throw new OvertureSyncLeaseLostError();
      },
      stop: () => clearInterval(timer),
    };
  }

  private async apply(
    snapshot: OvertureSnapshot,
    run: OvertureSyncRunDocument,
    force: boolean,
    checkLease: () => void = () => undefined,
  ): Promise<void> {
    const { release } = snapshot;
    const counts = run.counts;
    const admin = new AdminIndex(snapshot.divisions);
    if (admin.stateCount === 0 && admin.lgaCount === 0) {
      throw new Error(
        "The release has no Nigerian division boundaries, so states and LGAs cannot be assigned; nothing was loaded",
      );
    }
    // One projection-only pass: content hash and retirement of every stored place.
    const existing = await this.places.hashIndex();
    const previousLive = [...existing.values()].filter((e) => !e.retired).length;
    const now = new Date();
    const started = Date.now();

    let inserts: OverturePlaceDocument[] = [];
    let updates: NormalizedPlace[] = [];
    // Unchanged places are only counted and remembered (no write): the release confirms them.
    let unchangedInBatch = 0;
    const seenIds = new Set<string>();
    let batches = 0;
    // Up to WRITE_CONCURRENCY write batches in flight while the next rows are normalized.
    const inflight: Array<Promise<void>> = [];
    const flush = async (): Promise<void> => {
      const [ins, upd] = [inserts, updates];
      inserts = [];
      updates = [];
      unchangedInBatch = 0;
      batches += 1;
      const batchNo = batches;
      if (ins.length + upd.length === 0) {
        logProgress(batchNo);
        return;
      }
      checkLease();
      const write = (async () => {
        const raced = await this.places.insertNew(ins, STAGING_WRITE_CONCERN);
        // Inserted by another writer in the meantime: written as updates, so count them as such.
        counts.inserted -= raced.length;
        counts.updated += raced.length;
        const changed = [...upd, ...raced.map(stripForUpdate)];
        if (changed.length > 0) {
          await this.places.updateChanged(
            // A changed place starts alone in its group again; the regroup step rejoins real duplicates.
            changed.map((p) => ({
              place: p,
              set: {
                ...singletonFields(p),
                retiredAt: null,
                retiredInRelease: null,
                syncRunId: run._id,
                updatedAt: now,
              },
            })),
            STAGING_WRITE_CONCERN,
          );
        }
        logProgress(batchNo);
      })();
      // Handled here so a failed write never surfaces as an unhandled rejection; awaiting it below rethrows.
      write.catch(() => undefined);
      inflight.push(write);
      if (inflight.length >= WRITE_CONCURRENCY) await inflight.shift();
    };
    const logProgress = (batchNo: number) => {
      const seconds = (Date.now() - started) / 1000;
      this.logger.log(
        {
          release,
          batch: batchNo,
          read: counts.read,
          inserted: counts.inserted,
          updated: counts.updated,
          unchanged: counts.unchanged,
          invalid: counts.invalid,
          rowsPerSecond: Math.round(counts.read / Math.max(seconds, 0.001)),
          elapsedSeconds: Math.round(seconds),
        },
        "Overture sync progress",
      );
    };

    for await (const batch of snapshot.places) {
      for (const row of batch) {
        counts.read += 1;
        const result = normalizeOverturePlace(row, {
          release,
          schemaVersion: snapshot.schemaVersion,
          admin: admin.lookup(row.lon, row.lat),
        });
        if (!result.ok) {
          counts.invalid += 1;
          continue;
        }
        const place = result.place;
        if (!place.admin.stateKey) counts.withoutState += 1;
        if (!place.admin.lgaKey) counts.withoutLga += 1;
        const prior = existing.get(place._id);
        seenIds.add(place._id);
        if (
          prior &&
          !prior.retired &&
          prior.contentHash === place.contentHash.slice(0, HASH_PREFIX)
        ) {
          counts.unchanged += 1;
          unchangedInBatch += 1;
        } else if (!prior) {
          counts.inserted += 1;
          inserts.push(newDocument(place, release, run._id, now));
        } else {
          counts.updated += 1;
          if (prior.retired) counts.restored += 1;
          updates.push(place);
        }
        if (inserts.length + updates.length + unchangedInBatch >= WRITE_BATCH) await flush();
      }
    }
    await flush();
    while (inflight.length > 0) await inflight.shift();

    const loaded = counts.read - counts.invalid;
    if (snapshot.expectedRows !== null && snapshot.expectedRows !== counts.read) {
      run.warnings.push(
        `The reader expected ${snapshot.expectedRows} rows but returned ${counts.read}.`,
      );
    }
    if (
      previousLive >= SANITY_MIN_ROWS &&
      Math.abs(loaded - previousLive) / previousLive > MAX_COUNT_DRIFT
    ) {
      run.warnings.push(
        `Place count moved from ${previousLive} to ${loaded} (more than ${MAX_COUNT_DRIFT * 100}%).`,
      );
    }

    // Live places the release no longer contains, computed in memory from the hash index.
    const missing = [...existing.entries()]
      .filter(([id, e]) => !e.retired && !seenIds.has(id))
      .map(([id]) => id);
    if (missing.length > 0) {
      const share = previousLive > 0 ? missing.length / previousLive : 1;
      if (!force && previousLive >= SANITY_MIN_ROWS && share > MAX_REMOVED_SHARE) {
        run.warnings.push(
          `${missing.length} live places (${(share * 100).toFixed(1)}%) are missing from ${release}, above the ${MAX_REMOVED_SHARE * 100}% safety limit; they were not retired. Check the release, then rerun with --force to retire them.`,
        );
      } else {
        for (let i = 0; i < missing.length; i += 5000)
          counts.retired += await this.places.retire(
            missing.slice(i, i + 5000),
            release,
            new Date(),
          );
      }
    }

    checkLease();
    this.logger.log(
      { release, read: counts.read, elapsedSeconds: Math.round((Date.now() - started) / 1000) },
      "Overture sync: places written; grouping duplicates",
    );
    const grouping = await this.regroup();
    this.logger.log(
      { release, groups: grouping.groups, hidden: grouping.hidden, changed: grouping.changed },
      "Overture sync: duplicate groups updated",
    );
    counts.duplicateGroups = grouping.groups;
    counts.duplicatesHidden = grouping.hidden;
    counts.live = await this.places.countLive();
    counts.offerable = await this.places.countOfferable();
    run.summary = await this.places.summary();

    if (counts.live >= 10_000) {
      const present = new Set(run.summary.categories.map((c) => c.node));
      const unused = curatedNodes().filter((n) => !present.has(n));
      if (unused.length > 0)
        run.warnings.push(
          `Mapped taxonomy categories with no offerable places in ${release}: ${unused.join(", ")}. Check the taxonomy for renames.`,
        );
    }
  }

  /**
   * Recomputes duplicate groups over every live place and updates the rows whose group,
   * representative or offerable flag changed. Union-find: places sharing an upstream record
   * (`up:` key) always join; places sharing a numeric Facebook page join only across different
   * datasets and with the same normalized name, so chain branches listing one corporate page stay
   * apart. The representative is the highest-confidence place, then the one with more contacts,
   * then the lowest id.
   */
  async regroup(): Promise<{ groups: number; hidden: number; changed: number }> {
    // Only places sharing an upstream record or a Facebook page with another live place can be
    // duplicates; the database finds them, so the other ~93% never leave the server.
    const candidates = await this.places.sharedKeyCandidates();
    const rows = await this.places.groupingRowsFor(candidates);
    const parent = rows.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };

    const byUpstream = new Map<string, number[]>();
    const bySocial = new Map<string, number[]>();
    rows.forEach((r, i) => {
      if (r.upstreamKey)
        byUpstream.set(r.upstreamKey, [...(byUpstream.get(r.upstreamKey) ?? []), i]);
      for (const k of r.socialKeys ?? []) bySocial.set(k, [...(bySocial.get(k) ?? []), i]);
    });
    for (const members of byUpstream.values())
      for (let k = 1; k < members.length; k++) union(members[0]!, members[k]!);
    for (const members of bySocial.values()) {
      if (members.length < 2 || members.length > 50) continue;
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          const ra = rows[members[a]!]!;
          const rb = rows[members[b]!]!;
          const dsA = (ra.rootSource?.dataset ?? "").toLowerCase();
          const dsB = (rb.rootSource?.dataset ?? "").toLowerCase();
          if (dsA !== dsB && ra.nameKey === rb.nameKey) union(members[a]!, members[b]!);
        }
      }
    }

    const groups = new Map<number, GroupingRow[]>();
    rows.forEach((r, i) => {
      const root = find(i);
      groups.set(root, [...(groups.get(root) ?? []), r]);
    });

    const ops: Array<AnyBulkWriteOperation<OverturePlaceDocument>> = [];
    const singletonFixes: string[] = [];
    let multi = 0;
    let hidden = 0;
    let changed = 0;
    for (const members of groups.values()) {
      const best = [...members].sort(
        (a, b) =>
          b.confidence - a.confidence ||
          (b.contacts?.score ?? 0) - (a.contacts?.score ?? 0) ||
          (a._id < b._id ? -1 : a._id > b._id ? 1 : 0),
      )[0]!;
      if (members.length > 1) {
        multi += 1;
        hidden += members.length - 1;
      }
      const groupKeys = groupKeysOf(members);
      for (const m of members) {
        const isCanonical = m._id === best._id;
        const offerable = isCanonical && !m.closed;
        const sameKeys =
          Array.isArray(m.groupKeys) &&
          m.groupKeys.length === groupKeys.length &&
          m.groupKeys.every((k, i) => k === groupKeys[i]);
        if (
          m.canonicalId === best._id &&
          m.isCanonical === isCanonical &&
          m.offerable === offerable &&
          sameKeys
        )
          continue;
        changed += 1;
        // A place alone in its group gets the defaults a pipeline update computes from the row itself.
        if (members.length === 1) singletonFixes.push(m._id);
        else
          ops.push({
            updateOne: {
              filter: { _id: m._id },
              update: { $set: { canonicalId: best._id, isCanonical, offerable, groupKeys } },
            },
          });
      }
    }
    // Every other live place is alone in its group: fix the ones whose stored group fields are not their own.
    const stale = await this.places.singletonMismatches(candidates);
    changed += stale.length;
    singletonFixes.push(...stale);
    for (let i = 0; i < singletonFixes.length; i += 5000)
      await this.places.resetSingletons(singletonFixes.slice(i, i + 5000), STAGING_WRITE_CONCERN);
    for (let i = 0; i < ops.length; i += WRITE_BATCH)
      await this.places.bulkWrite(ops.slice(i, i + WRITE_BATCH), STAGING_WRITE_CONCERN);
    return { groups: multi, hidden, changed };
  }
}

/** Keys of every place in a group: `gers:<id>` and their upstream records, sorted. */
function groupKeysOf(members: Array<{ _id: string; upstreamKey: string | null }>): string[] {
  return [
    ...new Set(
      members.flatMap((m) => [`gers:${m._id}`, ...(m.upstreamKey ? [m.upstreamKey] : [])]),
    ),
  ].sort();
}

/** Group fields of a place alone in its duplicate group (most places are). */
function singletonFields(
  place: NormalizedPlace,
): Pick<OverturePlaceDocument, "canonicalId" | "isCanonical" | "offerable" | "groupKeys"> {
  return {
    canonicalId: place._id,
    isCanonical: true,
    offerable: !place.closed,
    groupKeys: groupKeysOf([place]),
  };
}

/**
 * A new place, inserted with the values it has when alone in its duplicate group, so the regroup
 * step only rewrites the few that share an upstream record or page.
 */
function newDocument(
  place: NormalizedPlace,
  release: string,
  syncRunId: ObjectId,
  now: Date,
): OverturePlaceDocument {
  return {
    ...place,
    firstSeenRelease: release,
    retiredAt: null,
    retiredInRelease: null,
    ...singletonFields(place),
    syncRunId,
    createdAt: now,
    updatedAt: now,
  };
}

/** A new-place document turned back into update input (when an insert raced with another writer). */
function stripForUpdate(doc: OverturePlaceDocument): NormalizedPlace {
  const {
    firstSeenRelease: _f,
    retiredAt: _r,
    retiredInRelease: _ri,
    canonicalId: _c,
    isCanonical: _i,
    offerable: _o,
    groupKeys: _g,
    syncRunId: _s,
    createdAt: _ca,
    updatedAt: _u,
    ...place
  } = doc;
  return place;
}
