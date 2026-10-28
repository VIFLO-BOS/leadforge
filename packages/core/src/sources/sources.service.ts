import { Inject, Injectable } from "@nestjs/common";
import type {
  DiscoveryBlocker,
  DiscoverySourceKey,
  DiscoverySourceOption,
  FieldRetention,
  SourceKey,
  SourceRegistryEntry,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { SOURCE_ADAPTERS, type SourceAdapter } from "./source-adapter.js";
import {
  SourceConfigRepository,
  type SourceConfigDocument,
} from "./repositories/source-config.repository.js";

const UNLIMITED: FieldRetention[] = [
  { field: "all values", retention: "indefinite", days: null, note: "No source retention limit." },
];

type StaticEntry = Omit<SourceRegistryEntry, "enabled" | "configurable" | "config">;

const DEFAULT_SPEC_SUPPORT: DiscoverySourceOption["specSupport"] = {
  location: ["region", "locality", "query", "geo"],
  confidence: false,
  requireContact: false,
  priorityFields: true,
  catalog: false,
};

/** Sources that are not discovery adapters: user-supplied data and (later) website enrichment. */
const STATIC_SOURCES: StaticEntry[] = [
  {
    key: "user_import",
    statusReason: null,
    name: "CSV import",
    kind: "user_supplied",
    method: "user_import",
    status: "active",
    statusDetail:
      "Upload a CSV from Businesses. Rows are normalized, validated and recorded with provenance.",
    fieldsProvided: [
      "name",
      "category",
      "website",
      "phone",
      "email",
      "whatsapp",
      "location",
      "social",
    ],
    coverage: "Whatever your file contains. LeadForge does not add to it.",
    policy: {
      storage: "Kept indefinitely as observations linked to the import that supplied them.",
      retentionDays: null,
      fieldRetention: UNLIMITED,
      attribution: 'Shown as "Imported" with the import and the importing user.',
      rateLimit: null,
      lawfulBasis: "The importing user attests a lawful basis for the data on every import.",
      termsCheckedAt: null,
      terms: [],
      licensing: null,
    },
    docsUrl: null,
  },
  {
    key: "user_edit",
    statusReason: null,
    name: "Manual entry and corrections",
    kind: "user_supplied",
    method: "user_edit",
    status: "active",
    statusDetail:
      "Businesses added by hand and every field correction are recorded as user_edit observations.",
    fieldsProvided: ["name", "category", "website", "phone", "email", "whatsapp", "location"],
    coverage: "Values your team enters.",
    policy: {
      storage: "Kept indefinitely with the editing user and time.",
      retentionDays: null,
      fieldRetention: UNLIMITED,
      attribution: 'Shown as "Edited by" the team member.',
      rateLimit: null,
      lawfulBasis:
        "Business contact information handled under legitimate interest; suppression requests are honored.",
      termsCheckedAt: null,
      terms: [],
      licensing: null,
    },
    docsUrl: null,
  },
  {
    key: "website",
    statusReason: null,
    name: "Business website",
    kind: "enrichment",
    method: "website_fetch",
    status: "active",
    statusDetail:
      "Contacts (mailto, tel, WhatsApp and social profile links) are collected from a business's own website on request or refresh, through SafeFetch: robots.txt is honored, at most 1 request every 2 seconds per site and 5 pages per analysis.",
    fieldsProvided: ["email", "phone", "whatsapp", "social"],
    coverage: "Only the business's own public pages, when robots.txt allows it.",
    policy: {
      storage: "Kept indefinitely as an observation with the page URL and date.",
      retentionDays: null,
      fieldRetention: UNLIMITED,
      attribution: "Links to the page the value was found on.",
      rateLimit: "1 request every 2 seconds per domain; at most 5 pages per site.",
      lawfulBasis:
        "Public business contact pages fetched with an identified user agent, respecting robots.txt.",
      termsCheckedAt: null,
      terms: [],
      licensing: null,
    },
    docsUrl: null,
  },
];

export interface SourceRunnability {
  adapter: SourceAdapter;
  enabled: boolean;
  runnable: boolean;
  blocker: DiscoveryBlocker | null;
}

/**
 * Source registry: discovery adapters plus user-supplied and enrichment sources, with the
 * organization's enable or disable setting (source_configs). Status reflects what is actually
 * wired up; a source is never shown as working before it is configured.
 */
@Injectable()
export class SourcesService {
  private readonly adapters: Map<string, SourceAdapter>;

  constructor(
    @Inject(SOURCE_ADAPTERS) adapters: SourceAdapter[],
    private readonly configs: SourceConfigRepository,
    private readonly audit: AuditService,
  ) {
    this.adapters = new Map(adapters.map((a) => [a.key, a]));
  }

  adapter(key: string): SourceAdapter | null {
    return this.adapters.get(key) ?? null;
  }

  /** Status as the registry reports it: a source blocked by its provider's terms is never available. */
  private status(adapter: SourceAdapter): {
    status: SourceRegistryEntry["status"];
    statusReason: SourceRegistryEntry["statusReason"];
    statusDetail: string;
  } {
    const d = adapter.describe();
    if (adapter.policy.blockedByTerms) {
      return {
        status: "not_available",
        statusReason: "provider_terms",
        statusDetail: adapter.policy.blockedByTerms.detail,
      };
    }
    const statusReason =
      d.status === "configured"
        ? null
        : (d.statusReason ?? (d.status === "not_configured" ? "credentials_missing" : null));
    return { status: d.status, statusReason, statusDetail: d.statusDetail };
  }

  private async refresh(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((a) => a.refreshState?.()));
  }

  private adapterEntry(
    adapter: SourceAdapter,
    config: SourceConfigDocument | null,
  ): SourceRegistryEntry {
    const d = adapter.describe();
    const p = adapter.policy;
    const s = this.status(adapter);
    const retentionDays =
      p.contentRetentionMs === null
        ? null
        : Math.floor(p.contentRetentionMs / (24 * 60 * 60 * 1000));
    return {
      key: d.key,
      name: d.name,
      kind: d.kind,
      method: d.collectionMethod ?? d.method,
      status: s.status,
      statusReason: s.statusReason,
      statusDetail: s.statusDetail,
      enabled: config?.enabled ?? true,
      configurable: true,
      fieldsProvided: d.fieldsProvided,
      coverage: d.coverage,
      policy: {
        storage: p.storage,
        retentionDays,
        fieldRetention: p.fieldRetention,
        attribution: p.attributionText,
        rateLimit: p.rateLimit.description,
        lawfulBasis: p.lawfulBasis,
        termsCheckedAt: p.termsCheckedAt,
        terms: p.terms,
        licensing: p.licensing ?? null,
      },
      docsUrl: d.docsUrl,
      config: config
        ? { updatedAt: config.updatedAt.toISOString(), updatedByUserId: config.updatedByUserId }
        : null,
    };
  }

  /** The registry with this organization's settings (or defaults when no organization is given). */
  async list(organizationId?: string): Promise<SourceRegistryEntry[]> {
    await this.refresh();
    const configs = organizationId ? await this.configs.listForOrganization(organizationId) : [];
    const byKey = new Map(configs.map((c) => [c.sourceKey, c]));
    const fromAdapters = [...this.adapters.values()].map((a) =>
      this.adapterEntry(a, byKey.get(a.key) ?? null),
    );
    const statics = STATIC_SOURCES.map((s) => ({
      ...s,
      enabled: s.status !== "not_available",
      configurable: false,
      config: null,
    }));
    // Keep the Phase 2 order: user sources first, then discovery (runnable first), then enrichment.
    const order = (e: SourceRegistryEntry) => (e.status === "not_available" ? 1 : 0);
    fromAdapters.sort((a, b) => order(a) - order(b));
    return [statics[0]!, statics[1]!, ...fromAdapters, statics[2]!];
  }

  async get(organizationId: string, key: string): Promise<SourceRegistryEntry> {
    const entry = (await this.list(organizationId)).find((e) => e.key === key);
    if (!entry) throw AppError.notFound("Source");
    return entry;
  }

  /** Owners and admins switch discovery sources on or off for their organization. */
  async setEnabled(
    organizationId: string,
    userId: string,
    key: string,
    enabled: boolean,
    auditCtx: AuditContext,
  ): Promise<SourceRegistryEntry> {
    const adapter = this.adapter(key);
    if (!adapter) {
      if (STATIC_SOURCES.some((s) => s.key === key)) {
        throw AppError.validation([
          { path: "key", message: "Only discovery sources can be enabled or disabled" },
        ]);
      }
      throw AppError.notFound("Source");
    }
    const before = await this.configs.findForSource(organizationId, key);
    const config = await this.configs.setEnabled(organizationId, key, enabled, userId);
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: enabled ? "source.enabled" : "source.disabled",
        resourceType: "source",
        resourceId: key,
        before: { enabled: before?.enabled ?? true },
        after: { enabled },
      },
      auditCtx,
    );
    return this.adapterEntry(adapter, config);
  }

  async runnability(organizationId: string, key: DiscoverySourceKey): Promise<SourceRunnability> {
    const adapter = this.adapter(key);
    if (!adapter) throw AppError.notFound("Source");
    await adapter.refreshState?.();
    const config = await this.configs.findForSource(organizationId, key);
    const enabled = config?.enabled ?? true;
    const d = adapter.describe();
    const s = this.status(adapter);
    let blocker: DiscoveryBlocker | null = null;
    if (s.statusReason === "provider_terms") {
      blocker = {
        code: "SOURCE_POLICY_BLOCKED",
        source: key,
        message: `${d.name} cannot be used: ${s.statusDetail}`,
      };
    } else if (d.status !== "configured") {
      blocker = {
        code: "SOURCE_NOT_CONFIGURED",
        source: key,
        message: `${d.name}: ${d.statusDetail}`,
      };
    } else if (!enabled) {
      blocker = {
        code: "SOURCE_DISABLED",
        source: key,
        message: `${d.name} is disabled for this organization. An owner or admin can enable it on the Sources page.`,
      };
    }
    return { adapter, enabled, runnable: blocker === null, blocker };
  }

  /** The adapter, or SOURCE_POLICY_BLOCKED / SOURCE_NOT_CONFIGURED / SOURCE_DISABLED (422). */
  async requireRunnable(organizationId: string, key: DiscoverySourceKey): Promise<SourceAdapter> {
    const r = await this.runnability(organizationId, key);
    if (r.blocker) {
      const code =
        r.blocker.code === "SOURCE_DISABLED" || r.blocker.code === "SOURCE_POLICY_BLOCKED"
          ? r.blocker.code
          : "SOURCE_NOT_CONFIGURED";
      throw new AppError(code, r.blocker.message, [{ path: "sources", message: key }]);
    }
    return r.adapter;
  }

  async discoveryOptions(organizationId: string): Promise<DiscoverySourceOption[]> {
    const out: DiscoverySourceOption[] = [];
    for (const adapter of this.adapters.values()) {
      const r = await this.runnability(organizationId, adapter.key);
      const d = adapter.describe();
      const s = this.status(adapter);
      out.push({
        key: adapter.key,
        name: d.name,
        status: s.status,
        statusReason: s.statusReason,
        statusDetail: s.statusDetail,
        enabled: r.enabled,
        runnable: r.runnable,
        maxResultsPerQuery: d.maxResultsPerQuery,
        providesFields: d.fieldsProvided,
        attribution: adapter.policy.attribution,
        retentionSummary: adapter.policy.storage,
        licensing: adapter.policy.licensing ?? null,
        specSupport: d.specSupport ?? DEFAULT_SPEC_SUPPORT,
        snapshot: d.snapshot
          ? {
              release: d.snapshot.release,
              syncedAt: d.snapshot.syncedAt.toISOString(),
              places: d.snapshot.places,
              offerable: d.snapshot.offerable,
            }
          : null,
      });
    }
    // Runnable sources first; sources blocked by their terms last.
    const rank = (o: DiscoverySourceOption) =>
      o.runnable ? 0 : o.statusReason === "provider_terms" ? 2 : 1;
    return out.sort((a, b) => rank(a) - rank(b));
  }

  /** Keys accepted as provenance sources (for filters); discovery adapters plus static ones. */
  knownKeys(): SourceKey[] {
    return ["user_import", "user_edit", ...([...this.adapters.keys()] as SourceKey[]), "website"];
  }
}
