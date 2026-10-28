import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import type { OrganizationRole } from "@leadforge/contracts";
import { BulkQueueHandler, ExportQueueHandler } from "@leadforge/core";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import type { Json } from "./discovery-helpers.js";
import {
  bulk,
  call,
  createTeam,
  download,
  isTerminal,
  pollUntil,
  ROLES,
  startPhase5Workers,
} from "./phase5-helpers.js";

/**
 * Every Phase 5 route: the permission matrix for all five roles (denied roles get 403 FORBIDDEN
 * before any work; allowed roles reach the handler) and tenant isolation (another organization's
 * ids are 404 everywhere, filters naming them are 404, lists never show them, job payloads
 * naming them are rejected).
 */

type Method = "get" | "post" | "patch" | "put" | "delete";
interface Ids {
  business: string;
  lead: string;
  list: string;
  activity: string;
  outreach: string;
  bulk: string;
  export: string;
}
interface RouteCase {
  name: string;
  method: Method;
  path: (ids: Ids) => string;
  body?: (ids: Ids) => object;
  headers?: () => Record<string, string>;
  allowed: OrganizationRole[];
  allowedStatus: number;
}

const ALL = ROLES;
const SETTINGS: OrganizationRole[] = ["owner", "admin"];
const WORKERS: OrganizationRole[] = ["owner", "admin", "sales_rep"];
const ASSIGNERS: OrganizationRole[] = ["owner", "admin", "researcher"];
const LIST_MANAGERS: OrganizationRole[] = ["owner", "admin", "researcher", "sales_rep"];
const USAGE: OrganizationRole[] = ["owner", "admin", "researcher", "analyst"];
const threeStages = { version: 999, stages: [{ label: "A" }, { label: "B" }, { label: "C" }] };
const key = () => ({ "Idempotency-Key": randomUUID() });

const ROUTES: RouteCase[] = [
  {
    name: "get pipeline config",
    method: "get",
    path: () => "/pipeline/config",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "put pipeline config",
    method: "put",
    path: () => "/pipeline/config",
    body: () => threeStages,
    allowed: SETTINGS,
    allowedStatus: 409,
  },
  { name: "board", method: "get", path: () => "/pipeline/board", allowed: ALL, allowedStatus: 200 },
  {
    name: "board by list",
    method: "get",
    path: (i) => `/pipeline/board?listId=${i.list}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "list leads",
    method: "get",
    path: () => "/pipeline/leads",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "get lead",
    method: "get",
    path: (i) => `/pipeline/leads/${i.lead}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "create lead",
    method: "post",
    path: () => "/pipeline/leads",
    body: (i) => ({ businessId: i.business }),
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "move lead",
    method: "post",
    path: (i) => `/pipeline/leads/${i.lead}/move`,
    body: () => ({ direction: "next" }),
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "edit lead",
    method: "patch",
    path: (i) => `/pipeline/leads/${i.lead}`,
    body: () => ({ priority: "low" }),
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "assign lead",
    method: "post",
    path: (i) => `/pipeline/leads/${i.lead}/assign`,
    body: () => ({ assignedToUserId: null }),
    allowed: ASSIGNERS,
    allowedStatus: 404,
  },
  { name: "list lists", method: "get", path: () => "/lists", allowed: ALL, allowedStatus: 200 },
  {
    name: "create list",
    method: "post",
    path: () => "/lists",
    body: () => ({ name: `Matrix ${randomUUID()}` }),
    allowed: LIST_MANAGERS,
    allowedStatus: 201,
  },
  {
    name: "get list",
    method: "get",
    path: (i) => `/lists/${i.list}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "edit list",
    method: "patch",
    path: (i) => `/lists/${i.list}`,
    body: () => ({ name: "Renamed" }),
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "delete list",
    method: "delete",
    path: (i) => `/lists/${i.list}`,
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "list items",
    method: "get",
    path: (i) => `/lists/${i.list}/items`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "add items",
    method: "post",
    path: (i) => `/lists/${i.list}/items`,
    body: (i) => ({ businessIds: [i.business] }),
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "remove items",
    method: "post",
    path: (i) => `/lists/${i.list}/items/remove`,
    body: (i) => ({ businessIds: [i.business] }),
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "remove one item",
    method: "delete",
    path: (i) => `/lists/${i.list}/items/${i.business}`,
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "list activities",
    method: "get",
    path: () => "/activities",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "get activity",
    method: "get",
    path: (i) => `/activities/${i.activity}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "log activity",
    method: "post",
    path: () => "/activities",
    body: (i) => ({ businessId: i.business, type: "note", body: "x" }),
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "edit activity",
    method: "patch",
    path: (i) => `/activities/${i.activity}`,
    body: () => ({ body: "y" }),
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "delete activity",
    method: "delete",
    path: (i) => `/activities/${i.activity}`,
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "list outreach",
    method: "get",
    path: () => "/outreach",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "get outreach",
    method: "get",
    path: (i) => `/outreach/${i.outreach}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "create outreach",
    method: "post",
    path: () => "/outreach",
    body: (i) => ({ businessId: i.business, channel: "call" }),
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "edit outreach",
    method: "patch",
    path: (i) => `/outreach/${i.outreach}`,
    body: () => ({ status: "closed" }),
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "log attempt",
    method: "post",
    path: (i) => `/outreach/${i.outreach}/attempts`,
    body: () => ({ outcome: "sent" }),
    allowed: WORKERS,
    allowedStatus: 404,
  },
  {
    name: "bulk preview",
    method: "post",
    path: () => "/bulk-operations/preview",
    body: (i) => ({ action: "add_to_list", listId: i.list, selection: { ids: [i.business] } }),
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "bulk create",
    method: "post",
    path: () => "/bulk-operations",
    body: (i) => ({ action: "add_to_list", listId: i.list, selection: { ids: [i.business] } }),
    headers: key,
    allowed: LIST_MANAGERS,
    allowedStatus: 404,
  },
  {
    name: "list bulk",
    method: "get",
    path: () => "/bulk-operations",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "get bulk",
    method: "get",
    path: (i) => `/bulk-operations/${i.bulk}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "bulk items",
    method: "get",
    path: (i) => `/bulk-operations/${i.bulk}/items`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "create export",
    method: "post",
    path: () => "/exports",
    body: (i) => ({ kind: "list", listId: i.list }),
    allowed: ALL,
    allowedStatus: 404,
  },
  { name: "list exports", method: "get", path: () => "/exports", allowed: ALL, allowedStatus: 200 },
  {
    name: "get export",
    method: "get",
    path: (i) => `/exports/${i.export}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "download url",
    method: "get",
    path: (i) => `/exports/${i.export}/download-url`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "sync export",
    method: "post",
    path: () => "/exports/businesses",
    body: () => ({ columns: ["name"] }),
    allowed: ALL,
    allowedStatus: 200,
  },
  { name: "usage", method: "get", path: () => "/usage", allowed: USAGE, allowedStatus: 200 },
  {
    name: "overview",
    method: "get",
    path: () => "/reports/overview",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "source breakdown",
    method: "get",
    path: () => "/reports/source-breakdown",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "quality distribution",
    method: "get",
    path: () => "/reports/quality-distribution",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "jobs timeline",
    method: "get",
    path: () => "/reports/jobs-timeline",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "pipeline funnel",
    method: "get",
    path: () => "/reports/pipeline-funnel",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "activity summary",
    method: "get",
    path: () => "/reports/activity-summary",
    allowed: ALL,
    allowedStatus: 200,
  },
];

function callRoute(u: OrgUser, route: RouteCase, ids: Ids) {
  let req = u.agent[route.method](`${API}${route.path(ids)}`).set(orgHeaders(u.agent, u.orgId));
  if (route.headers) req = req.set(route.headers());
  return route.method === "get" || route.method === "delete"
    ? req
    : req.send(route.body ? route.body(ids) : {});
}

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await h.resetState();
});
afterAll(async () => h?.close());

describe("Phase 5 permission matrix", () => {
  it(
    "checks the required permission on every new route for every role",
    { timeout: 600_000 },
    async () => {
      const team = await createTeam(h, "p5-matrix");
      const probe: Ids = {
        business: new ObjectId().toHexString(),
        lead: new ObjectId().toHexString(),
        list: new ObjectId().toHexString(),
        activity: new ObjectId().toHexString(),
        outreach: new ObjectId().toHexString(),
        bulk: new ObjectId().toHexString(),
        export: new ObjectId().toHexString(),
      };
      const failures: string[] = [];
      for (const route of ROUTES) {
        for (const role of ALL) {
          const res = await callRoute(team[role], route, probe);
          const expected = route.allowed.includes(role) ? route.allowedStatus : 403;
          if (res.status !== expected)
            failures.push(
              `${route.name} as ${role}: ${res.status} (expected ${expected}) ${JSON.stringify(res.body.error ?? "")}`,
            );
          if (expected === 403 && res.body.error?.code !== "FORBIDDEN")
            failures.push(`${route.name} as ${role}: code ${res.body.error?.code}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );
});

/**
 * Stage 8 security check: which lists may a sales representative read? The role matrix
 * (docs/SECURITY_AND_DATA_COLLECTION.md section 2) gives every role "View businesses, lists,
 * pipeline, reports", and limits sales representatives only in "Manage lead lists" (own and
 * assigned) and "Export" (assigned only). So reads are organization-wide for every role, and the
 * server enforces the two limits. The web's "my lists" view (ownerUserId) is a convenience, not
 * the boundary.
 */
describe("Lead list visibility for sales representatives (Stage 8)", () => {
  it(
    "lets every role read every list of its organization, while sales reps manage only their own and export only their assigned leads",
    { timeout: 300_000 },
    async () => {
      const team = await createTeam(h, "p8-lists");
      const rep = team.sales_rep;
      const [mine, theirs, open] = await seedBusinesses(h, team.owner.orgId, [
        { name: "Rep Lead (Sample)" },
        { name: "Admin Lead (Sample)" },
        { name: "Unassigned (Sample)" },
      ]);
      await call(team.owner, "post", "/pipeline/leads", {
        businessId: mine,
        assignedToUserId: rep.userId,
      }).expect(201);
      await call(team.owner, "post", "/pipeline/leads", {
        businessId: theirs,
        assignedToUserId: team.admin.userId,
      }).expect(201);
      const managers = (
        await call(team.owner, "post", "/lists", { name: "Managers' list" }).expect(201)
      ).body.data as Json;
      await call(team.owner, "post", `/lists/${managers.id}/items`, {
        businessIds: [mine, theirs, open],
      }).expect(200);
      const repOwn = (await call(rep, "post", "/lists", { name: "Rep's own list" }).expect(201))
        .body.data as Json;
      await call(rep, "post", `/lists/${repOwn.id}/items`, { businessIds: [mine] }).expect(200);
      const handed = (
        await call(team.owner, "post", "/lists", {
          name: "Handed to the rep",
          ownerUserId: rep.userId,
        }).expect(201)
      ).body.data as Json;
      const all = [managers.id, repOwn.id, handed.id].sort();

      // Reads: every role sees every list, its detail, its items and its board.
      for (const role of ROLES) {
        const u = team[role];
        expect(
          ((await call(u, "get", "/lists?pageSize=100").expect(200)).body.data as Json[])
            .map((l) => l.id)
            .sort(),
          role,
        ).toEqual(all);
        await call(u, "get", `/lists/${managers.id}`).expect(200);
        const items = (await call(u, "get", `/lists/${managers.id}/items`).expect(200)).body
          .data as Json[];
        expect(items.map((i) => i.businessId).sort(), role).toEqual([mine, theirs, open].sort());
        const board = (await call(u, "get", `/pipeline/board?listId=${managers.id}`).expect(200))
          .body.data as Json;
        expect(
          board.columns.reduce((n: number, c: Json) => n + (c.count as number), 0),
          role,
        ).toBe(2);
      }
      // "My lists" is the ownerUserId filter: the lists the rep created or was handed.
      expect(
        (
          (await call(rep, "get", `/lists?ownerUserId=${rep.userId}`).expect(200)).body
            .data as Json[]
        )
          .map((l) => l.id)
          .sort(),
      ).toEqual([repOwn.id, handed.id].sort());

      // Writes: a sales rep manages only lists they own, directly and through bulk operations.
      await call(rep, "patch", `/lists/${managers.id}`, { name: "Taken over" }).expect(403);
      await call(rep, "delete", `/lists/${managers.id}`).expect(403);
      await call(rep, "post", `/lists/${managers.id}/items`, { businessIds: [open] }).expect(403);
      await call(rep, "post", `/lists/${managers.id}/items/remove`, { businessIds: [open] }).expect(
        403,
      );
      await call(rep, "delete", `/lists/${managers.id}/items/${open}`).expect(403);
      await call(rep, "post", "/bulk-operations/preview", {
        action: "add_to_list",
        listId: managers.id,
        selection: { ids: [open] },
      }).expect(403);
      await bulk(rep, {
        action: "remove_from_list",
        listId: managers.id,
        selection: { ids: [open] },
      }).expect(403);
      await call(rep, "patch", `/lists/${handed.id}`, { description: "Mine to work" }).expect(200);
      await call(rep, "post", `/lists/${handed.id}/items`, { businessIds: [open] }).expect(200);
      expect(
        (
          await call(rep, "post", "/bulk-operations/preview", {
            action: "add_to_list",
            listId: repOwn.id,
            selection: { ids: [theirs] },
          }).expect(200)
        ).body.data.willChange,
      ).toBe(1);
      // Working the businesses of a list they can read still touches only the rep's own leads.
      const move = (
        await call(rep, "post", "/bulk-operations/preview", {
          action: "move_stage",
          stageKey: "contacted",
          selection: { ids: [mine, theirs, open] },
        }).expect(200)
      ).body.data as Json;
      expect(move.breakdown).toEqual([
        { outcome: "moved", count: 1 },
        { outcome: "not_in_pipeline", count: 1 },
        { outcome: "not_assigned_to_you", count: 1 },
      ]);
      expect(
        (await call(team.owner, "get", `/lists/${managers.id}`).expect(200)).body.data,
      ).toMatchObject({ name: "Managers' list", itemCount: 3 });

      // Exports of any list a rep can read contain only the rep's assigned leads.
      const exp = (
        await call(rep, "post", "/exports", { kind: "list", listId: managers.id }).expect(202)
      ).body.data as Json;
      expect(exp).toMatchObject({ scope: "assigned", matchedAtRequest: 1 });
    },
  );
});

describe("Phase 5 tenant isolation", () => {
  it(
    "returns 404 for another organization's leads, lists, activities, outreach, bulk operations and exports",
    { timeout: 300_000 },
    async () => {
      await h.resetState();
      const a = await createOwner(h, "p5-org-a@example.test", "Org A");
      const b = await createOwner(h, "p5-org-b@example.test", "Org B");
      const [business, second] = await seedBusinesses(h, a.orgId, [
        { name: "Isolated Leads (Sample)", phones: ["0803 123 4567"] },
        { name: "Second (Sample)" },
      ]);
      const hdrA = orgHeaders(a.agent, a.orgId);
      const lead = (
        await a.agent
          .post(`${API}/pipeline/leads`)
          .set(hdrA)
          .send({ businessId: business })
          .expect(201)
      ).body.data as Json;
      const list = (
        await a.agent.post(`${API}/lists`).set(hdrA).send({ name: "Org A list" }).expect(201)
      ).body.data as Json;
      await a.agent
        .post(`${API}/lists/${list.id}/items`)
        .set(hdrA)
        .send({ businessIds: [business] })
        .expect(200);
      const logged = (
        await a.agent
          .post(`${API}/activities`)
          .set(hdrA)
          .send({ businessId: business, type: "call", outcome: "connected" })
          .expect(201)
      ).body.data as Json;
      const bulkOp = (
        await a.agent
          .post(`${API}/bulk-operations`)
          .set(hdrA)
          .set("Idempotency-Key", randomUUID())
          .send({ action: "add_to_list", listId: list.id, selection: { ids: [second] } })
          .expect(202)
      ).body.data as Json;
      const exp = (
        await a.agent
          .post(`${API}/exports`)
          .set(hdrA)
          .send({ kind: "list", listId: list.id })
          .expect(202)
      ).body.data as Json;
      const w = startPhase5Workers(h);
      try {
        await pollUntil(a, `/bulk-operations/${bulkOp.id}`, isTerminal);
        await pollUntil(a, `/exports/${exp.id}`, isTerminal);
      } finally {
        await w.close();
      }
      const ids: Ids = {
        business: business!,
        lead: lead.id,
        list: list.id,
        activity: logged.activity.id,
        outreach: logged.outreach.id,
        bulk: bulkOp.id,
        export: exp.id,
      };

      const failures: string[] = [];
      for (const route of ROUTES) {
        if (!route.path(ids).match(/[a-f0-9]{24}/) && !route.body?.(ids)) continue;
        if (
          route.name === "create list" ||
          route.name === "sync export" ||
          route.name === "put pipeline config"
        )
          continue;
        const res = await callRoute(b, route, ids);
        if (res.status !== 404)
          failures.push(
            `${route.name}: ${res.status} ${JSON.stringify(res.body.error ?? res.body.data)}`,
          );
      }
      expect(failures).toEqual([]);

      const hdrB = orgHeaders(b.agent, b.orgId);
      for (const path of [
        "/pipeline/leads",
        "/lists",
        "/activities",
        "/outreach",
        "/bulk-operations",
        "/exports",
        "/jobs",
      ]) {
        const res = await b.agent.get(`${API}${path}`).set(hdrB).expect(200);
        expect(res.body.data, path).toEqual([]);
      }
      const board = (await b.agent.get(`${API}/pipeline/board`).set(hdrB).expect(200)).body
        .data as Json;
      expect(board.columns.every((c: Json) => c.count === 0)).toBe(true);
      // Filters naming another organization's records are 404, not an empty list.
      for (const path of [
        `/activities?listId=${list.id}`,
        `/activities?businessId=${business}`,
        `/activities?leadId=${lead.id}`,
        `/outreach?listId=${list.id}`,
        `/outreach?businessId=${business}`,
        `/pipeline/leads?listId=${list.id}`,
        `/pipeline/leads?businessId=${business}`,
        `/pipeline/board?listId=${list.id}`,
        `/lists?businessId=${business}`,
      ]) {
        expect((await b.agent.get(`${API}${path}`).set(hdrB)).status, path).toBe(404);
      }
      // An id selection of another organization's businesses matches nothing (like ids that do not exist).
      const byIds = await b.agent
        .get(`${API}/businesses?ids=${business},${second}&suppression=include`)
        .set(hdrB)
        .expect(200);
      expect(byIds.body.data).toEqual([]);
      expect(byIds.body.meta.total).toBe(0);
      // Selections naming another organization's businesses touch nothing.
      const listB = (
        await b.agent.post(`${API}/lists`).set(hdrB).send({ name: "Org B list" }).expect(201)
      ).body.data as Json;
      const preview = (
        await b.agent
          .post(`${API}/bulk-operations/preview`)
          .set(hdrB)
          .send({ action: "add_to_list", listId: listB.id, selection: { ids: [business, second] } })
          .expect(200)
      ).body.data as Json;
      expect(preview.breakdown).toEqual([{ outcome: "not_found", count: 2 }]);
      const selectionB = (
        await b.agent
          .post(`${API}/exports`)
          .set(hdrB)
          .send({ kind: "selection", ids: [business] })
          .expect(202)
      ).body.data as Json;
      expect(selectionB.matchedAtRequest).toBe(0);
      // Reports and usage count only the caller's organization.
      const funnel = (
        await b.agent.get(`${API}/reports/pipeline-funnel?period=all`).set(hdrB).expect(200)
      ).body.data as Json;
      expect(funnel.totals.leads).toBe(0);
      expect(
        (await b.agent.get(`${API}/reports/activity-summary?period=all`).set(hdrB).expect(200)).body
          .data.total,
      ).toBe(0);

      // A download link is bound to its organization and user.
      const link = (
        await a.agent.get(`${API}/exports/${exp.id}/download-url`).set(hdrA).expect(200)
      ).body.data as Json;
      expect((await download(b.agent, link.url)).json?.error.code).toBe("DOWNLOAD_LINK_INVALID");
      const swapped = new URL(link.url);
      swapped.searchParams.set("org", b.orgId);
      expect((await download(a.agent, swapped.toString())).json?.error.code).toBe(
        "DOWNLOAD_LINK_INVALID",
      );
      expect((await download(a.agent, link.url)).status).toBe(200);
    },
  );

  it("rejects queue payloads that name another organization's operation or export, writing nothing", async () => {
    await h.resetState();
    const a = await createOwner(h, "p5-payload-a@example.test", "Payload A");
    const b = await createOwner(h, "p5-payload-b@example.test", "Payload B");
    const [business] = await seedBusinesses(h, a.orgId, [{ name: "Payload (Sample)" }]);
    const hdrA = orgHeaders(a.agent, a.orgId);
    const list = (
      await a.agent.post(`${API}/lists`).set(hdrA).send({ name: "Payload list" }).expect(201)
    ).body.data as Json;
    const op = (
      await a.agent
        .post(`${API}/bulk-operations`)
        .set(hdrA)
        .set("Idempotency-Key", randomUUID())
        .send({ action: "add_to_list", listId: list.id, selection: { ids: [business] } })
        .expect(202)
    ).body.data as Json;
    const exp = (
      await a.agent
        .post(`${API}/exports`)
        .set(hdrA)
        .send({ kind: "directory", filter: {} })
        .expect(202)
    ).body.data as Json;
    const job = (name: string, data: object) =>
      ({ name, data, opts: { attempts: 3 }, attemptsMade: 0 }) as unknown as Job;

    await expect(
      h.app
        .get(BulkQueueHandler, { strict: false })
        .handle(job("run-bulk-operation", { organizationId: b.orgId, operationId: op.id })),
    ).rejects.toThrow(/not found in organization/);
    await expect(
      h.app
        .get(ExportQueueHandler, { strict: false })
        .handle(job("build-export", { organizationId: b.orgId, exportId: exp.id })),
    ).rejects.toThrow(/not found in organization/);
    await expect(
      h.app
        .get(BulkQueueHandler, { strict: false })
        .handle(job("run-bulk-operation", { organizationId: "nope", operationId: op.id })),
    ).rejects.toThrow(/Invalid run-bulk-operation payload/);
    await expect(
      h.app
        .get(ExportQueueHandler, { strict: false })
        .handle(job("build-export", { organizationId: a.orgId })),
    ).rejects.toThrow(/Invalid build-export payload/);

    const db = h.app.get(MongoService).database;
    expect(await db.collection(Collections.bulkOperationItems).countDocuments({})).toBe(0);
    expect(await db.collection(Collections.leadListItems).countDocuments({})).toBe(0);
    expect(
      (await db.collection(Collections.bulkOperations).findOne({ _id: new ObjectId(op.id) }))
        ?.status,
    ).toBe("queued");
    expect(
      (await db.collection(Collections.exportJobs).findOne({ _id: new ObjectId(exp.id) }))?.status,
    ).toBe("queued");
    expect(await db.collection(Collections.notifications).countDocuments({})).toBe(0);
  });
});
