import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { newId } from "@leadforge/db-postgres";
import { ROLE_PERMISSIONS, type OrganizationRole } from "@leadforge/contracts";
import {
  DownloadSigner,
  ExportBuilder,
  ExportsService,
  overtureFixtureRecords,
} from "@leadforge/core";
import { addMember, API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import type { Json } from "./discovery-helpers.js";
import { forgetOverture, ingestOverturePlace, sampleId, seedOverture } from "./overture-helpers.js";
import {
  call,
  createTeam,
  download,
  expiredAccessToken,
  isTerminal,
  navigate,
  parseCsv,
  pollUntil,
  readZip,
  startPhase5Workers,
} from "./phase5-helpers.js";

/**
 * State is reset once; each test works in its own organization (the last two share one team,
 * created once because registering five members is slow), and the file-retention test runs last.
 */
let h: Harness;
let team: Record<OrganizationRole, OrgUser>;
beforeAll(async () => {
  h = await createHarness();
  await h.resetState();
  forgetOverture(h);
});
afterAll(async () => h?.close());

const mongo = () => h.app.get(MongoService).database;

async function runExport(u: Parameters<typeof call>[0], body: object): Promise<Json> {
  const created = (await call(u, "post", "/exports", body).expect(202)).body.data as Json;
  const w = startPhase5Workers(h, ["exports"]);
  try {
    return await pollUntil(u, `/exports/${created.id}`, isTerminal);
  } finally {
    await w.close();
  }
}

async function fetchZip(
  u: Parameters<typeof call>[0],
  exportId: string,
): Promise<Map<string, Buffer>> {
  const link = (await call(u, "get", `/exports/${exportId}/download-url`).expect(200)).body
    .data as Json;
  const res = await download(u.agent, link.url);
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/application\/zip/);
  expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="leadforge-.*\.zip"$/);
  return readZip(res.body);
}

describe("CRM flow end to end", () => {
  it("adds Overture businesses to a list, moves a stage, logs activity, exports the list and downloads it through a signed link", async () => {
    const owner = await createOwner(h, "flow@example.test", "Flow Org");
    await seedOverture(h);
    const fsq = overtureFixtureRecords().find(
      (r) => r.place.sources?.[0]?.dataset === "Foursquare",
    )!.place.id;
    const ov1 = await ingestOverturePlace(h, owner.orgId, sampleId(1));
    const ov2 = await ingestOverturePlace(h, owner.orgId, fsq);
    const [own, evil] = await seedBusinesses(h, owner.orgId, [
      { name: "Imported Only (Sample)" },
      { name: "Evil Formula (Sample)" },
    ]);
    await mongo()
      .collection(Collections.businesses)
      .updateOne(
        { _id: new ObjectId(evil!) },
        { $set: { "name.value": '=HYPERLINK("http://evil.example")' } },
      );

    const list = (await call(owner, "post", "/lists", { name: "Flow list" }).expect(201)).body
      .data as Json;
    await call(owner, "post", `/lists/${list.id}/items`, {
      businessIds: [ov1, ov2, own, evil],
    }).expect(200);
    const lead = (await call(owner, "post", "/pipeline/leads", { businessId: ov1 }).expect(201))
      .body.data as Json;
    await call(owner, "post", `/pipeline/leads/${lead.id}/move`, {
      stageKey: "contacted",
      version: lead.version,
    }).expect(200);
    await call(owner, "post", "/activities", {
      businessId: ov1,
      type: "call",
      outcome: "connected",
      body: "Spoke to the pharmacist",
    }).expect(201);

    const done = await runExport(owner, {
      kind: "list",
      listId: list.id,
      columns: ["id", "name", "sources", "source_licenses", "attribution", "license_urls"],
    });
    expect(done).toMatchObject({
      status: "completed",
      kind: "list",
      format: "zip",
      scope: "all",
      rowCount: 4,
      truncated: false,
      selection: { listId: list.id, listName: "Flow list" },
      file: {
        available: true,
        licenses: expect.arrayContaining([
          "CDLA-Permissive-2.0",
          "Apache-2.0",
          "ODbL-1.0",
          "CC-BY-4.0",
        ]),
      },
    });
    const files = await fetchZip(owner, done.id);
    const names = [...files.keys()];
    expect(names[0]).toMatch(/^leadforge-list-.*\.csv$/);
    expect(names).toEqual(
      expect.arrayContaining([
        "ATTRIBUTION.txt",
        "LICENSES/CDLA-Permissive-2.0.txt",
        "LICENSES/Apache-2.0.txt",
        "LICENSES/ODbL-1.0.txt",
        "LICENSES/CC-BY-4.0.txt",
        "LICENSES/FOURSQUARE-NOTICE.txt",
      ]),
    );
    const csv = files.get(names[0]!)!.toString("utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([
      "id",
      "name",
      "sources",
      "source_licenses",
      "attribution",
      "license_urls",
    ]);
    const byId = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
    expect(Object.keys(byId).sort()).toEqual([ov1, ov2, own, evil].sort());
    expect(byId[evil!]![1]).toBe('\'=HYPERLINK("http://evil.example")');
    expect(byId[ov2!]![3]).toBe("Apache-2.0");
    expect(byId[ov1!]![4]).toMatch(/^Source: Overture Maps Foundation \(overturemaps.org\)/);
    expect(byId[ov1!]![5]).toMatch(/http:\/\/localhost:4000\/api\/v1\/public\/data-licenses\//);
    expect(byId[own!]![4]).toBe("");
    const attribution = files.get("ATTRIBUTION.txt")!.toString("utf8");
    expect(attribution).toMatch(/2 of 4 rows carry openly licensed data/);
    expect(attribution).toMatch(/Foursquare/);
    expect(attribution).toMatch(/Changes made by LeadForge/);
    expect(files.get("LICENSES/Apache-2.0.txt")!.toString()).toMatch(/Apache License/);
    expect(files.get("LICENSES/FOURSQUARE-NOTICE.txt")!.toString()).toMatch(
      /Foursquare OS Places Notice/,
    );

    await pollUntil(owner, "/notifications", (d) =>
      (d as unknown as Json[]).some(
        (n) => n.type === "export.completed" && n.href === `/app/jobs/exports/${done.id}`,
      ),
    );
    expect((await call(owner, "get", "/jobs?kind=export").expect(200)).body.data).toEqual([
      expect.objectContaining({
        id: done.id,
        kind: "export",
        status: "completed",
        name: 'Export of list "Flow list"',
      }),
    ]);
    const audit = (
      await mongo()
        .collection(Collections.auditEvents)
        .find({ organizationId: owner.orgId, resourceId: done.id })
        .toArray()
    )
      .map((a) => a.action)
      .sort();
    expect(audit).toEqual(["export.downloaded", "export.finished", "export.requested"]);
  });
});

describe("signed export links opened by a browser (Stage 8)", () => {
  it("answers a failed navigation with 303 to the export page and ?downloadError=<code>, and keeps the JSON error for scripts", async () => {
    const owner = await createOwner(h, "navigate@example.test", "Navigate Org");
    await seedBusinesses(h, owner.orgId, [{ name: "Navigated (Sample)" }]);
    const done = await runExport(owner, { kind: "directory", filter: {} });
    const link = (await call(owner, "get", `/exports/${done.id}/download-url`).expect(200)).body
      .data as Json;
    // APP_URL in tests is http://localhost:3000: the Location is that origin, a fixed path, the export id and a fixed code.
    const page = (code: string, id: string = done.id) =>
      `http://localhost:3000/app/jobs/exports/${id}?downloadError=${code}`;

    // A good link still downloads when the browser navigates to it.
    const ok = await navigate(owner.agent, link.url);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/application\/zip/);

    // Tampered: 303 for both navigation signals; no body worth reading, nothing cached.
    const tampered = new URL(link.url);
    tampered.searchParams.set("sig", `${tampered.searchParams.get("sig")!.slice(0, -2)}AA`);
    for (const how of ["fetch-metadata", "accept-html"] as const) {
      const res = await navigate(owner.agent, tampered.toString(), how);
      expect(res.status, how).toBe(303);
      expect(res.headers.location, how).toBe(page("DOWNLOAD_LINK_INVALID"));
      expect(res.headers["cache-control"], how).toBe("no-store");
    }
    // Requests that are not navigations keep the JSON envelope: no Accept, JSON, */*, or a fetch() from script.
    expect((await download(owner.agent, tampered.toString())).json?.error.code).toBe(
      "DOWNLOAD_LINK_INVALID",
    );
    const path = `${tampered.pathname}${tampered.search}`;
    for (const headers of [
      { Accept: "application/json" },
      { Accept: "*/*" },
      { Accept: "*/*", "Sec-Fetch-Mode": "cors" },
      { Accept: "application/json, text/html;q=0.5" },
    ]) {
      const res = await owner.agent.get(path).set(headers).redirects(0);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.body.error.code, JSON.stringify(headers)).toBe("DOWNLOAD_LINK_INVALID");
    }
    // Someone else's link is the same invalid-link page for them.
    const admin = await addMember(h, owner.orgId, "admin", "navigate-admin@example.test");
    expect((await navigate(admin.agent, link.url)).headers.location).toBe(
      page("DOWNLOAD_LINK_INVALID"),
    );

    // Expired link.
    const exportsService = h.app.get(ExportsService, { strict: false });
    const actor = { userId: owner.userId, permissions: ROLE_PERMISSIONS.owner };
    const stale = await exportsService.downloadLink(
      owner.orgId,
      actor,
      done.id,
      new Date(Date.now() - 60 * 60 * 1000),
    );
    const expired = await navigate(owner.agent, stale.url);
    expect(expired.status).toBe(303);
    expect(expired.headers.location).toBe(page("DOWNLOAD_LINK_EXPIRED"));

    // A damaged query (signature cut off) is an invalid link; a malformed export id has no page to go back to, so it stays JSON.
    const damaged = new URL(link.url);
    damaged.searchParams.delete("sig");
    expect((await navigate(owner.agent, damaged.toString())).headers.location).toBe(
      page("DOWNLOAD_LINK_INVALID"),
    );
    const badId = await navigate(
      owner.agent,
      link.url.replace(`/exports/${done.id}/`, "/exports/not-an-export/"),
    );
    expect(badId.status).toBe(400);
    expect(badId.json?.error.code).toBe("VALIDATION_FAILED");

    // Never an open redirect: Host and forwarding headers do not change the Location, and the id is normalized.
    const spoofed = await navigate(owner.agent, tampered.toString(), "fetch-metadata", {
      Host: "evil.example",
      "X-Forwarded-Host": "evil.example",
      "X-Forwarded-Proto": "https",
      Referer: "https://evil.example/",
    });
    expect(spoofed.headers.location).toBe(page("DOWNLOAD_LINK_INVALID"));
    const upper = await navigate(
      owner.agent,
      tampered.toString().replace(`/exports/${done.id}/`, `/exports/${done.id.toUpperCase()}/`),
    );
    expect(upper.headers.location).toBe(page("DOWNLOAD_LINK_INVALID"));

    // Not ready: a correctly signed link for an export that is still queued (no worker is running).
    const queued = (
      await call(owner, "post", "/exports", { kind: "directory", filter: {} }).expect(202)
    ).body.data as Json;
    const expires = Math.floor(Date.now() / 1000) + 600;
    const sig = h.app
      .get(DownloadSigner, { strict: false })
      .sign({ organizationId: owner.orgId, exportId: queued.id, userId: owner.userId, expires });
    const queuedUrl = `http://localhost:4000/api/v1/exports/${queued.id}/download?${new URLSearchParams({ org: owner.orgId, expires: String(expires), sig }).toString()}`;
    expect((await navigate(owner.agent, queuedUrl)).headers.location).toBe(
      page("EXPORT_NOT_READY", queued.id),
    );
    expect((await download(owner.agent, queuedUrl)).json?.error.code).toBe("EXPORT_NOT_READY");

    // File past retention.
    await mongo()
      .collection(Collections.exportJobs)
      .updateOne({ _id: new ObjectId(done.id) }, { $set: { "file.deletedAt": new Date() } });
    const gone = await navigate(owner.agent, link.url);
    expect(gone.status).toBe(303);
    expect(gone.headers.location).toBe(page("EXPORT_EXPIRED"));
    expect((await download(owner.agent, link.url)).status).toBe(410);

    // Failures outside the download codes stay JSON even for a navigation: no longer a member.
    // (Signed out is the sign-in redirect, Stage 9, below.)
    await h.prisma.membership.delete({
      where: { organizationId_userId: { organizationId: owner.orgId, userId: admin.userId } },
    });
    const adminSig = h.app
      .get(DownloadSigner, { strict: false })
      .sign({ organizationId: owner.orgId, exportId: done.id, userId: admin.userId, expires });
    const removed = await navigate(
      admin.agent,
      `http://localhost:4000/api/v1/exports/${done.id}/download?${new URLSearchParams({ org: owner.orgId, expires: String(expires), sig: adminSig }).toString()}`,
    );
    expect(removed.status).toBe(403);
    expect(removed.json?.error.code).toBe("ORG_FORBIDDEN");
  });

  it("sends a signed-out browser to sign in with next=/app/jobs/exports/<id>, and keeps the JSON 401 for scripts (Stage 9)", async () => {
    const owner = await createOwner(h, "signed-out@example.test", "Signed Out Org");
    // The guard refuses before anything is looked up, so the answer is the same for any export id (nothing about the export leaks).
    const exportId = new ObjectId().toHexString();
    const expires = Math.floor(Date.now() / 1000) + 600;
    const sig = h.app
      .get(DownloadSigner, { strict: false })
      .sign({ organizationId: owner.orgId, exportId, userId: owner.userId, expires });
    const url = `http://localhost:4000/api/v1/exports/${exportId}/download?${new URLSearchParams({ org: owner.orgId, expires: String(expires), sig }).toString()}`;
    // APP_URL in tests is http://localhost:3000: a fixed path and the validated, lower-cased id, nothing else from the request.
    const signIn = `http://localhost:3000/sign-in?next=/app/jobs/exports/${exportId}`;

    for (const how of ["fetch-metadata", "accept-html"] as const) {
      const res = await navigate(h.agent(), url, how);
      expect(res.status, how).toBe(303);
      expect(res.headers.location, how).toBe(signIn);
      expect(res.headers["cache-control"], how).toBe("no-store");
    }
    // An access token that ran out is signed out too for a navigation (the browser cannot refresh it on its own).
    const bearer = { Authorization: `Bearer ${await expiredAccessToken(h, owner.userId)}` };
    const expired = await navigate(h.agent(), url, "fetch-metadata", bearer);
    expect(expired.status).toBe(303);
    expect(expired.headers.location).toBe(signIn);

    // Not a navigation: the JSON 401 as before (no Accept, JSON, */*, a fetch() from script).
    const scripted = await download(h.agent(), url);
    expect(scripted.status).toBe(401);
    expect(scripted.json?.error.code).toBe("UNAUTHENTICATED");
    const path = `${new URL(url).pathname}${new URL(url).search}`;
    for (const headers of [
      { Accept: "application/json" },
      { Accept: "*/*" },
      { Accept: "*/*", "Sec-Fetch-Mode": "cors" },
      { Accept: "application/json, text/html;q=0.5" },
    ]) {
      const res = await h.agent().get(path).set(headers).redirects(0);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.body.error.code, JSON.stringify(headers)).toBe("UNAUTHENTICATED");
    }
    const scriptedExpired = await h
      .agent()
      .get(path)
      .set({ Accept: "application/json", ...bearer })
      .redirects(0);
    expect(scriptedExpired.status).toBe(401);
    expect(scriptedExpired.body.error.code).toBe("TOKEN_EXPIRED");

    // Never an open redirect: Host, X-Forwarded-*, Referer, Origin and extra query parameters do not change the Location.
    const spoofHeaders = {
      Host: "evil.example",
      "X-Forwarded-Host": "evil.example",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Prefix": "//evil.example",
      "X-Original-URL": "//evil.example/",
      Referer: "https://evil.example/app/jobs/exports",
      Origin: "https://evil.example",
    };
    for (const how of ["fetch-metadata", "accept-html"] as const) {
      const spoofed = await navigate(
        h.agent(),
        `${url}&next=https://evil.example/&redirect=//evil.example`,
        how,
        spoofHeaders,
      );
      expect(spoofed.status, how).toBe(303);
      expect(spoofed.headers.location, how).toBe(signIn);
    }
    expect(
      (
        await navigate(
          h.agent(),
          url.replace(`/exports/${exportId}/`, `/exports/${exportId.toUpperCase()}/`),
        )
      ).headers.location,
    ).toBe(signIn);
    // An id that is not an export id has no page to return to: the JSON 401, even for a navigation.
    for (const bad of ["not-an-export", "%2F%2Fevil.example", "..%2F..%2Fevil"]) {
      const res = await navigate(
        h.agent(),
        url.replace(`/exports/${exportId}/`, `/exports/${bad}/`),
      );
      expect(res.status, bad).toBe(401);
      expect(res.json?.error.code, bad).toBe("UNAUTHENTICATED");
      expect(res.headers.location, bad).toBeUndefined();
    }
  });
});

describe("export jobs", () => {
  it("enforces the row cap from the entitlement (EXPORT_TOO_LARGE) and the default without one", async () => {
    const owner = await createOwner(h, "cap@example.test", "Cap Org");
    await seedBusinesses(h, owner.orgId, [{ name: "Cap 1" }, { name: "Cap 2" }, { name: "Cap 3" }]);
    const customer = await h.prisma.billingCustomer.findUniqueOrThrow({
      where: { organizationId: owner.orgId },
    });
    await h.prisma.entitlement.create({
      data: {
        id: newId(),
        billingCustomerId: customer.id,
        key: "export_row_cap",
        valueInt: 2,
        source: "override",
      },
    });
    const refused = await call(owner, "post", "/exports", { kind: "directory", filter: {} }).expect(
      422,
    );
    expect(refused.body.error).toMatchObject({
      code: "EXPORT_TOO_LARGE",
      details: [{ path: "rowCap", message: "2" }, { path: "matched" }],
    });
    const narrow = await runExport(owner, { kind: "directory", filter: { q: "Cap 1" } });
    expect(narrow).toMatchObject({ status: "completed", rowCap: 2, rowCount: 1 });
    await h.prisma.entitlement.deleteMany({ where: { billingCustomerId: customer.id } });
    const all = await runExport(owner, { kind: "directory", filter: {} });
    expect(all).toMatchObject({ rowCap: 10_000, rowCount: 3, matchedAtRequest: 3 });
    // The synchronous export keeps its 1,000-row behaviour.
    const sync = await owner.agent
      .post(`${API}/exports/businesses`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ columns: ["name"] })
      .expect(200);
    expect(sync.headers["x-export-row-count"]).toBe("3");
  });

  it("limits sales representatives to businesses whose lead is assigned to them, async and sync", async () => {
    team = await createTeam(h, "scope");
    const [mine, theirs, none] = await seedBusinesses(h, team.owner.orgId, [
      { name: "Mine (Sample)" },
      { name: "Theirs (Sample)" },
      { name: "Nobody's (Sample)" },
    ]);
    await call(team.owner, "post", "/pipeline/leads", {
      businessId: mine,
      assignedToUserId: team.sales_rep.userId,
    }).expect(201);
    await call(team.owner, "post", "/pipeline/leads", {
      businessId: theirs,
      assignedToUserId: team.admin.userId,
    }).expect(201);
    const list = (await call(team.owner, "post", "/lists", { name: "Everyone" }).expect(201)).body
      .data as Json;
    await call(team.owner, "post", `/lists/${list.id}/items`, {
      businessIds: [mine, theirs, none],
    }).expect(200);

    const viaList = await runExport(team.sales_rep, {
      kind: "list",
      listId: list.id,
      columns: ["id"],
    });
    expect(viaList).toMatchObject({ scope: "assigned", rowCount: 1, matchedAtRequest: 1 });
    const ids = parseCsv([...(await fetchZip(team.sales_rep, viaList.id)).values()][0]!.toString())
      .slice(1)
      .map((r) => r[0]);
    expect(ids).toEqual([mine]);
    const viaSelection = await runExport(team.sales_rep, {
      kind: "selection",
      ids: [theirs, none],
      columns: ["id"],
    });
    expect(viaSelection).toMatchObject({ scope: "assigned", rowCount: 0 });
    const viaDirectory = await runExport(team.sales_rep, {
      kind: "directory",
      filter: {},
      columns: ["id"],
    });
    expect(viaDirectory.rowCount).toBe(1);
    const researcher = await runExport(team.researcher, {
      kind: "list",
      listId: list.id,
      columns: ["id"],
    });
    expect(researcher).toMatchObject({ scope: "all", rowCount: 3 });

    const sync = await call(team.sales_rep, "post", "/exports/businesses", { columns: ["id"] })
      .buffer(true)
      .expect(200);
    expect(sync.headers["x-export-row-count"]).toBe("1");
    expect(sync.text).toContain(mine);
    expect(sync.text).not.toContain(theirs);

    // Exports are visible to their requester and to owners and admins.
    await call(team.researcher, "get", `/exports/${viaList.id}`).expect(404);
    await call(team.admin, "get", `/exports/${viaList.id}`).expect(200);
    expect((await call(team.sales_rep, "get", "/exports").expect(200)).body.data).toHaveLength(3);
    expect(
      (await call(team.researcher, "get", "/jobs?kind=export").expect(200)).body.data,
    ).toHaveLength(1);
    await call(team.analyst, "get", "/exports").expect(200);
  });

  it("checks signed links: not ready, tampered, someone else's, expired, and files past retention", async () => {
    await seedBusinesses(h, team.owner.orgId, [{ name: "Linked (Sample)" }]);
    const queued = (
      await call(team.owner, "post", "/exports", { kind: "directory", filter: {} }).expect(202)
    ).body.data as Json;
    expect(
      (await call(team.owner, "get", `/exports/${queued.id}/download-url`).expect(409)).body.error
        .code,
    ).toBe("EXPORT_NOT_READY");
    const w = startPhase5Workers(h, ["exports"]);
    let done: Json;
    try {
      done = await pollUntil(team.owner, `/exports/${queued.id}`, isTerminal);
    } finally {
      await w.close();
    }
    const link = (await call(team.owner, "get", `/exports/${done.id}/download-url`).expect(200))
      .body.data as Json;
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    const url = new URL(link.url);

    const tampered = new URL(url);
    tampered.searchParams.set("sig", `${url.searchParams.get("sig")!.slice(0, -2)}AA`);
    expect((await download(team.owner.agent, tampered.toString())).json?.error.code).toBe(
      "DOWNLOAD_LINK_INVALID",
    );
    const longer = new URL(url);
    longer.searchParams.set("expires", String(Number(url.searchParams.get("expires")) + 3600));
    expect((await download(team.owner.agent, longer.toString())).json?.error.code).toBe(
      "DOWNLOAD_LINK_INVALID",
    );
    // The link is bound to the user it was issued to.
    const other = await download(team.admin.agent, link.url);
    expect(other.status).toBe(403);
    expect(other.json?.error.code).toBe("DOWNLOAD_LINK_INVALID");
    // Signed in is required.
    expect((await download(h.agent(), link.url)).status).toBe(401);

    const exportsService = h.app.get(ExportsService, { strict: false });
    const owner = { userId: team.owner.userId, permissions: ROLE_PERMISSIONS.owner };
    const stale = await exportsService.downloadLink(
      team.owner.orgId,
      owner,
      done.id,
      new Date(Date.now() - 60 * 60 * 1000),
    );
    const expired = await download(team.owner.agent, stale.url);
    expect(expired.status).toBe(410);
    expect(expired.json?.error.code).toBe("DOWNLOAD_LINK_EXPIRED");
    expect((await download(team.owner.agent, link.url)).status).toBe(200);

    // A member removed from the organization can no longer use a link issued earlier.
    const adminLink = (
      await call(team.admin, "get", `/exports/${done.id}/download-url`).expect(200)
    ).body.data as Json;
    await h.prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: team.owner.orgId, userId: team.admin.userId },
      },
    });
    expect((await download(team.admin.agent, adminLink.url)).json?.error.code).toBe(
      "ORG_FORBIDDEN",
    );

    // Past retention the maintenance job deletes the file: EXPORT_EXPIRED on both routes.
    const cleaned = await h.app
      .get(ExportBuilder, { strict: false })
      .cleanup(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(cleaned.expired).toBeGreaterThanOrEqual(1);
    expect(
      (await call(team.owner, "get", `/exports/${done.id}`).expect(200)).body.data,
    ).toMatchObject({ status: "expired", file: { available: false } });
    expect(
      (await call(team.owner, "get", `/exports/${done.id}/download-url`).expect(410)).body.error
        .code,
    ).toBe("EXPORT_EXPIRED");
    const gone = await download(team.owner.agent, link.url);
    expect(gone.status).toBe(410);
    expect(gone.json?.error.code).toBe("EXPORT_EXPIRED");
  });
});
