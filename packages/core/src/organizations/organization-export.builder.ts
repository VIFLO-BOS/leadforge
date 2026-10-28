import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { z } from "zod";
import { Collections, ObjectId, type Document, type WithId } from "@leadforge/db-mongo";
import {
  ExportColumn,
  ObjectIdString,
  ORGANIZATION_EXPORT_SECTIONS,
  ORGANIZATION_LIFECYCLE_PAGE,
  ROLE_PERMISSIONS,
  UuidString,
  type OrganizationExportSection,
  type ServerEnv,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AuditService } from "../audit/audit.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { csvLine } from "../normalization/csv-safety.js";
import { toObservationView, toVerificationEventView } from "../provenance/provenance.view.js";
import type {
  ObservationDocument,
  VerificationEventDocument,
} from "../provenance/provenance.types.js";
import { AttributionCollector, csvRows, exportArchiveEntries } from "../exports/export-format.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/object-storage.js";
import { buildZip, type ZipEntry } from "../storage/zip.js";
import { OrganizationsService } from "./organizations.service.js";
import { OrganizationDataRepository } from "./repositories/organization-data.repository.js";
import {
  OrganizationExportRepository,
  type OrganizationExportDocument,
} from "./repositories/organization-export.repository.js";
import { OrganizationRecordsRepository } from "./repositories/organization-records.repository.js";

const Payload = z.object({ organizationId: UuidString, exportId: ObjectIdString });
const TERMINAL = new Set(["completed", "failed", "expired"]);
const BOM = "\uFEFF";
/** Internal bookkeeping never exported (hashes, keys, search tokens, index flags). */
const INTERNAL_FIELDS = new Set([
  "organizationId",
  "requestHash",
  "idempotencyKey",
  "active",
  "search",
  "dedupKeys",
  "__v",
]);

class ExportGone extends Error {}

type Row = Record<string, unknown>;

/** JSON-safe copy of a stored document: ObjectIds as hex, dates as ISO, BigInt and BSON numbers as strings; internal fields dropped. */
export function portable(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof ObjectId) return value.toHexString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map((v) => portable(v, depth + 1));
  if (typeof value === "object") {
    const bsontype = (value as { _bsontype?: string })._bsontype;
    if (bsontype === "ObjectId" || bsontype === "ObjectID")
      return (value as { toHexString(): string }).toHexString();
    if (
      bsontype === "Long" ||
      bsontype === "Decimal128" ||
      bsontype === "Int32" ||
      bsontype === "Double"
    )
      return (value as { toString(): string }).toString();
    if (bsontype === "Binary")
      return (value as { toString(enc: string): string }).toString("base64");
    const out: Row = {};
    for (const [k, v] of Object.entries(value as Row)) {
      if (depth === 0 && INTERNAL_FIELDS.has(k)) continue;
      out[k === "_id" && depth === 0 ? "id" : k] = portable(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** A formula-safe CSV (BOM, header from the union of the rows' top-level keys; nested values as JSON). */
export function tableCsv(rows: Row[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  let out = BOM + csvLine(cols);
  for (const r of rows) {
    out += csvLine(
      cols.map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return null;
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
          return String(v);
        return JSON.stringify(v);
      }),
    );
  }
  return out;
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const text = (value: string) => Buffer.from(value, "utf8");

interface SectionOutput {
  rows: number;
  entries: ZipEntry[];
}

/**
 * Stage 10: worker side of the organization data export (queue `exports`, job
 * `build-organization-export`). Re-checks that the requester is still an owner of a live
 * organization, writes every section as JSON (and CSV for tables) into one ZIP with
 * README.txt, ATTRIBUTION.txt and LICENSES/, stores it for 7 days and notifies the requester.
 * Values whose source retention has expired are left out exactly as reads and exports hide
 * them. A retry rebuilds from the start; the file is written once, at the end.
 */
@Injectable()
export class OrganizationExportBuilder {
  constructor(
    private readonly exportsRepo: OrganizationExportRepository,
    private readonly organizations: OrganizationsService,
    private readonly businesses: BusinessesService,
    private readonly data: OrganizationDataRepository,
    private readonly records: OrganizationRecordsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private apiOrigin(): string {
    try {
      return new URL(this.env.API_URL).origin;
    } catch {
      return "";
    }
  }

  async build(payload: {
    organizationId: string;
    exportId: string;
  }): Promise<{ status: string; bytes: number }> {
    const { organizationId } = payload;
    const doc = await this.exportsRepo.findById(organizationId, payload.exportId);
    if (!doc)
      throw new ExportGone(
        `Organization export ${payload.exportId} not found in organization ${organizationId}`,
      );
    if (TERMINAL.has(doc.status)) return { status: doc.status, bytes: doc.file?.bytes ?? 0 };

    const member = await this.organizations.isActiveMember(organizationId, doc.requestedByUserId);
    if (
      !member.active ||
      !member.role ||
      !ROLE_PERMISSIONS[member.role].includes("organization:export")
    ) {
      await this.finish(doc, "failed", {
        code: "ACCESS_REVOKED",
        message: "The requester is no longer an owner of this organization.",
      });
      return { status: "failed", bytes: 0 };
    }
    const started = await this.exportsRepo.update(
      organizationId,
      doc._id,
      { status: "running", startedAt: doc.startedAt ?? new Date() },
      ["queued", "running"],
    );
    if (!started) return { status: "unknown", bytes: 0 };

    const now = new Date();
    const entries: ZipEntry[] = [];
    const sections: Array<{ key: OrganizationExportSection; rows: number }> = [];
    for (const [i, key] of ORGANIZATION_EXPORT_SECTIONS.entries()) {
      await this.exportsRepo.update(organizationId, doc._id, {
        progress: {
          completedSections: i,
          totalSections: ORGANIZATION_EXPORT_SECTIONS.length,
          currentSection: key,
        },
      });
      const out = await this.section(key, organizationId, doc, now);
      entries.push(...out.entries);
      sections.push({ key, rows: out.rows });
    }
    entries.unshift({ name: "README.txt", data: text(this.readme(doc, now, sections)) });

    const zip = buildZip(entries, now);
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const name = `leadforge-organization-${stamp}.zip`;
    const key = `org-exports/${organizationId}/${doc._id.toHexString()}/${name}`;
    await this.storage.put(key, zip, "application/zip");
    const file: NonNullable<OrganizationExportDocument["file"]> = {
      key,
      name,
      bytes: zip.length,
      sha256: createHash("sha256").update(zip).digest("hex"),
      contentType: "application/zip",
      expiresAt: new Date(now.getTime() + this.env.EXPORT_FILE_TTL_HOURS * 60 * 60 * 1000),
      deletedAt: null,
    };
    await this.finish(doc, "completed", null, {
      file,
      sections,
      progress: {
        completedSections: ORGANIZATION_EXPORT_SECTIONS.length,
        totalSections: ORGANIZATION_EXPORT_SECTIONS.length,
        currentSection: null,
      },
    });
    // The organization was purged (or the export stopped) meanwhile: never leave an orphan file.
    const recorded = await this.exportsRepo.findById(organizationId, doc._id);
    if (recorded?.status !== "completed" || recorded.file?.key !== key) {
      await this.storage.delete(key);
      return { status: recorded?.status ?? "gone", bytes: 0 };
    }
    return { status: "completed", bytes: zip.length };
  }

  private readme(
    doc: OrganizationExportDocument,
    now: Date,
    sections: Array<{ key: OrganizationExportSection; rows: number }>,
  ): string {
    return [
      "LeadForge organization data export",
      `Export id: ${doc._id.toHexString()}`,
      `Organization id: ${doc.organizationId}`,
      `Generated: ${now.toISOString()}`,
      "",
      "Every section is a JSON file; tables are also CSV files (UTF-8 with BOM). CSV cells that start with = + - @ tab or carriage return are prefixed with a single quote so spreadsheets treat them as text.",
      "Values whose source retention period has ended are left out, exactly as LeadForge hides them on screen and in exports.",
      "Card data is never stored by LeadForge and is not included; payments list their metadata only.",
      "The audit log leaves out IP addresses and browser user agents.",
      "",
      "Sections and rows:",
      ...sections.map((s) => `- ${s.key}: ${s.rows}`),
      "",
      "Files: organization.json, members, businesses (businesses.json holds every stored field; businesses.csv the directory columns), observations and verification_events (provenance), lists, list_items, leads, activities, outreach, imports, jobs, credit_ledger, invoices, payments, usage, audit_events.",
      "Open-data attribution and licence texts: ATTRIBUTION.txt and the LICENSES folder.",
      "",
    ].join("\n");
  }

  private async collect(
    collection: string,
    organizationId: string,
    options: { filter?: Document; projection?: Document } = {},
  ): Promise<Row[]> {
    const rows: Row[] = [];
    for await (const batch of this.data.iterate(collection, organizationId, options))
      for (const d of batch) rows.push(portable(d) as Row);
    return rows;
  }

  private table(name: string, rows: Row[], columns?: string[]): ZipEntry[] {
    return [
      { name: `${name}.json`, data: json(rows) },
      { name: `${name}.csv`, data: text(tableCsv(rows, columns)) },
    ];
  }

  private async section(
    key: OrganizationExportSection,
    organizationId: string,
    doc: OrganizationExportDocument,
    now: Date,
  ): Promise<SectionOutput> {
    switch (key) {
      case "organization": {
        const org = await this.records.organization(organizationId);
        const profile = org
          ? {
              id: org.id,
              name: org.name,
              slug: org.slug,
              country: org.country,
              defaultCurrency: org.defaultCurrency,
              freshnessDays: org.freshnessDays,
              createdAt: org.createdAt.toISOString(),
              deletionRequestedAt: org.deletionRequestedAt?.toISOString() ?? null,
              purgeAfter: org.deletionRequestedAt ? (org.purgeAfter?.toISOString() ?? null) : null,
              exportedAt: now.toISOString(),
            }
          : null;
        return {
          rows: profile ? 1 : 0,
          entries: [{ name: "organization.json", data: json(profile) }],
        };
      }
      case "members": {
        const rows = (await this.records.members(organizationId)).map((m) => ({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          status: m.status,
          joinedAt: m.createdAt.toISOString(),
        }));
        return {
          rows: rows.length,
          entries: this.table("members", rows, [
            "userId",
            "name",
            "email",
            "role",
            "status",
            "joinedAt",
          ]),
        };
      }
      case "businesses": {
        const origin = this.apiOrigin();
        const columns = [...ExportColumn.options];
        const attributions = new AttributionCollector();
        const details: unknown[] = [];
        let csv = BOM + csvLine(columns);
        let after: ObjectId | null = null;
        for (;;) {
          const page: Awaited<ReturnType<BusinessesService["portabilityPage"]>> =
            await this.businesses.portabilityPage(organizationId, after, 500);
          if (page.rows.length === 0) break;
          details.push(...page.details);
          csv += csvRows(page.rows, columns, origin);
          attributions.add(page.rows);
          after = page.lastId;
          if (page.rows.length < 500) break;
        }
        const entries = exportArchiveEntries("businesses.csv", csv, attributions, {
          exportId: doc._id.toHexString(),
          generatedAt: now,
          rowCount: details.length,
          truncated: false,
          rowCap: details.length,
          selection:
            "every business of the organization (suppressed ones included, merged-away records excluded)",
          scope: "all",
          apiOrigin: origin,
          title: "LeadForge organization data export",
          contentNote:
            "Suppressed businesses are included with their suppression flag. Cells that start with = + - @ tab or carriage return are prefixed with a single quote.",
        });
        return {
          rows: details.length,
          entries: [{ name: "businesses.json", data: json(details) }, ...entries],
        };
      }
      case "observations": {
        const observations: Row[] = [];
        for await (const batch of this.data.iterate(
          Collections.sourceObservations,
          organizationId,
        )) {
          for (const o of batch)
            observations.push(
              toObservationView(o as unknown as ObservationDocument, now) as unknown as Row,
            );
        }
        const events: Row[] = [];
        for await (const batch of this.data.iterate(
          Collections.verificationEvents,
          organizationId,
        )) {
          for (const e of batch)
            events.push(
              toVerificationEventView(e as unknown as VerificationEventDocument) as unknown as Row,
            );
        }
        return {
          rows: observations.length,
          entries: [
            ...this.table("observations", observations),
            ...this.table("verification_events", events),
          ],
        };
      }
      case "lists": {
        const rows = await this.collect(Collections.leadLists, organizationId);
        return { rows: rows.length, entries: this.table("lists", rows) };
      }
      case "list_items": {
        const rows = await this.collect(Collections.leadListItems, organizationId);
        return { rows: rows.length, entries: this.table("list_items", rows) };
      }
      case "leads": {
        const rows = await this.collect(Collections.leads, organizationId);
        return { rows: rows.length, entries: this.table("leads", rows) };
      }
      case "activities": {
        const rows = await this.collect(Collections.leadActivities, organizationId);
        return { rows: rows.length, entries: this.table("activities", rows) };
      }
      case "outreach": {
        const rows = await this.collect(Collections.outreachRecords, organizationId);
        return { rows: rows.length, entries: this.table("outreach", rows) };
      }
      case "imports": {
        // A summary per import: the staged rows themselves (import_rows) are not exported.
        const rows = await this.collect(Collections.importJobs, organizationId, {
          projection: { headers: 0, mapping: 0 },
        });
        return { rows: rows.length, entries: this.table("imports", rows) };
      }
      case "jobs": {
        const rows: Row[] = [];
        const kinds: Array<[string, string, string]> = [
          ["discovery", Collections.discoveryJobs, "createdByUserId"],
          ["website_analysis", Collections.websiteAnalyses, "requestedByUserId"],
          ["enrichment", Collections.enrichmentRuns, "requestedByUserId"],
          ["bulk_operation", Collections.bulkOperations, "requestedByUserId"],
          ["export", Collections.exportJobs, "requestedByUserId"],
          ["organization_export", Collections.organizationDataExports, "requestedByUserId"],
        ];
        for (const [kind, collection, by] of kinds) {
          for await (const batch of this.data.iterate(collection, organizationId, {
            projection: {
              _id: 1,
              name: 1,
              status: 1,
              kind: 1,
              action: 1,
              businessId: 1,
              createdAt: 1,
              startedAt: 1,
              finishedAt: 1,
              [by]: 1,
            },
          })) {
            for (const d of batch) {
              const p = portable(d) as Row;
              rows.push({
                kind,
                id: p.id,
                name: p.name ?? p.action ?? p.kind ?? null,
                status: p.status ?? null,
                businessId: p.businessId ?? null,
                requestedByUserId: p[by] ?? null,
                createdAt: p.createdAt ?? null,
                startedAt: p.startedAt ?? null,
                finishedAt: p.finishedAt ?? null,
              });
            }
          }
        }
        return {
          rows: rows.length,
          entries: this.table("jobs", rows, [
            "kind",
            "id",
            "name",
            "status",
            "businessId",
            "requestedByUserId",
            "createdAt",
            "startedAt",
            "finishedAt",
          ]),
        };
      }
      case "credit_ledger": {
        const rows: Row[] = [];
        for await (const batch of this.records.ledger(organizationId))
          for (const r of batch) rows.push(portable(r) as Row);
        return { rows: rows.length, entries: this.table("credit_ledger", rows) };
      }
      case "invoices": {
        const rows = (await this.records.invoices(organizationId)).map((r) => portable(r) as Row);
        return { rows: rows.length, entries: this.table("invoices", rows) };
      }
      case "payments": {
        const rows = (await this.records.payments(organizationId)).map((r) => portable(r) as Row);
        return { rows: rows.length, entries: this.table("payments", rows) };
      }
      case "usage": {
        const rows = (await this.records.usage(organizationId)).map((r) => ({
          day: r.day.toISOString().slice(0, 10),
          metric: r.metric,
          value: r.value.toString(),
        }));
        return {
          rows: rows.length,
          entries: this.table("usage", rows, ["day", "metric", "value"]),
        };
      }
      case "audit_events": {
        const rows = await this.collect(Collections.auditEvents, organizationId, {
          projection: { ip: 0, userAgent: 0 },
        });
        return { rows: rows.length, entries: this.table("audit_events", rows) };
      }
    }
  }

  /** Notification and audit first, then the terminal status, so a client that sees it also finds the notice. */
  async finish(
    doc: WithId<OrganizationExportDocument>,
    status: "completed" | "failed",
    error: { code: string; message: string } | null,
    result?: Pick<OrganizationExportDocument, "file" | "sections" | "progress">,
  ): Promise<void> {
    const current = await this.exportsRepo.findById(doc.organizationId, doc._id);
    if (!current || TERMINAL.has(current.status)) return;
    await this.notifications.organizationNotice({
      organizationId: doc.organizationId,
      userId: doc.requestedByUserId,
      type: status === "completed" ? "organization.export_completed" : "organization.export_failed",
      title:
        status === "completed"
          ? "Your organization data export is ready"
          : "Your organization data export failed",
      body:
        status === "completed"
          ? "Download the ZIP in Settings, Organization; the file is kept for 7 days."
          : (error?.message ?? "The export could not be built."),
      href: ORGANIZATION_LIFECYCLE_PAGE,
      dedupeKey: `org-export:${doc._id.toHexString()}`,
    });
    await this.audit.record({
      organizationId: doc.organizationId,
      actorUserId: doc.requestedByUserId,
      actorType: "system",
      action: "org.data_export_finished",
      resourceType: "organization_export",
      resourceId: doc._id.toHexString(),
      after: {
        status,
        bytes: result?.file?.bytes ?? null,
        sections: result?.sections ?? [],
        error,
      },
    });
    await this.exportsRepo.update(
      doc.organizationId,
      doc._id,
      { status, active: false, error, finishedAt: new Date(), ...(result ?? {}) },
      ["queued", "running"],
    );
  }

  async failAfterRetries(organizationId: string, exportId: string, message: string): Promise<void> {
    const doc = await this.exportsRepo.findById(organizationId, exportId);
    if (!doc || TERMINAL.has(doc.status)) return;
    await this.finish(doc, "failed", { code: "EXPORT_ERROR", message });
  }

  /** Maintenance (with `cleanup-exports`): deletes files past their 7 days and fails exports stuck for an hour. */
  async cleanup(now: Date = new Date()): Promise<{ expired: number; failed: number }> {
    let expired = 0;
    for (const due of await this.exportsRepo.findExpiredFiles(now, 200)) {
      if (due.file?.key) await this.storage.delete(due.file.key);
      const updated = await this.exportsRepo.update(
        due.organizationId,
        due._id,
        { status: "expired", file: due.file ? { ...due.file, deletedAt: now } : null },
        ["completed"],
      );
      if (updated) expired += 1;
    }
    let failed = 0;
    for (const stuck of await this.exportsRepo.findStuck(
      new Date(now.getTime() - 60 * 60 * 1000),
      100,
    )) {
      const doc = await this.exportsRepo.findById(stuck.organizationId, stuck._id);
      if (!doc || TERMINAL.has(doc.status)) continue;
      await this.finish(doc, "failed", {
        code: "TIMED_OUT",
        message: "The export stopped making progress; request it again.",
      });
      failed += 1;
    }
    return { expired, failed };
  }

  static isPayloadError(err: unknown): boolean {
    return err instanceof ExportGone;
  }
}

/** BullMQ glue for `build-organization-export` (exports queue), shared by apps/worker and the API tests. */
@Injectable()
export class OrganizationExportQueueHandler {
  constructor(
    private readonly builder: OrganizationExportBuilder,
    private readonly logger: Logger,
  ) {}

  async handle(job: Job): Promise<unknown> {
    if (job.name !== "build-organization-export")
      throw new UnrecoverableError(`Unknown organization export job ${job.name}`);
    const parsed = Payload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("Invalid build-organization-export payload");
    try {
      return await this.builder.build(parsed.data);
    } catch (err) {
      if (OrganizationExportBuilder.isPayloadError(err))
        throw new UnrecoverableError((err as Error).message);
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        this.logger.error(
          { err, exportId: parsed.data.exportId },
          "Organization export failed on its last attempt",
        );
        await this.builder.failAfterRetries(
          parsed.data.organizationId,
          parsed.data.exportId,
          "The organization export could not be built after retries.",
        );
      }
      throw err;
    }
  }
}
