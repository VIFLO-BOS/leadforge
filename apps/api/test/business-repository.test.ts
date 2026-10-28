import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoService, ObjectId, type Document } from "@leadforge/db-mongo";
import { BusinessRepository, buildBusinessFilter, SORT_PATHS } from "@leadforge/core";
import type { BusinessSortField } from "@leadforge/contracts";
import { createHarness, type Harness } from "./harness.js";
import { seedBusinesses } from "./fixtures.js";

let h: Harness;
let repo: BusinessRepository;
const ORG = "0192c9a8-1111-7000-8000-000000000001";
const OTHER = "0192c9a8-2222-7000-8000-000000000002";
const stateCtx = () => ({ now: new Date(), freshnessDays: 180 });

beforeAll(async () => {
  h = await createHarness();
  repo = h.app.get(BusinessRepository, { strict: false });
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

async function walk(
  filter: Document,
  sortField: string,
  direction: 1 | -1,
  pageSize: number,
  org = ORG,
) {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await repo.page(org, filter, { pageSize, cursor, sortField, direction });
    seen.push(...page.items.map((d) => d._id.toHexString()));
    cursor = page.nextCursor;
    pages += 1;
    if (pages > 100) throw new Error("pagination did not terminate");
  } while (cursor);
  return { seen, pages };
}

describe("business repository pagination", () => {
  it("walks ties on the sort value in a stable _id order with no gaps or repeats", async () => {
    await seedBusinesses(
      h,
      ORG,
      Array.from({ length: 23 }, (_, i) => ({ name: `Tie ${String(i).padStart(2, "0")}` })),
    );
    const db = h.app.get(MongoService).database;
    // Force every row to share the same updatedAt: all sort keys tie.
    const same = new Date("2026-10-01T00:00:00.000Z");
    await db
      .collection("businesses")
      .updateMany({ organizationId: ORG }, { $set: { updatedAt: same } });
    const all = (
      await db.collection("businesses").find({ organizationId: ORG }).project({ _id: 1 }).toArray()
    ).map((d) => d._id.toHexString());

    for (const direction of [-1, 1] as const) {
      const { seen, pages } = await walk({ deletedAt: null }, "updatedAt", direction, 5);
      expect(pages).toBe(5);
      expect(new Set(seen).size).toBe(23);
      expect([...seen].sort()).toEqual([...all].sort());
      const expected = [...all].sort();
      expect(seen).toEqual(direction === 1 ? expected : expected.reverse());
    }
  });

  it("stays stable when rows are inserted between pages", async () => {
    await seedBusinesses(
      h,
      ORG,
      Array.from({ length: 10 }, (_, i) => ({ name: `Row ${i}` })),
    );
    const first = await repo.page(
      ORG,
      { deletedAt: null },
      { pageSize: 4, sortField: "createdAt", direction: -1 },
    );
    await seedBusinesses(h, ORG, [{ name: "Newcomer" }]);
    const rest = await walk({ deletedAt: null }, "createdAt", -1, 4);
    const second = await repo.page(
      ORG,
      { deletedAt: null },
      { pageSize: 100, cursor: first.nextCursor, sortField: "createdAt", direction: -1 },
    );
    const firstIds = first.items.map((d) => d._id.toHexString());
    // Continuing from the old cursor never repeats rows from the first page.
    expect(
      second.items.map((d) => d._id.toHexString()).filter((id) => firstIds.includes(id)),
    ).toEqual([]);
    expect(second.items).toHaveLength(6);
    expect(rest.seen).toHaveLength(11);
  });

  it("pages through null sort values in MongoDB order (nulls last descending, first ascending)", async () => {
    const ids = await seedBusinesses(
      h,
      ORG,
      Array.from({ length: 9 }, (_, i) => ({ name: `Verified ${i}` })),
    );
    const db = h.app.get(MongoService).database;
    // Three distinct verification dates, two of them tied; the rest never verified (null).
    await db
      .collection("businesses")
      .updateOne(
        { _id: new ObjectId(ids[0]!) },
        { $set: { lastVerifiedAt: new Date("2026-01-01") } },
      );
    await db
      .collection("businesses")
      .updateOne(
        { _id: new ObjectId(ids[1]!) },
        { $set: { lastVerifiedAt: new Date("2026-02-01") } },
      );
    await db
      .collection("businesses")
      .updateOne(
        { _id: new ObjectId(ids[2]!) },
        { $set: { lastVerifiedAt: new Date("2026-02-01") } },
      );

    const desc = await walk({ deletedAt: null }, "lastVerifiedAt", -1, 2);
    expect(desc.seen).toHaveLength(9);
    expect(new Set(desc.seen).size).toBe(9);
    expect(desc.seen.slice(0, 3).sort()).toEqual([ids[0], ids[1], ids[2]].sort());
    expect(desc.seen[2]).toBe(ids[0]); // oldest verified date comes last among non-null
    const asc = await walk({ deletedAt: null }, "lastVerifiedAt", 1, 2);
    expect(asc.seen).toHaveLength(9);
    expect(new Set(asc.seen).size).toBe(9);
    expect(asc.seen.slice(6)).toEqual([ids[0], ...[ids[1]!, ids[2]!].sort()]);
  });

  it("sorts by name with a nested sort path", async () => {
    await seedBusinesses(h, ORG, [{ name: "charlie" }, { name: "Alpha Ltd" }, { name: "bravo" }]);
    const { seen } = await walk({ deletedAt: null }, SORT_PATHS.name, 1, 1);
    const docs = await Promise.all(seen.map((id) => repo.findById(ORG, id)));
    expect(docs.map((d) => d!.name.value)).toEqual(["Alpha Ltd", "bravo", "charlie"]);
  });

  it("never returns another organization's rows, whatever the filter", async () => {
    await seedBusinesses(h, ORG, [{ name: "Mine" }]);
    await seedBusinesses(h, OTHER, [{ name: "Theirs" }]);
    const { seen } = await walk({}, "_id", -1, 10);
    expect(seen).toHaveLength(1);
    const evil = await repo.page(ORG, { organizationId: OTHER } as Document, {
      pageSize: 10,
      sortField: "_id",
      direction: -1,
    });
    expect(evil.items.map((d) => d.name.value)).toEqual(["Mine"]);
    expect(
      await repo.findById(
        ORG,
        (await repo.page(OTHER, {}, { pageSize: 1, sortField: "_id", direction: -1 })).items[0]!
          ._id,
      ),
    ).toBeNull();
  });
});

describe("business repository filters", () => {
  it("applies category, location, presence, state and search filters", async () => {
    await seedBusinesses(h, ORG, [
      {
        name: "Lagos Bakery",
        categories: ["Bakery"],
        phones: ["0803 123 4567"],
        location: { locality: "Ikeja", region: "Lagos" },
      },
      {
        name: "Abuja Bakery",
        categories: ["Bakery"],
        emails: ["hi@abuja.example.test"],
        location: { locality: "Wuse", region: "Abuja" },
      },
      {
        name: "Lagos Clinic",
        categories: ["Clinic"],
        website: "clinic.example.test",
        location: { region: "Lagos State" },
      },
    ]);
    const names = async (f: Parameters<typeof buildBusinessFilter>[0]) =>
      (
        await repo.findMatching(
          ORG,
          buildBusinessFilter(f, stateCtx()),
          { field: "name.normalized", direction: 1 },
          50,
        )
      ).map((d) => d.name.value);
    expect(await names({ category: ["bakery"] })).toEqual(["Abuja Bakery", "Lagos Bakery"]);
    expect(await names({ region: ["LAGOS"] })).toEqual(["Lagos Bakery", "Lagos Clinic"]);
    expect(await names({ region: ["fct"] })).toEqual(["Abuja Bakery"]);
    expect(await names({ hasPhone: true })).toEqual(["Lagos Bakery"]);
    expect(await names({ hasEmail: false, hasWebsite: false })).toEqual(["Lagos Bakery"]);
    expect(await names({ emailState: ["unverified"] })).toEqual(["Abuja Bakery"]);
    expect(await names({ emailState: ["missing"] })).toEqual(["Lagos Bakery", "Lagos Clinic"]);
    expect(await names({ websiteState: ["unverified"] })).toEqual(["Lagos Clinic"]);
    expect(await names({ websiteState: ["verified"] })).toEqual([]);
    expect(await names({ q: "bak lag" })).toEqual(["Lagos Bakery"]);
    expect(await names({ q: "clinic.example" })).toEqual(["Lagos Clinic"]);
    expect(await names({ whatsapp: ["unknown"], category: ["clinic"] })).toEqual(["Lagos Clinic"]);
    expect(await repo.countMatching(ORG, buildBusinessFilter({}, stateCtx()))).toBe(3);
  });

  it("backs every directory query shape with an index (no collection scans)", async () => {
    await seedBusinesses(h, ORG, [
      { name: "Indexed", categories: ["Bakery"], phones: ["0803 123 4567"] },
    ]);
    const sorts: BusinessSortField[] = [
      "updatedAt",
      "createdAt",
      "name",
      "lastVerifiedAt",
      "fit",
      "dataConfidence",
    ];
    const filters: Array<Parameters<typeof buildBusinessFilter>[0]> = [
      {},
      { q: "bak" },
      { q: "0803" },
      { category: ["Bakery"] },
      { region: ["Lagos"], locality: ["Ikeja"] },
      { lga: ["Ikeja"] },
      { hasWebsite: true },
      { hasPhone: true, phoneState: ["verified"] },
      { emailState: ["stale", "missing"] },
      { whatsapp: ["confirmed"] },
      { source: ["user_import"] },
      { importId: new ObjectId().toHexString() },
      { suppression: "only" },
      // Phase 4: score ranges.
      { fitMin: 50 },
      { fitMin: 20, fitMax: 80 },
      { dataConfidenceMin: 40 },
      { fitMin: 10, dataConfidenceMax: 90, category: ["Bakery"] },
      // Stage 8: an id selection, alone and with a search.
      { ids: [new ObjectId().toHexString(), new ObjectId().toHexString()] },
      { ids: [new ObjectId().toHexString()], q: "bak" },
    ];
    const plans: string[] = [];
    const stages = (plan: unknown): string[] => {
      const out: string[] = [];
      const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        const n = node as Record<string, unknown>;
        if (typeof n.stage === "string") out.push(n.stage);
        for (const v of Object.values(n)) {
          if (Array.isArray(v)) v.forEach(visit);
          else if (v && typeof v === "object") visit(v);
        }
      };
      visit(plan);
      return out;
    };
    for (const filter of filters) {
      for (const sort of sorts) {
        const explain = await repo.explainFind(ORG, buildBusinessFilter(filter, stateCtx()), {
          [SORT_PATHS[sort]]: -1,
          _id: -1,
        });
        const winning = stages((explain.queryPlanner as Document).winningPlan);
        plans.push(`${JSON.stringify(filter)} ${sort}: ${winning.join(">")}`);
        expect(winning, `${JSON.stringify(filter)} sorted by ${sort}`).not.toContain("COLLSCAN");
        expect(
          winning.some((s) => s === "IXSCAN" || s === "EXPRESS_IXSCAN" || s === "IDHACK"),
        ).toBe(true);
      }
    }
    expect(plans).toHaveLength(filters.length * sorts.length);
  });
});
