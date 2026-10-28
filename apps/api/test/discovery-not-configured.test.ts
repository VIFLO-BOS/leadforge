import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Collections, MongoService } from "@leadforge/db-mongo";
import { HttpPlacesTransport, PLACES_TRANSPORT } from "@leadforge/core";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner } from "./fixtures.js";
import { balance, createJob, grant, spec } from "./discovery-helpers.js";
import { forgetOverture } from "./overture-helpers.js";

// A Google key is set on purpose: Google Places must stay unavailable under its terms anyway.
// No Overture snapshot is loaded: Overture is not configured until the first sync.
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ GOOGLE_PLACES_API_KEY: "test-key-not-real" });
});
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.resetState();
  forgetOverture(h);
});
afterEach(() => vi.restoreAllMocks());

describe("sources that cannot run", () => {
  it("never runs Google Places, with or without a key, and reports Overture as waiting for its first sync", async () => {
    expect(h.app.get(PLACES_TRANSPORT, { strict: false })).toBeInstanceOf(HttpPlacesTransport);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const owner = await createOwner(h, "nokey@example.test", "No Source Org");
    await grant(h, owner.orgId, 100);
    const hdr = () => orgHeaders(owner.agent, owner.orgId);

    const sources = await owner.agent.get(`${API}/sources`).set(hdr()).expect(200);
    const google = sources.body.data.find((s: { key: string }) => s.key === "google_places");
    expect(google).toMatchObject({
      status: "not_available",
      statusReason: "provider_terms",
      enabled: true,
    });
    expect(google.statusDetail).toMatch(
      /section 3\.2\.3 forbid copying and saving business names and addresses \(a\)\(iii\)/,
    );
    const overture = sources.body.data.find((s: { key: string }) => s.key === "overture_places");
    expect(overture).toMatchObject({ status: "not_configured", statusReason: "snapshot_missing" });
    expect(overture.statusDetail).toMatch(/pnpm overture:sync/);

    const wizard = await owner.agent.get(`${API}/discovery/sources`).set(hdr()).expect(200);
    expect(
      wizard.body.data.map((s: { key: string; runnable: boolean; statusReason: string }) => [
        s.key,
        s.runnable,
        s.statusReason,
      ]),
    ).toEqual([
      ["overture_places", false, "snapshot_missing"],
      ["google_places", false, "provider_terms"],
    ]);

    const est = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(hdr())
      .send(spec())
      .expect(200);
    expect(est.body.data).toMatchObject({
      estimateAvailable: false,
      credits: { hold: 0, sufficient: true },
      blockers: [
        expect.objectContaining({ code: "SOURCE_NOT_CONFIGURED", source: "overture_places" }),
      ],
    });
    const googleEst = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(hdr())
      .send(spec({ sources: ["google_places"] }))
      .expect(200);
    expect(googleEst.body.data.blockers).toEqual([
      expect.objectContaining({ code: "SOURCE_POLICY_BLOCKED", source: "google_places" }),
    ]);
    expect(googleEst.body.data.sources[0]).toMatchObject({
      source: "google_places",
      status: "not_available",
      runnable: false,
    });

    const res = await createJob(owner.agent, owner.orgId, spec()).expect(422);
    expect(res.body.error).toMatchObject({
      code: "SOURCE_NOT_CONFIGURED",
      details: [{ path: "sources", message: "overture_places" }],
    });
    const blocked = await createJob(
      owner.agent,
      owner.orgId,
      spec({ sources: ["google_places"] }),
    ).expect(422);
    expect(blocked.body.error).toMatchObject({
      code: "SOURCE_POLICY_BLOCKED",
      details: [{ path: "sources", message: "google_places" }],
    });
    expect(
      await h.app
        .get(MongoService)
        .database.collection(Collections.discoveryJobs)
        .countDocuments({}),
    ).toBe(0);
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({
      balance: 100,
      held: 0,
      openHolds: 0,
    });
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes("googleapis.com"))).toEqual([]);

    const empty = await owner.agent.get(`${API}/discovery/locations`).set(hdr()).expect(200);
    expect(empty.body.data).toMatchObject({ release: null, states: [] });
    const cats = await owner.agent
      .get(`${API}/discovery/categories?q=pharm`)
      .set(hdr())
      .expect(200);
    expect(cats.body.data[0]).toMatchObject({ key: "pharmacy", places: null });
  });

  it("publishes the registry with coverage, policy and licensing on the public endpoint", async () => {
    const res = await h.agent().get(`${API}/public/sources`).expect(200);
    const google = res.body.data.items.find((s: { key: string }) => s.key === "google_places");
    expect(google).toMatchObject({
      status: "not_available",
      statusReason: "provider_terms",
      config: null,
      policy: { retentionDays: 0 },
    });
    const overture = res.body.data.items.find((s: { key: string }) => s.key === "overture_places");
    expect(overture).toMatchObject({
      kind: "discovery",
      method: "dataset_snapshot",
      policy: { retentionDays: null, licensing: { label: "Overture Maps Foundation" } },
    });
  });
});
