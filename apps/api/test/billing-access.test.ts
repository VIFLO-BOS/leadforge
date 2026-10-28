import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrganizationRole } from "@leadforge/contracts";
import { PaymentSettlementService } from "@leadforge/core";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, type OrgUser } from "./fixtures.js";
import { createTeam, download, ROLES } from "./phase5-helpers.js";
import {
  billingEnv,
  startFakePaystack,
  transactionData,
  type FakePaystack,
} from "./paystack-fake.js";
import { createPack, createPlan } from "./billing-helpers.js";

describe("Billing permission matrix and tenant isolation (Phase 6)", () => {
  let fake: FakePaystack;
  let h: Harness;
  let team: Record<OrganizationRole, OrgUser>;
  let outsider: OrgUser;
  let reference: string;
  let paymentId: string;
  let invoiceId: string;
  let packId: string;

  beforeAll(async () => {
    fake = await startFakePaystack();
    h = await createHarness(billingEnv(fake));
    await h.resetState();
    team = await createTeam(h, "billacc");
    outsider = await createOwner(h, "billacc-outsider@example.test", "Outsider Org");
    const pack = await createPack(h, { credits: 50, priceMinor: 150_000 });
    packId = pack.id;
    await createPlan(h, { priceMinor: 300_000 });
    const res = await team.owner.agent
      .post(`${API}/billing/checkout/credits`)
      .set(orgHeaders(team.owner.agent, team.owner.orgId))
      .set("Idempotency-Key", randomUUID())
      .send({ packId })
      .expect(201);
    reference = res.body.data.reference;
    paymentId = res.body.data.paymentId;
    fake.transactions.set(reference, transactionData({ reference, amount: 150_000 }));
    expect(
      await h.app
        .get(PaymentSettlementService, { strict: false })
        .verifyAndSettle(paymentId, { trigger: "webhook" }),
    ).toBe("granted");
    invoiceId = (await h.prisma.invoice.findFirstOrThrow()).id;
  });
  afterAll(async () => {
    await h?.close();
    await fake?.close();
  });

  const send = (
    u: OrgUser,
    method: "get" | "post",
    path: string,
    body?: object,
    orgId = team.owner.orgId,
  ) => {
    const req = u.agent[method](`${API}${path}`)
      .set(orgHeaders(u.agent, orgId))
      .set("Idempotency-Key", randomUUID());
    return method === "get" ? req : req.send(body ?? {});
  };

  it("billing management is owner and admin only; banners are for everyone", async () => {
    const managed: Array<[method: "get" | "post", path: () => string, body?: () => object]> = [
      ["get", () => "/billing/overview"],
      ["get", () => "/billing/plans"],
      ["get", () => "/billing/payments"],
      ["get", () => `/billing/payments/${reference}`],
      ["post", () => `/billing/payments/${reference}/verify`],
      ["get", () => "/billing/invoices"],
      ["get", () => `/billing/invoices/${invoiceId}`],
      ["get", () => `/billing/invoices/${invoiceId}/download-url`],
      [
        "post",
        () => "/billing/checkout/credits",
        () => ({ packId: "00000000-0000-7000-8000-000000000000" }),
      ],
      [
        "post",
        () => "/billing/checkout/subscription",
        () => ({ planId: "00000000-0000-7000-8000-000000000000" }),
      ],
      ["post", () => "/billing/subscription/cancel"],
      ["post", () => "/billing/subscription/resume"],
      ["get", () => "/billing/subscription/manage-link"],
    ];
    for (const role of ROLES) {
      const u = team[role];
      for (const [method, path, body] of managed) {
        const res = await send(u, method, path(), body?.());
        if (role === "owner" || role === "admin")
          expect(res.status, `${role} ${method} ${path()}`).not.toBe(403);
        else {
          expect(res.status, `${role} ${method} ${path()}`).toBe(403);
          expect(res.body.error.code).toBe("FORBIDDEN");
        }
      }
      const banners = await send(u, "get", "/billing/banners");
      expect(banners.status, `${role} banners`).toBe(200);
      // Refunds are owner-only (admins included in the 403).
      const refund = await send(u, "post", `/billing/payments/${paymentId}/refund`, {
        reason: "Matrix check",
        amountMinor: 1,
      });
      if (role === "owner") expect(refund.status).toBe(202);
      else expect(refund.status, `${role} refund`).toBe(403);
    }
  });

  it("another organization cannot see or act on this organization's payments and invoices", async () => {
    const o = outsider;
    const own = (method: "get" | "post", path: string, body?: object) =>
      send(o, method, path, body, o.orgId);
    for (const [method, path, body] of [
      ["get", `/billing/payments/${reference}`],
      ["get", `/billing/payments/${paymentId}`],
      ["post", `/billing/payments/${reference}/verify`],
      ["post", `/billing/payments/${paymentId}/refund`, { reason: "Not mine" }],
      ["get", `/billing/invoices/${invoiceId}`],
      ["get", `/billing/invoices/${invoiceId}/download-url`],
    ] as Array<["get" | "post", string, object?]>) {
      const res = await own(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    expect((await own("get", "/billing/payments")).body.data).toEqual([]);
    expect((await own("get", "/billing/invoices")).body.data).toEqual([]);
    // Asserting the other organization's scope is refused outright.
    const forged = await send(o, "get", "/billing/overview", undefined, team.owner.orgId);
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe("ORG_FORBIDDEN");
    // A download link issued to the owner does not work for anyone else, even a member with billing rights.
    const link = await send(team.owner, "get", `/billing/invoices/${invoiceId}/download-url`);
    expect((await download(o.agent, link.body.data.url)).status).toBe(403);
    expect((await download(team.admin.agent, link.body.data.url)).json?.error?.code).toBe(
      "DOWNLOAD_LINK_INVALID",
    );
    expect((await download(team.owner.agent, link.body.data.url)).status).toBe(200);
  });
});
