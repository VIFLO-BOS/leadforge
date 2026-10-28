import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import type { ScoringProfile, UpdateScoringProfileRequest } from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import {
  cleanText,
  normalizeKey,
  normalizePlace,
  normalizeRegion,
  placeKey,
  regionKey,
} from "../normalization/index.js";
import { computeScore, type ScoringProfileInput } from "./scoring-engine.js";
import {
  ScoringProfileRepository,
  type ScoringProfileDocument,
} from "./repositories/scoring-profile.repository.js";

const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function toProfileView(p: ScoringProfileDocument): ScoringProfile {
  return {
    id: p._id.toHexString(),
    name: p.name,
    isDefault: p.isDefault,
    weights: { ...p.weights },
    icp: { categories: [...p.icp.categories], locations: p.icp.locations.map((l) => ({ ...l })) },
    version: p.version,
    recompute: {
      status: p.recompute.status,
      profileVersion: p.recompute.profileVersion,
      processed: p.recompute.processed,
      total: p.recompute.total,
      requestedAt: iso(p.recompute.requestedAt),
      startedAt: iso(p.recompute.startedAt),
      finishedAt: iso(p.recompute.finishedAt),
      error: p.recompute.error,
    },
    updatedByUserId: p.updatedByUserId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Engine input from the stored profile: ICP values become the same keys the directory filters use. */
export function profileInput(p: ScoringProfileDocument): ScoringProfileInput {
  return {
    id: p._id,
    version: p.version,
    weights: { ...p.weights },
    categoryKeys: p.icp.categories.map((c) => normalizeKey(c)),
    categoryLabels: [...p.icp.categories],
    locations: p.icp.locations.map((l) => ({
      country: l.country,
      regionKey: l.region ? regionKey(l.region) : null,
      localityKey: l.locality ? placeKey(l.locality) : null,
      label: [l.locality, l.region, l.country].filter(Boolean).join(", "),
    })),
  };
}

/**
 * Scoring profiles (one default per organization, created on first use) and score
 * computation. Changing weights or the ICP bumps the profile version and queues a recompute of
 * every business; data changes queue a recompute of the businesses they touched.
 */
@Injectable()
export class ScoringService {
  constructor(
    private readonly profiles: ScoringProfileRepository,
    private readonly businesses: BusinessesService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  async getProfile(organizationId: string): Promise<ScoringProfile> {
    return toProfileView(await this.profiles.getOrCreateDefault(organizationId));
  }

  async updateProfile(
    organizationId: string,
    userId: string,
    req: UpdateScoringProfileRequest,
    auditCtx: AuditContext,
  ): Promise<ScoringProfile> {
    const current = await this.profiles.getOrCreateDefault(organizationId);
    if (req.version !== current.version) {
      throw AppError.conflict(
        `The scoring profile changed since you loaded it (now version ${current.version}); reload and try again`,
      );
    }
    const { country } = await this.businesses.stateContext(organizationId);
    const icp = req.icp
      ? {
          categories: dedupeCaseInsensitive(req.icp.categories.map((c) => cleanText(c))),
          locations: req.icp.locations.map((l) => {
            const c = l.country ?? null;
            return {
              country: c,
              region: l.region ? normalizeRegion(l.region, c ?? country) : null,
              locality: l.locality ? normalizePlace(l.locality) : null,
            };
          }),
        }
      : current.icp;
    const weights = req.weights ?? current.weights;
    const now = new Date();
    const nextVersion = current.version + 1;
    const updated = await this.profiles.updateIfVersion(
      organizationId,
      current._id,
      current.version,
      {
        $set: {
          weights,
          icp,
          updatedAt: now,
          updatedByUserId: userId,
          recompute: {
            status: "queued",
            profileVersion: nextVersion,
            processed: 0,
            total: null,
            requestedAt: now,
            startedAt: null,
            finishedAt: null,
            error: null,
          },
        },
        $inc: { version: 1 },
      },
    );
    if (!updated)
      throw AppError.conflict("The scoring profile changed while saving; reload and try again");
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "scoring.profile_updated",
        resourceType: "scoring_profile",
        resourceId: current._id.toHexString(),
        before: { version: current.version, weights: current.weights, icp: current.icp },
        after: { version: updated.version, weights: updated.weights, icp: updated.icp },
      },
      auditCtx,
    );
    await this.enqueueRecompute(updated);
    return toProfileView(updated);
  }

  /** Re-scores every business with the current profile (for example after the freshness window changed). */
  async requestRecompute(
    organizationId: string,
    userId: string,
    auditCtx: AuditContext,
  ): Promise<ScoringProfile> {
    const profile = await this.profiles.getOrCreateDefault(organizationId);
    const now = new Date();
    const updated = await this.profiles.updateIfVersion(
      organizationId,
      profile._id,
      profile.version,
      {
        $set: {
          recompute: {
            status: "queued",
            profileVersion: profile.version,
            processed: 0,
            total: null,
            requestedAt: now,
            startedAt: null,
            finishedAt: null,
            error: null,
          },
        },
      },
    );
    if (!updated) throw AppError.conflict("The scoring profile changed; reload and try again");
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "scoring.recompute_requested",
        resourceType: "scoring_profile",
        resourceId: profile._id.toHexString(),
        after: { version: profile.version },
      },
      auditCtx,
    );
    await this.enqueueRecompute(updated, `r${now.getTime()}`);
    return toProfileView(updated);
  }

  private async enqueueRecompute(profile: ScoringProfileDocument, suffix?: string): Promise<void> {
    try {
      await this.queue.enqueueScoreRecompute(
        { organizationId: profile.organizationId, profileVersion: profile.version },
        suffix,
      );
    } catch (err) {
      this.logger.error(
        { err, organizationId: profile.organizationId },
        "Could not queue the score recompute",
      );
      await this.profiles.setRecompute(profile.organizationId, profile._id, profile.version, {
        status: "failed",
        error: "The recompute could not be queued; save again or request a recompute",
      });
    }
  }

  /** Scores specific businesses with the current profile (after their data changed). */
  async scoreBusinesses(organizationId: string, ids: string[]): Promise<number> {
    const valid = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    if (valid.length === 0) return 0;
    const profile = await this.profiles.getOrCreateDefault(organizationId);
    const ctx = await this.businesses.stateContext(organizationId);
    const docs = await this.businesses.findLiveByIds(organizationId, valid);
    const input = profileInput(profile);
    return this.businesses.setScores(
      organizationId,
      docs.map((d) => ({ id: d._id, score: computeScore(d, input, ctx) })),
    );
  }

  /**
   * Recomputes every live business for `profileVersion`. Stops early when a newer version
   * superseded it (that version has its own job). Progress is written after every batch.
   */
  async recompute(
    organizationId: string,
    profileVersion: number,
  ): Promise<{ status: string; processed: number }> {
    let profile: WithId<ScoringProfileDocument> =
      await this.profiles.getOrCreateDefault(organizationId);
    if (profile.version !== profileVersion) return { status: "superseded", processed: 0 };
    const startedAt = new Date();
    await this.profiles.setRecompute(organizationId, profile._id, profileVersion, {
      status: "running",
      startedAt,
      processed: 0,
      error: null,
    });
    const ctx = await this.businesses.stateContext(organizationId);
    const input = profileInput(profile);
    let after: ObjectId | null = null;
    let processed = 0;
    for (;;) {
      const page = await this.businesses.pageLive(organizationId, after, BATCH);
      if (page.length === 0) break;
      await this.businesses.setScores(
        organizationId,
        page.map((d) => ({ id: d._id, score: computeScore(d, input, ctx) })),
      );
      processed += page.length;
      after = page[page.length - 1]!._id;
      profile = await this.profiles.getOrCreateDefault(organizationId);
      if (profile.version !== profileVersion) return { status: "superseded", processed };
      await this.profiles.setRecompute(organizationId, profile._id, profileVersion, { processed });
      if (page.length < BATCH) break;
    }
    await this.profiles.setRecompute(organizationId, profile._id, profileVersion, {
      status: "completed",
      processed,
      total: processed,
      finishedAt: new Date(),
    });
    this.logger.log({ organizationId, profileVersion, processed }, "Scores recomputed");
    return { status: "completed", processed };
  }

  async markRecomputeFailed(
    organizationId: string,
    profileVersion: number,
    message: string,
  ): Promise<void> {
    const profile = await this.profiles.getOrCreateDefault(organizationId);
    await this.profiles.setRecompute(organizationId, profile._id, profileVersion, {
      status: "failed",
      error: message.slice(0, 300),
      finishedAt: new Date(),
    });
  }

  /**
   * Maintenance (any organization): scores computed more than a day ago are refreshed, so the
   * freshness signal follows the calendar. Bounded per run.
   */
  async refreshStaleScores(now: Date = new Date(), limit = 500): Promise<number> {
    const due = await this.businesses.findScoresOlderThan(new Date(now.getTime() - DAY_MS), limit);
    const byOrg = new Map<string, string[]>();
    for (const d of due)
      byOrg.set(d.organizationId, [...(byOrg.get(d.organizationId) ?? []), d._id.toHexString()]);
    let refreshed = 0;
    for (const [organizationId, ids] of byOrg)
      refreshed += await this.scoreBusinesses(organizationId, ids);
    return refreshed;
  }
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values)
    if (v && !out.some((o) => normalizeKey(o) === normalizeKey(v))) out.push(v);
  return out;
}
