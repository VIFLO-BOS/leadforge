import { describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { GooglePlacesAdapter } from "./google-places/google-places.adapter.js";
import {
  GOOGLE_PLACES_POLICY,
  GOOGLE_PLACES_TERMS_BLOCK,
} from "./google-places/google-places.policy.js";
import { FixturePlacesTransport, HttpPlacesTransport } from "./google-places/places-transport.js";
import type { SourceConfigRepository } from "./repositories/source-config.repository.js";
import { SourcesService } from "./sources.service.js";

const configs = {
  listForOrganization: async () => [],
  findForSource: async () => null,
} as unknown as SourceConfigRepository;
const audit = {} as AuditService;
const ORG = "0192c9a8-0000-7000-8000-000000000001";

describe("Google Places is unavailable under its terms", () => {
  it("states the terms block with the sections that forbid storage and directory use", () => {
    expect(GOOGLE_PLACES_POLICY.blockedByTerms?.detail).toBe(GOOGLE_PLACES_TERMS_BLOCK);
    expect(GOOGLE_PLACES_TERMS_BLOCK).toMatch(/last modified 2026-08-26/);
    expect(GOOGLE_PLACES_TERMS_BLOCK).toMatch(/\(a\)\(iii\)/);
    expect(GOOGLE_PLACES_TERMS_BLOCK).toMatch(/\(b\)/);
    expect(GOOGLE_PLACES_TERMS_BLOCK).toMatch(/\(d\)\(iii\)/);
    expect(GOOGLE_PLACES_POLICY.licensing).toBeNull();
  });

  for (const [label, transport] of [
    ["without a key", null],
    ["with a key", new HttpPlacesTransport("test-key-not-real")],
    ["in fixture mode", new FixturePlacesTransport()],
  ] as const) {
    it(`is never runnable ${label}`, async () => {
      const service = new SourcesService([new GooglePlacesAdapter(transport)], configs, audit);
      const entry = (await service.list(ORG)).find((e) => e.key === "google_places")!;
      expect(entry).toMatchObject({
        status: "not_available",
        statusReason: "provider_terms",
        statusDetail: GOOGLE_PLACES_TERMS_BLOCK,
      });
      const r = await service.runnability(ORG, "google_places");
      expect(r).toMatchObject({
        runnable: false,
        blocker: { code: "SOURCE_POLICY_BLOCKED", source: "google_places" },
      });
      await expect(service.requireRunnable(ORG, "google_places")).rejects.toMatchObject({
        code: "SOURCE_POLICY_BLOCKED",
      });
      const [option] = await service.discoveryOptions(ORG);
      expect(option).toMatchObject({
        key: "google_places",
        status: "not_available",
        statusReason: "provider_terms",
        runnable: false,
        licensing: null,
      });
    });
  }
});
