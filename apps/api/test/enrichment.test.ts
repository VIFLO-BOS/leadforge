import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import { balance, grant, type Json } from "./discovery-helpers.js";
import {
  ALLOW_ALL_ROBOTS,
  createPhase4Harness,
  startPhase4Workers,
  startSites,
  stubDns,
  waitFor,
  type LocalSites,
} from "./phase4-helpers.js";

const SITE = "mamaput.example.test";

const CONTACT_PAGE = `<html><head><title>Contact Mama Put (Sample)</title></head><body>
<main>
  <p>Email: <a href="mailto:hello@mamaput.example.test">hello@mamaput.example.test</a></p>
  <p>Orders: <a href="mailto:orders@mailinator.com">orders@mailinator.com</a></p>
  <p>Call <a href="tel:+442079460101">+44 20 7946 0101</a></p>
  <p>WhatsApp: +44 20 7946 0102</p>
  <a href="https://wa.me/442079460101">Chat with us on WhatsApp</a>
  <a href="https://www.instagram.com/MamaPutKitchen/">Instagram</a>
  <p>Branch line 020 7946 0199</p>
</main></body></html>`;

let h: Harness;
let sites: LocalSites;

beforeAll(async () => {
  sites = await startSites();
  h = await createPhase4Harness({ [SITE]: `127.0.0.1:${sites.port}` });
  stubDns(h, {
    mx: {
      "mamaput.example.test": ["mx.mamaput.example.test"],
      "mailinator.com": ["mx.mailinator.com"],
    },
  });
});
afterAll(async () => {
  await h?.close();
  await sites?.close();
});
beforeEach(async () => {
  await h.resetState();
  sites.sites.set(SITE, {
    "/robots.txt": ALLOW_ALL_ROBOTS,
    "/": {
      body: `<html><head><title>Mama Put (Sample)</title></head><body><a href="/contact">Contact</a></body></html>`,
    },
    "/contact": { body: CONTACT_PAGE },
  });
});

const post = (u: OrgUser, path: string, body: unknown = {}) =>
  u.agent
    .post(`${API}${path}`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object);
const get = (u: OrgUser, path: string) =>
  u.agent.get(`${API}${path}`).set(orgHeaders(u.agent, u.orgId));

async function waitRun(u: OrgUser, id: string): Promise<Json> {
  return waitFor(
    async () => {
      const data = (await get(u, `/enrichment/runs/${id}`).expect(200)).body.data as Json;
      return ["completed", "failed"].includes(data.status) ? data : null;
    },
    30_000,
    `run ${id}`,
  );
}

describe("website contacts enrichment", () => {
  it("records website observations with evidence, verifies own-site phones, confirms WhatsApp and checks emails", async () => {
    const owner = await createOwner(h, "en-owner@example.test", "Enrich Org");
    const [id] = await seedBusinesses(h, owner.orgId, [
      {
        name: "Mama Put (Sample)",
        website: `http://${SITE}`,
        phones: ["+44 20 7946 0101"],
        emails: ["info@mamaput.example.test"],
      },
    ]);
    const started = await post(owner, `/enrichment/businesses/${id}/website-contacts`).expect(202);
    expect(started.body.data).toMatchObject({
      kind: "website_contacts",
      status: "queued",
      trigger: "manual",
      input: { url: `http://${SITE}` },
    });
    // A second request while queued returns the same run.
    expect(
      (await post(owner, `/enrichment/businesses/${id}/website-contacts`).expect(202)).body.data.id,
    ).toBe(started.body.data.id);

    const w = startPhase4Workers(h, ["enrichment"]);
    let run: Json;
    try {
      run = await waitRun(owner, started.body.data.id);
    } finally {
      await w.close();
    }
    expect(run).toMatchObject({
      status: "completed",
      error: null,
      output: { ownSite: true, phonesVerified: 2, whatsappConfirmed: 2 },
    });
    expect(run.output.found).toEqual({ phones: 2, emails: 2, socials: 1, whatsapp: 2 });
    expect(run.output.emailChecks).toEqual(
      expect.arrayContaining([
        { address: "hello@mamaput.example.test", result: "mx_found" },
        { address: "orders@mailinator.com", result: "disposable" },
        { address: "info@mamaput.example.test", result: "mx_found" },
      ]),
    );

    const detail = (await get(owner, `/businesses/${id}`).expect(200)).body.data as Json;
    const phones = Object.fromEntries(detail.phones.map((p: Json) => [p.e164, p]));
    expect(phones["+442079460101"]).toMatchObject({
      state: "verified",
      whatsapp: { status: "confirmed" },
    });
    expect(phones["+442079460102"]).toMatchObject({
      state: "verified",
      whatsapp: { status: "confirmed" },
    });
    // A number written in plain text, without a link or a WhatsApp label, is not collected.
    expect(phones["+442079460199"]).toBeUndefined();
    // Emails are never verified in release 1 (no mailbox probing); the check summary is recorded.
    expect(detail.emails.every((e: Json) => e.state === "unverified")).toBe(true);
    expect(
      detail.emails.find((e: Json) => e.address === "orders@mailinator.com").verification,
    ).toMatchObject({ method: "syntax_mx_disposable", result: "disposable" });
    expect(detail.socials.map((s: Json) => s.url)).toEqual([
      "https://instagram.com/mamaputkitchen",
    ]);
    expect(detail.sources.map((s: Json) => s.source)).toContain("website");

    const observations = (
      await get(owner, `/businesses/${id}/observations?source=website&pageSize=50`).expect(200)
    ).body.data as Json[];
    expect(observations.length).toBe(run.output.observationIds.length);
    const waObs = observations.find(
      (o) => o.field === "whatsapp" && o.fieldKey === "+442079460101",
    )!;
    expect(waObs).toMatchObject({
      collectionMethod: "website_fetch",
      sourceRef: `http://${SITE}/contact`,
      enrichmentRunId: run.id,
    });
    expect(waObs.evidence).toMatchObject({ page: `http://${SITE}/contact` });
    expect(
      waObs.evidence.selector
        .split(" > ")
        .pop()
        .replace(/:nth-of-type\(\d+\)$/, ""),
    ).toBe("a");
    expect(phones["+442079460101"].whatsapp.evidenceObservationId).toBe(waObs.id);

    const events = (
      await get(owner, `/businesses/${id}/verification-events?pageSize=50`).expect(200)
    ).body.data as Json[];
    const methods = events.map((e) => `${e.field}:${e.method}:${e.result}`);
    expect(methods).toEqual(
      expect.arrayContaining([
        "phone:website_presence:passed",
        "whatsapp:whatsapp_link:passed",
        "whatsapp:whatsapp_label:passed",
        "email:email_syntax:passed",
        "email:email_mx:passed",
        "email:email_disposable:failed",
        "email:email_disposable:passed",
      ]),
    );
    expect(events.every((e) => e.actorType === "system")).toBe(true);

    const jobs = (await get(owner, "/jobs?kind=enrichment").expect(200)).body.data as Json[];
    expect(jobs[0]).toMatchObject({
      id: run.id,
      kind: "enrichment",
      status: "completed",
      href: `/app/businesses/${id}`,
    });
  });

  it("checks one email on request and refuses an address that is not on the business", async () => {
    const owner = await createOwner(h, "en-email@example.test", "Email Org");
    const [id] = await seedBusinesses(h, owner.orgId, [
      { name: "Email Check (Sample)", emails: ["sales@unknown-domain.example.test"] },
    ]);
    const bad = await post(owner, `/enrichment/businesses/${id}/check-email`, {
      address: "other@example.test",
    }).expect(400);
    expect(bad.body.error.details[0]).toMatchObject({ path: "address" });
    const started = await post(owner, `/enrichment/businesses/${id}/check-email`, {
      address: "SALES@unknown-domain.example.test",
    }).expect(202);
    const w = startPhase4Workers(h, ["enrichment"]);
    try {
      const run = await waitRun(owner, started.body.data.id);
      expect(run).toMatchObject({
        kind: "email_check",
        status: "completed",
        output: {
          emailChecks: [{ address: "sales@unknown-domain.example.test", result: "no_mx" }],
        },
      });
    } finally {
      await w.close();
    }
    const events = (await get(owner, `/businesses/${id}/verification-events`).expect(200)).body
      .data as Json[];
    expect(events.map((e) => `${e.method}:${e.result}`).sort()).toEqual([
      "email_disposable:passed",
      "email_mx:failed",
      "email_syntax:passed",
    ]);
    const detail = (await get(owner, `/businesses/${id}`).expect(200)).body.data as Json;
    expect(detail.emails[0]).toMatchObject({
      state: "unverified",
      verification: { result: "no_mx" },
    });
  });

  it("refreshes a business: one analysis credit and a contacts run; 422 WEBSITE_MISSING without a website", async () => {
    const owner = await createOwner(h, "en-refresh@example.test", "Refresh Org");
    await grant(h, owner.orgId, 2);
    const [withSite, noSite] = await seedBusinesses(h, owner.orgId, [
      { name: "Refresh (Sample)", website: `http://${SITE}` },
      { name: "Refresh None (Sample)" },
    ]);
    const res = await post(owner, `/businesses/${withSite}/refresh`).expect(202);
    expect(res.body.data).toMatchObject({
      analysisAlreadyInProgress: false,
      analysis: { status: "queued", trigger: "refresh", credits: { held: 1 } },
      enrichmentRun: { kind: "website_contacts", trigger: "refresh", status: "queued" },
    });
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(1);
    const again = await post(owner, `/businesses/${withSite}/refresh`).expect(202);
    expect(again.body.data.analysisAlreadyInProgress).toBe(true);
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(1);
    const missing = await post(owner, `/businesses/${noSite}/refresh`).expect(422);
    expect(missing.body.error.code).toBe("WEBSITE_MISSING");
    const kinds = ((await get(owner, "/jobs").expect(200)).body.data as Json[])
      .map((j) => j.kind)
      .sort();
    expect(kinds).toEqual(["analysis", "enrichment"]);
  });
});
