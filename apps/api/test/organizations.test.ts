import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "@leadforge/contracts";
import {
  API,
  createHarness,
  csrfFrom,
  orgHeaders,
  registerUser,
  verifyEmail,
  type Harness,
} from "./harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

async function verifiedOwner(email: string, organizationName = "Org") {
  const agent = h.agent();
  const me = await registerUser(agent, { email, organizationName });
  await verifyEmail(h, agent, email);
  return { agent, me, orgId: me.organizations[0]!.id };
}

describe("tenant isolation", () => {
  it("refuses access to another organization even with a valid session", async () => {
    const a = await verifiedOwner("a@example.test", "Org A");
    const b = await verifiedOwner("b@example.test", "Org B");

    const res = await b.agent
      .get(`${API}/organizations/current`)
      .set("X-Organization-Id", a.orgId)
      .expect(403);
    expect(res.body.error.code).toBe("ORG_FORBIDDEN");

    const members = await b.agent
      .get(`${API}/organizations/current/members`)
      .set("X-Organization-Id", a.orgId)
      .expect(403);
    expect(members.body.error.code).toBe("ORG_FORBIDDEN");

    const own = await b.agent
      .get(`${API}/organizations/current`)
      .set("X-Organization-Id", b.orgId)
      .expect(200);
    expect(own.body.data.name).toBe("Org B");
  });

  it("rejects a missing or malformed organization header", async () => {
    const a = await verifiedOwner("hdr@example.test");
    const none = await a.agent.get(`${API}/organizations/current`).expect(403);
    expect(none.body.error.code).toBe("ORG_FORBIDDEN");
    await a.agent
      .get(`${API}/organizations/current`)
      .set("X-Organization-Id", "not-a-uuid")
      .expect(403);
  });
});

describe("organization settings", () => {
  it("lets the owner update settings and records the member count", async () => {
    const a = await verifiedOwner("settings@example.test");
    const res = await a.agent
      .patch(`${API}/organizations/current`)
      .set(orgHeaders(a.agent, a.orgId))
      .send({ name: "Renamed Org", freshnessDays: 90 })
      .expect(200);
    expect(res.body.data.name).toBe("Renamed Org");
    expect(res.body.data.freshnessDays).toBe(90);
    expect(res.body.data.memberCount).toBe(1);
  });

  it("validates settings input", async () => {
    const a = await verifiedOwner("settings2@example.test");
    const res = await a.agent
      .patch(`${API}/organizations/current`)
      .set(orgHeaders(a.agent, a.orgId))
      .send({ freshnessDays: 1 })
      .expect(400);
    expect(res.body.error.details[0].path).toBe("freshnessDays");
  });
});

describe("invitations and roles", () => {
  it("runs the full invite flow and enforces role rules", async () => {
    const owner = await verifiedOwner("owner@example.test", "Team Org");

    // Invite an admin.
    const invite = await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ email: "admin@example.test", role: "admin" })
      .expect(201);
    expect(invite.body.data.role).toBe("admin");

    const pending = await owner.agent
      .get(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(pending.body.data).toHaveLength(1);

    // Preview is public; accept needs a signed-in user whose email matches.
    const token = await h.tokenFromMail("admin@example.test", "/invite/");
    const preview = await h
      .agent()
      .get(`${API}/invitations/${encodeURIComponent(token)}`)
      .expect(200);
    expect(preview.body.data.organizationName).toBe("Team Org");

    const wrongPerson = await verifiedOwner("someone-else@example.test");
    const mismatch = await wrongPerson.agent
      .post(`${API}/invitations/${encodeURIComponent(token)}/accept`)
      .set(CSRF_HEADER, csrfFrom(wrongPerson.agent))
      .expect(403);
    expect(mismatch.body.error.code).toBe("FORBIDDEN");

    const admin = await verifiedOwner("admin@example.test", "Admin Personal Org");
    await admin.agent
      .post(`${API}/invitations/${encodeURIComponent(token)}/accept`)
      .set(CSRF_HEADER, csrfFrom(admin.agent))
      .expect(200);

    const adminMe = await admin.agent.get(`${API}/auth/me`).expect(200);
    const membership = adminMe.body.data.organizations.find(
      (o: { id: string }) => o.id === owner.orgId,
    );
    expect(membership.role).toBe("admin");

    // Admin may invite a researcher but not an owner (schema) and may not touch owners (service).
    await admin.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(admin.agent, owner.orgId))
      .send({ email: "r@example.test", role: "researcher" })
      .expect(201);
    const ownerInvite = await admin.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(admin.agent, owner.orgId))
      .send({ email: "o2@example.test", role: "owner" })
      .expect(400);
    expect(ownerInvite.body.error.code).toBe("VALIDATION_FAILED");

    const demoteOwner = await admin.agent
      .patch(`${API}/organizations/current/members/${owner.me.user.id}`)
      .set(orgHeaders(admin.agent, owner.orgId))
      .send({ role: "analyst" })
      .expect(403);
    expect(demoteOwner.body.error.code).toBe("FORBIDDEN");

    // Owner cannot demote themself while they are the last owner.
    const lastOwner = await owner.agent
      .patch(`${API}/organizations/current/members/${owner.me.user.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ role: "admin" })
      .expect(409);
    expect(lastOwner.body.error.code).toBe("LAST_OWNER");

    // Owner promotes admin to owner, then may step down.
    await owner.agent
      .patch(`${API}/organizations/current/members/${admin.me.user.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ role: "owner" })
      .expect(200);
    await owner.agent
      .patch(`${API}/organizations/current/members/${owner.me.user.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ role: "analyst" })
      .expect(200);

    // Cache invalidation: the demoted user immediately loses members:manage.
    const denied = await owner.agent
      .get(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects inviting an existing member and revokes pending invitations", async () => {
    const owner = await verifiedOwner("own2@example.test");
    const dup = await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ email: "own2@example.test", role: "admin" })
      .expect(409);
    expect(dup.body.error.code).toBe("CONFLICT");

    const inv = await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ email: "pending@example.test", role: "sales_rep" })
      .expect(201);
    await owner.agent
      .delete(`${API}/organizations/current/invitations/${inv.body.data.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(204);
    const token = await h.tokenFromMail("pending@example.test", "/invite/");
    const preview = await h
      .agent()
      .get(`${API}/invitations/${encodeURIComponent(token)}`)
      .expect(400);
    expect(preview.body.error.code).toBe("INVALID_TOKEN");
  });

  it("denies member management to roles without the permission", async () => {
    const owner = await verifiedOwner("own3@example.test", "Perm Org");
    await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ email: "rep@example.test", role: "sales_rep" })
      .expect(201);
    const token = await h.tokenFromMail("rep@example.test", "/invite/");
    const rep = await verifiedOwner("rep@example.test", "Rep Org");
    await rep.agent
      .post(`${API}/invitations/${encodeURIComponent(token)}/accept`)
      .set(CSRF_HEADER, csrfFrom(rep.agent))
      .expect(200);

    await rep.agent
      .get(`${API}/organizations/current/members`)
      .set(orgHeaders(rep.agent, owner.orgId))
      .expect(200);
    const denied = await rep.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(rep.agent, owner.orgId))
      .send({ email: "x@example.test", role: "analyst" })
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    const settings = await rep.agent
      .patch(`${API}/organizations/current`)
      .set(orgHeaders(rep.agent, owner.orgId))
      .send({ name: "Hijack" })
      .expect(403);
    expect(settings.body.error.code).toBe("FORBIDDEN");
  });
});
