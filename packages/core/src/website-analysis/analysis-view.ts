import type { WebsiteAnalysis } from "@leadforge/contracts";
import type { BusinessSummary } from "../businesses/businesses.service.js";
import type { WebsiteAnalysisDocument } from "./analysis.types.js";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toAnalysisView(
  doc: WebsiteAnalysisDocument,
  business?: BusinessSummary | null,
): WebsiteAnalysis {
  return {
    id: doc._id.toHexString(),
    businessId: doc.businessId.toHexString(),
    business: business ? { name: business.name, nameState: business.nameState } : null,
    url: doc.url,
    finalUrl: doc.finalUrl,
    status: doc.status,
    trigger: doc.trigger,
    batchId: doc.batchId ? doc.batchId.toHexString() : null,
    fetched: doc.fetched
      ? {
          status: doc.fetched.status,
          redirects: doc.fetched.redirects.map((r) => ({ url: r.url, status: r.status })),
          bytes: doc.fetched.bytes,
          contentType: doc.fetched.contentType,
          durationMs: doc.fetched.durationMs,
          tls: { ...doc.fetched.tls },
        }
      : null,
    robots: { fetched: doc.robots.fetched, allowed: doc.robots.allowed },
    pagesVisited: doc.pagesVisited.map((p) => ({
      url: p.url,
      finalUrl: p.finalUrl,
      kind: p.kind,
      status: p.status,
      error: p.error,
    })),
    detections: doc.detections.map((d) => ({
      key: d.key,
      label: d.label,
      observed: d.observed,
      confidence: d.confidence,
      evidence: d.evidence.map((e) => ({ type: e.type, value: e.value, page: e.page })),
      observedValue: d.observedValue,
      analyzedAt: d.analyzedAt.toISOString(),
    })),
    opportunities: doc.opportunities.map((o) => ({ ...o, detectionKeys: [...o.detectionKeys] })),
    credits: {
      held: doc.credits.held,
      captured: doc.credits.captured,
      released: doc.credits.released,
      settled: doc.credits.settledAt !== null,
    },
    error: doc.error,
    requestedByUserId: doc.requestedByUserId,
    createdAt: doc.createdAt.toISOString(),
    startedAt: iso(doc.startedAt),
    analyzedAt: iso(doc.analyzedAt),
    finishedAt: iso(doc.finishedAt),
  };
}
