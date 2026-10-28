import { Injectable } from "@nestjs/common";
import { ObjectId } from "@leadforge/db-mongo";
import type { JobKind, JobListQuery, JobSummary } from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { DiscoveryService } from "../discovery/discovery.service.js";
import { ImportsService } from "../imports/imports.service.js";
import { WebsiteAnalysisService } from "../website-analysis/website-analysis.service.js";
import { EnrichmentService } from "../enrichment/enrichment.service.js";
import { ExportsService } from "../exports/exports.service.js";
import { BulkOperationsService } from "../crm/bulk-operations.service.js";
import type { CrmActor } from "../crm/crm.types.js";

type Row = { createdAt: Date; id: ObjectId; summary: JobSummary };

/**
 * All background jobs for the /app/jobs page: discovery, import, website analysis, enrichment,
 * export (Phase 5) and bulk (Phase 5) jobs merged newest first. Each kind is read with the same
 * (createdAt, _id) keyset, so the merged cursor is stable. Exports follow their own visibility:
 * owners and administrators see every export, other members only their own.
 */
@Injectable()
export class JobsService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly imports: ImportsService,
    private readonly analyses: WebsiteAnalysisService,
    private readonly enrichment: EnrichmentService,
    private readonly exports: ExportsService,
    private readonly bulk: BulkOperationsService,
  ) {}

  async list(
    organizationId: string,
    query: Pick<JobListQuery, "pageSize"> & Partial<JobListQuery>,
    viewer: CrmActor | null = null,
  ): Promise<{ items: JobSummary[]; nextCursor: string | null }> {
    const before = query.cursor ? decodeJobsCursor(query.cursor) : null;
    const kinds = new Set<JobKind>(
      query.kind?.length
        ? query.kind
        : ["discovery", "import", "analysis", "enrichment", "export", "bulk"],
    );
    const take = query.pageSize + 1;
    const lists: Row[][] = await Promise.all([
      kinds.has("discovery")
        ? this.discovery.jobSummariesBefore(organizationId, query.status, before, take)
        : Promise.resolve([]),
      kinds.has("import")
        ? this.imports.jobSummariesBefore(organizationId, query.status, before, take)
        : Promise.resolve([]),
      kinds.has("analysis")
        ? this.analyses.jobSummariesBefore(organizationId, query.status, before, take)
        : Promise.resolve([]),
      kinds.has("enrichment")
        ? this.enrichment.jobSummariesBefore(organizationId, query.status, before, take)
        : Promise.resolve([]),
      kinds.has("export")
        ? this.exports.jobSummariesBefore(organizationId, viewer, query.status, before, take)
        : Promise.resolve([]),
      kinds.has("bulk")
        ? this.bulk.jobSummariesBefore(organizationId, query.status, before, take)
        : Promise.resolve([]),
    ]);
    const merged = lists
      .flat()
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (b.id.toHexString() < a.id.toHexString() ? -1 : 1),
      );
    const page = merged.slice(0, query.pageSize);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => r.summary),
      nextCursor: merged.length > query.pageSize && last ? encodeJobsCursor(last) : null,
    };
  }
}

function encodeJobsCursor(row: Row): string {
  return Buffer.from(
    JSON.stringify([row.createdAt.toISOString(), row.id.toHexString()]),
    "utf8",
  ).toString("base64url");
}

function decodeJobsCursor(cursor: string): { createdAt: Date; id: ObjectId } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      const createdAt = new Date(parsed[0]);
      if (!Number.isNaN(createdAt.getTime()) && /^[a-f0-9]{24}$/i.test(parsed[1]))
        return { createdAt, id: new ObjectId(parsed[1]) };
    }
  } catch {
    // fall through
  }
  throw AppError.validation([
    { path: "cursor", message: "Invalid or expired cursor; start from the first page" },
  ]);
}
