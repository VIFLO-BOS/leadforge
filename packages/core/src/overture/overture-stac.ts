import type { OvertureDivision, OvertureRawPlace, OvertureSnapshot } from "./overture.types.js";

/** Nigeria's bounding box (lon/lat), used to pick release files and as the row prefilter. */
export const NIGERIA_BBOX = { xmin: 2.6, ymin: 4.2, xmax: 14.7, ymax: 13.95 } as const;

export interface StacFile {
  /** HTTPS URL on AWS (readable with DuckDB httpfs without credentials). */
  https: string;
  s3: string | null;
  azure: string | null;
  bbox: [number, number, number, number] | null;
}

export interface StacRelease {
  release: string;
  catalogUrl: string;
  placesFiles: StacFile[];
  divisionFiles: StacFile[];
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface StacLink {
  rel: string;
  href: string;
  title?: string;
  latest?: boolean;
}

async function getJson(
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`STAC request ${url} failed with HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

function links(doc: Record<string, unknown>): StacLink[] {
  return Array.isArray(doc.links)
    ? (doc.links as StacLink[]).filter((l) => l && typeof l.href === "string")
    : [];
}

function child(doc: Record<string, unknown>, title: string): string {
  const link = links(doc).find((l) => l.rel === "child" && l.title === title);
  if (!link) throw new Error(`STAC catalogue has no "${title}" child`);
  return link.href;
}

function intersects(b: [number, number, number, number] | null): boolean {
  if (!b) return true;
  const [xmin, ymin, xmax, ymax] = b;
  return !(
    xmax < NIGERIA_BBOX.xmin ||
    xmin > NIGERIA_BBOX.xmax ||
    ymax < NIGERIA_BBOX.ymin ||
    ymin > NIGERIA_BBOX.ymax
  );
}

async function filesFor(
  fetchFn: FetchFn,
  collectionUrl: string,
  timeoutMs: number,
): Promise<StacFile[]> {
  const collection = await getJson(fetchFn, collectionUrl, timeoutMs);
  const itemLinks = links(collection).filter((l) => l.rel === "item");
  const items = await Promise.all(itemLinks.map((l) => getJson(fetchFn, l.href, timeoutMs)));
  const files: StacFile[] = [];
  for (const item of items) {
    const bbox =
      Array.isArray(item.bbox) && item.bbox.length >= 4
        ? (item.bbox.slice(0, 4) as [number, number, number, number])
        : null;
    if (!intersects(bbox)) continue;
    const assets = (item.assets ?? {}) as Record<
      string,
      { href?: string; alternate?: { s3?: { href?: string } } }
    >;
    const aws = assets.aws;
    if (!aws?.href) continue;
    files.push({
      https: aws.href,
      s3: aws.alternate?.s3?.href ?? null,
      azure: assets.azure?.href ?? null,
      bbox,
    });
  }
  return files;
}

/**
 * Resolves the latest Overture release from the STAC catalogue (`latest` key) and lists the
 * places and division-area files whose bounding boxes overlap Nigeria (2 of 16 places files in
 * 2026-10-21.0). Release paths disappear about 60 days after publication, so nothing is
 * hard-coded. `release` pins a specific release instead of `latest`.
 */
export async function resolveStacRelease(
  catalogUrl: string,
  options: { release?: string; fetchFn?: FetchFn; timeoutMs?: number } = {},
): Promise<StacRelease> {
  const fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const root = await getJson(fetchFn, catalogUrl, timeoutMs);
  const release = options.release ?? (typeof root.latest === "string" ? root.latest : null);
  if (!release || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release))
    throw new Error("The STAC catalogue did not name a latest release");
  const releaseLink = links(root).find(
    (l) => l.rel === "child" && (l.href.includes(`/${release}/`) || l.title?.startsWith(release)),
  );
  if (!releaseLink)
    throw new Error(
      `Release ${release} is not in the STAC catalogue (releases are removed after about 60 days)`,
    );
  const releaseCatalog = await getJson(fetchFn, releaseLink.href, timeoutMs);
  const placesCatalog = await getJson(fetchFn, child(releaseCatalog, "places"), timeoutMs);
  const divisionsCatalog = await getJson(fetchFn, child(releaseCatalog, "divisions"), timeoutMs);
  const [placesFiles, divisionFiles] = await Promise.all([
    filesFor(fetchFn, child(placesCatalog, "place"), timeoutMs),
    filesFor(fetchFn, child(divisionsCatalog, "division_area"), timeoutMs),
  ]);
  if (placesFiles.length === 0)
    throw new Error(`Release ${release} lists no places files overlapping Nigeria`);
  if (divisionFiles.length === 0)
    throw new Error(`Release ${release} lists no division files overlapping Nigeria`);
  return { release, catalogUrl, placesFiles, divisionFiles };
}

/** Only the `latest` release id (cheap check before deciding to sync). */
export async function latestStacRelease(
  catalogUrl: string,
  options: { fetchFn?: FetchFn; timeoutMs?: number } = {},
): Promise<string> {
  const fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  const root = await getJson(fetchFn, catalogUrl, options.timeoutMs ?? 30_000);
  if (typeof root.latest !== "string")
    throw new Error("The STAC catalogue did not name a latest release");
  return root.latest;
}

/** A snapshot over in-memory rows (fixtures, tests), yielded in batches. */
export function arraySnapshot(input: {
  release: string;
  schemaVersion?: string | null;
  places: OvertureRawPlace[];
  divisions: OvertureDivision[];
  origin?: OvertureSnapshot["origin"];
  batchSize?: number;
}): OvertureSnapshot {
  const batchSize = input.batchSize ?? 500;
  const rows = input.places;
  return {
    release: input.release,
    schemaVersion: input.schemaVersion ?? null,
    origin: input.origin ?? { kind: "fixture", location: "in-memory" },
    divisions: input.divisions,
    expectedRows: rows.length,
    places: (async function* () {
      for (let i = 0; i < rows.length; i += batchSize) yield rows.slice(i, i + batchSize);
    })(),
  };
}
