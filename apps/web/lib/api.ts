import {
  CSRF_COOKIE,
  CSRF_HEADER,
  ORGANIZATION_HEADER,
  type ErrorCode,
  type ErrorDetail,
  type PageMeta,
  type PagedEnvelope,
} from "@leadforge/contracts";
import { getActiveOrgId } from "./org";
import {
  noteSessionStarted,
  notifySignedOut,
  refreshOnce,
  refreshesOn401,
  startsSession,
} from "./session";

export const API_PREFIX = `${process.env.NEXT_PUBLIC_API_BASE ?? "/api"}/v1`;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  readonly requestId: string | undefined;
  /** Seconds from a `Retry-After` header (429 RATE_LIMITED), when the server sent one. */
  readonly retryAfter: number | undefined;

  constructor(args: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: ErrorDetail[] | undefined;
    requestId?: string | undefined;
    retryAfter?: number | undefined;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.status = args.status;
    this.details = args.details;
    this.requestId = args.requestId;
    this.retryAfter = args.retryAfter;
  }
}

/** `Retry-After` as seconds: delta-seconds or an HTTP date. Undefined when absent or invalid. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the organization header, e.g. for auth endpoints. */
  noOrg?: boolean;
}

async function parseEnvelope<T>(res: Response): Promise<{ data: T; meta?: PageMeta }> {
  const requestId = res.headers.get("x-request-id") ?? undefined;
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const errBody = (
      json as {
        error?: { code?: ErrorCode; message?: string; details?: ErrorDetail[]; requestId?: string };
      } | null
    )?.error;
    throw new ApiError({
      code:
        errBody?.code ??
        (res.status === 429
          ? "RATE_LIMITED"
          : res.status === 401
            ? "UNAUTHENTICATED"
            : "INTERNAL_ERROR"),
      message:
        errBody?.message ??
        (res.status >= 500 ? "The server could not complete the request." : res.statusText),
      status: res.status,
      details: errBody?.details,
      requestId: errBody?.requestId ?? requestId,
      retryAfter: parseRetryAfter(res.headers.get("retry-after")),
    });
  }

  if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
    return json as { data: T; meta?: PageMeta };
  }
  return { data: json as T };
}

async function parseResponse<T>(res: Response): Promise<T> {
  return (await parseEnvelope<T>(res)).data;
}

function buildRequest(path: string, init: ApiFetchOptions): [string, RequestInit] {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  if (MUTATING.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }

  if (!init.noOrg) {
    const orgId = getActiveOrgId();
    if (orgId) headers.set(ORGANIZATION_HEADER, orgId);
  }

  const { body, noOrg: _noOrg, ...rest } = init;
  return [
    `${API_PREFIX}${path}`,
    {
      ...rest,
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  ];
}

function refreshRequest(): Promise<Response> {
  const [url, req] = buildRequest("/auth/refresh", { method: "POST", noOrg: true });
  return fetch(url, req);
}

/**
 * Sends a request. A 401 (expired, missing or revoked access token) triggers one shared
 * POST /auth/refresh and one repeat of the request; the request is rebuilt so it carries the new
 * CSRF cookie. A 401 that survives that, or a refresh the server refuses, signals "signed out"
 * once (lib/session.ts). Auth endpoints never refresh, and nothing is repeated twice, so a
 * revoked session cannot loop.
 */
async function send(path: string, init: ApiFetchOptions): Promise<Response> {
  const [url, req] = buildRequest(path, init);
  const res = await fetch(url, req);
  if (res.ok && startsSession(path)) noteSessionStarted();
  if (res.status !== 401 || !refreshesOn401(path)) return res;
  const outcome = await refreshOnce(refreshRequest);
  if (outcome === "signed_out") {
    notifySignedOut();
    return res;
  }
  if (outcome === "unavailable") return res;
  const [retryUrl, retryReq] = buildRequest(path, init);
  const retry = await fetch(retryUrl, retryReq);
  if (retry.status === 401) notifySignedOut();
  return retry;
}

/** Client-side fetch for cursor-paged lists; returns data plus pagination meta. */
export async function apiFetchPaged<T>(
  path: string,
  init: ApiFetchOptions = {},
): Promise<PagedEnvelope<T>> {
  const res = await send(path, init);
  const envelope = await parseEnvelope<T[]>(res);
  return {
    data: envelope.data,
    meta: envelope.meta ?? { nextCursor: null, pageSize: envelope.data.length },
  };
}

/** Client-side fetch against the same-origin API proxy. Throws ApiError on non-2xx. */
export async function apiFetch<T>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const res = await send(path, init);
  return parseResponse<T>(res);
}

export interface DownloadResult {
  blob: Blob;
  /** From Content-Disposition, or null when the server did not name the file. */
  fileName: string | null;
  headers: Headers;
}

/**
 * Fetches a file (for example a CSV export) with the same credentials, organization and CSRF
 * headers as JSON calls. Error responses are still JSON envelopes and throw ApiError.
 */
export async function apiDownload(
  path: string,
  init: ApiFetchOptions & { accept?: string } = {},
): Promise<DownloadResult> {
  const { accept = "text/csv", ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Accept", `${accept}, application/json;q=0.5`);
  const res = await send(path, { ...rest, headers });
  if (!res.ok) {
    await parseEnvelope<never>(res);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return {
    blob: await res.blob(),
    fileName: match?.[1] ? decodeURIComponent(match[1]) : null,
    headers: res.headers,
  };
}

/** Hands a downloaded blob to the browser as a file save. */
export function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled so the download is not cancelled.
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

export interface UploadOptions {
  /** Called with bytes sent and total bytes while the request body uploads. */
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Multipart upload with real upload progress (fetch cannot report it, so this uses
 * XMLHttpRequest). Sends the organization and CSRF headers and parses the response envelope.
 */
export function apiUpload<T>(path: string, form: FormData, opts: UploadOptions = {}): Promise<T> {
  return uploadOnce<T>(path, form, opts, true);
}

function uploadOnce<T>(
  path: string,
  form: FormData,
  opts: UploadOptions,
  mayRefresh: boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_PREFIX}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    const orgId = getActiveOrgId();
    if (orgId) xhr.setRequestHeader(ORGANIZATION_HEADER, orgId);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      const headers = new Headers();
      const requestId = xhr.getResponseHeader("x-request-id");
      if (requestId) headers.set("x-request-id", requestId);
      const retryAfter = xhr.getResponseHeader("retry-after");
      if (retryAfter) headers.set("retry-after", retryAfter);
      const res = new Response(xhr.status === 204 ? null : xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers,
      });
      if (xhr.status === 401 && refreshesOn401(path)) {
        if (!mayRefresh) {
          notifySignedOut();
          parseResponse<T>(res).then(resolve, reject);
          return;
        }
        void refreshOnce(refreshRequest).then((outcome) => {
          if (outcome === "refreshed") {
            uploadOnce<T>(path, form, opts, false).then(resolve, reject);
            return;
          }
          if (outcome === "signed_out") notifySignedOut();
          parseResponse<T>(res).then(resolve, reject);
        });
        return;
      }
      parseResponse<T>(res).then(resolve, reject);
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/**
 * Serializes a query object into `?a=1&b=x&b=y`. Arrays repeat the key (the API's convention),
 * undefined, null and empty strings are dropped.
 */
export function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value)
        if (v !== undefined && v !== null && v !== "") search.append(key, String(v));
    } else {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/**
 * Server-component fetch: talks to the API origin directly and forwards the incoming
 * cookie header so the user's session applies.
 */
export async function serverApiFetch<T>(
  path: string,
  init: RequestInit & { organizationId?: string } = {},
): Promise<T> {
  const { headers: nextHeaders } = await import("next/headers");
  const incoming = await nextHeaders();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const cookie = incoming.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  if (init.organizationId) headers.set(ORGANIZATION_HEADER, init.organizationId);

  const origin = process.env.API_URL ?? "http://localhost:4000";
  const res = await fetch(`${origin}/api/v1${path}`, {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
  });
  return parseResponse<T>(res);
}
