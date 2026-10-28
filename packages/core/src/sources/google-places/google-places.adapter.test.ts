import { describe, expect, it, vi } from "vitest";
import { DiscoveryJobSpec, type DiscoveryJobSpecInput } from "@leadforge/contracts";
import { SourceError } from "../source-adapter.js";
import { GOOGLE_PLACES_POLICY } from "./google-places.policy.js";
import {
  GooglePlacesAdapter,
  PLACES_MAX_RESULTS_PER_QUERY,
  addressParts,
} from "./google-places.adapter.js";
import {
  FixturePlacesTransport,
  HttpPlacesTransport,
  PLACES_TEXT_SEARCH_URL,
} from "./places-transport.js";
import { placesFixtureData } from "./places-fixtures.js";
import type { Place } from "./places.types.js";

function spec(overrides: Partial<DiscoveryJobSpecInput> = {}): DiscoveryJobSpec {
  return DiscoveryJobSpec.parse({
    name: "Ikeja restaurants",
    sources: ["google_places"],
    location: { country: "NG", region: "Lagos", locality: "Ikeja" },
    categories: ["Restaurant"],
    maxRecords: 100,
    ...overrides,
  });
}

function fixtureAdapter() {
  const transport = new FixturePlacesTransport();
  return { transport, adapter: new GooglePlacesAdapter(transport) };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

function stubFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no stubbed response");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("Google Places adapter: describe() and configuration", () => {
  it("reports not_configured without a key and never returns made-up results", async () => {
    const adapter = new GooglePlacesAdapter(null);
    expect(adapter.describe()).toMatchObject({
      key: "google_places",
      status: "not_configured",
      fixtureMode: false,
    });
    await expect(collect(adapter.search(spec()))).rejects.toMatchObject({
      code: "SOURCE_NOT_CONFIGURED",
      retryable: false,
    });
    await expect(adapter.fetchRecord("fixture-restaurant-01", spec())).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it("reports configured in fixture mode and says the data is sample data", () => {
    const { adapter } = fixtureAdapter();
    const d = adapter.describe();
    expect(d.status).toBe("configured");
    expect(d.fixtureMode).toBe(true);
    expect(d.statusDetail).toMatch(/fixture/i);
    expect(d.maxResultsPerQuery).toBe(60);
  });

  it("publishes the strict retention policy: place IDs indefinitely, other content not stored", () => {
    const p = GOOGLE_PLACES_POLICY;
    expect(p.contentRetentionMs).toBe(0);
    expect(p.externalIdRetentionMs).toBeNull();
    expect(p.fieldRetention.find((f) => f.field === "place_id")?.retention).toBe("indefinite");
    expect(p.fieldRetention.find((f) => f.field.startsWith("latitude"))?.retention).toBe(
      "not_collected",
    );
    expect(p.fieldRetention.find((f) => f.field.startsWith("name"))?.retention).toBe("none");
    expect(p.attribution).toBe("Google Maps");
    expect(p.termsCheckedAt).toBe("2026-10-25");
    expect(p.terms.map((t) => t.lastModified)).toEqual([
      "2026-08-26",
      "2026-10-15",
      "2026-10-23",
      "2026-10-23",
    ]);
  });
});

describe("Google Places adapter: request format (HTTP transport, stubbed fetch)", () => {
  it("POSTs places:searchText with the key and an explicit field mask in headers", async () => {
    const { fn, calls } = stubFetch([
      { status: 200, body: { places: [], nextPageToken: undefined } },
    ]);
    const adapter = new GooglePlacesAdapter(new HttpPlacesTransport("test-key-not-real", fn));
    await collect(
      adapter.search(
        spec({
          location: {
            country: "NG",
            region: "Lagos State",
            locality: "Ikeja",
            geo: { lat: 6.6, lng: 3.35, radiusM: 5000 },
          },
        }),
      ),
    );
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(PLACES_TEXT_SEARCH_URL);
    expect(call.url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key-not-real");
    expect(headers["X-Goog-FieldMask"]).toBe(
      "places.id,places.attributions,places.displayName,places.formattedAddress,places.addressComponents,places.types,places.primaryType,places.primaryTypeDisplayName,places.businessStatus,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,nextPageToken",
    );
    expect(headers["X-Goog-FieldMask"]).not.toMatch(/\*|places\.location\b|reviews/);
    expect(JSON.parse(String(call.init.body))).toEqual({
      textQuery: "Restaurant in Ikeja, Lagos State, Nigeria",
      pageSize: 20,
      regionCode: "NG",
      languageCode: "en",
      locationBias: { circle: { center: { latitude: 6.6, longitude: 3.35 }, radius: 5000 } },
    });
  });

  it("paginates with nextPageToken, keeping every other parameter identical", async () => {
    const page = (n: number) => Array.from({ length: 20 }, (_, i) => ({ id: `p${n}-${i}` }));
    const { fn, calls } = stubFetch([
      { status: 200, body: { places: page(1), nextPageToken: "tok-2" } },
      { status: 200, body: { places: page(2), nextPageToken: "tok-3" } },
      { status: 200, body: { places: page(3), nextPageToken: "tok-4" } },
    ]);
    const adapter = new GooglePlacesAdapter(new HttpPlacesTransport("k", fn));
    const pages = await collect(adapter.search(spec()));
    // Google returns at most 60 results per query, so a 4th page is never requested.
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.cursor.pageIndex)).toEqual([0, 1, 2]);
    expect(pages[2]!.nextCursor).toBeNull();
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)) as Record<string, unknown>);
    expect(bodies[0]!.pageToken).toBeUndefined();
    expect(bodies[1]!.pageToken).toBe("tok-2");
    expect(bodies[2]!.pageToken).toBe("tok-3");
    const strip = (b: Record<string, unknown>) => ({ ...b, pageToken: undefined });
    expect(strip(bodies[1]!)).toEqual(strip(bodies[0]!));
    expect(strip(bodies[2]!)).toEqual(strip(bodies[0]!));
  });

  it("requests only Pro fields when the job asks for neither phone nor website", () => {
    const adapter = new GooglePlacesAdapter(null);
    const s = spec({ priorityFields: ["phone"] });
    expect(adapter.searchFieldMask(s)).toContain("places.internationalPhoneNumber");
    expect(adapter.searchFieldMask(s)).not.toContain("websiteUri");
    expect(adapter.estimate(s).providerSku).toBe("Text Search Enterprise");
    const pro = spec({ priorityFields: [] });
    expect(adapter.searchFieldMask(pro)).not.toMatch(/PhoneNumber|websiteUri/);
    expect(adapter.estimate(pro).providerSku).toBe("Text Search Pro");
    expect(adapter.detailsFieldMask(pro)).not.toContain("places.");
  });

  it("classifies errors: 429 and 5xx retryable, 400 and 403 permanent, network retryable; the key never appears", async () => {
    const key = "secret-key-123";
    const cases: Array<[{ status: number; body: unknown } | Error, string, boolean]> = [
      [
        {
          status: 429,
          body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } },
        },
        "SOURCE_RATE_LIMITED",
        true,
      ],
      [
        {
          status: 503,
          body: { error: { code: 503, status: "UNAVAILABLE", message: "Try again" } },
        },
        "SOURCE_UNAVAILABLE",
        true,
      ],
      [
        {
          status: 400,
          body: { error: { code: 400, status: "INVALID_ARGUMENT", message: "Bad page token" } },
        },
        "SOURCE_REQUEST_INVALID",
        false,
      ],
      [
        {
          status: 403,
          body: {
            error: { code: 403, status: "PERMISSION_DENIED", message: `API key ${key} not valid` },
          },
        },
        "SOURCE_AUTH_FAILED",
        false,
      ],
      [new TypeError("fetch failed"), "SOURCE_UNAVAILABLE", true],
    ];
    for (const [response, code, retryable] of cases) {
      const { fn } = stubFetch([response]);
      const adapter = new GooglePlacesAdapter(new HttpPlacesTransport(key, fn));
      const err = await collect(adapter.search(spec())).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SourceError);
      expect(err).toMatchObject({ code, retryable });
      expect((err as Error).message).not.toContain(key);
    }
  });

  it("fetches one place with Place Details and returns null on 404", async () => {
    const { fn, calls } = stubFetch([
      { status: 200, body: { id: "abc", displayName: { text: "X (Sample)" } } },
      { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } },
    ]);
    const adapter = new GooglePlacesAdapter(new HttpPlacesTransport("k", fn));
    await expect(adapter.fetchRecord("abc", spec())).resolves.toMatchObject({ id: "abc" });
    await expect(adapter.fetchRecord("gone", spec())).resolves.toBeNull();
    expect(calls[0]!.url).toBe("https://places.googleapis.com/v1/places/abc");
    expect(calls[0]!.init.method).toBe("GET");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Goog-FieldMask"]).toMatch(
      /^id,attributions,displayName/,
    );
  });
});

describe("Google Places adapter: search() over recorded fixtures", () => {
  it("yields pages as an async iterator and moves to the next query when one is exhausted", async () => {
    const { adapter, transport } = fixtureAdapter();
    const pages = await collect(adapter.search(spec({ categories: ["Restaurant", "Pharmacy"] })));
    expect(pages.map((p) => [p.cursor.queryIndex, p.cursor.pageIndex, p.records.length])).toEqual([
      [0, 0, 20],
      [0, 1, 6], // 5 more restaurants plus place 3 repeated, as Text Search sometimes does
      [1, 0, 3],
    ]);
    expect(pages[0]!.nextCursor).toEqual({
      queryIndex: 0,
      pageIndex: 1,
      pageToken: "fixture-page-1",
    });
    expect(pages[1]!.nextCursor).toEqual({ queryIndex: 1, pageIndex: 0, pageToken: null });
    expect(pages[2]!.nextCursor).toBeNull();
    expect(transport.calls.map((c) => c.body?.textQuery)).toEqual([
      "Restaurant in Ikeja, Lagos, Nigeria",
      "Restaurant in Ikeja, Lagos, Nigeria",
      "Pharmacy in Ikeja, Lagos, Nigeria",
    ]);
  });

  it("resumes from a cursor", async () => {
    const { adapter } = fixtureAdapter();
    const pages = await collect(
      adapter.search(spec(), {
        from: { queryIndex: 0, pageIndex: 1, pageToken: "fixture-page-1" },
      }),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]!.records.map((r) => r.id)).toContain("fixture-restaurant-25");
  });

  it("projects the field mask: no phone or website fields when not requested", async () => {
    const { adapter } = fixtureAdapter();
    const [first] = await collect(adapter.search(spec({ priorityFields: [] })));
    expect(first!.records[0]).not.toHaveProperty("internationalPhoneNumber");
    expect(first!.records[0]).not.toHaveProperty("websiteUri");
    expect(first!.records[0]).toHaveProperty("displayName");
  });

  it("returns nothing for a category with no fixtures instead of inventing places", async () => {
    const { adapter } = fixtureAdapter();
    const pages = await collect(adapter.search(spec({ categories: ["Shipyard"] })));
    expect(pages).toEqual([
      { cursor: { queryIndex: 0, pageIndex: 0, pageToken: null }, nextCursor: null, records: [] },
    ]);
  });
});

describe("Google Places adapter: mapToObservations()", () => {
  const collectedAt = new Date("2026-10-25T10:00:00.000Z");
  const places = placesFixtureData().restaurant!;
  const byNumber = (n: number) =>
    places.find((p) => p.id === `fixture-restaurant-${String(n).padStart(2, "0")}`)!;
  const map = (p: Place, s = spec()) =>
    new GooglePlacesAdapter(null).mapToObservations(p, { spec: s, collectedAt });

  it("maps name, Google category, address parts, phone and website with provenance", () => {
    const m = map(byNumber(1));
    expect(m.skip).toBeNull();
    expect(m.externalId).toBe("fixture-restaurant-01");
    expect(m.input!.name.value).toBe("Ikeja Restaurant 01 (Sample)");
    expect(m.input!.categories.map((c) => c.value)).toEqual(["Restaurant"]);
    expect(m.input!.location).toMatchObject({
      street: "1 Sample Street",
      locality: "Ikeja",
      lga: "Ikeja",
      region: "Lagos",
      country: "NG",
    });
    expect(m.input!.location!.formatted).toBe("1 Sample Street, Ikeja, Lagos, Nigeria");
    expect(m.input!.phones).toHaveLength(1);
    expect(m.input!.phones[0]!.e164).toBe("+441134960701");
    expect(m.input!.website).toMatchObject({ domain: "restaurant-01.example.test" });
    expect(m.provenance).toMatchObject({
      sourceRef: "places/fixture-restaurant-01",
      categoryTaxonomy: "google",
      attribution: "Google Maps",
    });
  });

  it("never infers WhatsApp from a Google phone number", () => {
    for (const p of places) {
      const m = map(p);
      for (const phone of m.input?.phones ?? []) expect(phone.whatsapp).toBe("unknown");
    }
  });

  it("sets the strict retention: content expires when collected, the place ID never does", () => {
    const m = map(byNumber(2));
    expect(m.provenance.expiresAt?.toISOString()).toBe(collectedAt.toISOString());
    expect(m.provenance.externalIdExpiresAt).toBeNull();
  });

  it("skips permanently closed places and places without a name, and warns on temporary closure", () => {
    expect(map(byNumber(5)).skip).toMatchObject({ code: "PERMANENTLY_CLOSED" });
    expect(map(byNumber(5)).input).toBeNull();
    expect(map(byNumber(13)).skip).toMatchObject({ code: "MISSING_NAME" });
    expect(map(byNumber(7)).warnings.map((w) => w.code)).toEqual(["TEMPORARILY_CLOSED"]);
  });

  it("files a social profile URL as a social, not the website", () => {
    const m = map(byNumber(11));
    expect(m.input!.website).toBeNull();
    expect(m.input!.socials[0]).toMatchObject({ platform: "facebook" });
  });

  it("keeps third-party attributions next to Google's", () => {
    expect(map(byNumber(12)).provenance.attribution).toBe(
      "Google Maps; Sample Listings Provider (fixture)",
    );
  });

  it("reads Nigerian address components (state level 1, LGA level 2)", () => {
    expect(
      addressParts([
        { longText: "Wuse", types: ["sublocality", "political"] },
        { longText: "Abuja Municipal", types: ["administrative_area_level_2"] },
        {
          longText: "Federal Capital Territory",
          shortText: "FC",
          types: ["administrative_area_level_1"],
        },
        { longText: "Nigeria", shortText: "NG", types: ["country"] },
      ]),
    ).toEqual({
      street: null,
      locality: "Wuse",
      lga: "Abuja Municipal",
      region: "Federal Capital Territory",
      postalCode: null,
      country: "NG",
    });
  });
});

describe("Google Places adapter: validateSpec() and estimate()", () => {
  const adapter = new GooglePlacesAdapter(null);

  it("needs a place to search and a field Google provides", () => {
    expect(adapter.validateSpec(spec({ location: { country: "NG" } }))[0]).toMatchObject({
      path: "location",
    });
    expect(adapter.validateSpec(spec({ priorityFields: ["email", "whatsapp"] }))[0]).toMatchObject({
      path: "priorityFields",
    });
    expect(adapter.validateSpec(spec())).toEqual([]);
  });

  it("bounds the estimate by 60 results per query and explains it", () => {
    const e = adapter.estimate(spec({ categories: ["Restaurant", "Bakery"], maxRecords: 500 }));
    expect(e).toMatchObject({
      queries: 2,
      maxResults: 2 * PLACES_MAX_RESULTS_PER_QUERY,
      maxRequests: 6,
    });
    expect(e.warnings.join(" ")).toMatch(/at most 60 results per query/);
    expect(adapter.estimate(spec({ maxRecords: 25 })).maxResults).toBe(25);
    expect(
      adapter.estimate(spec({ priorityFields: ["phone", "email"] })).warnings.join(" "),
    ).toMatch(/does not provide email/);
  });
});
