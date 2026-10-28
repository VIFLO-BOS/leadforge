import { SourceError } from "../source-adapter.js";
import { FIXTURE_REPEATED_ON_PAGE_2, placesFixtureData } from "./places-fixtures.js";
import type {
  GoogleApiErrorBody,
  Place,
  PlacesSearchTextRequest,
  PlacesSearchTextResponse,
} from "./places.types.js";

export const PLACES_API_BASE = "https://places.googleapis.com/v1";
export const PLACES_TEXT_SEARCH_URL = `${PLACES_API_BASE}/places:searchText`;
const REQUEST_TIMEOUT_MS = 15_000;

/** How LeadForge reaches the Places API. One implementation calls Google; the other replays fixtures. */
export interface PlacesTransport {
  readonly mode: "live" | "fixture";
  searchText(
    body: PlacesSearchTextRequest,
    fieldMask: string,
    signal?: AbortSignal,
  ): Promise<PlacesSearchTextResponse>;
  /** Place Details (New). Null when Google answers 404 for the place ID. */
  getPlace(placeId: string, fieldMask: string, signal?: AbortSignal): Promise<Place | null>;
}

/** Injection token. Null when neither an API key nor fixture mode is configured. */
export const PLACES_TRANSPORT = Symbol("PLACES_TRANSPORT");

/**
 * Maps an HTTP failure to a SourceError. 429 and 5xx are retried with backoff; 400 (bad
 * request), 401 and 403 (invalid key, API not enabled, billing disabled) end the source's run.
 */
export function placesHttpError(
  status: number,
  body: GoogleApiErrorBody | null,
  redact: (s: string) => string,
): SourceError {
  const googleStatus = body?.error?.status ?? null;
  const detail = redact((body?.error?.message ?? "").slice(0, 300));
  const message = `Google Places returned HTTP ${status}${googleStatus ? ` ${googleStatus}` : ""}${detail ? `: ${detail}` : ""}`;
  if (status === 429) return new SourceError("SOURCE_RATE_LIMITED", message, true, status);
  if (status >= 500) return new SourceError("SOURCE_UNAVAILABLE", message, true, status);
  if (status === 401 || status === 403)
    return new SourceError("SOURCE_AUTH_FAILED", message, false, status);
  if (status === 400 || status === 404)
    return new SourceError("SOURCE_REQUEST_INVALID", message, false, status);
  return new SourceError("SOURCE_ERROR", message, false, status);
}

/** Calls the Places API (New) over HTTPS. The key travels only in the X-Goog-Api-Key header. */
export class HttpPlacesTransport implements PlacesTransport {
  readonly mode = "live" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private redact = (s: string): string =>
    this.apiKey ? s.split(this.apiKey).join("[redacted]") : s;

  private async call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : "error";
      throw new SourceError(
        "SOURCE_UNAVAILABLE",
        `Could not reach Google Places (${reason})`,
        true,
        null,
      );
    }
  }

  private async fail(res: Response): Promise<never> {
    let body: GoogleApiErrorBody | null = null;
    try {
      body = (await res.json()) as GoogleApiErrorBody;
    } catch {
      body = null;
    }
    throw placesHttpError(res.status, body, this.redact);
  }

  async searchText(
    body: PlacesSearchTextRequest,
    fieldMask: string,
    signal?: AbortSignal,
  ): Promise<PlacesSearchTextResponse> {
    const res = await this.call(
      PLACES_TEXT_SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      },
      signal,
    );
    if (!res.ok) return this.fail(res);
    return (await res.json()) as PlacesSearchTextResponse;
  }

  async getPlace(placeId: string, fieldMask: string, signal?: AbortSignal): Promise<Place | null> {
    const res = await this.call(
      `${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}`,
      { method: "GET", headers: { "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": fieldMask } },
      signal,
    );
    if (res.status === 404) return null;
    if (!res.ok) return this.fail(res);
    return (await res.json()) as Place;
  }
}

export interface FixtureFault {
  op: "search" | "details";
  status: number;
  /** How many consecutive calls fail (default 1). */
  times?: number;
  googleStatus?: string;
}

const FIXTURE_PAGE_SIZE = 20;
const FIXTURE_MAX_RESULTS = 60;

/**
 * Development and test transport: replays the hand-built fixtures in places-fixtures.ts with
 * the documented pagination (20 per page, at most 60) and field-mask projection. Faults can be
 * queued to exercise retries. Never used in production (the env schema refuses fixture mode).
 */
export class FixturePlacesTransport implements PlacesTransport {
  readonly mode = "fixture" as const;
  private readonly data = placesFixtureData();
  private readonly faults: Array<Required<FixtureFault>> = [];
  /** Every call, for tests. */
  readonly calls: Array<{
    op: "search" | "details";
    body?: PlacesSearchTextRequest;
    placeId?: string;
    fieldMask: string;
  }> = [];

  injectFault(fault: FixtureFault): void {
    this.faults.push({ times: 1, googleStatus: "", ...fault });
  }

  clearFaults(): void {
    this.faults.length = 0;
    this.calls.length = 0;
  }

  private takeFault(op: "search" | "details"): void {
    const fault = this.faults.find((f) => f.op === op && f.times > 0);
    if (!fault) return;
    fault.times -= 1;
    if (fault.times <= 0) this.faults.splice(this.faults.indexOf(fault), 1);
    throw placesHttpError(
      fault.status,
      {
        error: {
          code: fault.status,
          status: fault.googleStatus || undefined,
          message: "Injected fixture fault",
        },
      },
      (s) => s,
    );
  }

  async searchText(
    body: PlacesSearchTextRequest,
    fieldMask: string,
  ): Promise<PlacesSearchTextResponse> {
    this.calls.push({ op: "search", body, fieldMask });
    this.takeFault("search");
    const key = (body.textQuery.split(/\s+in\s+/i)[0] ?? "").trim().toLowerCase();
    const places = this.data[key] ?? [];
    const page = body.pageToken
      ? Number(/^fixture-page-(\d+)$/.exec(body.pageToken)?.[1] ?? NaN)
      : 0;
    if (!Number.isInteger(page))
      throw placesHttpError(
        400,
        { error: { status: "INVALID_ARGUMENT", message: "Invalid page token" } },
        (s) => s,
      );
    const capped = places.slice(0, FIXTURE_MAX_RESULTS);
    const slice = capped.slice(page * FIXTURE_PAGE_SIZE, (page + 1) * FIXTURE_PAGE_SIZE);
    const repeated = page === 1 ? FIXTURE_REPEATED_ON_PAGE_2[key] : undefined;
    if (repeated !== undefined && capped[repeated - 1]) slice.unshift(capped[repeated - 1]!);
    const more = (page + 1) * FIXTURE_PAGE_SIZE < capped.length;
    const fields = maskFields(fieldMask, "places.");
    return {
      ...(slice.length ? { places: slice.map((p) => project(p, fields)) } : {}),
      ...(more && fieldMask.split(",").includes("nextPageToken")
        ? { nextPageToken: `fixture-page-${page + 1}` }
        : {}),
    };
  }

  async getPlace(placeId: string, fieldMask: string): Promise<Place | null> {
    this.calls.push({ op: "details", placeId, fieldMask });
    this.takeFault("details");
    for (const list of Object.values(this.data)) {
      const found = list.find((p) => p.id === placeId);
      if (found) return project(found, maskFields(fieldMask, ""));
    }
    return null;
  }
}

function maskFields(mask: string, prefix: string): Set<string> {
  return new Set(
    mask
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length)),
  );
}

function project(place: Place, fields: Set<string>): Place {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(place)) if (fields.has(k) && v !== undefined) out[k] = v;
  return out as unknown as Place;
}
