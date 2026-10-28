import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrganizationRole } from "@leadforge/contracts";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import type { SendEmailJob } from "@leadforge/core";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { seedBusinesses, type OrgUser } from "./fixtures.js";
import type { Json } from "./discovery-helpers.js";
import { call, createTeam } from "./phase5-helpers.js";

/**
 * CRM routes against one organization with a member per role (created once: registering five
 * verified members is the slow part). Each test uses its own businesses and scopes its
 * assertions to them; the pipeline configuration test runs last because it edits the stages.
 */

let h: Harness;
let team: Record<OrganizationRole, OrgUser>;
beforeAll(async () => {
  h = await createHarness();
  await h.resetState();
  team = await createTeam(h, "crm");
});
afterAll(async () => h?.close());

const mongo = () => h.app.get(MongoService).database;
const auditActions = async (resourceId: string) =>
  (
    await mongo()
      .collection(Collections.auditEvents)
      .find({ organizationId: team.owner.orgId, resourceId })
      .toArray()
  ).map((a) => a.action as string);
const assignmentMails = async (to: string) =>
  (await h.mailQueue.getJobs(["waiting", "delayed", "prioritized", "completed", "active"]))
    .map((j) => j.data as SendEmailJob)
    .filter((m) => m.message.to === to && m.message.subject.includes("assigned to you"));
const emailOf = async (userId: string) =>
  (await h.prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;

const stagesBody = (cfg: Json, edit: (stages: Json[]) => Json[] = (s) => s) => ({
  version: cfg.version,
  stages: edit(cfg.stages.map((s: Json) => ({ key: s.key, label: s.label, archived: s.archived }))),
});

describe("leads", () => {
  it("adds a business once and moves it atomically with version checks and keyboard directions", async () => {
    const [biz] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Mover Foods (Sample)", location: { locality: "Ikeja", region: "Lagos" } },
    ]);
    const lead = (
      await call(team.owner, "post", "/pipeline/leads", { businessId: biz }).expect(201)
    ).body.data as Json;
    expect(lead).toMatchObject({
      stageKey: "new",
      stageKind: "open",
      version: 1,
      assignedToUserId: null,
      business: { id: biz, name: "Mover Foods (Sample)", locality: "Ikeja" },
    });
    // One lead per business: a repeat returns the existing lead.
    expect(
      (await call(team.owner, "post", "/pipeline/leads", { businessId: biz }).expect(200)).body.data
        .id,
    ).toBe(lead.id);

    const next = (
      await call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, {
        direction: "next",
        version: 1,
      }).expect(200)
    ).body.data as Json;
    expect(next).toMatchObject({ stageKey: "qualified", version: 2 });
    const conflict = await call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, {
      stageKey: "won",
      version: 1,
    }).expect(409);
    expect(conflict.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: [{ path: "version", message: "2" }],
    });

    // Two quick key presses without a version both land, one stage each.
    await Promise.all([
      call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, { direction: "next" }).expect(
        200,
      ),
      call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, { direction: "next" }).expect(
        200,
      ),
    ]);
    const moved = (await call(team.owner, "get", `/pipeline/leads/${lead.id}`).expect(200)).body
      .data as Json;
    expect(moved).toMatchObject({ stageKey: "interested", version: 4 });

    const won = (
      await call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, {
        stageKey: "won",
        wonValueMinor: 5_000_000,
        currency: "NGN",
        version: 4,
      }).expect(200)
    ).body.data as Json;
    expect(won).toMatchObject({ stageKind: "won", wonValueMinor: 5_000_000, currency: "NGN" });
    expect(won.closedAt).not.toBeNull();
    // Moving into the current stage changes nothing.
    expect(
      (
        await call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, {
          stageKey: "won",
        }).expect(200)
      ).body.data.version,
    ).toBe(won.version);
    const end = await call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, {
      stageKey: "lost",
    }).expect(200);
    expect(end.body.data.stageKind).toBe("lost");
    expect(
      (
        await call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, {
          direction: "next",
        }).expect(400)
      ).body.error.details[0].path,
    ).toBe("direction");
    expect(
      (
        await call(team.owner, "post", `/pipeline/leads/${lead.id}/move`, {
          stageKey: "nope",
        }).expect(400)
      ).body.error.details[0].path,
    ).toBe("stageKey");

    // Edits are version-checked too.
    const edited = (
      await call(team.owner, "patch", `/pipeline/leads/${lead.id}`, {
        priority: "high",
        nextActionAt: "2026-12-01T09:00:00.000Z",
      }).expect(200)
    ).body.data as Json;
    expect(edited).toMatchObject({ priority: "high", nextActionAt: "2026-12-01T09:00:00.000Z" });
    expect(
      (
        await call(team.owner, "patch", `/pipeline/leads/${lead.id}`, {
          priority: "low",
          version: 1,
        }).expect(409)
      ).body.error.code,
    ).toBe("VERSION_CONFLICT");

    const changes = (
      await call(team.analyst, "get", `/activities?leadId=${lead.id}&type=stage_change`).expect(200)
    ).body.data as Json[];
    expect(changes.map((a) => a.stageChange.toStageKey).sort()).toEqual([
      "contacted",
      "interested",
      "lost",
      "new",
      "qualified",
      "won",
    ]);
    expect(
      changes.find((a) => a.stageChange.toStageKey === "new")!.stageChange.fromStageKey,
    ).toBeNull();
    const actions = await auditActions(lead.id);
    expect(actions.filter((a) => a === "lead.stage_changed")).toHaveLength(5);
    expect(actions).toEqual(expect.arrayContaining(["lead.created", "lead.updated"]));

    // Lead lists filter by stage and list and paginate with totals.
    const [b2, b3] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Second (Sample)" },
      { name: "Third (Sample)" },
    ]);
    await call(team.owner, "post", "/pipeline/leads", { businessId: b2 }).expect(201);
    await call(team.owner, "post", "/pipeline/leads", { businessId: b3 }).expect(201);
    const list = (await call(team.owner, "post", "/lists", { name: "Paging list" }).expect(201))
      .body.data as Json;
    await call(team.owner, "post", `/lists/${list.id}/items`, {
      businessIds: [biz, b2, b3],
    }).expect(200);
    const page1 = await call(
      team.analyst,
      "get",
      `/pipeline/leads?stage=new&listId=${list.id}&pageSize=1`,
    ).expect(200);
    expect(page1.body.meta).toMatchObject({ total: 2, pageSize: 1 });
    const page2 = await call(
      team.analyst,
      "get",
      `/pipeline/leads?stage=new&listId=${list.id}&pageSize=1&cursor=${page1.body.meta.nextCursor}`,
    ).expect(200);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
    expect(page2.body.meta.nextCursor).toBeNull();
  });

  it("assigns only to members who can work leads, notifies them, and limits sales representatives to their own leads", async () => {
    const [b1, b2, b3] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Alpha (Sample)" },
      { name: "Beta (Sample)" },
      { name: "Gamma (Sample)" },
    ]);
    const repEmail = await emailOf(team.sales_rep.userId);
    const mailsBefore = (await assignmentMails(repEmail)).length;
    const lead1 = (
      await call(team.researcher, "post", "/pipeline/leads", { businessId: b1 }).expect(201)
    ).body.data as Json;
    // Researchers can add and assign, but not pick a stage or move.
    expect(
      (
        await call(team.researcher, "post", "/pipeline/leads", {
          businessId: b2,
          stageKey: "won",
        }).expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN");
    await call(team.researcher, "post", `/pipeline/leads/${lead1.id}/move`, {
      direction: "next",
    }).expect(403);

    const notMember = await call(team.owner, "post", `/pipeline/leads/${lead1.id}/assign`, {
      assignedToUserId: "0190f0f0-0000-7000-8000-00000000abcd",
    }).expect(422);
    expect(notMember.body.error).toMatchObject({
      code: "INVALID_ASSIGNEE",
      details: [{ path: "assignedToUserId" }],
    });
    const analyst = await call(team.owner, "post", `/pipeline/leads/${lead1.id}/assign`, {
      assignedToUserId: team.analyst.userId,
    }).expect(422);
    expect(analyst.body.error.message).toMatch(/owners, administrators and sales representatives/);
    await call(team.sales_rep, "post", `/pipeline/leads/${lead1.id}/assign`, {
      assignedToUserId: team.sales_rep.userId,
    }).expect(403);

    const assigned = (
      await call(team.researcher, "post", `/pipeline/leads/${lead1.id}/assign`, {
        assignedToUserId: team.sales_rep.userId,
      }).expect(200)
    ).body.data as Json;
    expect(assigned.assignedToUserId).toBe(team.sales_rep.userId);
    const notes = (await call(team.sales_rep, "get", "/notifications").expect(200)).body
      .data as Json[];
    expect(notes).toContainEqual(
      expect.objectContaining({
        type: "lead.assigned",
        title: '"Alpha (Sample)" was assigned to you',
        href: `/app/pipeline?assignedToUserId=${team.sales_rep.userId}`,
      }),
    );
    expect((await assignmentMails(repEmail)).length).toBe(mailsBefore + 1);

    // The sales rep works their lead, not others.
    await call(team.sales_rep, "post", `/pipeline/leads/${lead1.id}/move`, {
      direction: "next",
    }).expect(200);
    const lead2 = (
      await call(team.owner, "post", "/pipeline/leads", { businessId: b2 }).expect(201)
    ).body.data as Json;
    expect(
      (
        await call(team.sales_rep, "post", `/pipeline/leads/${lead2.id}/move`, {
          direction: "next",
        }).expect(403)
      ).body.error.message,
    ).toMatch(/assigned to you/);
    await call(team.sales_rep, "patch", `/pipeline/leads/${lead2.id}`, { priority: "low" }).expect(
      403,
    );
    // Leads a sales rep adds are theirs; they cannot add leads for someone else.
    await call(team.sales_rep, "post", "/pipeline/leads", {
      businessId: b3,
      assignedToUserId: team.admin.userId,
    }).expect(403);
    const own = (
      await call(team.sales_rep, "post", "/pipeline/leads", { businessId: b3 }).expect(201)
    ).body.data as Json;
    expect(own.assignedToUserId).toBe(team.sales_rep.userId);

    // Assignment emails follow the assignee's preference.
    const adminEmail = await emailOf(team.admin.userId);
    await call(team.admin, "put", "/notifications/preferences", { emailAssignments: false }).expect(
      200,
    );
    await call(team.owner, "post", `/pipeline/leads/${lead2.id}/assign`, {
      assignedToUserId: team.admin.userId,
    }).expect(200);
    expect(await assignmentMails(adminEmail)).toHaveLength(0);
    expect((await call(team.admin, "get", "/notifications").expect(200)).body.data).toContainEqual(
      expect.objectContaining({
        type: "lead.assigned",
        title: '"Beta (Sample)" was assigned to you',
      }),
    );
    expect(
      (await call(team.admin, "get", "/notifications/preferences").expect(200)).body.data,
    ).toMatchObject({ emailAssignments: false });
    await call(team.admin, "put", "/notifications/preferences", { emailAssignments: true }).expect(
      200,
    );

    const assignments = (
      await call(team.analyst, "get", `/activities?type=assignment&businessId=${b1}`).expect(200)
    ).body.data as Json[];
    expect(assignments).toEqual([
      expect.objectContaining({
        assignment: { fromUserId: null, toUserId: team.sales_rep.userId },
        authorUserId: team.researcher.userId,
      }),
    ]);
    expect((await auditActions(lead1.id)).filter((a) => a === "lead.assigned")).toHaveLength(1);
    expect((await auditActions(lead2.id)).filter((a) => a === "lead.assigned")).toHaveLength(1);
  });
});

describe("activities and outreach", () => {
  it("logs calls, WhatsApp messages and notes, counts outreach attempts and filters both pages", async () => {
    const [b1, b2] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Caller Pharmacy (Sample)", phones: ["0803 123 4567"] },
      {
        name: "Other Shop (Sample)",
        phones: ["0803 765 4321"],
        emails: ["hello@other.example.test"],
      },
    ]);
    const lead = (
      await call(team.owner, "post", "/pipeline/leads", {
        businessId: b1,
        assignedToUserId: team.sales_rep.userId,
      }).expect(201)
    ).body.data as Json;
    const rep = team.sales_rep;

    const first = (
      await call(rep, "post", "/activities", {
        businessId: b1,
        type: "call",
        outcome: "no_answer",
        target: "0803 123 4567",
        body: "Rang twice",
      }).expect(201)
    ).body.data as Json;
    expect(first.activity).toMatchObject({
      type: "call",
      direction: "outbound",
      outcome: "no_answer",
      target: "+2348031234567",
      leadId: lead.id,
      authorUserId: rep.userId,
    });
    expect(first.outreach).toMatchObject({
      channel: "call",
      status: "in_progress",
      attempts: 1,
      lastOutcome: "no_answer",
      ownerUserId: rep.userId,
    });
    const second = (
      await call(rep, "post", "/activities", {
        businessId: b1,
        type: "call",
        outcome: "interested",
      }).expect(201)
    ).body.data as Json;
    expect(second.outreach).toMatchObject({
      id: first.outreach.id,
      attempts: 2,
      status: "replied",
    });
    const wa = (
      await call(rep, "post", "/activities", {
        businessId: b1,
        type: "whatsapp",
        outcome: "read",
      }).expect(201)
    ).body.data as Json;
    expect(wa.outreach).toMatchObject({ channel: "whatsapp", attempts: 1, status: "in_progress" });
    const note = (
      await call(rep, "post", "/activities", {
        businessId: b1,
        type: "note",
        body: "Owner prefers mornings",
      }).expect(201)
    ).body.data as Json;
    expect(note.outreach).toBeNull();

    expect(
      (await call(rep, "post", "/activities", { businessId: b1, type: "note" }).expect(400)).body
        .error.details[0].path,
    ).toBe("body");
    expect(
      (
        await call(rep, "post", "/activities", {
          businessId: b1,
          type: "call",
          outcome: "read",
        }).expect(400)
      ).body.error.details[0].path,
    ).toBe("outcome");
    expect(
      (
        await call(rep, "post", "/activities", {
          businessId: b1,
          type: "call",
          occurredAt: "2099-01-01T00:00:00Z",
        }).expect(400)
      ).body.error.details[0].path,
    ).toBe("occurredAt");
    expect(
      (
        await call(rep, "post", "/activities", {
          businessId: b1,
          type: "email",
          target: "not-an-email",
        }).expect(400)
      ).body.error.details[0].path,
    ).toBe("target");
    // Not their lead; researchers and analysts cannot log at all.
    await call(rep, "post", "/activities", { businessId: b2, type: "note", body: "x" }).expect(403);
    await call(team.researcher, "post", "/activities", {
      businessId: b1,
      type: "note",
      body: "x",
    }).expect(403);
    const ownerEmail = (
      await call(team.owner, "post", "/activities", {
        businessId: b2,
        type: "email",
        outcome: "sent",
        target: "Hello@Other.example.test",
        occurredAt: "2026-10-01T10:00:00Z",
      }).expect(201)
    ).body.data as Json;
    expect(ownerEmail.activity).toMatchObject({ target: "hello@other.example.test", leadId: null });

    expect(
      (await call(team.analyst, "get", `/pipeline/leads/${lead.id}`).expect(200)).body.data
        .lastActivityAt,
    ).not.toBeNull();

    // Activities page filters.
    expect(
      (await call(team.analyst, "get", `/activities?type=call&businessId=${b1}`).expect(200)).body
        .data,
    ).toHaveLength(2);
    expect(
      (
        await call(
          team.analyst,
          "get",
          `/activities?userId=${team.owner.userId}&type=email&businessId=${b2}`,
        ).expect(200)
      ).body.data,
    ).toHaveLength(1);
    expect(
      (await call(team.analyst, "get", `/activities?businessId=${b2}`).expect(200)).body.data,
    ).toHaveLength(1);
    expect(
      (
        await call(
          team.analyst,
          "get",
          `/activities?businessId=${b2}&from=2026-09-30T00:00:00Z&to=2026-10-02T00:00:00Z`,
        ).expect(200)
      ).body.data,
    ).toHaveLength(1);
    expect(
      (
        await call(
          team.analyst,
          "get",
          `/activities?businessId=${b1}&from=2026-09-30T00:00:00Z&to=2026-10-02T00:00:00Z`,
        ).expect(200)
      ).body.data,
    ).toHaveLength(0);
    const list = (await call(team.owner, "post", "/lists", { name: "Callers" }).expect(201)).body
      .data as Json;
    await call(team.owner, "post", `/lists/${list.id}/items`, { businessIds: [b1, b2] }).expect(
      200,
    );
    const logged = "type=call&type=whatsapp&type=note&type=email";
    const inList = (
      await call(team.analyst, "get", `/activities?listId=${list.id}&${logged}`).expect(200)
    ).body.data as Json[];
    expect(inList.map((a) => a.type).sort()).toEqual(["call", "call", "email", "note", "whatsapp"]);
    const p1 = await call(
      team.analyst,
      "get",
      `/activities?pageSize=2&listId=${list.id}&${logged}`,
    ).expect(200);
    const p2 = await call(
      team.analyst,
      "get",
      `/activities?pageSize=2&listId=${list.id}&${logged}&cursor=${p1.body.meta.nextCursor}`,
    ).expect(200);
    const p3 = await call(
      team.analyst,
      "get",
      `/activities?pageSize=2&listId=${list.id}&${logged}&cursor=${p2.body.meta.nextCursor}`,
    ).expect(200);
    expect(
      new Set([...p1.body.data, ...p2.body.data, ...p3.body.data].map((a: Json) => a.id)).size,
    ).toBe(5);
    expect(p3.body.meta.nextCursor).toBeNull();

    // Outreach page filters and edits.
    expect(
      (await call(team.analyst, "get", `/outreach?channel=call&listId=${list.id}`).expect(200)).body
        .data,
    ).toEqual([expect.objectContaining({ attempts: 2, status: "replied" })]);
    expect(
      (
        await call(team.analyst, "get", `/outreach?userId=${rep.userId}&listId=${list.id}`).expect(
          200,
        )
      ).body.data,
    ).toHaveLength(2);
    expect(
      (await call(team.analyst, "get", `/outreach?listId=${list.id}`).expect(200)).body.data,
    ).toHaveLength(3);
    expect(
      (
        await call(
          team.analyst,
          "get",
          `/outreach?status=in_progress&channel=whatsapp&businessId=${b1}`,
        ).expect(200)
      ).body.data,
    ).toHaveLength(1);
    const outreach = wa.outreach as Json;
    const patched = (
      await call(rep, "patch", `/outreach/${outreach.id}`, {
        status: "no_response",
        nextAttemptAt: "2026-12-01T09:00:00Z",
        version: outreach.version,
      }).expect(200)
    ).body.data as Json;
    expect(patched).toMatchObject({ status: "no_response", version: outreach.version + 1 });
    expect(
      (
        await call(rep, "patch", `/outreach/${outreach.id}`, {
          status: "closed",
          version: outreach.version,
        }).expect(409)
      ).body.error.code,
    ).toBe("VERSION_CONFLICT");
    const attempt = (
      await call(rep, "post", `/outreach/${outreach.id}/attempts`, { outcome: "delivered" }).expect(
        201,
      )
    ).body.data as Json;
    expect(attempt.outreach.attempts).toBe(2);
    expect(attempt.activity).toMatchObject({ type: "whatsapp", outreachId: outreach.id });
    expect(
      (await call(rep, "post", "/outreach", { businessId: b1, channel: "whatsapp" }).expect(200))
        .body.data.id,
    ).toBe(outreach.id);

    // Edits: author or owner/admin; system activities are not editable.
    await call(rep, "patch", `/activities/${note.activity.id}`, {
      body: "Owner prefers evenings",
    }).expect(200);
    await call(team.admin, "patch", `/activities/${ownerEmail.activity.id}`, {
      outcome: "replied",
    }).expect(200);
    await call(rep, "patch", `/activities/${ownerEmail.activity.id}`, {
      outcome: "bounced",
    }).expect(403);
    const stageChange = (
      (await call(team.owner, "get", `/activities?type=stage_change&leadId=${lead.id}`).expect(200))
        .body.data as Json[]
    )[0]!;
    await call(team.owner, "delete", `/activities/${stageChange.id}`).expect(409);
    await call(team.owner, "delete", `/activities/${note.activity.id}`).expect(200);
    await call(team.analyst, "get", `/activities/${note.activity.id}`).expect(404);
    expect((await auditActions(note.activity.id)).sort()).toEqual([
      "activity.deleted",
      "activity.updated",
    ]);
  });

  it("refuses contact with a suppressed business or contact unless an override reason is given", async () => {
    const [quiet, normal, sharer] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Opted Out (Sample)", phones: ["0803 111 2222"] },
      { name: "Normal (Sample)", phones: ["0803 333 4444"] },
      { name: "Sharer (Sample)", phones: ["0803 555 6666"] },
    ]);
    await call(team.owner, "post", `/businesses/${quiet}/suppress`, {
      scope: "business",
      reason: "Asked not to be contacted",
    }).expect(200);
    await call(team.owner, "post", `/businesses/${sharer}/suppress`, {
      scope: "phone",
      reason: "Number opted out",
    }).expect(200);

    const refused = await call(team.owner, "post", "/activities", {
      businessId: quiet,
      type: "call",
      outcome: "connected",
    }).expect(409);
    expect(refused.body.error).toMatchObject({
      code: "CONTACT_SUPPRESSED",
      details: [{ path: "suppressionOverride.reason" }],
    });
    // A suppressed number is refused even on a business that is not suppressed.
    const target = await call(team.owner, "post", "/activities", {
      businessId: normal,
      type: "whatsapp",
      target: "0803 555 6666",
    }).expect(409);
    expect(target.body.error.code).toBe("CONTACT_SUPPRESSED");
    expect(
      (
        await call(team.owner, "post", "/outreach", { businessId: quiet, channel: "call" }).expect(
          409,
        )
      ).body.error.code,
    ).toBe("CONTACT_SUPPRESSED");
    // Notes never contact anyone.
    await call(team.owner, "post", "/activities", {
      businessId: quiet,
      type: "note",
      body: "Do not call",
    }).expect(201);

    const overridden = (
      await call(team.owner, "post", "/activities", {
        businessId: quiet,
        type: "call",
        direction: "inbound",
        outcome: "connected",
        suppressionOverride: { reason: "They called us to ask for a quote" },
      }).expect(201)
    ).body.data as Json;
    expect(overridden.activity.suppressionOverride).toEqual({
      reason: "They called us to ask for a quote",
    });
    const audit = await mongo()
      .collection(Collections.auditEvents)
      .findOne({
        organizationId: team.owner.orgId,
        action: "contact.suppression_overridden",
        resourceId: quiet,
      });
    expect(audit).toMatchObject({
      after: {
        channel: "call",
        reason: "They called us to ask for a quote",
        businessSuppressed: true,
      },
    });
    // Lead creation for a suppressed business is refused.
    expect(
      (await call(team.owner, "post", "/pipeline/leads", { businessId: quiet }).expect(409)).body
        .error.code,
    ).toBe("CONFLICT");
  });
});

describe("lead lists", () => {
  it("manages lists and items with outcomes and exact counts; sales reps manage only their own lists", async () => {
    const [b1, b2, b3] = await seedBusinesses(h, team.owner.orgId, [
      { name: "One (Sample)" },
      { name: "Two (Sample)" },
      { name: "Three (Sample)" },
    ]);
    await call(team.owner, "post", `/businesses/${b3}/suppress`, {
      scope: "business",
      reason: "Opted out",
    }).expect(200);

    const list = (
      await call(team.researcher, "post", "/lists", {
        name: "Lagos Pharmacies",
        description: "Q4",
      }).expect(201)
    ).body.data as Json;
    expect(list).toMatchObject({ ownerUserId: team.researcher.userId, itemCount: 0 });
    expect(
      (await call(team.owner, "post", "/lists", { name: "lagos pharmacies" }).expect(409)).body
        .error.code,
    ).toBe("CONFLICT");
    await call(team.analyst, "post", "/lists", { name: "Nope" }).expect(403);

    const missing = "65f000000000000000000099";
    const added = (
      await call(team.researcher, "post", `/lists/${list.id}/items`, {
        businessIds: [b1, b2, b3, missing],
      }).expect(200)
    ).body.data as Json;
    expect(added.results.map((r: Json) => r.outcome)).toEqual([
      "added",
      "added",
      "suppressed",
      "not_found",
    ]);
    expect(added.summary).toEqual({
      requested: 4,
      changed: 2,
      unchanged: 0,
      notFound: 1,
      suppressed: 1,
      listFull: 0,
    });
    expect(added.list.itemCount).toBe(2);
    expect(
      (
        await call(team.researcher, "post", `/lists/${list.id}/items`, {
          businessIds: [b1],
        }).expect(200)
      ).body.data.results[0].outcome,
    ).toBe("already_in_list");

    await call(team.owner, "post", "/pipeline/leads", {
      businessId: b1,
      assignedToUserId: team.sales_rep.userId,
    }).expect(201);
    const items = (await call(team.analyst, "get", `/lists/${list.id}/items`).expect(200)).body
      .data as Json[];
    expect(items.map((i) => i.businessId).sort()).toEqual([b1, b2].sort());
    expect(items.find((i) => i.businessId === b1)).toMatchObject({
      business: { name: "One (Sample)" },
      lead: { stageKey: "new", assignedToUserId: team.sales_rep.userId },
    });
    expect(
      (await call(team.analyst, "get", `/lists?businessId=${b2}`).expect(200)).body.data.map(
        (l: Json) => l.id,
      ),
    ).toEqual([list.id]);
    expect((await call(team.analyst, "get", "/lists?q=lagos").expect(200)).body.data).toHaveLength(
      1,
    );
    expect((await call(team.analyst, "get", "/lists?q=abuja").expect(200)).body.data).toHaveLength(
      0,
    );

    const removed = (
      await call(team.researcher, "post", `/lists/${list.id}/items/remove`, {
        businessIds: [b2, b3],
      }).expect(200)
    ).body.data as Json;
    expect(removed.results.map((r: Json) => r.outcome)).toEqual(["removed", "not_in_list"]);
    expect(
      (await call(team.researcher, "delete", `/lists/${list.id}/items/${b1}`).expect(200)).body.data
        .list.itemCount,
    ).toBe(0);

    // Sales reps: own lists only, no hand-over.
    const repList = (await call(team.sales_rep, "post", "/lists", { name: "My calls" }).expect(201))
      .body.data as Json;
    await call(team.sales_rep, "post", "/lists", {
      name: "For admin",
      ownerUserId: team.admin.userId,
    }).expect(403);
    await call(team.sales_rep, "post", `/lists/${repList.id}/items`, { businessIds: [b1] }).expect(
      200,
    );
    await call(team.sales_rep, "patch", `/lists/${list.id}`, { name: "Mine now" }).expect(403);
    await call(team.sales_rep, "patch", `/lists/${repList.id}`, {
      ownerUserId: team.admin.userId,
    }).expect(403);
    // A manager hands the list to the rep, who can then manage it.
    await call(team.owner, "patch", `/lists/${list.id}`, {
      ownerUserId: team.sales_rep.userId,
    }).expect(200);
    await call(team.sales_rep, "patch", `/lists/${list.id}`, { name: "Rep's pharmacies" }).expect(
      200,
    );
    expect(
      (
        await call(team.owner, "patch", `/lists/${list.id}`, {
          ownerUserId: "0190f0f0-0000-7000-8000-00000000abcd",
        }).expect(400)
      ).body.error.details[0].path,
    ).toBe("ownerUserId");

    await call(team.sales_rep, "delete", `/lists/${repList.id}`).expect(200);
    await call(team.analyst, "get", `/lists/${repList.id}`).expect(404);
    expect(
      await mongo()
        .collection(Collections.leadListItems)
        .countDocuments({
          organizationId: team.owner.orgId,
          listId: { $in: [repList.id, list.id].map((i) => new ObjectId(i)) },
        }),
    ).toBe(0);
    expect(await auditActions(list.id)).toEqual(
      expect.arrayContaining([
        "list.created",
        "list.items_added",
        "list.items_removed",
        "list.updated",
      ]),
    );
    expect(await auditActions(repList.id)).toContain("list.deleted");
  });

  it("filters the pipeline board by list, combined with the assignee filters (Stage 8)", async () => {
    const [p1, p2, p3, p4] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Board One (Sample)" },
      { name: "Board Two (Sample)" },
      { name: "Board Three (Sample)" },
      { name: "Board Four (Sample)" },
    ]);
    const l1 = (
      await call(team.owner, "post", "/pipeline/leads", {
        businessId: p1,
        assignedToUserId: team.sales_rep.userId,
      }).expect(201)
    ).body.data as Json;
    await call(team.owner, "post", `/pipeline/leads/${l1.id}/move`, {
      stageKey: "qualified",
      version: l1.version,
    }).expect(200);
    await call(team.owner, "post", "/pipeline/leads", { businessId: p2 }).expect(201);
    await call(team.owner, "post", "/pipeline/leads", {
      businessId: p3,
      assignedToUserId: team.sales_rep.userId,
    }).expect(201);
    const list = (await call(team.owner, "post", "/lists", { name: "Board filter" }).expect(201))
      .body.data as Json;
    // p4 is on the list but has no lead; p3 has a lead but is not on the list.
    await call(team.owner, "post", `/lists/${list.id}/items`, { businessIds: [p1, p2, p4] }).expect(
      200,
    );
    const empty = (
      await call(team.owner, "post", "/lists", { name: "Board filter (empty)" }).expect(201)
    ).body.data as Json;

    const board = async (q: string) => {
      const data = (await call(team.sales_rep, "get", `/pipeline/board?${q}`).expect(200)).body
        .data as Json;
      const shown = (data.columns as Json[]).flatMap((c) =>
        (c.leads as Json[]).map((l) => `${c.stage.key}:${l.businessId}`),
      );
      return {
        counts: Object.fromEntries(
          (data.columns as Json[]).filter((c) => c.count > 0).map((c) => [c.stage.key, c.count]),
        ),
        shown: shown.sort(),
      };
    };
    expect(await board(`listId=${list.id}`)).toEqual({
      counts: { new: 1, qualified: 1 },
      shown: [`new:${p2}`, `qualified:${p1}`].sort(),
    });
    expect(await board(`listId=${list.id}&assignedToUserId=${team.sales_rep.userId}`)).toEqual({
      counts: { qualified: 1 },
      shown: [`qualified:${p1}`],
    });
    expect(await board(`listId=${list.id}&unassigned=true`)).toEqual({
      counts: { new: 1 },
      shown: [`new:${p2}`],
    });
    expect(await board(`listId=${empty.id}`)).toEqual({ counts: {}, shown: [] });
    // A column continues with GET /pipeline/leads and the same listId.
    const more = (
      await call(team.sales_rep, "get", `/pipeline/leads?stage=new&listId=${list.id}`).expect(200)
    ).body;
    expect(more.data.map((l: Json) => l.businessId)).toEqual([p2]);
    expect(more.meta.total).toBe(1);
    // Unknown (or another organization's) list: 404; a malformed id: 400 on listId.
    await call(
      team.sales_rep,
      "get",
      `/pipeline/board?listId=${new ObjectId().toHexString()}`,
    ).expect(404);
    expect(
      (await call(team.sales_rep, "get", "/pipeline/board?listId=nope").expect(400)).body.error
        .details[0].path,
    ).toBe("listId");
  });

  it("requires the organization header on CRM routes", async () => {
    const res = await team.owner.agent.get(`${API}/pipeline/config`).expect(403);
    expect(res.body.error.code).toBe("ORG_FORBIDDEN");
    await team.owner.agent
      .get(`${API}/pipeline/config`)
      .set(orgHeaders(team.owner.agent, team.owner.orgId))
      .expect(200);
  });
});

describe("pipeline configuration", () => {
  it("starts with the default stages, validates changes, refuses stale versions and stages that still hold leads", async () => {
    const cfg = (await call(team.analyst, "get", "/pipeline/config").expect(200)).body.data as Json;
    expect(cfg.stages.map((s: Json) => s.key)).toEqual([
      "new",
      "qualified",
      "contacted",
      "interested",
      "opportunity",
      "won",
      "lost",
    ]);
    expect(cfg).toMatchObject({ version: 1, entryStageKey: "new" });

    // Owners and admins only.
    for (const role of ["researcher", "sales_rep", "analyst"] as const) {
      expect(
        (await call(team[role], "put", "/pipeline/config", stagesBody(cfg)).expect(403)).body.error
          .code,
      ).toBe("FORBIDDEN");
    }
    // Validation: won cannot be archived; per-stage paths.
    const bad = await call(
      team.admin,
      "put",
      "/pipeline/config",
      stagesBody(cfg, (s) => s.map((x) => (x.key === "won" ? { ...x, archived: true } : x))),
    ).expect(400);
    expect(bad.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: [{ path: "stages.5.archived" }],
    });

    // Rename, reorder and add.
    const updated = (
      await call(
        team.admin,
        "put",
        "/pipeline/config",
        stagesBody(cfg, (s) => [
          { ...s[0]!, label: "Inbox" },
          s[1]!,
          { label: "Proposal sent" },
          ...s.slice(2),
        ]),
      ).expect(200)
    ).body.data as Json;
    expect(updated.version).toBe(2);
    expect(updated.stages.map((s: Json) => s.label)).toEqual([
      "Inbox",
      "Qualified",
      "Proposal sent",
      "Contacted",
      "Interested",
      "Opportunity",
      "Won",
      "Lost",
    ]);
    expect(updated.stages[2]).toMatchObject({
      key: "proposal_sent",
      kind: "open",
      archived: false,
    });

    // A stale version is a VERSION_CONFLICT carrying the current version.
    const stale = await call(team.owner, "put", "/pipeline/config", stagesBody(cfg)).expect(409);
    expect(stale.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: [{ path: "version", message: "2" }],
    });

    // Archiving a stage that holds a lead is STAGE_NOT_EMPTY.
    const [biz] = await seedBusinesses(h, team.owner.orgId, [{ name: "Staged Bakery (Sample)" }]);
    await call(team.owner, "post", "/pipeline/leads", {
      businessId: biz,
      stageKey: "opportunity",
    }).expect(201);
    const busy = await call(
      team.owner,
      "put",
      "/pipeline/config",
      stagesBody(updated, (s) =>
        s.map((x) => (x.key === "opportunity" ? { ...x, archived: true } : x)),
      ),
    ).expect(409);
    expect(busy.body.error).toMatchObject({
      code: "STAGE_NOT_EMPTY",
      details: [
        { path: "stageKey", message: "opportunity" },
        { path: "leads", message: "1" },
      ],
    });
    // An empty stage archives fine and leaves the board.
    const archived = (
      await call(
        team.owner,
        "put",
        "/pipeline/config",
        stagesBody(updated, (s) =>
          s.map((x) => (x.key === "proposal_sent" ? { ...x, archived: true } : x)),
        ),
      ).expect(200)
    ).body.data as Json;
    expect(archived.stages.find((s: Json) => s.key === "proposal_sent").archived).toBe(true);
    const board = (await call(team.analyst, "get", "/pipeline/board").expect(200)).body
      .data as Json;
    expect(board.columns.map((c: Json) => c.stage.key)).not.toContain("proposal_sent");
    expect(board.columns.find((c: Json) => c.stage.key === "opportunity")).toMatchObject({
      count: 1,
      leads: [expect.objectContaining({ businessId: biz })],
    });
    expect(
      await mongo()
        .collection(Collections.auditEvents)
        .countDocuments({ organizationId: team.owner.orgId, action: "pipeline.config_updated" }),
    ).toBe(2);
  });
});
