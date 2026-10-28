import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { BULK_LIMITS, type OrganizationRole } from "@leadforge/contracts";
import { BulkQueueHandler, ListsService } from "@leadforge/core";
import { createHarness, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import type { Json } from "./discovery-helpers.js";
import {
  bulk,
  call,
  cloneBusinesses,
  createTeam,
  isTerminal,
  pollUntil,
  startPhase5Workers,
} from "./phase5-helpers.js";

/** One organization with a member per role for the whole file (registration is the slow part); tests scope their assertions. */
let h: Harness;
let team: Record<OrganizationRole, OrgUser>;
beforeAll(async () => {
  h = await createHarness();
  await h.resetState();
  team = await createTeam(h, "bulk");
});
afterAll(async () => h?.close());

const mongo = () => h.app.get(MongoService).database;

/** Runs the queue handler directly, as one BullMQ attempt would. */
function attempt(organizationId: string, operationId: string, attemptsMade = 0) {
  const job = {
    name: "run-bulk-operation",
    data: { organizationId, operationId },
    opts: { attempts: 3 },
    attemptsMade,
  } as unknown as Job;
  return h.app.get(BulkQueueHandler, { strict: false }).handle(job);
}

describe("bulk operations", () => {
  it("previews counts, confirms with an Idempotency-Key, runs in the worker and notifies", async () => {
    const ids = await seedBusinesses(h, team.owner.orgId, [
      { name: "Bulk A (Sample)", location: { region: "Lagos" } },
      { name: "Bulk B (Sample)", location: { region: "Lagos" } },
      { name: "Bulk C (Sample)", location: { region: "Lagos" } },
      { name: "Bulk D (Sample)", location: { region: "Oyo" } },
    ]);
    await call(team.owner, "post", `/businesses/${ids[2]}/suppress`, {
      scope: "business",
      reason: "Opted out",
    }).expect(200);
    const list = (await call(team.researcher, "post", "/lists", { name: "Bulk list" }).expect(201))
      .body.data as Json;
    await call(team.researcher, "post", `/lists/${list.id}/items`, {
      businessIds: [ids[0]],
    }).expect(200);

    const body = {
      action: "add_to_list",
      listId: list.id,
      selection: { filter: { region: ["Lagos"], suppression: "include" } },
    };
    const preview = (
      await call(team.researcher, "post", "/bulk-operations/preview", body).expect(200)
    ).body.data as Json;
    expect(preview).toMatchObject({
      action: "add_to_list",
      matched: 3,
      cap: BULK_LIMITS.maxItems,
      overCap: false,
      willChange: 1,
    });
    expect(preview.breakdown).toEqual([
      { outcome: "added", count: 1 },
      { outcome: "unchanged", count: 1 },
      { outcome: "suppressed", count: 1 },
    ]);
    // Preview writes nothing.
    expect(
      (await call(team.analyst, "get", `/lists/${list.id}`).expect(200)).body.data.itemCount,
    ).toBe(1);

    expect(
      (await bulk(team.researcher, body, "short").expect(400)).body.error.details[0].path,
    ).toBe("Idempotency-Key");
    const key = randomUUID();
    const created = (await bulk(team.researcher, body, key).expect(202)).body.data as Json;
    expect(created).toMatchObject({
      status: "queued",
      action: "add_to_list",
      params: { listId: list.id },
      progress: { total: 3, processed: 0 },
    });
    expect((await bulk(team.researcher, body, key).expect(200)).body.data.id).toBe(created.id);
    expect(
      (await bulk(team.researcher, { ...body, selection: { ids: [ids[3]] } }, key).expect(409)).body
        .error.code,
    ).toBe("CONFLICT");

    const w = startPhase5Workers(h, ["bulk"]);
    let done: Json;
    try {
      done = await pollUntil(team.researcher, `/bulk-operations/${created.id}`, isTerminal);
    } finally {
      await w.close();
    }
    expect(done).toMatchObject({
      status: "completed",
      progress: {
        total: 3,
        processed: 3,
        changed: 1,
        unchanged: 1,
        skipped: 1,
        failed: 0,
        percent: 100,
      },
    });
    expect(
      (await call(team.analyst, "get", `/lists/${list.id}`).expect(200)).body.data.itemCount,
    ).toBe(2);
    const items = (
      await call(
        team.analyst,
        "get",
        `/bulk-operations/${created.id}/items?outcome=suppressed`,
      ).expect(200)
    ).body.data as Json[];
    expect(items).toEqual([expect.objectContaining({ businessId: ids[2], outcome: "suppressed" })]);
    await pollUntil(team.researcher, "/notifications", (d) =>
      (d as unknown as Json[]).some(
        (n) => n.type === "bulk.completed" && n.href === `/app/jobs/bulk/${created.id}`,
      ),
    );
    const jobs = (await call(team.analyst, "get", "/jobs?kind=bulk").expect(200)).body
      .data as Json[];
    expect(jobs).toContainEqual(
      expect.objectContaining({
        id: created.id,
        kind: "bulk",
        status: "completed",
        name: 'Add 3 businesses to "Bulk list"',
        href: `/app/jobs/bulk/${created.id}`,
      }),
    );
    const audit = await mongo()
      .collection(Collections.auditEvents)
      .find({ organizationId: team.owner.orgId, resourceId: created.id })
      .toArray();
    expect(audit.map((a) => a.action).sort()).toEqual(["bulk.finished", "bulk.requested"]);
  });

  it("names every result row with the business's current name, read with the page (Stage 8)", async () => {
    const [named, expiring] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Named Result (Sample)" },
      { name: "Expiring Name (Sample)" },
    ]);
    const other = await createOwner(h, "bulk-names-other@example.test", "Bulk Names Other Org");
    const [foreign] = await seedBusinesses(h, other.orgId, [
      { name: "Foreign Secret Name (Sample)" },
    ]);
    const missing = new ObjectId().toHexString();
    const list = (await call(team.owner, "post", "/lists", { name: "Named results" }).expect(201))
      .body.data as Json;
    const created = (
      await bulk(team.owner, {
        action: "add_to_list",
        listId: list.id,
        selection: { ids: [named, expiring, foreign, missing] },
      }).expect(202)
    ).body.data as Json;
    await attempt(team.owner.orgId, created.id);

    const read = async () => {
      const rows = (
        await call(team.analyst, "get", `/bulk-operations/${created.id}/items?pageSize=10`).expect(
          200,
        )
      ).body.data as Json[];
      return new Map(rows.map((r) => [r.businessId as string, r]));
    };
    let rows = await read();
    expect(rows.get(named!)).toMatchObject({
      businessName: "Named Result (Sample)",
      businessNameState: expect.any(String),
      outcome: "added",
    });
    expect(rows.get(named!)!.businessNameState).not.toBeNull();
    // Ids that are not this organization's businesses carry no name and no state, never another organization's name.
    expect(rows.get(foreign!)).toMatchObject({
      businessName: null,
      businessNameState: null,
      outcome: "not_found",
    });
    expect(rows.get(missing)).toMatchObject({
      businessName: null,
      businessNameState: null,
      outcome: "not_found",
    });
    const raw = JSON.stringify(
      await call(team.analyst, "get", `/bulk-operations/${created.id}/items`)
        .expect(200)
        .then((r) => r.body),
    );
    expect(raw).not.toContain("Foreign Secret Name");

    // Joined on read: a correction shows on the next read, and a name whose source retention passed is hidden.
    await call(team.owner, "patch", `/businesses/${named}`, {
      field: "name",
      value: "Renamed Result (Sample)",
    }).expect(200);
    await mongo()
      .collection(Collections.businesses)
      .updateOne(
        { _id: new ObjectId(expiring!) },
        { $set: { "name.expiresAt": new Date(Date.now() - 60_000) } },
      );
    rows = await read();
    expect(rows.get(named!)!.businessName).toBe("Renamed Result (Sample)");
    expect(rows.get(expiring!)).toMatchObject({ businessName: null, businessNameState: "expired" });
    // Nothing was copied onto the stored items.
    const stored = await mongo()
      .collection(Collections.bulkOperationItems)
      .findOne({ operationId: new ObjectId(created.id), businessId: new ObjectId(named!) });
    expect(stored).not.toHaveProperty("businessName");
  });

  it("assigns and moves in bulk with per-item results; sales reps move only their own leads", async () => {
    const ids = await seedBusinesses(h, team.owner.orgId, [
      { name: "P1 (Sample)" },
      { name: "P2 (Sample)" },
      { name: "P3 (Sample)" },
    ]);
    await call(team.owner, "post", "/pipeline/leads", {
      businessId: ids[0],
      assignedToUserId: team.sales_rep.userId,
    }).expect(201);

    const assign = {
      action: "assign",
      assignedToUserId: team.sales_rep.userId,
      selection: { ids },
    };
    const preview = (
      await call(team.researcher, "post", "/bulk-operations/preview", assign).expect(200)
    ).body.data as Json;
    expect(preview.breakdown).toEqual([
      { outcome: "created_and_assigned", count: 2 },
      { outcome: "unchanged", count: 1 },
    ]);
    await call(team.sales_rep, "post", "/bulk-operations/preview", assign).expect(403);
    const badAssignee = await bulk(team.researcher, {
      ...assign,
      assignedToUserId: team.analyst.userId,
    }).expect(422);
    expect(badAssignee.body.error.code).toBe("INVALID_ASSIGNEE");

    const w = startPhase5Workers(h, ["bulk"]);
    try {
      const op = (await bulk(team.researcher, assign).expect(202)).body.data as Json;
      const done = await pollUntil(team.researcher, `/bulk-operations/${op.id}`, isTerminal);
      expect(done.breakdown).toEqual([
        { outcome: "created_and_assigned", count: 2 },
        { outcome: "unchanged", count: 1 },
      ]);
      // One notice to the assignee for the whole operation (written just after the status turns terminal).
      const notes = await pollUntil(team.sales_rep, "/notifications?unread=true", (d) =>
        (d as unknown as Json[]).some((n) => n.title === "2 leads were assigned to you"),
      );
      expect(
        (notes as unknown as Json[]).filter((n) => n.title === "2 leads were assigned to you"),
      ).toHaveLength(1);

      // The rep moves their leads; someone else's lead is skipped.
      const third = (
        await call(team.owner, "get", `/pipeline/leads?businessId=${ids[2]}`).expect(200)
      ).body.data[0] as Json;
      await call(team.owner, "post", `/pipeline/leads/${third.id}/assign`, {
        assignedToUserId: team.admin.userId,
      }).expect(200);
      const move = {
        action: "move_stage",
        stageKey: "contacted",
        selection: { ids: [...ids, new ObjectId().toHexString()] },
      };
      await bulk(team.researcher, move).expect(403);
      const moveOp = (await bulk(team.sales_rep, move).expect(202)).body.data as Json;
      const moved = await pollUntil(team.sales_rep, `/bulk-operations/${moveOp.id}`, isTerminal);
      expect(moved.breakdown).toEqual([
        { outcome: "moved", count: 2 },
        { outcome: "not_in_pipeline", count: 1 },
        { outcome: "not_assigned_to_you", count: 1 },
      ]);
      const inContacted = await Promise.all(
        ids.map(
          async (b) =>
            (
              await call(
                team.analyst,
                "get",
                `/pipeline/leads?businessId=${b}&stage=contacted`,
              ).expect(200)
            ).body.data.length as number,
        ),
      );
      expect(inContacted).toEqual([1, 1, 0]);
      const changes = await Promise.all(
        ids.map(
          async (b) =>
            (
              await call(
                team.analyst,
                "get",
                `/activities?type=stage_change&businessId=${b}`,
              ).expect(200)
            ).body.data as Json[],
        ),
      );
      expect(changes.flat().filter((a) => a.stageChange.toStageKey === "contacted")).toHaveLength(
        2,
      );
      const unknownStage = await bulk(team.owner, { ...move, stageKey: "nowhere" }).expect(400);
      expect(unknownStage.body.error.details[0].path).toBe("stageKey");
    } finally {
      await w.close();
    }
  });

  it(
    "is idempotent across a failed attempt and its retry: nothing is added, assigned or logged twice",
    { timeout: 300_000 },
    async () => {
      const [template] = await seedBusinesses(h, team.owner.orgId, [
        { name: "Retrytemplate (Sample)" },
      ]);
      const clones = await cloneBusinesses(h, team.owner.orgId, template!, 449);
      const all = [template!, ...clones];
      const list = (await call(team.owner, "post", "/lists", { name: "Retry list" }).expect(201))
        .body.data as Json;
      // Clones copy the template's search tokens, so this filter selects exactly these 450.
      const op = (
        await bulk(team.owner, {
          action: "add_to_list",
          listId: list.id,
          selection: { filter: { q: "retrytemplate" } },
        }).expect(202)
      ).body.data as Json;
      expect(op.progress.total).toBe(450);

      // First attempt dies on the second chunk of 200 (after the first chunk was applied and recorded).
      const lists = h.app.get(ListsService, { strict: false });
      const original = lists.addBusinesses.bind(lists);
      let calls = 0;
      const spy = vi.spyOn(lists, "addBusinesses").mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) throw new Error("simulated crash");
        return original(...args);
      });
      await expect(attempt(team.owner.orgId, op.id, 0)).rejects.toThrow("simulated crash");
      const mid = (await call(team.owner, "get", `/bulk-operations/${op.id}`).expect(200)).body
        .data as Json;
      expect(mid).toMatchObject({ status: "running", progress: { processed: 200, changed: 200 } });
      spy.mockRestore();

      // The retry skips the recorded chunk and finishes; a further run of a finished operation is a no-op.
      expect(await attempt(team.owner.orgId, op.id, 1)).toMatchObject({
        status: "completed",
        processed: 450,
      });
      expect(await attempt(team.owner.orgId, op.id, 2)).toMatchObject({
        status: "completed",
        processed: 450,
      });
      const done = (await call(team.owner, "get", `/bulk-operations/${op.id}`).expect(200)).body
        .data as Json;
      expect(done).toMatchObject({
        status: "completed",
        progress: { processed: 450, changed: 450, unchanged: 0 },
        breakdown: [{ outcome: "added", count: 450 }],
      });
      expect(
        (await call(team.owner, "get", `/lists/${list.id}`).expect(200)).body.data.itemCount,
      ).toBe(450);
      expect(
        await mongo()
          .collection(Collections.bulkOperationItems)
          .countDocuments({ operationId: new ObjectId(op.id) }),
      ).toBe(450);
      expect(
        await mongo()
          .collection(Collections.notifications)
          .countDocuments({
            organizationId: team.owner.orgId,
            type: "bulk.completed",
            href: `/app/jobs/bulk/${op.id}`,
          }),
      ).toBe(1);

      // A crash after applying but before recording: the rerun finds the state applied and logs nothing twice.
      const assignOp = (
        await bulk(team.owner, {
          action: "assign",
          assignedToUserId: team.sales_rep.userId,
          selection: { ids: all.slice(0, 300) },
        }).expect(202)
      ).body.data as Json;
      expect(await attempt(team.owner.orgId, assignOp.id)).toMatchObject({
        status: "completed",
        processed: 300,
      });
      const targets = all.slice(0, 300).map((i) => new ObjectId(i));
      const activitiesBefore = await mongo()
        .collection(Collections.leadActivities)
        .countDocuments({ organizationId: team.owner.orgId, businessId: { $in: targets } });
      const leadsBefore = await mongo()
        .collection(Collections.leads)
        .countDocuments({ organizationId: team.owner.orgId, businessId: { $in: targets } });
      expect([leadsBefore, activitiesBefore]).toEqual([300, 600]);
      await mongo()
        .collection(Collections.bulkOperationItems)
        .deleteMany({
          operationId: new ObjectId(assignOp.id),
          businessId: { $in: targets.slice(100) },
        });
      await mongo()
        .collection(Collections.bulkOperations)
        .updateOne(
          { _id: new ObjectId(assignOp.id) },
          { $set: { status: "running", finishedAt: null } },
        );
      expect(await attempt(team.owner.orgId, assignOp.id)).toMatchObject({
        status: "completed",
        processed: 300,
      });
      expect(
        await mongo()
          .collection(Collections.leadActivities)
          .countDocuments({ organizationId: team.owner.orgId, businessId: { $in: targets } }),
      ).toBe(activitiesBefore);
      expect(
        await mongo()
          .collection(Collections.leads)
          .countDocuments({ organizationId: team.owner.orgId, businessId: { $in: targets } }),
      ).toBe(leadsBefore);
      const rerun = (await call(team.owner, "get", `/bulk-operations/${assignOp.id}`).expect(200))
        .body.data as Json;
      expect(rerun.breakdown).toEqual([
        { outcome: "created_and_assigned", count: 100 },
        { outcome: "unchanged", count: 200 },
      ]);
    },
  );

  it(
    "caps selections at 5,000 businesses (BULK_LIMIT_EXCEEDED)",
    { timeout: 300_000 },
    async () => {
      const owner = await createOwner(h, "bulk-cap@example.test", "Bulk Cap Org");
      const [template] = await seedBusinesses(h, owner.orgId, [{ name: "Template (Sample)" }]);
      await cloneBusinesses(h, owner.orgId, template!, BULK_LIMITS.maxItems);
      const list = (await call(owner, "post", "/lists", { name: "Too big" }).expect(201)).body
        .data as Json;
      const body = { action: "add_to_list", listId: list.id, selection: { filter: {} } };
      const preview = (await call(owner, "post", "/bulk-operations/preview", body).expect(200)).body
        .data as Json;
      expect(preview).toMatchObject({ matched: BULK_LIMITS.maxItems + 1, overCap: true });
      const refused = await bulk(owner, body).expect(422);
      expect(refused.body.error).toMatchObject({
        code: "BULK_LIMIT_EXCEEDED",
        details: [
          { path: "selection.matched", message: String(BULK_LIMITS.maxItems + 1) },
          { path: "selection.cap" },
        ],
      });
      expect(
        await mongo()
          .collection(Collections.bulkOperations)
          .countDocuments({ organizationId: owner.orgId }),
      ).toBe(0);
    },
  );
});
