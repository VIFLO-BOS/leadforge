import { EXPORT_LIMITS, type ExportJob, type ExportStatus } from "@leadforge/contracts";
import type { JobState } from "@leadforge/ui";
import { isApiError } from "./api";
import { formatNumber, plural } from "./format";

/*
 * Asynchronous exports (Phase 5): create, poll, then download through a short-lived signed link.
 * Every export is a ZIP with the CSV, ATTRIBUTION.txt and the licence texts that apply.
 */

export const EXPORT_POLL_MS = 2_000;

export const EXPORT_STATUS_LABELS: Partial<Record<ExportStatus, string>> = {
  queued: "Queued",
  running: "Building the file",
  completed: "Ready to download",
  failed: "Failed",
  expired: "Expired",
};

export function exportJobState(status: string): JobState {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "expired":
      return "cancelled";
    default:
      return "queued";
  }
}

export function isExportActive(job: Pick<ExportJob, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}

/** What was exported, in words: a list, a selection or the directory filters. */
export function exportSelectionLabel(job: Pick<ExportJob, "kind" | "selection">): string {
  if (job.kind === "list") {
    return job.selection.listName ? `List “${job.selection.listName}”` : "A lead list";
  }
  if (job.kind === "selection") {
    return job.selection.idsCount !== null
      ? `${plural(job.selection.idsCount, "selected business", "selected businesses")}`
      : "Selected businesses";
  }
  return "Directory results";
}

/** Row cap and matched count from a 422 EXPORT_TOO_LARGE on POST /exports (details `rowCap`, `matched`). */
export function exportCapDetails(err: unknown): { rowCap: number; matched: number | null } | null {
  if (!isApiError(err) || err.code !== "EXPORT_TOO_LARGE") return null;
  const read = (path: string) => {
    const raw = err.details?.find((d) => d.path === path)?.message;
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return { rowCap: read("rowCap") ?? EXPORT_LIMITS.defaultRowCap, matched: read("matched") };
}

export function exportTooLargeMessage(err: unknown): string | null {
  const d = exportCapDetails(err);
  if (!d) return null;
  return d.matched !== null
    ? `${formatNumber(d.matched)} businesses match, and exports are limited to ${formatNumber(d.rowCap)} rows on this workspace's plan. Narrow the filters or export a list.`
    : `Exports are limited to ${formatNumber(d.rowCap)} rows on this workspace's plan. Narrow the filters or export a list.`;
}

/** Messages for the download error codes (from download-url, or a link that failed when opened). */
export const DOWNLOAD_ERROR_MESSAGES: Record<string, string> = {
  EXPORT_NOT_READY: "The file is not ready yet. Wait until the export shows Ready to download.",
  EXPORT_EXPIRED:
    "The file was deleted after its 7-day retention window. Run the export again to get a fresh file.",
  DOWNLOAD_LINK_INVALID:
    "That download link is not valid for you. Download links work only for the person who requested them, in this workspace.",
  DOWNLOAD_LINK_EXPIRED: "That download link has expired. Choose Download again for a new link.",
};

export function downloadErrorMessage(code: string | null | undefined): string | null {
  return code ? (DOWNLOAD_ERROR_MESSAGES[code] ?? null) : null;
}

/**
 * The signed link as a same-origin path when it points at this app's API (`…/api/v1/…`), so the
 * browser sends the session cookie first-party through the web app's `/api` proxy. Other links
 * are returned unchanged. The link's signature binds the user, workspace and export, not the host.
 */
export function sameOriginDownloadUrl(url: string, origin?: string): string {
  try {
    const base =
      origin ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const parsed = new URL(url, base);
    if (parsed.pathname.startsWith("/api/v1/")) return `${parsed.pathname}${parsed.search}`;
    return parsed.href;
  } catch {
    return url;
  }
}

export const EXPORT_RETENTION_DAYS = Math.round(EXPORT_LIMITS.fileRetentionHours / 24);
export const DOWNLOAD_LINK_MINUTES = Math.round(EXPORT_LIMITS.downloadUrlTtlSeconds / 60);
