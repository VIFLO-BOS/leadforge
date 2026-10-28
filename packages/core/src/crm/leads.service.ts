import { Injectable } from "@nestjs/common";
import { ObjectId, type Document, type WithId } from "@leadforge/db-mongo";
import {
  CRM_LIMITS,
  roleHasPermission,
  type AssignLeadRequest,
  type BulkItemOutcome,
  type CreateLeadRequest,
  type Lead,
  type LeadListQuery,
  type MoveLeadRequest,
  type PipelineBoard,
  type PipelineBoardQuery,
  type UpdateLeadRequest,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import {
  can,
  worksAssignedOnly,
  type ActivityDocument,
  type CrmActor,
  type LeadDocument,
  type PipelineStageDoc,
} from "./crm.types.js";
import { toConfigView, toLeadView, toStageView } from "./crm-view.js";
import { activeStages, entryStage, neighbourStage, sortedStages } from "./pipeline-rules.js";
import { PipelineService, versionConflict } from "./pipeline.service.js";
import { ActivityRepository } from "./repositories/activity.repository.js";
import { LeadRepository } from "./repositories/lead.repository.js";
import { LeadListItemRepository, LeadListRepository } from "./repositories/lead-list.repository.js";

const SORT_FIELDS = {
  updatedAt: "updatedAt",
  createdAt: "createdAt",
  nextActionAt: "nextActionAt",
} as const;
const MAX_MOVE_ATTEMPTS = 3;

export interface ItemResult {
  outcome: BulkItemOutcome;
  message: string | null;
}

function systemActivity(
  organizationId: string,
  lead: Pick<LeadDocument, "_id" | "businessId">,
  userId: string,
  at: Date,
  extra: Pick<ActivityDocument, "type" | "stageChange" | "assignment">,
  bulkOperationId: ObjectId | null = null,
): ActivityDocument {
  return {
    _id: new ObjectId(),
    organizationId,
    businessId: lead.businessId,
    leadId: lead._id,
    outreachId: null,
    direction: null,
    outcome: null,
    body: null,
    target: null,
    occurredAt: at,
    createdByUserId: userId,
    createdAt: at,
    editedAt: null,
    suppressionOverride: null,
    bulkOperationId,
    ...extra,
  };
}

/**
 * Leads: the pipeline state of a business (one per business per organization), kept apart
 * from the business's facts and score. Stage moves and edits are optimistic (version checked),
 * so two people, or two quick key presses, never overwrite each other silently. Every stage
 * change and assignment is written as an activity and audited.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly pipeline: PipelineService,
    private readonly businesses: BusinessesService,
    private readonly organizations: OrganizationsService,
    private readonly activities: ActivityRepository,
    private readonly lists: LeadListRepository,
    private readonly listItems: LeadListItemRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async requireLead(organizationId: string, id: string): Promise<WithId<LeadDocument>> {
    const lead = await this.leads.findById(organizationId, id);
    if (!lead) throw AppError.notFound("Lead");
    return lead;
  }

  async views(
    organizationId: string,
    docs: LeadDocument[],
    stages?: PipelineStageDoc[],
  ): Promise<Lead[]> {
    const config = stages ?? (await this.pipeline.config(organizationId)).stages;
    const cards = await this.businesses.leadCards(
      organizationId,
      docs.map((d) => d.businessId),
    );
    return docs.map((d) => toLeadView(d, config, cards.get(d.businessId.toHexString())));
  }

  async get(organizationId: string, id: string): Promise<Lead> {
    const [view] = await this.views(organizationId, [await this.requireLead(organizationId, id)]);
    return view!;
  }

  /** Business ids on a list (404 for another organization's list). */
  private async listBusinessIds(organizationId: string, listId: string): Promise<ObjectId[]> {
    const list = await this.lists.findById(organizationId, listId);
    if (!list) throw AppError.notFound("List");
    return this.listItems.businessIds(organizationId, list._id, CRM_LIMITS.listMaxItems);
  }

  private async filterFor(
    organizationId: string,
    query: Partial<LeadListQuery>,
  ): Promise<Document> {
    const and: Document[] = [];
    if (query.stage?.length) and.push({ stageKey: { $in: query.stage } });
    if (query.assignedToUserId) and.push({ assignedToUserId: query.assignedToUserId });
    else if (query.unassigned) and.push({ assignedToUserId: null });
    if (query.priority?.length) and.push({ priority: { $in: query.priority } });
    if (query.businessId) {
      const business = await this.businesses.findAny(
        organizationId,
        new ObjectId(query.businessId),
      );
      if (!business) throw AppError.notFound("Business");
      and.push({ businessId: business._id });
    }
    if (query.listId)
      and.push({ businessId: { $in: await this.listBusinessIds(organizationId, query.listId) } });
    return and.length === 0 ? {} : and.length === 1 ? and[0]! : { $and: and };
  }

  async list(
    organizationId: string,
    query: LeadListQuery,
  ): Promise<{ items: Lead[]; nextCursor: string | null; total?: number }> {
    const filter = await this.filterFor(organizationId, query);
    const sort = query.sort ?? { field: "updatedAt" as const, direction: "desc" as const };
    const page = await withCursor(() =>
      this.leads.page(organizationId, filter, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
        sortField: SORT_FIELDS[sort.field],
        direction: sort.direction === "asc" ? 1 : -1,
      }),
    );
    const items = await this.views(organizationId, page.items);
    return {
      items,
      nextCursor: page.nextCursor,
      ...(query.cursor ? {} : { total: await this.leads.countMatching(organizationId, filter) }),
    };
  }

  /** Every active stage (and archived ones that hold leads, when asked) with its count and first leads. */
  async board(organizationId: string, query: PipelineBoardQuery): Promise<PipelineBoard> {
    const config = await this.pipeline.config(organizationId);
    // Lists are readable by every role (docs/SECURITY_AND_DATA_COLLECTION.md section 2), so the
    // only check on `listId` is the organization's: another organization's list is 404.
    const base = await this.filterFor(organizationId, {
      assignedToUserId: query.assignedToUserId,
      unassigned: query.unassigned,
      listId: query.listId,
    });
    const counts = await this.leads.countByStage(organizationId, base);
    const stages = sortedStages(config.stages).filter(
      (s) => !s.archived || (query.includeArchived && (counts.get(s.key) ?? 0) > 0),
    );
    const pages = await Promise.all(
      stages.map((s) =>
        this.leads.page(
          organizationId,
          Object.keys(base).length ? { $and: [base, { stageKey: s.key }] } : { stageKey: s.key },
          {
            pageSize: query.perStage,
            sortField: "updatedAt",
            direction: -1,
          },
        ),
      ),
    );
    const views = await this.views(
      organizationId,
      pages.flatMap((p) => p.items),
      config.stages,
    );
    const byId = new Map(views.map((v) => [v.id, v]));
    return {
      config: toConfigView(config),
      columns: stages.map((s, i) => ({
        stage: toStageView(s),
        count: counts.get(s.key) ?? 0,
        leads: pages[i]!.items.map((d) => byId.get(d._id.toHexString())!),
        nextCursor: pages[i]!.nextCursor,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /** INVALID_ASSIGNEE unless the user is an active member whose role can work leads. */
  async assertAssignable(organizationId: string, userId: string): Promise<void> {
    const member = await this.organizations.isActiveMember(organizationId, userId);
    if (!member.active || !member.role) {
      throw new AppError(
        "INVALID_ASSIGNEE",
        "The assignee is not an active member of this organization",
        [{ path: "assignedToUserId", message: userId }],
      );
    }
    if (!roleHasPermission(member.role, "pipeline:write")) {
      throw new AppError(
        "INVALID_ASSIGNEE",
        "Leads can only be assigned to owners, administrators and sales representatives",
        [{ path: "assignedToUserId", message: userId }],
      );
    }
  }

  /** Sales Representatives may work only leads assigned to them. */
  assertCanWork(actor: CrmActor, lead: LeadDocument): void {
    if (worksAssignedOnly(actor) && lead.assignedToUserId !== actor.userId) {
      throw AppError.forbidden("You can only work leads assigned to you");
    }
  }

  private async activeStage(
    organizationId: string,
    key: string,
    path = "stageKey",
  ): Promise<{ stage: PipelineStageDoc; stages: PipelineStageDoc[] }> {
    const config = await this.pipeline.config(organizationId);
    const stage = config.stages.find((s) => s.key === key);
    if (!stage) throw AppError.validation([{ path, message: `Unknown stage "${key}"` }]);
    if (stage.archived)
      throw AppError.validation([{ path, message: `The stage "${stage.label}" is archived` }]);
    return { stage, stages: config.stages };
  }

  /**
   * Adds a business to the pipeline. Returns the existing lead (created: false) when the
   * business already has one. Sales Representatives own the leads they add.
   */
  async create(
    organizationId: string,
    actor: CrmActor,
    req: CreateLeadRequest,
    auditCtx: AuditContext,
  ): Promise<{ lead: Lead; created: boolean }> {
    const business = await this.businesses.requireBusiness(organizationId, req.businessId);
    const existing = await this.leads.findByBusiness(organizationId, business._id);
    if (existing)
      return { lead: (await this.views(organizationId, [existing]))[0]!, created: false };
    if (business.flags.suppressed)
      throw AppError.conflict("This business is suppressed and cannot be added to the pipeline");

    if (req.stageKey !== undefined && !can(actor, "pipeline:write"))
      throw AppError.forbidden("Choosing a stage needs permission to change pipeline stages");
    let assignee: string | null;
    if (can(actor, "leads:assign")) assignee = req.assignedToUserId ?? null;
    else {
      if (req.assignedToUserId !== undefined && req.assignedToUserId !== actor.userId)
        throw AppError.forbidden("You can only add leads assigned to yourself");
      assignee = actor.userId;
    }
    if (assignee) await this.assertAssignable(organizationId, assignee);
    const config = await this.pipeline.config(organizationId);
    const stage = req.stageKey
      ? (await this.activeStage(organizationId, req.stageKey)).stage
      : entryStage(config.stages);

    const now = new Date();
    const doc: LeadDocument = {
      _id: new ObjectId(),
      organizationId,
      businessId: business._id,
      stageKey: stage.key,
      stageEnteredAt: now,
      assignedToUserId: assignee,
      assignedAt: assignee ? now : null,
      priority: req.priority ?? null,
      nextActionAt: null,
      lastActivityAt: null,
      lostReason: null,
      wonValueMinor: null,
      currency: null,
      closedAt: stage.kind === "open" ? null : now,
      closedKind: stage.kind === "open" ? null : stage.kind,
      version: 1,
      createdByUserId: actor.userId,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await this.leads.insert(organizationId, doc))) {
      const winner = await this.leads.findByBusiness(organizationId, business._id);
      if (!winner)
        throw AppError.conflict("The lead changed while it was being created; try again");
      return { lead: (await this.views(organizationId, [winner]))[0]!, created: false };
    }
    const activities = [
      systemActivity(organizationId, doc, actor.userId, now, {
        type: "stage_change",
        stageChange: { fromStageKey: null, toStageKey: stage.key },
        assignment: null,
      }),
    ];
    if (assignee)
      activities.push(
        systemActivity(organizationId, doc, actor.userId, now, {
          type: "assignment",
          stageChange: null,
          assignment: { fromUserId: null, toUserId: assignee },
        }),
      );
    await this.activities.insertMany(organizationId, activities);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "lead.created",
        resourceType: "lead",
        resourceId: doc._id.toHexString(),
        after: {
          businessId: business._id.toHexString(),
          stageKey: stage.key,
          assignedToUserId: assignee,
        },
      },
      auditCtx,
    );
    const [view] = await this.views(organizationId, [doc], config.stages);
    if (assignee) {
      await this.notifications.leadAssigned({
        organizationId,
        assigneeUserId: assignee,
        assignedByUserId: actor.userId,
        count: 1,
        businessName: view!.business?.name ?? null,
        dedupeKey: `lead-assigned:${doc._id.toHexString()}:v${doc.version}`,
      });
    }
    return { lead: view!, created: true };
  }

  /**
   * One atomic stage change. With `version`, a stale lead is refused (VERSION_CONFLICT);
   * without it the move applies to the current state (a direction move is computed from the
   * stage the lead is in when the write lands, retried on a concurrent change).
   */
  async move(
    organizationId: string,
    actor: CrmActor,
    id: string,
    req: MoveLeadRequest,
    auditCtx: AuditContext,
  ): Promise<Lead> {
    for (let attempt = 1; ; attempt++) {
      const lead = await this.requireLead(organizationId, id);
      this.assertCanWork(actor, lead);
      if (req.version !== undefined && req.version !== lead.version)
        throw versionConflict("lead", lead.version);
      const config = await this.pipeline.config(organizationId);
      let target: PipelineStageDoc;
      if (req.stageKey) target = (await this.activeStage(organizationId, req.stageKey)).stage;
      else {
        const next = neighbourStage(config.stages, lead.stageKey, req.direction!);
        if (!next)
          throw AppError.validation([
            {
              path: "direction",
              message:
                req.direction === "next"
                  ? "The lead is already in the last stage"
                  : "The lead is already in the first stage",
            },
          ]);
        target = next;
      }
      if (target.key === lead.stageKey)
        return (await this.views(organizationId, [lead], config.stages))[0]!;

      const now = new Date();
      const set: Partial<LeadDocument> = {
        stageKey: target.key,
        stageEnteredAt: now,
        updatedAt: now,
        closedAt: target.kind === "open" ? null : now,
        closedKind: target.kind === "open" ? null : target.kind,
        ...(target.kind === "lost" && req.lostReason !== undefined
          ? { lostReason: req.lostReason || null }
          : {}),
        ...(target.kind === "won" && req.wonValueMinor !== undefined
          ? { wonValueMinor: req.wonValueMinor }
          : {}),
        ...(target.kind === "won" && req.currency !== undefined ? { currency: req.currency } : {}),
      };
      const updated = await this.leads.updateIfVersion(organizationId, lead._id, lead.version, set);
      if (!updated) {
        if (req.version !== undefined || attempt >= MAX_MOVE_ATTEMPTS) {
          const fresh = await this.leads.findById(organizationId, lead._id);
          if (!fresh) throw AppError.notFound("Lead");
          throw versionConflict("lead", fresh.version);
        }
        continue;
      }
      await this.activities.insert(
        organizationId,
        systemActivity(organizationId, updated, actor.userId, now, {
          type: "stage_change",
          stageChange: { fromStageKey: lead.stageKey, toStageKey: target.key },
          assignment: null,
        }),
      );
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorType: "user",
          action: "lead.stage_changed",
          resourceType: "lead",
          resourceId: updated._id.toHexString(),
          before: { stageKey: lead.stageKey, version: lead.version },
          after: { stageKey: target.key, version: updated.version },
        },
        auditCtx,
      );
      return (await this.views(organizationId, [updated], config.stages))[0]!;
    }
  }

  async update(
    organizationId: string,
    actor: CrmActor,
    id: string,
    req: UpdateLeadRequest,
    auditCtx: AuditContext,
  ): Promise<Lead> {
    const lead = await this.requireLead(organizationId, id);
    this.assertCanWork(actor, lead);
    if (req.version !== undefined && req.version !== lead.version)
      throw versionConflict("lead", lead.version);
    const set: Partial<LeadDocument> = { updatedAt: new Date() };
    if (req.priority !== undefined) set.priority = req.priority;
    if (req.nextActionAt !== undefined)
      set.nextActionAt = req.nextActionAt ? new Date(req.nextActionAt) : null;
    if (req.lostReason !== undefined) set.lostReason = req.lostReason || null;
    if (req.wonValueMinor !== undefined) set.wonValueMinor = req.wonValueMinor;
    if (req.currency !== undefined) set.currency = req.currency;
    const updated = await this.leads.updateIfVersion(organizationId, lead._id, lead.version, set);
    if (!updated)
      throw versionConflict(
        "lead",
        (await this.leads.findById(organizationId, lead._id))?.version ?? null,
      );
    const changed = Object.keys(set).filter((k) => k !== "updatedAt");
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "lead.updated",
        resourceType: "lead",
        resourceId: updated._id.toHexString(),
        before: Object.fromEntries(
          changed.map((k) => [k, (lead as unknown as Record<string, unknown>)[k] ?? null]),
        ),
        after: Object.fromEntries(
          changed.map((k) => [k, (updated as unknown as Record<string, unknown>)[k] ?? null]),
        ),
      },
      auditCtx,
    );
    return (await this.views(organizationId, [updated]))[0]!;
  }

  async assign(
    organizationId: string,
    actor: CrmActor,
    id: string,
    req: AssignLeadRequest,
    auditCtx: AuditContext,
  ): Promise<Lead> {
    const lead = await this.requireLead(organizationId, id);
    if (req.version !== undefined && req.version !== lead.version)
      throw versionConflict("lead", lead.version);
    if (req.assignedToUserId) await this.assertAssignable(organizationId, req.assignedToUserId);
    if (lead.assignedToUserId === req.assignedToUserId)
      return (await this.views(organizationId, [lead]))[0]!;
    const business = await this.businesses.findAny(organizationId, lead.businessId);
    if (req.assignedToUserId && business?.flags.suppressed)
      throw AppError.conflict("This business is suppressed; it cannot be assigned for contact");
    const now = new Date();
    const updated = await this.leads.updateIfVersion(organizationId, lead._id, lead.version, {
      assignedToUserId: req.assignedToUserId,
      assignedAt: req.assignedToUserId ? now : null,
      updatedAt: now,
    });
    if (!updated)
      throw versionConflict(
        "lead",
        (await this.leads.findById(organizationId, lead._id))?.version ?? null,
      );
    await this.activities.insert(
      organizationId,
      systemActivity(organizationId, updated, actor.userId, now, {
        type: "assignment",
        stageChange: null,
        assignment: { fromUserId: lead.assignedToUserId, toUserId: req.assignedToUserId },
      }),
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "lead.assigned",
        resourceType: "lead",
        resourceId: updated._id.toHexString(),
        before: { assignedToUserId: lead.assignedToUserId },
        after: { assignedToUserId: req.assignedToUserId },
      },
      auditCtx,
    );
    const [view] = await this.views(organizationId, [updated]);
    if (req.assignedToUserId) {
      await this.notifications.leadAssigned({
        organizationId,
        assigneeUserId: req.assignedToUserId,
        assignedByUserId: actor.userId,
        count: 1,
        businessName: view!.business?.name ?? null,
        dedupeKey: `lead-assigned:${updated._id.toHexString()}:v${updated.version}`,
      });
    }
    return view!;
  }

  // -------------------------------------------------------------------------
  // Bulk (preview and worker)
  // -------------------------------------------------------------------------

  /**
   * Assignment outcome per business. With `apply` it writes: existing leads are reassigned
   * (version checked, retried), businesses without a lead get one in the entry stage. A rerun
   * finds the state already applied and reports `unchanged`, so retries never duplicate.
   */
  async bulkAssign(
    organizationId: string,
    actor: CrmActor,
    assignee: string | null,
    ids: ObjectId[],
    opts: { apply: boolean; operationId?: ObjectId },
  ): Promise<Map<string, ItemResult>> {
    const out = new Map<string, ItemResult>();
    const [docs, leads, config] = await Promise.all([
      this.businesses.findLiveByIds(organizationId, ids),
      this.leads.findByBusinessIds(organizationId, ids),
      this.pipeline.config(organizationId),
    ]);
    const live = new Map(docs.map((d) => [d._id.toHexString(), d]));
    const leadBy = new Map(leads.map((l) => [l.businessId.toHexString(), l]));
    const entry = entryStage(config.stages);
    const activities: ActivityDocument[] = [];
    for (const id of ids) {
      const key = id.toHexString();
      const business = live.get(key);
      if (!business) {
        out.set(key, { outcome: "not_found", message: null });
        continue;
      }
      let lead = leadBy.get(key) ?? null;
      if (business.flags.suppressed && assignee) {
        out.set(key, {
          outcome: "suppressed",
          message: "Suppressed businesses are not assigned for contact",
        });
        continue;
      }
      if (!lead && !assignee) {
        out.set(key, { outcome: "unchanged", message: "Not in the pipeline" });
        continue;
      }
      if (lead && lead.assignedToUserId === assignee) {
        out.set(key, { outcome: "unchanged", message: null });
        continue;
      }
      if (!opts.apply) {
        out.set(key, { outcome: lead ? "assigned" : "created_and_assigned", message: null });
        continue;
      }
      const now = new Date();
      if (!lead) {
        const doc: LeadDocument = {
          _id: new ObjectId(),
          organizationId,
          businessId: business._id,
          stageKey: entry.key,
          stageEnteredAt: now,
          assignedToUserId: assignee,
          assignedAt: now,
          priority: null,
          nextActionAt: null,
          lastActivityAt: null,
          lostReason: null,
          wonValueMinor: null,
          currency: null,
          closedAt: null,
          closedKind: null,
          version: 1,
          createdByUserId: actor.userId,
          createdAt: now,
          updatedAt: now,
        };
        if (await this.leads.insert(organizationId, doc)) {
          activities.push(
            systemActivity(
              organizationId,
              doc,
              actor.userId,
              now,
              {
                type: "stage_change",
                stageChange: { fromStageKey: null, toStageKey: entry.key },
                assignment: null,
              },
              opts.operationId ?? null,
            ),
            systemActivity(
              organizationId,
              doc,
              actor.userId,
              now,
              {
                type: "assignment",
                stageChange: null,
                assignment: { fromUserId: null, toUserId: assignee },
              },
              opts.operationId ?? null,
            ),
          );
          out.set(key, { outcome: "created_and_assigned", message: null });
          continue;
        }
        lead = await this.leads.findByBusiness(organizationId, business._id);
        if (!lead || lead.assignedToUserId === assignee) {
          out.set(key, { outcome: "unchanged", message: null });
          continue;
        }
      }
      let result: ItemResult = { outcome: "failed", message: "The lead kept changing; try again" };
      for (let attempt = 0; attempt < MAX_MOVE_ATTEMPTS && lead; attempt++) {
        if (lead.assignedToUserId === assignee) {
          result = { outcome: "unchanged", message: null };
          break;
        }
        const updated = await this.leads.updateIfVersion(organizationId, lead._id, lead.version, {
          assignedToUserId: assignee,
          assignedAt: assignee ? now : null,
          updatedAt: now,
        });
        if (updated) {
          activities.push(
            systemActivity(
              organizationId,
              updated,
              actor.userId,
              now,
              {
                type: "assignment",
                stageChange: null,
                assignment: { fromUserId: lead.assignedToUserId, toUserId: assignee },
              },
              opts.operationId ?? null,
            ),
          );
          result = { outcome: "assigned", message: null };
          break;
        }
        lead = await this.leads.findById(organizationId, lead._id);
      }
      out.set(key, result);
    }
    await this.activities.insertMany(organizationId, activities);
    return out;
  }

  /** Stage move per business: existing leads only; Sales Representatives only their own. */
  async bulkMove(
    organizationId: string,
    actor: CrmActor,
    stageKey: string,
    ids: ObjectId[],
    opts: { apply: boolean; operationId?: ObjectId },
  ): Promise<Map<string, ItemResult>> {
    const out = new Map<string, ItemResult>();
    const { stage } = await this.activeStage(organizationId, stageKey);
    const leads = await this.leads.findByBusinessIds(organizationId, ids);
    const leadBy = new Map(leads.map((l) => [l.businessId.toHexString(), l]));
    const activities: ActivityDocument[] = [];
    for (const id of ids) {
      const key = id.toHexString();
      let lead = leadBy.get(key) ?? null;
      if (!lead) {
        out.set(key, { outcome: "not_in_pipeline", message: null });
        continue;
      }
      if (worksAssignedOnly(actor) && lead.assignedToUserId !== actor.userId) {
        out.set(key, { outcome: "not_assigned_to_you", message: null });
        continue;
      }
      if (lead.stageKey === stage.key) {
        out.set(key, { outcome: "unchanged", message: null });
        continue;
      }
      if (!opts.apply) {
        out.set(key, { outcome: "moved", message: null });
        continue;
      }
      const now = new Date();
      let result: ItemResult = { outcome: "failed", message: "The lead kept changing; try again" };
      for (let attempt = 0; attempt < MAX_MOVE_ATTEMPTS && lead; attempt++) {
        if (lead.stageKey === stage.key) {
          result = { outcome: "unchanged", message: null };
          break;
        }
        const updated = await this.leads.updateIfVersion(organizationId, lead._id, lead.version, {
          stageKey: stage.key,
          stageEnteredAt: now,
          updatedAt: now,
          closedAt: stage.kind === "open" ? null : now,
          closedKind: stage.kind === "open" ? null : stage.kind,
        });
        if (updated) {
          activities.push(
            systemActivity(
              organizationId,
              updated,
              actor.userId,
              now,
              {
                type: "stage_change",
                stageChange: { fromStageKey: lead.stageKey, toStageKey: stage.key },
                assignment: null,
              },
              opts.operationId ?? null,
            ),
          );
          result = { outcome: "moved", message: null };
          break;
        }
        lead = await this.leads.findById(organizationId, lead._id);
      }
      out.set(key, result);
    }
    await this.activities.insertMany(organizationId, activities);
    return out;
  }

  /** Active stage check for bulk requests (400 on unknown or archived). */
  async requireActiveStage(organizationId: string, key: string): Promise<void> {
    await this.activeStage(organizationId, key);
  }

  // -------------------------------------------------------------------------
  // Reports and exports
  // -------------------------------------------------------------------------

  businessIdsAssignedTo(
    organizationId: string,
    userId: string,
    limit: number,
  ): Promise<ObjectId[]> {
    return this.leads.businessIdsAssignedTo(organizationId, userId, limit);
  }

  findByBusinessIds(organizationId: string, ids: ObjectId[]) {
    return this.leads.findByBusinessIds(organizationId, ids);
  }

  async funnelCounts(organizationId: string) {
    const config = await this.pipeline.config(organizationId);
    return {
      stages: sortedStages(config.stages),
      active: activeStages(config.stages),
      counts: await this.leads.countByStage(organizationId),
    };
  }

  closedSince(organizationId: string, since: Date | null) {
    return this.leads.closedSince(organizationId, since);
  }

  /** Overview: open leads (not won or lost), open leads past the entry stage, unassigned open leads, closed in the period. */
  async overviewCounts(organizationId: string, since: Date) {
    const config = await this.pipeline.config(organizationId);
    const entry = entryStage(config.stages);
    const [openLeads, qualifiedLeads, unassignedOpenLeads, closed] = await Promise.all([
      this.leads.countMatching(organizationId, { closedAt: null }),
      this.leads.countMatching(organizationId, { closedAt: null, stageKey: { $ne: entry.key } }),
      this.leads.countMatching(organizationId, { closedAt: null, assignedToUserId: null }),
      this.leads.closedSince(organizationId, since),
    ]);
    const sum = (kind: "won" | "lost") =>
      closed.filter((c) => c.kind === kind).reduce((n, c) => n + c.count, 0);
    return {
      openLeads,
      qualifiedLeads,
      unassignedOpenLeads,
      wonInPeriod: sum("won"),
      lostInPeriod: sum("lost"),
    };
  }
}
