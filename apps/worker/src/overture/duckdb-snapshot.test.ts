import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";
import type { Logger } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import {
  overtureFixtureDivisions,
  overtureFixtureRecords,
  type OvertureRawPlace,
  type OvertureSyncService,
} from "@leadforge/core";
import { openDuckDbSnapshot } from "./duckdb-snapshot.js";
import { OvertureSyncRunner } from "./overture-sync.runner.js";

/**
 * Builds small Parquet files from the 25 fixture records (no network, no DuckDB extensions):
 * the flattened research extract layout, the raw Overture places schema, and division areas
 * with WKB boundaries, then reads them back through openDuckDbSnapshot.
 */
let dir: string;
const path = (name: string) => join(dir, name).replace(/\\/g, "/");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lf-overture-"));
  const places = overtureFixtureRecords().map((r) => r.place);
  writeFileSync(join(dir, "places.json"), JSON.stringify(places));
  // Little-endian WKB points for the raw layout's GEOMETRY column.
  const points = places.map((p) => {
    const b = Buffer.alloc(21);
    b.writeUInt8(1, 0);
    b.writeUInt32LE(1, 1);
    b.writeDoubleLE(p.lon!, 5);
    b.writeDoubleLE(p.lat!, 13);
    return { id: p.id, hex: b.toString("hex") };
  });
  writeFileSync(join(dir, "points.json"), JSON.stringify(points));
  const divisions = overtureFixtureDivisions().map((d) => ({
    ...d,
    wkb: Buffer.from(d.wkb).toString("hex"),
  }));
  writeFileSync(join(dir, "divisions.json"), JSON.stringify(divisions));

  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const sourceType =
    "STRUCT(property VARCHAR, dataset VARCHAR, license VARCHAR, record_id VARCHAR, update_time VARCHAR, confidence DOUBLE, provider VARCHAR, resource VARCHAR, version VARCHAR)[]";
  const columns = `{id: 'VARCHAR', version: 'INTEGER', name: 'VARCHAR', basic_category: 'VARCHAR', taxonomy_primary: 'VARCHAR', taxonomy_hierarchy: 'VARCHAR[]', taxonomy_alternates: 'VARCHAR[]', confidence: 'DOUBLE', operating_status: 'VARCHAR', websites: 'VARCHAR[]', phones: 'VARCHAR[]', emails: 'VARCHAR[]', socials: 'VARCHAR[]', brand_name: 'VARCHAR', brand_wikidata: 'VARCHAR', addresses: 'STRUCT(freeform VARCHAR, locality VARCHAR, postcode VARCHAR, region VARCHAR, country VARCHAR)[]', lon: 'DOUBLE', lat: 'DOUBLE', sources: '${sourceType}'}`;
  await c.run(
    `COPY (SELECT * FROM read_json('${path("places.json")}', format = 'array', columns = ${columns})) TO '${path("extract.parquet")}' (FORMAT parquet)`,
  );
  await c.run(`COPY (
    SELECT id, version, {'primary': name} AS names, basic_category,
           {'primary': taxonomy_primary, 'hierarchy': taxonomy_hierarchy, 'alternates': taxonomy_alternates} AS taxonomy,
           confidence, operating_status, websites, socials, emails, phones,
           {'wikidata': brand_wikidata, 'names': {'primary': brand_name}} AS brand,
           addresses, sources,
           -- float32-rounded like the published bbox; the exact point is in the geometry
           {'xmin': lon::FLOAT, 'xmax': lon::FLOAT, 'ymin': lat::FLOAT, 'ymax': lat::FLOAT} AS bbox,
           from_hex(pt.hex)::GEOMETRY AS geometry
    FROM read_parquet('${path("extract.parquet")}') e
    JOIN read_json('${path("points.json")}', format = 'array', columns = {id: 'VARCHAR', hex: 'VARCHAR'}) pt USING (id)) TO '${path("raw.parquet")}' (FORMAT parquet)`);
  await c.run(`COPY (
    SELECT id, divisionId AS division_id, subtype, name, region, country, from_hex(wkb) AS geometry_wkb
    FROM read_json('${path("divisions.json")}', format = 'array', columns = {id: 'VARCHAR', divisionId: 'VARCHAR', subtype: 'VARCHAR', name: 'VARCHAR', region: 'VARCHAR', country: 'VARCHAR', wkb: 'VARCHAR'})
  ) TO '${path("divisions.parquet")}' (FORMAT parquet)`);
  // The raw Overture divisions schema: names struct, GEOMETRY column, class and bbox.
  await c.run(`COPY (
    SELECT id, division_id, subtype, {'primary': name} AS names, region, country, 'land' AS class, geometry_wkb::GEOMETRY AS geometry,
           {'xmin': 2.7, 'xmax': 14.6, 'ymin': 4.3, 'ymax': 13.9} AS bbox
    FROM read_parquet('${path("divisions.parquet")}')
  ) TO '${path("divisions-raw.parquet")}' (FORMAT parquet)`);
  c.closeSync();
  db.closeSync();
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function readAll(
  layout: "extract" | "raw",
): Promise<{
  rows: OvertureRawPlace[];
  divisions: number;
  expected: number | null;
  release: string;
}> {
  const snap = await openDuckDbSnapshot({
    kind: "local",
    placesFiles: [path(`${layout}.parquet`)],
    divisionFiles: [path("divisions.parquet")],
    release: "2026-10-21.0",
    schemaVersion: null,
    location: "test",
    countRows: true,
  });
  const rows: OvertureRawPlace[] = [];
  for await (const batch of snap.places) rows.push(...batch);
  await snap.close?.();
  return {
    rows,
    divisions: snap.divisions.length,
    expected: snap.expectedRows,
    release: snap.release,
  };
}

describe("DuckDB snapshot reader (@duckdb/node-api, local Parquet)", { timeout: 30_000 }, () => {
  it("reads the flattened extract layout with the bbox and NG filters", async () => {
    const { rows, divisions, expected, release } = await readAll("extract");
    expect(release).toBe("2026-10-21.0");
    expect(divisions).toBe(overtureFixtureDivisions().length);
    expect(expected).toBe(25);
    expect(rows).toHaveLength(25);
    const first = rows.find((r) => r.id === "67b7fd45-fc42-4de9-9c3d-8bf8f5b7a922")!;
    expect(first).toMatchObject({
      name: "Officers Of Nigerian National Commission-NATFORCE",
      taxonomy_hierarchy: ["community_and_government", "government_office"],
      phones: ["+2349039880927"],
      addresses: [expect.objectContaining({ country: "NG", region: "FC" })],
      lon: 7.50752,
      lat: 9.0472,
    });
    expect(first.sources![0]).toMatchObject({
      property: "",
      dataset: "meta",
      record_id: "229113884444822",
      license: "CDLA-Permissive-2.0",
    });
  });

  it("reads the raw Overture places schema the same way (names, taxonomy, brand and bbox structs)", async () => {
    const extract = await readAll("extract");
    const raw = await readAll("raw");
    const pick = (r: OvertureRawPlace) => [
      r.id,
      r.name,
      r.taxonomy_primary,
      r.confidence,
      r.lon,
      r.lat,
      r.sources?.[0]?.record_id,
    ];
    expect(raw.rows.map(pick).sort()).toEqual(extract.rows.map(pick).sort());
  });

  it("returns division areas as WKB with their state codes", async () => {
    const snap = await openDuckDbSnapshot({
      kind: "local",
      placesFiles: [path("extract.parquet")],
      divisionFiles: [path("divisions.parquet")],
      release: "r",
      schemaVersion: null,
      location: "test",
      countRows: false,
    });
    await snap.close?.();
    const lagos = snap.divisions.find((d) => d.subtype === "region" && d.name === "Lagos")!;
    expect(lagos.region).toBe("NG-LA");
    expect(lagos.wkb).toBeInstanceOf(Uint8Array);
    expect(lagos.wkb[0]).toBe(1);
  });

  it("reads the raw Overture divisions schema (names struct, GEOMETRY column)", async () => {
    const flat = await openDuckDbSnapshot({
      kind: "local",
      placesFiles: [path("extract.parquet")],
      divisionFiles: [path("divisions.parquet")],
      release: "r",
      schemaVersion: null,
      location: "test",
      countRows: false,
    });
    const raw = await openDuckDbSnapshot({
      kind: "local",
      placesFiles: [path("extract.parquet")],
      divisionFiles: [path("divisions-raw.parquet")],
      release: "r",
      schemaVersion: null,
      location: "test",
      countRows: false,
    });
    await flat.close?.();
    await raw.close?.();
    const pick = (d: { name: string; subtype: string; region: string | null; wkb: Uint8Array }) =>
      [d.subtype, d.name, d.region, Buffer.from(d.wkb).toString("hex")].join("|");
    expect(raw.divisions.map(pick).sort()).toEqual(flat.divisions.map(pick).sort());
  });

  it("refuses a file without a release label and a file in neither layout", async () => {
    await expect(
      openDuckDbSnapshot({
        kind: "local",
        placesFiles: [path("extract.parquet")],
        divisionFiles: [path("divisions.parquet")],
        release: null,
        schemaVersion: null,
        location: "test",
        countRows: false,
      }),
    ).rejects.toThrow(/OVERTURE_LOCAL_RELEASE/);
    await expect(
      openDuckDbSnapshot({
        kind: "local",
        placesFiles: [path("divisions.parquet")],
        divisionFiles: [path("divisions.parquet")],
        release: "r",
        schemaVersion: null,
        location: "test",
        countRows: false,
      }),
    ).rejects.toThrow(/neither the Overture places schema nor the LeadForge extract layout/);
  });
});

describe("Overture sync runner", { timeout: 30_000 }, () => {
  it("refuses local files in production even if the environment check was bypassed", async () => {
    const sync = {
      load: vi.fn(),
      loadedForRelease: vi.fn(),
      expireStaleRuns: vi.fn(async () => 0),
    } as unknown as OvertureSyncService;
    const env = {
      NODE_ENV: "production",
      OVERTURE_LOCAL_PLACES_PATH: path("extract.parquet"),
      OVERTURE_LOCAL_DIVISIONS_PATH: path("divisions.parquet"),
    } as unknown as ServerEnv;
    const runner = new OvertureSyncRunner(
      sync,
      { warn: vi.fn(), log: vi.fn() } as unknown as Logger,
      env,
    );
    await expect(runner.run({ trigger: "manual" })).rejects.toThrow(/refused in production/);
    expect(sync.load).not.toHaveBeenCalled();
  });

  it("skips a release that is already loaded unless forced", async () => {
    const sync = {
      load: vi.fn(async () => ({ status: "completed" })),
      loadedForRelease: vi.fn(async () => ({ status: "completed" })),
      expireStaleRuns: vi.fn(async () => 0),
    } as unknown as OvertureSyncService;
    const env = {
      NODE_ENV: "development",
      OVERTURE_LOCAL_PLACES_PATH: path("extract.parquet"),
      OVERTURE_LOCAL_DIVISIONS_PATH: path("divisions.parquet"),
      OVERTURE_LOCAL_RELEASE: "2026-10-21.0",
    } as unknown as ServerEnv;
    const runner = new OvertureSyncRunner(
      sync,
      { warn: vi.fn(), log: vi.fn() } as unknown as Logger,
      env,
    );
    expect(await runner.run({ trigger: "manual" })).toEqual({
      status: "skipped",
      release: "2026-10-21.0",
      reason: "Release 2026-10-21.0 is already loaded (use --force to reload)",
    });
    expect(sync.load).not.toHaveBeenCalled();
    // Stale runs are closed on every attempt, including one that skips.
    expect(sync.expireStaleRuns).toHaveBeenCalledTimes(1);
    const forced = await runner.run({ trigger: "manual", force: true });
    expect(forced.status).toBe("loaded");
    expect(sync.load).toHaveBeenCalledTimes(1);
  });
});
