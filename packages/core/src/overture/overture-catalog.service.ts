import { Injectable } from "@nestjs/common";
import type { DiscoveryCategoryOption, DiscoveryLocationOptions } from "@leadforge/contracts";
import { normalizeKey } from "../normalization/index.js";
import { DIVISIONS_ATTRIBUTION } from "./overture-licensing.js";
import { CURATED_CATEGORIES, humanizeNode } from "./overture-taxonomy.js";
import type { OvertureSyncSummary } from "./overture.types.js";
import { OverturePlaceRepository } from "./repositories/overture-place.repository.js";
import { OvertureSyncRunRepository } from "./repositories/overture-sync-run.repository.js";

export interface OvertureSnapshotState {
  release: string;
  syncedAt: Date;
  live: number;
  offerable: number;
  /** Taxonomy nodes present among offerable places (category resolution). */
  vocabulary: ReadonlySet<string>;
  nodeCounts: ReadonlyMap<string, number>;
  summary: OvertureSyncSummary;
}

const TTL_MS = 30_000;

/**
 * The loaded Overture snapshot as discovery sees it: release, counts, taxonomy vocabulary and the
 * state, LGA and category catalogues from the latest completed sync run. Cached for 30 seconds;
 * the sync invalidates it in-process, other processes pick a new release up within the TTL.
 */
@Injectable()
export class OvertureCatalogService {
  private cache: { at: number; state: OvertureSnapshotState | null } | null = null;

  constructor(
    private readonly runs: OvertureSyncRunRepository,
    private readonly places: OverturePlaceRepository,
  ) {}

  /** The cached state, without a database round trip (null before the first refresh or the first sync). */
  current(): OvertureSnapshotState | null {
    return this.cache?.state ?? null;
  }

  invalidate(): void {
    this.cache = null;
  }

  async snapshot(options: { fresh?: boolean } = {}): Promise<OvertureSnapshotState | null> {
    if (!options.fresh && this.cache && Date.now() - this.cache.at < TTL_MS)
      return this.cache.state;
    const run = await this.runs.latestLoaded();
    let state: OvertureSnapshotState | null = null;
    if (run && run.finishedAt) {
      const summary = run.summary ?? (await this.places.summary());
      const nodeCounts = new Map(summary.categories.map((c) => [c.node, c.places]));
      state = {
        release: run.release,
        syncedAt: run.finishedAt,
        live: run.counts.live,
        offerable: run.counts.offerable,
        vocabulary: new Set(nodeCounts.keys()),
        nodeCounts,
        summary,
      };
    }
    this.cache = { at: Date.now(), state };
    return state;
  }

  /**
   * Category options for the wizard: the curated Nigerian vocabulary first (with synonyms), then
   * every Overture category present in the snapshot. `places` counts offerable places nationwide.
   */
  async categories(q: string | undefined, limit: number): Promise<DiscoveryCategoryOption[]> {
    const state = await this.snapshot();
    const all = categoryOptions(state?.nodeCounts ?? null);
    const needle = q ? normalizeKey(q) : "";
    const filtered = needle
      ? all.filter((o) =>
          [o.label, o.key.replace(/_/g, " "), ...o.synonyms].some((t) => {
            const text = normalizeKey(t);
            return text.startsWith(needle) || text.includes(` ${needle}`);
          }),
        )
      : all;
    return filtered.slice(0, limit);
  }

  async locations(): Promise<DiscoveryLocationOptions> {
    const state = await this.snapshot();
    return {
      source: "overture_places",
      release: state?.release ?? null,
      country: "NG",
      states: state?.summary.states ?? [],
      boundariesAttribution: DIVISIONS_ATTRIBUTION,
    };
  }
}

/** Case, accent, underscore, hyphen and spacing-insensitive form of a category term. */
function termKey(term: string): string {
  return normalizeKey(term.replace(/[-_]+/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * The wizard's category list: the curated Nigerian vocabulary first, then every other Overture
 * category in the snapshot by place count, with one entry per label. A taxonomy category whose
 * label is already a curated label, key or synonym is left out: submitting that term resolves to
 * the curated category anyway (`pharmacy` sits under the curated `pharmacy_and_drug_store`).
 * Taxonomy categories that humanize to the same label are merged into one entry.
 * `nodeCounts` is null before the first sync (`places` is then null).
 */
export function categoryOptions(
  nodeCounts: ReadonlyMap<string, number> | null,
): DiscoveryCategoryOption[] {
  const counts = nodeCounts ?? new Map<string, number>();
  const curated: DiscoveryCategoryOption[] = CURATED_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    synonyms: c.synonyms,
    sourceCategories: c.nodes,
    kind: "curated",
    // Places matching any node (nodes can nest, so the largest count is a lower bound and the sum an upper one; report the largest).
    places: nodeCounts ? Math.max(0, ...c.nodes.map((n) => counts.get(n) ?? 0)) : null,
  }));
  const covered = new Set(CURATED_CATEGORIES.flatMap((c) => c.nodes));
  const curatedTerms = new Set(
    CURATED_CATEGORIES.flatMap((c) => [c.key, c.label, ...c.synonyms].map(termKey)),
  );
  const byLabel = new Map<string, DiscoveryCategoryOption>();
  for (const [node, places] of counts) {
    if (covered.has(node)) continue;
    const label = humanizeNode(node);
    const key = termKey(label);
    if (curatedTerms.has(key) || curatedTerms.has(termKey(node))) continue;
    const prior = byLabel.get(key);
    if (prior) {
      prior.sourceCategories = [...prior.sourceCategories, node];
      prior.places = Math.max(prior.places ?? 0, places);
      continue;
    }
    byLabel.set(key, {
      key: node,
      label,
      synonyms: [],
      sourceCategories: [node],
      kind: "taxonomy",
      places,
    });
  }
  const taxonomy = [...byLabel.values()].sort(
    (a, b) => (b.places ?? 0) - (a.places ?? 0) || a.label.localeCompare(b.label),
  );
  return [...curated, ...taxonomy];
}
