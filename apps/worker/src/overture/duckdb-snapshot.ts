import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  NIGERIA_BBOX,
  type OvertureDivision,
  type OvertureRawPlace,
  type OvertureSnapshot,
  type StacRelease,
} from "@leadforge/core";

const BBOX = NIGERIA_BBOX;

/** SQL string literal (paths and URLs come from config and STAC, never from users). */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function list(files: string[]): string {
  return `[${files.map(lit).join(", ")}]`;
}

/** Column projections for the two Parquet layouts LeadForge reads. */
const rawColumns = (point: string) => `
  id,
  version,
  names."primary" AS name,
  basic_category,
  taxonomy."primary" AS taxonomy_primary,
  taxonomy.hierarchy AS taxonomy_hierarchy,
  taxonomy.alternates AS taxonomy_alternates,
  confidence,
  operating_status,
  websites, phones, emails, socials,
  brand.names."primary" AS brand_name,
  brand.wikidata AS brand_wikidata,
  addresses,
  ${point},
  sources`;

const EXTRACT_COLUMNS = `
  id, version, name, basic_category, taxonomy_primary, taxonomy_hierarchy, taxonomy_alternates,
  confidence, operating_status, websites, phones, emails, socials, brand_name, brand_wikidata,
  addresses, lon, lat, sources`;

/** Bbox pushdown first (row-group pruning on the Overture files), then the NG country code. */
const RAW_WHERE = `bbox.xmin >= ${BBOX.xmin} AND bbox.xmax <= ${BBOX.xmax} AND bbox.ymin >= ${BBOX.ymin} AND bbox.ymax <= ${BBOX.ymax} AND addresses[1].country = 'NG'`;
const EXTRACT_WHERE = `lon >= ${BBOX.xmin} AND lon <= ${BBOX.xmax} AND lat >= ${BBOX.ymin} AND lat <= ${BBOX.ymax} AND addresses[1].country = 'NG'`;

async function columns(conn: DuckDBConnection, source: string): Promise<Set<string>> {
  const reader = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${source})`);
  return new Set(reader.getRowObjectsJson().map((r) => String(r.column_name)));
}

async function placesQuery(
  conn: DuckDBConnection,
  source: string,
): Promise<{ sql: string; layout: "raw" | "extract"; releaseColumn: boolean }> {
  const cols = await columns(conn, source);
  if (cols.has("names") && cols.has("taxonomy") && cols.has("bbox")) {
    // The point comes from the geometry (WKB, decoded below): the bbox columns are float32-rounded
    // (up to 2e-6 degrees off), fine for row-group pruning but not as the place's coordinates.
    const point = cols.has("geometry")
      ? "geometry::BLOB AS point_wkb"
      : cols.has("geometry_wkb")
        ? "geometry_wkb AS point_wkb"
        : "bbox.xmin AS lon, bbox.ymin AS lat";
    return {
      sql: `SELECT ${rawColumns(point)} FROM read_parquet(${source}) WHERE ${RAW_WHERE}`,
      layout: "raw",
      releaseColumn: false,
    };
  }
  if (cols.has("name") && cols.has("taxonomy_primary") && cols.has("lon")) {
    return {
      sql: `SELECT ${EXTRACT_COLUMNS} FROM read_parquet(${source}) WHERE ${EXTRACT_WHERE}`,
      layout: "extract",
      releaseColumn: cols.has("overture_release"),
    };
  }
  throw new Error(
    "The places file is neither the Overture places schema nor the LeadForge extract layout",
  );
}

async function readDivisions(conn: DuckDBConnection, source: string): Promise<OvertureDivision[]> {
  const cols = await columns(conn, source);
  const wkb = cols.has("geometry_wkb") ? "geometry_wkb" : "geometry::BLOB";
  // The raw Overture schema names areas in a struct; the research extract flattened it to `name`.
  const name = cols.has("names") ? `names."primary"` : "name";
  const bboxFilter = cols.has("bbox")
    ? ` AND bbox.xmax >= ${BBOX.xmin} AND bbox.xmin <= ${BBOX.xmax} AND bbox.ymax >= ${BBOX.ymin} AND bbox.ymin <= ${BBOX.ymax}`
    : "";
  const classFilter = cols.has("class") ? ` AND coalesce(class, 'land') <> 'maritime'` : "";
  const result = await conn.stream(
    `SELECT id, division_id, subtype, ${name} AS name, region, country, ${wkb} AS wkb FROM read_parquet(${source}) WHERE country = 'NG' AND subtype IN ('region', 'county') AND ${name} IS NOT NULL${classFilter}${bboxFilter}`,
  );
  const out: OvertureDivision[] = [];
  for await (const rows of result.yieldRowObjectJs()) {
    for (const r of rows) {
      const bytes = r.wkb;
      if (!(bytes instanceof Uint8Array)) continue;
      out.push({
        id: String(r.id),
        divisionId: r.division_id == null ? null : String(r.division_id),
        subtype: String(r.subtype),
        name: String(r.name),
        region: r.region == null ? null : String(r.region),
        country: r.country == null ? null : String(r.country),
        wkb: bytes,
      });
    }
  }
  return out;
}

export interface DuckDbSnapshotInput {
  kind: "local" | "s3" | "azure";
  /** Parquet paths or URLs (a glob is fine for local files). */
  placesFiles: string[];
  divisionFiles: string[];
  /** Release label; for a local extract carrying \`overture_release\`, that column wins when this is null. */
  release: string | null;
  schemaVersion: string | null;
  location: string;
  /** Count rows before streaming (cheap for local files; a second pass for remote ones). */
  countRows: boolean;
}

/**
 * Opens an Overture release with DuckDB (@duckdb/node-api): local Parquet, or the published
 * GeoParquet over HTTPS (httpfs, anonymous). Reads both the raw Overture places schema (bbox
 * pushdown, then country NG) and the flattened research extract. Division areas come back as
 * WKB for the point-in-polygon index, so the spatial extension is not needed.
 */
export async function openDuckDbSnapshot(input: DuckDbSnapshotInput): Promise<OvertureSnapshot> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const close = async () => {
    conn.closeSync();
    instance.closeSync();
  };
  try {
    if (input.kind !== "local") {
      await conn.run("INSTALL httpfs; LOAD httpfs;");
      await conn.run("SET enable_progress_bar = false;");
    }
    const placesSource = list(input.placesFiles);
    const divisionsSource = list(input.divisionFiles);
    const divisions = await readDivisions(conn, divisionsSource);
    const query = await placesQuery(conn, placesSource);
    let release = input.release;
    if (!release && query.releaseColumn) {
      const rel = await conn.runAndReadAll(
        `SELECT DISTINCT overture_release AS r FROM read_parquet(${placesSource}) LIMIT 2`,
      );
      const values = rel.getRowObjectsJson().map((r) => String(r.r));
      if (values.length === 1) release = values[0]!;
    }
    if (!release)
      throw new Error(
        "Cannot tell which Overture release the file holds; set OVERTURE_LOCAL_RELEASE (for example 2026-10-21.0)",
      );
    let expectedRows: number | null = null;
    if (input.countRows) {
      const counted = await conn.runAndReadAll(`SELECT count(*)::INTEGER AS n FROM (${query.sql})`);
      expectedRows = Number(counted.getRowObjectsJson()[0]?.n ?? 0);
    }
    const sql = query.sql;
    async function* places(): AsyncGenerator<OvertureRawPlace[]> {
      const result = await conn.stream(sql);
      for await (const rows of result.yieldRowObjectJs()) yield rows.map(toRawPlace);
    }
    return {
      release,
      schemaVersion: input.schemaVersion,
      origin: { kind: input.kind, location: input.location },
      divisions,
      expectedRows,
      places: places(),
      close,
    };
  } catch (err) {
    await close().catch(() => undefined);
    throw err;
  }
}

/** A DuckDB row (JS values) as an Overture place: the point WKB, when selected, becomes lon/lat. */
function toRawPlace(row: Record<string, unknown>): OvertureRawPlace {
  const { point_wkb: wkb, ...rest } = row as Record<string, unknown> & { point_wkb?: unknown };
  const place = rest as unknown as OvertureRawPlace;
  if (wkb instanceof Uint8Array) {
    const p = parseWkbPoint(wkb);
    place.lon = p?.lon ?? null;
    place.lat = p?.lat ?? null;
  }
  if (typeof place.version === "bigint") place.version = Number(place.version);
  return place;
}

/** Decodes a WKB (ISO or EWKB) Point; null for anything else. */
export function parseWkbPoint(wkb: Uint8Array): { lon: number; lat: number } | null {
  if (wkb.byteLength < 21) return null;
  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  const little = view.getUint8(0) === 1;
  let type = view.getUint32(1, little);
  let offset = 5;
  if (type & 0x20000000) offset += 4; // EWKB SRID
  type &= 0x0fffffff;
  if (type % 1000 !== 1 || offset + 16 > wkb.byteLength) return null;
  return { lon: view.getFloat64(offset, little), lat: view.getFloat64(offset + 8, little) };
}

/** The published release, from the STAC listing (HTTPS on AWS; Azure as the fallback). */
export function remoteSnapshotInput(
  stac: StacRelease,
  mirror: "aws" | "azure" = "aws",
): DuckDbSnapshotInput {
  const pick = (f: StacRelease["placesFiles"][number]) =>
    mirror === "azure" && f.azure ? f.azure : f.https;
  return {
    kind: mirror === "azure" ? "azure" : "s3",
    placesFiles: stac.placesFiles.map(pick),
    divisionFiles: stac.divisionFiles.map(pick),
    release: stac.release,
    schemaVersion: null,
    location: `${stac.catalogUrl} (${stac.release}, ${stac.placesFiles.length} places files, ${stac.divisionFiles.length} division files via ${mirror === "azure" ? "Azure" : "AWS"})`,
    countRows: false,
  };
}
