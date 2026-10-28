import { Injectable } from "@nestjs/common";
import { ObjectId, type Document, type WithId } from "@leadforge/db-mongo";
import {
  ACTIVITY_OUTCOMES,
  CONTACT_ACTIVITY_TYPES,
  CRM_LIMITS,
  type Activity,
  type ActivityListQuery,
  type ActivityOutcome,
  type CreateActivityRequest,
  type CreateActivityResponse,
  type CreateOutreachRequest,
  type LoggableActivityType,
  type LogOutreachAttemptRequest,
  type LogOutreachAttemptResponse,
  type OutreachChannel,
  type OutreachListQuery,
  type OutreachRecord,
  type OutreachStatus,
  type UpdateActivityRequest,
  type UpdateOutreachRequest,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { normalizeEmail, parsePhone } from "../normalization/index.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import {
  isManager,
  worksAssignedOnly,
  type ActivityDocument,
  type CrmActor,
  type LeadDocument,
  type OutreachDocument,
} from "./crm.types.js";
import { toActivityView, toOutreachView } from "./crm-view.js";
import { versionConflict } from "./pipeline.service.js";
import { ActivityRepository } from "./repositories/activity.repository.js";
import { LeadRepository } from "./repositories/lead.repository.js";
import { LeadListItemRepository, LeadListRepository } from "./repositories/lead-list.repository.js";
import { OutreachRepository } from "./repositories/outreach.repository.js";

/** Activities logged by people (stage changes and assignments are written by the system). */
const LOGGABLE: readonly string[] = ["note", "call", "whatsapp", "email", "meeting"];
const OUTREACH_CHANNELS: readonly string[] = ["call", "whatsapp", "email"];
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_WRITE_ATTEMPTS = 3;

/** Outreach status after an outbound attempt with this outcome. */
function statusAfterAttempt(
  current: OutreachStatus,
  outcome: ActivityOutcome | null,
): OutreachStatus {
  if (
    outcome === "replied" ||
    outcome === "interested" ||
    outcome === "callback_requested" ||
    outcome === "meeting_booked"
  )
    return "replied";
  if (outcome === "not_interested") return "not_interested";
  if (current === "planned") return "in_progress";
  return current;
}

/**
 * Activities (notes, calls, WhatsApp messages, emails, meetings) and outreach records (one per
 * business and channel, counting attempts). Suppression is enforced: contact with a suppressed
 * business, or to a suppressed phone number or address, is refused with CONTACT_SUPPRESSED
 * unless the caller sends `suppressionOverride.reason`, which is kept on the record and audited
 * (`contact.suppression_overridden`). Notes never contact anyone and are always allowed.
 * Sales Representatives log only on businesses whose lead is assigned to them.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly activities: ActivityRepository,
    private readonly outreach: OutreachRepository,
    private readonly leads: LeadRepository,
    private readonly lists: LeadListRepository,
    private readonly listItems: LeadListItemRepository,
    private readonly businesses: BusinessesService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Shared checks
  // -------------------------------------------------------------------------

  private async assertCanWorkBusiness(
    organizationId: string,
    actor: CrmActor,
    businessId: ObjectId,
  ): Promise<WithId<LeadDocument> | null> {
    const lead = await this.leads.findByBusiness(organizationId, businessId);
    if (worksAssignedOnly(actor) && lead?.assignedToUserId !== actor.userId) {
      throw AppError.forbidden("You can only log activity on leads assigned to you");
    }
    return lead;
  }

  /** The normalized phone (E.164) or address for the channel, or a 400. */
  private async normalizeTarget(
    organizationId: string,
    channel: string,
    raw: string | undefined,
  ): Promise<string | null> {
    if (raw === undefined) return null;
    if (channel === "email") {
      const parsed = normalizeEmail(raw);
      if (!parsed.ok) throw AppError.validation([{ path: "target", message: parsed.reason }]);
      return parsed.address;
    }
    if (channel === "call" || channel === "whatsapp") {
      const { country } = await this.businesses.stateContext(organizationId);
      const parsed = parsePhone(raw, country);
      if (!parsed.ok) throw AppError.validation([{ path: "target", message: parsed.reason }]);
      return parsed.phone.e164;
    }
    throw AppError.validation([
      { path: "target", message: "Only calls, WhatsApp messages and emails have a target" },
    ]);
  }

  /**
   * CONTACT_SUPPRESSED (409) when the business is suppressed or the target is on the suppression
   * list, unless an override reason is given; returns the reason to store (null when not needed).
   */
  private async checkSuppression(
    organizationId: string,
    actor: CrmActor,
    business: WithId<BusinessDocument>,
    channel: string,
    target: string | null,
    override: { reason: string } | undefined,
    auditCtx: AuditContext,
  ): Promise<{ reason: string } | null> {
    const targetSuppressed = target
      ? await this.businesses.isContactSuppressed(
          organizationId,
          channel === "email" ? { email: target } : { phone: target },
        )
      : false;
    if (!business.flags.suppressed && !targetSuppressed) return null;
    const what = business.flags.suppressed
      ? "This business is suppressed"
      : "This contact is on the suppression list";
    if (!override) {
      throw new AppError(
        "CONTACT_SUPPRESSED",
        `${what}. Do not contact it; to log contact anyway (for example it contacted you), send suppressionOverride.reason.`,
        [
          {
            path: "suppressionOverride.reason",
            message: "Required for a suppressed business or contact",
          },
        ],
      );
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "contact.suppression_overridden",
        resourceType: "business",
        resourceId: business._id.toHexString(),
        after: {
          channel,
          target,
          reason: override.reason,
          businessSuppressed: business.flags.suppressed,
          targetSuppressed,
        },
      },
      auditCtx,
    );
    return { reason: override.reason };
  }

  private async views(organizationId: string, docs: ActivityDocument[]): Promise<Activity[]> {
    const cards = await this.businesses.leadCards(
      organizationId,
      [...new Set(docs.map((d) => d.businessId.toHexString()))].map((h) => new ObjectId(h)),
    );
    return docs.map((d) => toActivityView(d, cards.get(d.businessId.toHexString())));
  }

  private async outreachViews(
    organizationId: string,
    docs: OutreachDocument[],
  ): Promise<OutreachRecord[]> {
    const cards = await this.businesses.leadCards(
      organizationId,
      [...new Set(docs.map((d) => d.businessId.toHexString()))].map((h) => new ObjectId(h)),
    );
    return docs.map((d) => toOutreachView(d, cards.get(d.businessId.toHexString())));
  }

  private async listFilter(organizationId: string, listId: string): Promise<Document> {
    const list = await this.lists.findById(organizationId, listId);
    if (!list) throw AppError.notFound("List");
    return {
      businessId: {
        $in: await this.listItems.businessIds(organizationId, list._id, CRM_LIMITS.listMaxItems),
      },
    };
  }

  private async businessFilter(organizationId: string, businessId: string): Promise<Document> {
    const business = await this.businesses.findAny(organizationId, new ObjectId(businessId));
    if (!business) throw AppError.notFound("Business");
    return { businessId: business._id };
  }

  // -------------------------------------------------------------------------
  // Activities
  // -------------------------------------------------------------------------

  async list(
    organizationId: string,
    query: ActivityListQuery,
  ): Promise<{ items: Activity[]; nextCursor: string | null }> {
    const and: Document[] = [];
    if (query.type?.length) and.push({ type: { $in: query.type } });
    if (query.userId) and.push({ createdByUserId: query.userId });
    if (query.businessId) and.push(await this.businessFilter(organizationId, query.businessId));
    if (query.leadId) {
      const lead = await this.leads.findById(organizationId, query.leadId);
      if (!lead) throw AppError.notFound("Lead");
      and.push({ leadId: lead._id });
    }
    if (query.listId) and.push(await this.listFilter(organizationId, query.listId));
    if (query.from || query.to) {
      and.push({
        occurredAt: {
          ...(query.from ? { $gte: new Date(query.from) } : {}),
          ...(query.to ? { $lte: new Date(query.to) } : {}),
        },
      });
    }
    const page = await withCursor(() =>
      this.activities.page(
        organizationId,
        and.length === 0 ? {} : and.length === 1 ? and[0]! : { $and: and },
        {
          pageSize: query.pageSize,
          cursor: query.cursor ?? null,
        },
      ),
    );
    return { items: await this.views(organizationId, page.items), nextCursor: page.nextCursor };
  }

  async get(organizationId: string, id: string): Promise<Activity> {
    const doc = await this.activities.findById(organizationId, id);
    if (!doc) throw AppError.notFound("Activity");
    return (await this.views(organizationId, [doc]))[0]!;
  }

  private validateOutcome(
    type: LoggableActivityType,
    outcome: ActivityOutcome | null | undefined,
  ): void {
    if (outcome === undefined || outcome === null) return;
    if (!ACTIVITY_OUTCOMES[type].includes(outcome)) {
      throw AppError.validation([
        {
          path: "outcome",
          message:
            type === "note"
              ? "Notes have no outcome"
              : `"${outcome}" is not an outcome of a ${type}`,
        },
      ]);
    }
  }

  private occurredAt(value: string | undefined): Date {
    const at = value ? new Date(value) : new Date();
    if (at.getTime() > Date.now() + FUTURE_TOLERANCE_MS)
      throw AppError.validation([
        { path: "occurredAt", message: "Activities cannot be logged in the future" },
      ]);
    return at;
  }

  async create(
    organizationId: string,
    actor: CrmActor,
    req: CreateActivityRequest,
    auditCtx: AuditContext,
  ): Promise<CreateActivityResponse> {
    const business = await this.businesses.requireBusiness(organizationId, req.businessId);
    const lead = await this.assertCanWorkBusiness(organizationId, actor, business._id);
    if (req.type === "note" && !req.body)
      throw AppError.validation([{ path: "body", message: "A note needs text" }]);
    this.validateOutcome(req.type, req.outcome);
    if (req.direction && !OUTREACH_CHANNELS.includes(req.type)) {
      throw AppError.validation([
        { path: "direction", message: "Only calls, WhatsApp messages and emails have a direction" },
      ]);
    }
    const occurredAt = this.occurredAt(req.occurredAt);
    const target = await this.normalizeTarget(organizationId, req.type, req.target);
    const override = (CONTACT_ACTIVITY_TYPES as readonly string[]).includes(req.type)
      ? await this.checkSuppression(
          organizationId,
          actor,
          business,
          req.type,
          target,
          req.suppressionOverride,
          auditCtx,
        )
      : null;

    const now = new Date();
    const doc: ActivityDocument = {
      _id: new ObjectId(),
      organizationId,
      businessId: business._id,
      leadId: lead?._id ?? null,
      outreachId: null,
      type: req.type,
      direction: OUTREACH_CHANNELS.includes(req.type) ? (req.direction ?? "outbound") : null,
      outcome: req.outcome ?? null,
      body: req.body || null,
      target,
      occurredAt,
      createdByUserId: actor.userId,
      createdAt: now,
      editedAt: null,
      stageChange: null,
      assignment: null,
      suppressionOverride: override,
      bulkOperationId: null,
    };

    let outreach: WithId<OutreachDocument> | null = null;
    if (OUTREACH_CHANNELS.includes(req.type)) {
      outreach = await this.recordOnOutreach(organizationId, actor, doc, lead, override);
      if (outreach) doc.outreachId = outreach._id;
    }
    await this.activities.insert(organizationId, doc);
    if (lead) await this.leads.touchActivity(organizationId, business._id, occurredAt);
    const [view] = await this.views(organizationId, [doc]);
    return {
      activity: view!,
      outreach: outreach ? (await this.outreachViews(organizationId, [outreach]))[0]! : null,
    };
  }

  /**
   * Outbound call, WhatsApp or email: counts an attempt on the business's outreach record for
   * the channel (created on first contact). Inbound: marks an open record as replied.
   */
  private async recordOnOutreach(
    organizationId: string,
    actor: CrmActor,
    activity: ActivityDocument,
    lead: LeadDocument | null,
    override: { reason: string } | null,
  ): Promise<WithId<OutreachDocument> | null> {
    const channel = activity.type as OutreachChannel;
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const existing = await this.outreach.findFor(organizationId, activity.businessId, channel);
      if (activity.direction === "inbound") {
        if (!existing || !["planned", "in_progress", "no_response"].includes(existing.status))
          return existing;
        const updated = await this.outreach.updateIfVersion(
          organizationId,
          existing._id,
          existing.version,
          { $set: { status: "replied", updatedAt: new Date() } },
        );
        if (updated) return updated;
        continue;
      }
      const now = new Date();
      if (!existing) {
        const doc: OutreachDocument = {
          _id: new ObjectId(),
          organizationId,
          businessId: activity.businessId,
          leadId: lead?._id ?? null,
          channel,
          target: activity.target,
          status: statusAfterAttempt("planned", activity.outcome),
          attempts: 1,
          lastAttemptAt: activity.occurredAt,
          lastOutcome: activity.outcome,
          nextAttemptAt: null,
          ownerUserId: actor.userId,
          suppressionOverride: override
            ? { reason: override.reason, byUserId: actor.userId, at: now }
            : null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        if (await this.outreach.insert(organizationId, doc)) return doc as WithId<OutreachDocument>;
        continue;
      }
      const updated = await this.outreach.updateIfVersion(
        organizationId,
        existing._id,
        existing.version,
        {
          $set: {
            status: statusAfterAttempt(existing.status, activity.outcome),
            lastAttemptAt:
              !existing.lastAttemptAt || existing.lastAttemptAt < activity.occurredAt
                ? activity.occurredAt
                : existing.lastAttemptAt,
            lastOutcome: activity.outcome ?? existing.lastOutcome,
            target: activity.target ?? existing.target,
            leadId: existing.leadId ?? lead?._id ?? null,
            updatedAt: now,
            ...(override
              ? {
                  suppressionOverride: { reason: override.reason, byUserId: actor.userId, at: now },
                }
              : {}),
          },
          $inc: { attempts: 1 },
        },
      );
      if (updated) return updated;
    }
    throw AppError.conflict("The outreach record kept changing; try again");
  }

  private async requireEditable(
    organizationId: string,
    actor: CrmActor,
    id: string,
  ): Promise<WithId<ActivityDocument>> {
    const doc = await this.activities.findById(organizationId, id);
    if (!doc) throw AppError.notFound("Activity");
    if (!LOGGABLE.includes(doc.type))
      throw AppError.conflict(
        "Stage changes and assignments are written by the system and cannot be edited",
      );
    if (doc.createdByUserId !== actor.userId && !isManager(actor))
      throw AppError.forbidden(
        "Only the author or an owner or administrator can change this activity",
      );
    return doc;
  }

  async update(
    organizationId: string,
    actor: CrmActor,
    id: string,
    req: UpdateActivityRequest,
    auditCtx: AuditContext,
  ): Promise<Activity> {
    const doc = await this.requireEditable(organizationId, actor, id);
    this.validateOutcome(doc.type as LoggableActivityType, req.outcome);
    if (doc.type === "note" && req.body === null)
      throw AppError.validation([{ path: "body", message: "A note needs text" }]);
    const set: Partial<ActivityDocument> = { editedAt: new Date() };
    if (req.body !== undefined) set.body = req.body || null;
    if (req.outcome !== undefined) set.outcome = req.outcome;
    if (req.occurredAt !== undefined) set.occurredAt = this.occurredAt(req.occurredAt);
    const updated = await this.activities.update(organizationId, doc._id, set);
    if (!updated) throw AppError.notFound("Activity");
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "activity.updated",
        resourceType: "activity",
        resourceId: doc._id.toHexString(),
        before: { body: doc.body, outcome: doc.outcome, occurredAt: doc.occurredAt },
        after: { body: updated.body, outcome: updated.outcome, occurredAt: updated.occurredAt },
      },
      auditCtx,
    );
    return (await this.views(organizationId, [updated]))[0]!;
  }

  async remove(
    organizationId: string,
    actor: CrmActor,
    id: string,
    auditCtx: AuditContext,
  ): Promise<{ deleted: true }> {
    const doc = await this.requireEditable(organizationId, actor, id);
    await this.activities.remove(organizationId, doc._id);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "activity.deleted",
        resourceType: "activity",
        resourceId: doc._id.toHexString(),
        before: {
          type: doc.type,
          businessId: doc.businessId.toHexString(),
          body: doc.body,
          outcome: doc.outcome,
          occurredAt: doc.occurredAt,
          authorUserId: doc.createdByUserId,
        },
      },
      auditCtx,
    );
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Outreach records
  // -------------------------------------------------------------------------

  async listOutreach(
    organizationId: string,
    query: OutreachListQuery,
  ): Promise<{ items: OutreachRecord[]; nextCursor: string | null }> {
    const and: Document[] = [];
    if (query.channel?.length) and.push({ channel: { $in: query.channel } });
    if (query.status?.length) and.push({ status: { $in: query.status } });
    if (query.userId) and.push({ ownerUserId: query.userId });
    if (query.businessId) and.push(await this.businessFilter(organizationId, query.businessId));
    if (query.listId) and.push(await this.listFilter(organizationId, query.listId));
    if (query.from || query.to) {
      and.push({
        lastAttemptAt: {
          ...(query.from ? { $gte: new Date(query.from) } : {}),
          ...(query.to ? { $lte: new Date(query.to) } : {}),
        },
      });
    }
    const page = await withCursor(() =>
      this.outreach.page(
        organizationId,
        and.length === 0 ? {} : and.length === 1 ? and[0]! : { $and: and },
        {
          pageSize: query.pageSize,
          cursor: query.cursor ?? null,
        },
      ),
    );
    return {
      items: await this.outreachViews(organizationId, page.items),
      nextCursor: page.nextCursor,
    };
  }

  private async requireOutreach(
    organizationId: string,
    id: string,
  ): Promise<WithId<OutreachDocument>> {
    const doc = await this.outreach.findById(organizationId, id);
    if (!doc) throw AppError.notFound("Outreach record");
    return doc;
  }

  async getOutreach(organizationId: string, id: string): Promise<OutreachRecord> {
    return (
      await this.outreachViews(organizationId, [await this.requireOutreach(organizationId, id)])
    )[0]!;
  }

  /** Plans outreach on a channel; returns the existing record (created: false) when there is one. */
  async createOutreach(
    organizationId: string,
    actor: CrmActor,
    req: CreateOutreachRequest,
    auditCtx: AuditContext,
  ): Promise<{ outreach: OutreachRecord; created: boolean }> {
    const business = await this.businesses.requireBusiness(organizationId, req.businessId);
    const lead = await this.assertCanWorkBusiness(organizationId, actor, business._id);
    const existing = await this.outreach.findFor(organizationId, business._id, req.channel);
    if (existing)
      return {
        outreach: (await this.outreachViews(organizationId, [existing]))[0]!,
        created: false,
      };
    const target = await this.normalizeTarget(organizationId, req.channel, req.target);
    const override = await this.checkSuppression(
      organizationId,
      actor,
      business,
      req.channel,
      target,
      req.suppressionOverride,
      auditCtx,
    );
    const now = new Date();
    const doc: OutreachDocument = {
      _id: new ObjectId(),
      organizationId,
      businessId: business._id,
      leadId: lead?._id ?? null,
      channel: req.channel,
      target,
      status: "planned",
      attempts: 0,
      lastAttemptAt: null,
      lastOutcome: null,
      nextAttemptAt: req.nextAttemptAt ? new Date(req.nextAttemptAt) : null,
      ownerUserId: actor.userId,
      suppressionOverride: override
        ? { reason: override.reason, byUserId: actor.userId, at: now }
        : null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await this.outreach.insert(organizationId, doc))) {
      const winner = await this.outreach.findFor(organizationId, business._id, req.channel);
      if (!winner)
        throw AppError.conflict(
          "The outreach record changed while it was being created; try again",
        );
      return { outreach: (await this.outreachViews(organizationId, [winner]))[0]!, created: false };
    }
    return { outreach: (await this.outreachViews(organizationId, [doc]))[0]!, created: true };
  }

  async updateOutreach(
    organizationId: string,
    actor: CrmActor,
    id: string,
    req: UpdateOutreachRequest,
  ): Promise<OutreachRecord> {
    const doc = await this.requireOutreach(organizationId, id);
    await this.assertCanWorkBusiness(organizationId, actor, doc.businessId);
    if (req.version !== undefined && req.version !== doc.version)
      throw versionConflict("outreach record", doc.version);
    const set: Partial<OutreachDocument> = { updatedAt: new Date() };
    if (req.status !== undefined) set.status = req.status;
    if (req.nextAttemptAt !== undefined)
      set.nextAttemptAt = req.nextAttemptAt ? new Date(req.nextAttemptAt) : null;
    if (req.target !== undefined)
      set.target =
        req.target === null
          ? null
          : await this.normalizeTarget(organizationId, doc.channel, req.target);
    const updated = await this.outreach.updateIfVersion(organizationId, doc._id, doc.version, {
      $set: set,
    });
    if (!updated)
      throw versionConflict(
        "outreach record",
        (await this.outreach.findById(organizationId, doc._id))?.version ?? null,
      );
    return (await this.outreachViews(organizationId, [updated]))[0]!;
  }

  /** Logs one attempt on the record: an outbound activity of its channel (suppression applies). */
  async logAttempt(
    organizationId: string,
    actor: CrmActor,
    id: string,
    req: LogOutreachAttemptRequest,
    auditCtx: AuditContext,
  ): Promise<LogOutreachAttemptResponse> {
    const doc = await this.requireOutreach(organizationId, id);
    const result = await this.create(
      organizationId,
      actor,
      {
        businessId: doc.businessId.toHexString(),
        type: doc.channel,
        direction: "outbound",
        outcome: req.outcome,
        body: req.body,
        occurredAt: req.occurredAt,
        target: req.target ?? doc.target ?? undefined,
        suppressionOverride: req.suppressionOverride,
      },
      auditCtx,
    );
    return {
      activity: result.activity,
      outreach: result.outreach ?? (await this.getOutreach(organizationId, id)),
    };
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  countByTypeAndUser(organizationId: string, from: Date | null) {
    return this.activities.countByTypeAndUser(organizationId, from, [...LOGGABLE]);
  }

  stageEntries(organizationId: string, from: Date | null) {
    return this.activities.stageEntries(organizationId, from);
  }

  async recent(organizationId: string, limit: number): Promise<Activity[]> {
    const page = await this.activities.page(organizationId, {}, { pageSize: limit });
    return this.views(organizationId, page.items);
  }

  countLoggedSince(organizationId: string, since: Date): Promise<number> {
    return this.activities.countMatching(organizationId, {
      type: { $in: [...LOGGABLE] },
      occurredAt: { $gte: since },
    });
  }
}
