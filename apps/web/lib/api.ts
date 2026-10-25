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

export const API_PREFIX = `${process.env.NEXT_PUBLIC_API_BASE ?? "/api"}/v1`;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  readonly requestId: string | undefined;

  constructor(args: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: ErrorDetail[] | undefined;
    requestId?: string | undefined;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.status = args.status;
    this.details = args.details;
    this.requestId = args.requestId;
  }
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
  headers.set("Accept", "application/json");

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

/** Client-side fetch for cursor-paged lists; returns data plus pagination meta. */
export async function apiFetchPaged<T>(
  path: string,
  init: ApiFetchOptions = {},
): Promise<PagedEnvelope<T>> {
  const [url, req] = buildRequest(path, init);
  const res = await fetch(url, req);
  const envelope = await parseEnvelope<T[]>(res);
  return {
    data: envelope.data,
    meta: envelope.meta ?? { nextCursor: null, pageSize: envelope.data.length },
  };
}

/** Client-side fetch against the same-origin API proxy. Throws ApiError on non-2xx. */
export async function apiFetch<T>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const [url, req] = buildRequest(path, init);
  const res = await fetch(url, req);
  return parseResponse<T>(res);
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
