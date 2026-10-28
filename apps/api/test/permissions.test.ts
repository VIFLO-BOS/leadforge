import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationRole } from "@leadforge/contracts";
import { addMember, API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, csvBuffer, seedBusinesses, type OrgUser } from "./fixtures.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

type Expect = Record<OrganizationRole, number>;
const ALL_READ: Expect = { owner: 200, admin: 200, researcher: 200, sales_rep: 200, analyst: 200 };
/** docs/SECURITY_AND_DATA_COLLECTION.md section 2: create or edit businesses, corrections, suppress. */
const WRITE = (ok: number): Expect => ({
  owner: ok,
  admin: ok,
  researcher: ok,
  sales_rep: 403,
  analyst: 403,
});
/** Export: every role but sales reps exports everything; sales reps export only leads assigned to them (Phase 5). */
const EXPORT: Expect = { owner: 200, admin: 200, researcher: 200, sales_rep: 200, analyst: 200 };

describe("permission matrix for business records", () => {
  it("enforces read, write and export permissions per role", async () => {
    const owner = await createOwner(h, "perm-owner@example.test", "Perm Org");
    const users: Record<OrganizationRole, OrgUser> = { owner } as Record<OrganizationRole, OrgUser>;
    for (const role of ["admin", "researcher", "sales_rep", "analyst"] as const) {
      const m = await addMember(h, owner.orgId, role, `perm-${role}@example.test`);
      users[role] = { agent: m.agent, orgId: owner.orgId, userId: m.userId };
    }
    const [businessId] = await seedBusinesses(h, owner.orgId, [
      { name: "Target", phones: ["0803 123 4567"], website: "target.example.test" },
    ]);

    const results: Array<{
      role: OrganizationRole;
      name: string;
      status: number;
      expected: number;
    }> = [];
    for (const role of Object.keys(users) as OrganizationRole[]) {
      const u = users[role];
      const hdr = orgHeaders(u.agent, u.orgId);
      const run = async (
        name: string,
        expected: Expect,
        req: () => Promise<{ status: number }>,
      ) => {
        const res = await req();
        results.push({ role, name, status: res.status, expected: expected[role] });
      };

      await run("list", ALL_READ, () => u.agent.get(`${API}/businesses`).set(hdr));
      await run("facets", ALL_READ, () => u.agent.get(`${API}/businesses/facets`).set(hdr));
      await run("detail", ALL_READ, () => u.agent.get(`${API}/businesses/${businessId}`).set(hdr));
      await run("observations", ALL_READ, () =>
        u.agent.get(`${API}/businesses/${businessId}/observations`).set(hdr),
      );
      await run("verification-events", ALL_READ, () =>
        u.agent.get(`${API}/businesses/${businessId}/verification-events`).set(hdr),
      );
      await run("imports list", ALL_READ, () => u.agent.get(`${API}/imports`).set(hdr));
      await run("sources", ALL_READ, () => u.agent.get(`${API}/sources`).set(hdr));
      await run("overview", ALL_READ, () => u.agent.get(`${API}/reports/overview`).set(hdr));

      await run("correct", WRITE(200), () =>
        u.agent
          .patch(`${API}/businesses/${businessId}`)
          .set(hdr)
          .send({ field: "name", value: `Target by ${role}` }),
      );
      await run("create", WRITE(201), () =>
        u.agent
          .post(`${API}/businesses`)
          .set(hdr)
          .send({ name: `Created by ${role}` }),
      );
      await run("suppress", WRITE(200), () =>
        u.agent
          .post(`${API}/businesses/${businessId}/suppress`)
          .set(hdr)
          .send({ scope: "business", reason: `by ${role}` }),
      );
      await run("unsuppress", WRITE(200), () =>
        u.agent.delete(`${API}/businesses/${businessId}/suppression`).set(hdr),
      );
      await run("upload", WRITE(201), () =>
        u.agent
          .post(`${API}/imports`)
          .set(hdr)
          .attach("file", csvBuffer(["Name", `Row by ${role}`]), {
            filename: "x.csv",
            contentType: "text/csv",
          }),
      );
      await run("export", EXPORT, () =>
        u.agent
          .post(`${API}/exports/businesses`)
          .set(hdr)
          .send({ columns: ["name"] }),
      );
    }

    const mismatches = results.filter((r) => r.status !== r.expected);
    expect(mismatches).toEqual([]);
    // Denials use the standard error code.
    const denied = await users.analyst.agent
      .patch(`${API}/businesses/${businessId}`)
      .set(orgHeaders(users.analyst.agent, owner.orgId))
      .send({ field: "name", value: "nope" })
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("lets only writers preview and commit an import", async () => {
    const owner = await createOwner(h, "perm-import@example.test", "Import Perm Org");
    const analyst = await addMember(h, owner.orgId, "analyst", "perm-import-analyst@example.test");
    const up = await owner.agent
      .post(`${API}/imports`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .attach("file", csvBuffer(["Name", "Acme"]), { filename: "x.csv", contentType: "text/csv" })
      .expect(201);
    const hdr = orgHeaders(analyst.agent, owner.orgId);
    await analyst.agent.get(`${API}/imports/${up.body.data.id}`).set(hdr).expect(200);
    await analyst.agent.get(`${API}/imports/${up.body.data.id}/rows`).set(hdr).expect(200);
    await analyst.agent
      .post(`${API}/imports/${up.body.data.id}/preview`)
      .set(hdr)
      .send({ mapping: [{ column: 0, field: "name" }] })
      .expect(403);
    await analyst.agent
      .post(`${API}/imports/${up.body.data.id}/commit`)
      .set(hdr)
      .send({ mapping: [{ column: 0, field: "name" }], attestLawfulBasis: true })
      .expect(403);
  });
});
