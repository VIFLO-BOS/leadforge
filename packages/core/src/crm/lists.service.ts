import { Injectable } from "@nestjs/common";
import { isDuplicateKeyError, ObjectId, type Document, type WithId } from "@leadforge/db-mongo";
import {
  CRM_LIMITS,
  type CreateLeadListRequest,
  type LeadList,
  type LeadListItem,
  type LeadListItemsQuery,
  type LeadListListQuery,
  type ListItemOutcome,
  type ListItemsResult,
  type UpdateLeadListRequest,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { escapeRegex } from "../normalization/index.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { can, type CrmActor, type LeadListDocument } from "./crm.types.js";
import { stageKindOf, toListView } from "./crm-view.js";
import { PipelineService } from "./pipeline.service.js";
import { LeadRepository } from "./repositories/lead.repository.js";
import { LeadListItemRepository, LeadListRepository } from "./repositories/lead-list.repository.js";

const SORT_FIELDS = { name: "nameKey", updatedAt: "updatedAt", createdAt: "createdAt" } as const;

const nameKeyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Lead lists. Owners, administrators and researchers (`lists:manage`) manage every list;
 * Sales Representatives (`lists:manage_own`) create lists and manage the ones they own (theirs,
 * or assigned to them by a manager). Item counts are recounted after every change, so they
 * stay exact under retries and concurrent edits. Suppressed businesses are not added.
 */
@Injectable()
export class ListsService {
  constructor(
    private readonly lists: LeadListRepository,
    private readonly items: LeadListItemRepository,
    private readonly leads: LeadRepository,
    private readonly pipeline: PipelineService,
    private readonly businesses: BusinessesService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
  ) {}

  async requireList(
    organizationId: string,
    id: string | ObjectId,
  ): Promise<WithId<LeadListDocument>> {
    const list = await this.lists.findById(organizationId, id);
    if (!list) throw AppError.notFound("List");
    return list;
  }

  /** 403 unless the actor manages every list, or owns this one. */
  assertCanManage(actor: CrmActor, list: LeadListDocument): void {
    if (can(actor, "lists:manage")) return;
    if (can(actor, "lists:manage_own") && list.ownerUserId === actor.userId) return;
    throw AppError.forbidden("You can only change lists you own");
  }

  private async assertMember(organizationId: string, userId: string, path: string): Promise<void> {
    const member = await this.organizations.isActiveMember(organizationId, userId);
    if (!member.active)
      throw AppError.validation([{ path, message: "Not an active member of this organization" }]);
  }

  async get(organizationId: string, id: string): Promise<LeadList> {
    return toListView(await this.requireList(organizationId, id));
  }

  async list(
    organizationId: string,
    query: LeadListListQuery,
  ): Promise<{ items: LeadList[]; nextCursor: string | null }> {
    const and: Document[] = [];
    // eslint-disable-next-line security/detect-non-literal-regexp
    if (query.q) and.push({ nameKey: new RegExp(`^${escapeRegex(nameKeyOf(query.q))}`) });
    if (query.ownerUserId) and.push({ ownerUserId: query.ownerUserId });
    if (query.businessId) {
      const business = await this.businesses.findAny(
        organizationId,
        new ObjectId(query.businessId),
      );
      if (!business) throw AppError.notFound("Business");
      and.push({ _id: { $in: await this.items.listIdsFor(organizationId, business._id) } });
    }
    const sort = query.sort ?? { field: "updatedAt" as const, direction: "desc" as const };
    const page = await withCursor(() =>
      this.lists.page(
        organizationId,
        and.length === 0 ? {} : and.length === 1 ? and[0]! : { $and: and },
        {
          pageSize: query.pageSize,
          cursor: query.cursor ?? null,
          sortField: SORT_FIELDS[sort.field],
          direction: sort.direction === "asc" ? 1 : -1,
        },
      ),
    );
    return { items: page.items.map(toListView), nextCursor: page.nextCursor };
  }

  async create(
    organizationId: string,
    actor: CrmActor,
    req: CreateLeadListRequest,
    auditCtx: AuditContext,
  ): Promise<LeadList> {
    const owner = req.ownerUserId ?? actor.userId;
    if (owner !== actor.userId) {
      if (!can(actor, "lists:manage"))
        throw AppError.forbidden("You can only create lists you own");
      await this.assertMember(organizationId, owner, "ownerUserId");
    }
    const now = new Date();
    const doc: LeadListDocument = {
      _id: new ObjectId(),
      organizationId,
      name: req.name.trim(),
      nameKey: nameKeyOf(req.name),
      description: req.description ?? null,
      ownerUserId: owner,
      itemCount: 0,
      createdByUserId: actor.userId,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await this.lists.insert(organizationId, doc)))
      throw AppError.conflict(`A list called "${doc.name}" already exists`);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "list.created",
        resourceType: "lead_list",
        resourceId: doc._id.toHexString(),
        after: { name: doc.name, ownerUserId: owner },
      },
      auditCtx,
    );
    return toListView(doc);
  }

  async update(
    organizationId: string,
    actor: CrmActor,
    id: string,
    req: UpdateLeadListRequest,
    auditCtx: AuditContext,
  ): Promise<LeadList> {
    const list = await this.requireList(organizationId, id);
    this.assertCanManage(actor, list);
    const set: Partial<LeadListDocument> = { updatedAt: new Date() };
    if (req.name !== undefined) {
      set.name = req.name.trim();
      set.nameKey = nameKeyOf(req.name);
    }
    if (req.description !== undefined) set.description = req.description;
    if (req.ownerUserId !== undefined && req.ownerUserId !== list.ownerUserId) {
      if (!can(actor, "lists:manage"))
        throw AppError.forbidden("Only list managers can hand a list to someone else");
      await this.assertMember(organizationId, req.ownerUserId, "ownerUserId");
      set.ownerUserId = req.ownerUserId;
    }
    let updated: WithId<LeadListDocument> | null;
    try {
      updated = await this.lists.update(organizationId, list._id, set);
    } catch (err) {
      if (isDuplicateKeyError(err))
        throw AppError.conflict(`A list called "${set.name}" already exists`);
      throw err;
    }
    if (!updated) throw AppError.notFound("List");
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "list.updated",
        resourceType: "lead_list",
        resourceId: list._id.toHexString(),
        before: { name: list.name, description: list.description, ownerUserId: list.ownerUserId },
        after: {
          name: updated.name,
          description: updated.description,
          ownerUserId: updated.ownerUserId,
        },
      },
      auditCtx,
    );
    return toListView(updated);
  }

  async remove(
    organizationId: string,
    actor: CrmActor,
    id: string,
    auditCtx: AuditContext,
  ): Promise<{ deleted: true; items: number }> {
    const list = await this.requireList(organizationId, id);
    this.assertCanManage(actor, list);
    await this.lists.remove(organizationId, list._id);
    const items = await this.items.removeList(organizationId, list._id);
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "list.deleted",
        resourceType: "lead_list",
        resourceId: list._id.toHexString(),
        before: { name: list.name, ownerUserId: list.ownerUserId, itemCount: list.itemCount },
      },
      auditCtx,
    );
    return { deleted: true, items };
  }

  async listItems(
    organizationId: string,
    id: string,
    query: LeadListItemsQuery,
  ): Promise<{ items: LeadListItem[]; nextCursor: string | null }> {
    const list = await this.requireList(organizationId, id);
    const page = await withCursor(() =>
      this.items.page(organizationId, list._id, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    const ids = page.items.map((i) => i.businessId);
    const [rows, leads, config] = await Promise.all([
      this.businesses.listRowsByIds(organizationId, ids),
      this.leads.findByBusinessIds(organizationId, ids),
      this.pipeline.config(organizationId),
    ]);
    const leadBy = new Map(leads.map((l) => [l.businessId.toHexString(), l]));
    return {
      items: page.items.map((i) => {
        const key = i.businessId.toHexString();
        const lead = leadBy.get(key);
        return {
          businessId: key,
          addedAt: i.addedAt.toISOString(),
          addedByUserId: i.addedByUserId,
          business: rows.get(key) ?? null,
          lead: lead
            ? {
                id: lead._id.toHexString(),
                stageKey: lead.stageKey,
                stageKind: stageKindOf(config.stages, lead.stageKey),
                assignedToUserId: lead.assignedToUserId,
              }
            : null,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Adds businesses (outcome per business). With `apply: false` nothing is written (bulk
   * preview). Capacity is checked against the current count; a retry finds the items already
   * on the list (`already_in_list`).
   */
  async addBusinesses(
    organizationId: string,
    list: WithId<LeadListDocument>,
    userId: string,
    ids: ObjectId[],
    apply: boolean,
  ): Promise<Map<string, ListItemOutcome>> {
    const out = new Map<string, ListItemOutcome>();
    const [docs, present, count] = await Promise.all([
      this.businesses.findLiveByIds(organizationId, ids),
      this.items.membersAmong(organizationId, list._id, ids),
      this.items.countForList(organizationId, list._id),
    ]);
    const live = new Map(docs.map((d) => [d._id.toHexString(), d]));
    let room = Math.max(0, CRM_LIMITS.listMaxItems - count);
    const toAdd: ObjectId[] = [];
    for (const id of ids) {
      const key = id.toHexString();
      const doc = live.get(key);
      if (!doc) out.set(key, "not_found");
      else if (present.has(key)) out.set(key, "already_in_list");
      else if (doc.flags.suppressed) out.set(key, "suppressed");
      else if (room <= 0) out.set(key, "list_full");
      else {
        room -= 1;
        toAdd.push(id);
        out.set(key, "added");
      }
    }
    if (apply && toAdd.length) {
      const added = await this.items.addMany(organizationId, list._id, toAdd, userId, new Date());
      for (const id of toAdd)
        if (!added.has(id.toHexString())) out.set(id.toHexString(), "already_in_list");
      await this.recount(organizationId, list._id);
    }
    return out;
  }

  async removeBusinesses(
    organizationId: string,
    list: WithId<LeadListDocument>,
    ids: ObjectId[],
    apply: boolean,
  ): Promise<Map<string, ListItemOutcome>> {
    const present = apply
      ? await this.items.removeMany(organizationId, list._id, ids)
      : await this.items.membersAmong(organizationId, list._id, ids);
    if (apply && present.size) await this.recount(organizationId, list._id);
    return new Map(
      ids.map((id) => [
        id.toHexString(),
        present.has(id.toHexString()) ? "removed" : "not_in_list",
      ]),
    );
  }

  async recount(
    organizationId: string,
    listId: ObjectId,
  ): Promise<WithId<LeadListDocument> | null> {
    const itemCount = await this.items.countForList(organizationId, listId);
    return this.lists.update(organizationId, listId, { itemCount, updatedAt: new Date() });
  }

  /** Synchronous add or remove of up to CRM_LIMITS.listItemsPerRequest businesses. */
  async changeItems(
    organizationId: string,
    actor: CrmActor,
    id: string,
    businessIds: string[],
    mode: "add" | "remove",
    auditCtx: AuditContext,
  ): Promise<ListItemsResult> {
    const list = await this.requireList(organizationId, id);
    this.assertCanManage(actor, list);
    const ids = businessIds.map((b) => new ObjectId(b));
    const outcomes =
      mode === "add"
        ? await this.addBusinesses(organizationId, list, actor.userId, ids, true)
        : await this.removeBusinesses(organizationId, list, ids, true);
    const results = ids.map((i) => ({
      businessId: i.toHexString(),
      outcome: outcomes.get(i.toHexString())!,
    }));
    const n = (o: ListItemOutcome) => results.filter((r) => r.outcome === o).length;
    const changed = n("added") + n("removed");
    if (changed > 0) {
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorType: "user",
          action: mode === "add" ? "list.items_added" : "list.items_removed",
          resourceType: "lead_list",
          resourceId: list._id.toHexString(),
          after: {
            count: changed,
            businessIds: results
              .filter((r) => r.outcome === "added" || r.outcome === "removed")
              .map((r) => r.businessId),
          },
        },
        auditCtx,
      );
    }
    return {
      list: toListView((await this.lists.findById(organizationId, list._id)) ?? list),
      results,
      summary: {
        requested: results.length,
        changed,
        unchanged: n("already_in_list") + n("not_in_list"),
        notFound: n("not_found"),
        suppressed: n("suppressed"),
        listFull: n("list_full"),
      },
    };
  }

  /** Business ids on a list (404 for another organization's list). */
  async businessIdsOf(
    organizationId: string,
    listId: string,
  ): Promise<{ list: WithId<LeadListDocument>; ids: ObjectId[] }> {
    const list = await this.requireList(organizationId, listId);
    return {
      list,
      ids: await this.items.businessIds(organizationId, list._id, CRM_LIMITS.listMaxItems),
    };
  }
}
