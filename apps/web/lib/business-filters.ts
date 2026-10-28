import {
  BUSINESS_SORT_FIELDS,
  BusinessListQuery,
  PAGE_SIZE_DEFAULT,
  type BusinessListFilter,
  type BusinessListFilterInput,
  type BusinessSortField,
  type FieldState,
  type SourceKey,
  type SuppressionFilter,
  type WhatsAppStatus,
} from "@leadforge/contracts";

/**
 * Directory view state, mirrored in the URL so a view is shareable and survives a refresh.
 * Parsing goes through the contracts' BusinessListQuery schema (the same one the API validates
 * with); unknown or invalid params are dropped rather than failing the page.
 */
export interface DirectoryState {
  q?: string;
  category: string[];
  region: string[];
  locality: string[];
  hasWebsite?: boolean;
  hasPhone?: boolean;
  hasEmail?: boolean;
  whatsapp: WhatsAppStatus[];
  websiteState: FieldState[];
  phoneState: FieldState[];
  emailState: FieldState[];
  source: SourceKey[];
  suppression: SuppressionFilter;
  importId?: string;
  /** Fit score and data confidence ranges (0 to 100, inclusive). Unscored businesses never match. */
  fitMin?: number;
  fitMax?: number;
  dataConfidenceMin?: number;
  dataConfidenceMax?: number;
  sort: { field: BusinessSortField; direction: "asc" | "desc" };
  pageSize: number;
}

export const SCORE_KEYS = ["fitMin", "fitMax", "dataConfidenceMin", "dataConfidenceMax"] as const;
type ScoreKey = (typeof SCORE_KEYS)[number];

export const DEFAULT_SORT: DirectoryState["sort"] = { field: "updatedAt", direction: "desc" };
export const PAGE_SIZES = [25, 50, 100] as const;

const ARRAY_KEYS = [
  "category",
  "region",
  "locality",
  "whatsapp",
  "websiteState",
  "phoneState",
  "emailState",
  "source",
] as const;
const SCALAR_KEYS = [
  "q",
  "hasWebsite",
  "hasPhone",
  "hasEmail",
  "suppression",
  "importId",
  "sort",
  "pageSize",
  ...SCORE_KEYS,
] as const;

type ArrayKey = (typeof ARRAY_KEYS)[number];

function rawFromParams(params: URLSearchParams): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of ARRAY_KEYS) {
    const values = params.getAll(key).filter(Boolean);
    if (values.length) raw[key] = values;
  }
  for (const key of SCALAR_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return raw;
}

export function parseDirectoryParams(params: URLSearchParams): DirectoryState {
  const raw = rawFromParams(params);
  // Drop whichever params fail validation (a hand-edited or stale link) and keep the rest.
  let parsed = BusinessListQuery.safeParse(raw);
  for (let i = 0; !parsed.success && i < 20; i++) {
    const bad = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")));
    if (bad.size === 0 || [...bad].every((k) => !(k in raw))) break;
    for (const k of bad) delete raw[k];
    parsed = BusinessListQuery.safeParse(raw);
  }
  const v = parsed.success ? parsed.data : BusinessListQuery.parse({});
  return {
    q: v.q || undefined,
    category: v.category ?? [],
    region: v.region ?? [],
    locality: v.locality ?? [],
    hasWebsite: v.hasWebsite,
    hasPhone: v.hasPhone,
    hasEmail: v.hasEmail,
    whatsapp: v.whatsapp ?? [],
    websiteState: v.websiteState ?? [],
    phoneState: v.phoneState ?? [],
    emailState: v.emailState ?? [],
    source: v.source ?? [],
    suppression: v.suppression,
    importId: v.importId,
    fitMin: v.fitMin,
    fitMax: v.fitMax,
    dataConfidenceMin: v.dataConfidenceMin,
    dataConfidenceMax: v.dataConfidenceMax,
    sort: v.sort ?? DEFAULT_SORT,
    pageSize: (PAGE_SIZES as readonly number[]).includes(v.pageSize)
      ? v.pageSize
      : PAGE_SIZE_DEFAULT,
  };
}

/** URL params for a state. Defaults are left out so the URL stays short. */
export function serializeDirectoryState(state: DirectoryState): URLSearchParams {
  const out = new URLSearchParams();
  if (state.q) out.set("q", state.q);
  for (const key of ARRAY_KEYS) for (const v of state[key]) out.append(key, v);
  for (const key of ["hasWebsite", "hasPhone", "hasEmail"] as const) {
    const v = state[key];
    if (v !== undefined) out.set(key, String(v));
  }
  if (state.suppression !== "exclude") out.set("suppression", state.suppression);
  if (state.importId) out.set("importId", state.importId);
  for (const key of SCORE_KEYS) {
    const v = state[key];
    if (v !== undefined) out.set(key, String(v));
  }
  if (state.sort.field !== DEFAULT_SORT.field || state.sort.direction !== DEFAULT_SORT.direction) {
    out.set("sort", `${state.sort.field}:${state.sort.direction}`);
  }
  if (state.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(state.pageSize));
  return out;
}

/** Filter fields shared by GET /businesses and POST /exports/businesses. */
export function toFilter(state: DirectoryState): BusinessListFilterInput {
  const filter: BusinessListFilterInput = { suppression: state.suppression };
  if (state.q) filter.q = state.q;
  for (const key of ARRAY_KEYS) {
    if (state[key].length) (filter as Record<ArrayKey, string[]>)[key] = [...state[key]];
  }
  if (state.hasWebsite !== undefined) filter.hasWebsite = state.hasWebsite;
  if (state.hasPhone !== undefined) filter.hasPhone = state.hasPhone;
  if (state.hasEmail !== undefined) filter.hasEmail = state.hasEmail;
  if (state.importId) filter.importId = state.importId;
  for (const key of SCORE_KEYS) {
    const v = state[key];
    if (v !== undefined) (filter as Record<ScoreKey, number>)[key] = v;
  }
  return filter;
}

/**
 * The same filters typed as the request bodies of bulk operations and async exports expect them
 * (BusinessListFilter, whose `suppression` is always present).
 */
export function toRequestFilter(state: DirectoryState): BusinessListFilter {
  return { ...toFilter(state), suppression: state.suppression } as BusinessListFilter;
}

/** Query params for GET /businesses (arrays repeat, booleans as "true"/"false"). */
export function toListQuery(
  state: DirectoryState,
  cursor?: string | null,
): Record<string, unknown> {
  return {
    ...toFilter(state),
    sort: `${state.sort.field}:${state.sort.direction}`,
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  };
}

/** Number of narrowing filters (search and sort are not counted). */
export function activeFilterCount(state: DirectoryState): number {
  let n = 0;
  for (const key of ARRAY_KEYS) n += state[key].length ? 1 : 0;
  for (const key of ["hasWebsite", "hasPhone", "hasEmail"] as const) {
    n += state[key] !== undefined ? 1 : 0;
  }
  if (state.suppression !== "exclude") n += 1;
  if (state.importId) n += 1;
  if (state.fitMin !== undefined || state.fitMax !== undefined) n += 1;
  if (state.dataConfidenceMin !== undefined || state.dataConfidenceMax !== undefined) n += 1;
  return n;
}

export function isSortField(id: string): id is BusinessSortField {
  return (BUSINESS_SORT_FIELDS as readonly string[]).includes(id);
}

/** Presence and state of one contact field expressed as a single choice for the filter menu. */
export type ContactChoice = "" | "has" | "none" | FieldState;

export function contactChoice(
  state: DirectoryState,
  field: "website" | "phone" | "email",
): ContactChoice | "custom" {
  const has = state[`has${capitalize(field)}` as "hasWebsite" | "hasPhone" | "hasEmail"];
  const states = state[`${field}State` as "websiteState" | "phoneState" | "emailState"];
  if (has !== undefined && states.length) return "custom";
  if (has === true) return "has";
  if (has === false) return "none";
  if (states.length === 1) return states[0] === "missing" ? "none" : (states[0] as FieldState);
  if (states.length > 1) return "custom";
  return "";
}

export function withContactChoice(
  state: DirectoryState,
  field: "website" | "phone" | "email",
  choice: ContactChoice,
): DirectoryState {
  const hasKey = `has${capitalize(field)}` as "hasWebsite" | "hasPhone" | "hasEmail";
  const stateKey = `${field}State` as "websiteState" | "phoneState" | "emailState";
  const next: DirectoryState = { ...state, [hasKey]: undefined, [stateKey]: [] };
  if (choice === "has") next[hasKey] = true;
  else if (choice === "none") next[hasKey] = false;
  else if (choice) next[stateKey] = [choice];
  return next;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A state with every narrowing filter removed (search, sort and page size are kept). */
export function clearedFilters(state: DirectoryState): DirectoryState {
  return {
    ...state,
    category: [],
    region: [],
    locality: [],
    hasWebsite: undefined,
    hasPhone: undefined,
    hasEmail: undefined,
    whatsapp: [],
    websiteState: [],
    phoneState: [],
    emailState: [],
    source: [],
    suppression: "exclude",
    importId: undefined,
    fitMin: undefined,
    fitMax: undefined,
    dataConfidenceMin: undefined,
    dataConfidenceMax: undefined,
  };
}
