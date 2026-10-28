import {
  normalizeKey,
  normalizePlace,
  normalizeRegion,
  regionKey,
} from "../normalization/index.js";

/**
 * Matching key for LGA names: case, diacritics, hyphens and slashes ignored ("Ìkòròdú" and
 * "Ikorodu", "Port-Harcourt" and "Port Harcourt", "Oshodi/Isolo" and "Oshodi Isolo" match).
 */
export function lgaMatchKey(name: string): string {
  return normalizeKey(name)
    .replace(/[-/_.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
import type { OvertureDivision } from "./overture.types.js";

/** A ring as flat [x0, y0, x1, y1, ...] coordinates (lon, lat). */
type Ring = Float64Array;
/** Outer ring first, then holes. */
type Polygon = Ring[];

interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Parses WKB (ISO or EWKB, either byte order) Polygon and MultiPolygon geometries into rings.
 * Z and M ordinates are skipped. Throws on other geometry types or truncated input.
 */
export function parseWkbPolygons(wkb: Uint8Array): Polygon[] {
  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  let offset = 0;
  const need = (n: number) => {
    if (offset + n > view.byteLength) throw new Error("Truncated WKB");
  };

  const readGeometry = (): { type: number; polygons: Polygon[] } => {
    need(5);
    const little = view.getUint8(offset) === 1;
    offset += 1;
    let type = view.getUint32(offset, little);
    offset += 4;
    let dims = 2;
    // EWKB flags: Z 0x80000000, M 0x40000000, SRID 0x20000000.
    if (type & 0x20000000) {
      need(4);
      offset += 4;
    }
    if (type & 0x80000000) dims += 1;
    if (type & 0x40000000) dims += 1;
    type &= 0x0fffffff;
    // ISO: 1000 Z, 2000 M, 3000 ZM.
    if (type >= 1000) {
      const iso = Math.floor(type / 1000);
      dims = iso === 3 ? 4 : 3;
      type %= 1000;
    }
    const readRing = (): Ring => {
      need(4);
      const n = view.getUint32(offset, little);
      offset += 4;
      need(n * dims * 8);
      const ring = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        ring[i * 2] = view.getFloat64(offset, little);
        ring[i * 2 + 1] = view.getFloat64(offset + 8, little);
        offset += dims * 8;
      }
      return ring;
    };
    if (type === 3) {
      need(4);
      const rings = view.getUint32(offset, little);
      offset += 4;
      const polygon: Polygon = [];
      for (let r = 0; r < rings; r++) polygon.push(readRing());
      return { type, polygons: [polygon] };
    }
    if (type === 6) {
      need(4);
      const count = view.getUint32(offset, little);
      offset += 4;
      const polygons: Polygon[] = [];
      for (let p = 0; p < count; p++) polygons.push(...readGeometry().polygons);
      return { type, polygons };
    }
    throw new Error(`Unsupported WKB geometry type ${type}`);
  };
  return readGeometry().polygons;
}

function bboxOf(polygons: Polygon[]): Bbox {
  const b: Bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    for (let i = 0; i < outer.length; i += 2) {
      const x = outer[i]!;
      const y = outer[i + 1]!;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

/** Even-odd ray casting over one ring. */
function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!;
    const yi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!;
    const yj = ring[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygons(polygons: Polygon[], x: number, y: number): boolean {
  for (const polygon of polygons) {
    const [outer, ...holes] = polygon;
    if (!outer || !inRing(outer, x, y)) continue;
    if (holes.some((h) => inRing(h, x, y))) continue;
    return true;
  }
  return false;
}

interface Area {
  division: OvertureDivision;
  polygons: Polygon[];
  bbox: Bbox;
  size: number;
}

export interface AdminAssignment {
  stateName: string | null;
  stateKey: string | null;
  stateCode: string | null;
  lgaName: string | null;
  lgaKey: string | null;
  regionDivisionId: string | null;
  countyDivisionId: string | null;
}

const EMPTY: AdminAssignment = {
  stateName: null,
  stateKey: null,
  stateCode: null,
  lgaName: null,
  lgaKey: null,
  regionDivisionId: null,
  countyDivisionId: null,
};

const CELL = 0.1;

/**
 * State and LGA lookup by point-in-polygon against Overture division areas (`region` areas are
 * states, `county` areas LGAs; Nigeria has 37 and 773). A 0.1 degree grid narrows each point to a
 * few candidate polygons, so the 162k Nigerian places resolve in seconds without the DuckDB
 * spatial extension. A point in no LGA falls back to the state polygons; when areas overlap the
 * smaller one wins (deterministic).
 */
export class AdminIndex {
  private readonly lgaGrid = new Map<string, Area[]>();
  private readonly stateGrid = new Map<string, Area[]>();
  private readonly statesByCode = new Map<string, Area>();
  readonly lgaCount: number;
  readonly stateCount: number;

  constructor(divisions: OvertureDivision[]) {
    let lgas = 0;
    let states = 0;
    for (const division of divisions) {
      if (division.subtype !== "county" && division.subtype !== "region") continue;
      const polygons = parseWkbPolygons(division.wkb);
      const bbox = bboxOf(polygons);
      if (!Number.isFinite(bbox.minX)) continue;
      const area: Area = {
        division,
        polygons,
        bbox,
        size: (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY),
      };
      const grid = division.subtype === "county" ? this.lgaGrid : this.stateGrid;
      if (division.subtype === "county") lgas += 1;
      else {
        states += 1;
        if (division.region && !this.statesByCode.has(division.region))
          this.statesByCode.set(division.region, area);
      }
      for (let cx = Math.floor(bbox.minX / CELL); cx <= Math.floor(bbox.maxX / CELL); cx++) {
        for (let cy = Math.floor(bbox.minY / CELL); cy <= Math.floor(bbox.maxY / CELL); cy++) {
          const key = `${cx}:${cy}`;
          const list = grid.get(key) ?? [];
          list.push(area);
          grid.set(key, list);
        }
      }
    }
    for (const grid of [this.lgaGrid, this.stateGrid])
      for (const list of grid.values()) list.sort((a, b) => a.size - b.size);
    this.lgaCount = lgas;
    this.stateCount = states;
  }

  private find(grid: Map<string, Area[]>, lon: number, lat: number): Area | null {
    const candidates = grid.get(`${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`);
    if (!candidates) return null;
    for (const area of candidates) {
      const b = area.bbox;
      if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
      if (inPolygons(area.polygons, lon, lat)) return area;
    }
    return null;
  }

  lookup(lon: number | null, lat: number | null): AdminAssignment {
    if (lon === null || lat === null || !Number.isFinite(lon) || !Number.isFinite(lat))
      return EMPTY;
    const lga = this.find(this.lgaGrid, lon, lat);
    const state =
      (lga?.division.region ? this.statesByCode.get(lga.division.region) : undefined) ??
      this.find(this.stateGrid, lon, lat);
    const stateName = state ? normalizeRegion(state.division.name, "NG") : null;
    return {
      stateName,
      stateKey: stateName ? regionKey(stateName) : null,
      stateCode: state?.division.region ?? lga?.division.region ?? null,
      lgaName: lga ? normalizePlace(lga.division.name) : null,
      lgaKey: lga ? lgaMatchKey(lga.division.name) : null,
      regionDivisionId: state?.division.divisionId ?? null,
      countyDivisionId: lga?.division.divisionId ?? null,
    };
  }
}

/** WKB for a closed lon/lat rectangle (tests and synthetic boundaries). */
export function rectangleWkb(minX: number, minY: number, maxX: number, maxY: number): Uint8Array {
  const points = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ];
  const buf = new ArrayBuffer(1 + 4 + 4 + 4 + points.length * 16);
  const view = new DataView(buf);
  view.setUint8(0, 1);
  view.setUint32(1, 3, true);
  view.setUint32(5, 1, true);
  view.setUint32(9, points.length, true);
  points.forEach(([x, y], i) => {
    view.setFloat64(13 + i * 16, x!, true);
    view.setFloat64(21 + i * 16, y!, true);
  });
  return new Uint8Array(buf);
}
