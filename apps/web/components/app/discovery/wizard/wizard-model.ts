import {
  DISCOVERY_LIMITS,
  DiscoveryJobSpec,
  type DiscoveryJobSpecInput,
  type DiscoveryPriorityField,
  type DiscoverySourceOption,
} from "@leadforge/contracts";
import type { z } from "zod";
import { splitList } from "@/lib/forms";
import { formatNumber } from "@/lib/format";

/**
 * Discovery wizard model. The inputs do not mirror the request one to one (comma-separated
 * domains, a number typed as text, a suggested name, controls that only some sources honour), so
 * `toSpec` builds the body and every step validates it with the contracts' DiscoveryJobSpec, the
 * schema the API validates with. Issues are mapped back onto the inputs of the step that owns
 * them. Which controls exist comes from each source's `specSupport` (GET /discovery/sources);
 * nothing here names a source.
 */

export const WIZARD_STEPS = [
  { id: "source", label: "Source" },
  { id: "target", label: "What to find" },
  { id: "limits", label: "Limits" },
  { id: "estimate", label: "Estimate" },
  { id: "review", label: "Review and create" },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

export type Confidence = "standard" | "high";

export interface WizardValues {
  sources: string[];
  categories: string[];
  /** State or region (canonical Nigerian spelling). */
  region: string;
  /** Local government area. */
  lga: string;
  /** City or town. */
  locality: string;
  /** Extra place text, e.g. a street or neighbourhood. */
  area: string;
  name: string;
  /** False while the name still follows the suggestion built from categories and place. */
  nameEdited: boolean;
  /** Typed as text so an empty field is representable; converted by `toSpec`. */
  maxRecords: string;
  priorityFields: DiscoveryPriorityField[];
  confidence: Confidence;
  requireContact: boolean;
  domainsInclude: string;
  domainsExclude: string;
}

export type WizardField = keyof WizardValues;

export const DEFAULT_MAX_RECORDS = 100;

export function defaultValues(): WizardValues {
  return {
    sources: [],
    categories: [],
    region: "",
    lga: "",
    locality: "",
    area: "",
    name: "",
    nameEdited: false,
    maxRecords: String(DEFAULT_MAX_RECORDS),
    priorityFields: ["phone", "website"],
    confidence: "standard",
    requireContact: true,
    domainsInclude: "",
    domainsExclude: "",
  };
}

/** Which controls the selected sources honour (the union of their `specSupport`). */
export interface WizardSupport {
  location: ("region" | "lga" | "locality" | "query" | "geo")[];
  confidence: boolean;
  requireContact: boolean;
  priorityFields: boolean;
  /** First selected source with category and location catalogues, if any. */
  catalogSource: string | null;
}

/** Before any source is chosen: a state, a city and an area; no source-specific controls. */
export const DEFAULT_SUPPORT: WizardSupport = {
  location: ["region", "locality", "query"],
  confidence: false,
  requireContact: false,
  priorityFields: true,
  catalogSource: null,
};

export function supportFor(selected: readonly DiscoverySourceOption[]): WizardSupport {
  if (!selected.length) return DEFAULT_SUPPORT;
  const location = new Set<WizardSupport["location"][number]>();
  for (const s of selected)
    for (const f of s.specSupport?.location ?? DEFAULT_SUPPORT.location) location.add(f);
  return {
    location: [...location],
    confidence: selected.some((s) => s.specSupport?.confidence),
    requireContact: selected.some((s) => s.specSupport?.requireContact),
    priorityFields: selected.some((s) => s.specSupport?.priorityFields ?? true),
    catalogSource: selected.find((s) => s.specSupport?.catalog)?.key ?? null,
  };
}

/** Fields each step owns; a step validates its own fields and those of the steps before it. */
export const STEP_FIELDS: Record<WizardStepId, WizardField[]> = {
  source: ["sources"],
  target: ["categories", "region", "lga", "locality", "area", "name"],
  limits: [
    "maxRecords",
    "confidence",
    "requireContact",
    "priorityFields",
    "domainsInclude",
    "domainsExclude",
  ],
  estimate: [],
  review: [],
};

export function stepOfField(field: WizardField): number {
  const i = WIZARD_STEPS.findIndex((s) => STEP_FIELDS[s.id].includes(field));
  return i < 0 ? 0 : i;
}

const blank = (v: string) => (v.trim() ? v.trim() : undefined);

/**
 * The request body the estimate and create endpoints receive. Controls the selected sources do
 * not honour are left out (the schema's defaults apply), so a hidden input never changes a job.
 */
export function toSpec(
  values: WizardValues,
  country = "NG",
  support: WizardSupport = DEFAULT_SUPPORT,
): DiscoveryJobSpecInput {
  const max = values.maxRecords.trim();
  const has = (f: WizardSupport["location"][number]) => support.location.includes(f);
  return {
    name: values.name.trim(),
    // Keys come from GET /discovery/sources; the schema rejects anything else.
    sources: values.sources as DiscoveryJobSpecInput["sources"],
    location: {
      country,
      region: has("region") ? blank(values.region) : undefined,
      lga: has("lga") ? blank(values.lga) : undefined,
      locality: has("locality") ? blank(values.locality) : undefined,
      query: has("query") ? blank(values.area) : undefined,
    },
    categories: values.categories.map((c) => c.trim()),
    domainsInclude: splitList(values.domainsInclude),
    domainsExclude: splitList(values.domainsExclude),
    maxRecords: max === "" ? Number.NaN : Number(max),
    priorityFields: support.priorityFields ? values.priorityFields : undefined,
    confidence: support.confidence ? values.confidence : undefined,
    requireContact: support.requireContact ? values.requireContact : undefined,
  };
}

/** Maps a spec issue path (from the schema or a 400 VALIDATION_FAILED) to the input it belongs to. */
export function fieldForPath(path: readonly (string | number)[]): {
  field: WizardField;
  prefix?: string;
} {
  const [head, second] = path;
  switch (head) {
    case "location":
      if (second === "locality") return { field: "locality" };
      if (second === "lga") return { field: "lga" };
      if (second === "query") return { field: "area" };
      return { field: "region" };
    case "domainsInclude":
    case "domainsExclude":
      return typeof second === "number"
        ? { field: head, prefix: `Domain ${second + 1}: ` }
        : { field: head };
    case "sources":
    case "categories":
    case "maxRecords":
    case "priorityFields":
    case "confidence":
    case "requireContact":
    case "name":
      return { field: head };
    default:
      return { field: "name" };
  }
}

const NUMBER_HINT = `Enter a whole number from 1 to ${formatNumber(DISCOVERY_LIMITS.maxRecords)}.`;

/**
 * Plain-language wording for the schema's generic issues (minimum and maximum sizes, types).
 * Messages the contracts already word (refinements, the domain format) pass through unchanged.
 */
export function friendlyIssue(
  field: WizardField,
  issue: z.core.$ZodIssue,
  values: WizardValues,
): string {
  const code = issue.code;
  const indexed = typeof issue.path[1] === "number";
  switch (field) {
    case "sources":
      if (code === "too_small") return "Choose at least one source.";
      if (code === "too_big") return `Choose at most ${DISCOVERY_LIMITS.maxSources} sources.`;
      if (code === "invalid_value" || code === "invalid_type")
        return "A selected source is not available for discovery. Choose another.";
      return issue.message;
    case "categories":
      if (indexed) {
        const value = values.categories[issue.path[1] as number] ?? "";
        if (code === "too_small") return `“${value}” is too short. Use at least 2 characters.`;
        if (code === "too_big")
          return `“${value.slice(0, 24)}…” is too long. Use at most 80 characters.`;
        return issue.message;
      }
      if (code === "too_small") return "Add at least one category or keyword.";
      if (code === "too_big") return `Use at most ${DISCOVERY_LIMITS.maxCategories} categories.`;
      return issue.message;
    case "region":
    case "lga":
    case "locality":
    case "area":
      if (code === "too_small") return "Use at least 2 characters.";
      if (code === "too_big") return "This is too long.";
      return issue.message;
    case "name":
      if (code === "too_small") return "Give the job a name of at least 2 characters.";
      if (code === "too_big") return "Keep the name under 120 characters.";
      return issue.message;
    case "maxRecords":
      return NUMBER_HINT;
    case "priorityFields":
      if (code === "too_big") return "Choose at most 4 contact fields.";
      return issue.message;
    case "domainsInclude":
    case "domainsExclude":
      if (code === "too_big" && !indexed)
        return `Use at most ${DISCOVERY_LIMITS.maxDomains} domains.`;
      if (code === "too_small") return "Use a bare domain such as example.com";
      return issue.message;
    default:
      return issue.message;
  }
}

export type StepErrors = Partial<Record<WizardField, string>>;

const PLACE_FIELDS: {
  field: "region" | "lga" | "locality" | "area";
  support: WizardSupport["location"][number];
  noun: string;
}[] = [
  { field: "region", support: "region", noun: "a state" },
  { field: "lga", support: "lga", noun: "an LGA" },
  { field: "locality", support: "locality", noun: "a city or town" },
  { field: "area", support: "query", noun: "an area" },
];

/** "Choose a state, or enter a city or town or an area." for the place fields on offer. */
export function placeRequirement(support: WizardSupport): string {
  const nouns = PLACE_FIELDS.filter((p) => support.location.includes(p.support)).map((p) => p.noun);
  if (nouns.length <= 1) return `Enter ${nouns[0] ?? "a place"}.`;
  return `Choose ${nouns.slice(0, -1).join(", ")} or ${nouns[nouns.length - 1]}.`;
}

/**
 * Validates the spec with the contracts schema and keeps the issues that belong to steps up to and
 * including `stepIndex`. One rule is added on top of the schema: the API refuses a job without a
 * place (docs/API_CONTRACTS.md: "a city, state, area or map point is required"), so the wizard
 * asks for one of the place fields the selected sources honour before estimating.
 */
export function validateThrough(
  stepIndex: number,
  values: WizardValues,
  country = "NG",
  support: WizardSupport = DEFAULT_SUPPORT,
): StepErrors {
  const owned = new Set(WIZARD_STEPS.slice(0, stepIndex + 1).flatMap((s) => STEP_FIELDS[s.id]));
  const errors: StepErrors = {};
  const parsed = DiscoveryJobSpec.safeParse(toSpec(values, country, support));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const { field, prefix = "" } = fieldForPath(issue.path as (string | number)[]);
      if (!owned.has(field) || errors[field]) continue;
      errors[field] = `${prefix}${friendlyIssue(field, issue, values)}`;
    }
  }
  const offered = PLACE_FIELDS.filter((p) => support.location.includes(p.support));
  if (
    owned.has("region") &&
    offered.length > 0 &&
    !offered.some((p) => values[p.field].trim()) &&
    !offered.some((p) => errors[p.field])
  ) {
    errors[offered[0]!.field] = placeRequirement(support);
  }
  return errors;
}

/** "Restaurant and bakery in Ikeja, Lagos", used as the job name until the user edits it. */
export function suggestName(
  values: Pick<WizardValues, "categories" | "region" | "lga" | "locality" | "area">,
): string {
  const cats = values.categories.map((c) => c.trim()).filter(Boolean);
  const what =
    cats.length === 0
      ? ""
      : cats.length === 1
        ? cats[0]!
        : cats.length === 2
          ? `${cats[0]} and ${cats[1]!.toLowerCase()}`
          : `${cats[0]}, ${cats[1]!.toLowerCase()} and ${cats.length - 2} more`;
  const places: string[] = [];
  for (const p of [values.area, values.locality, values.lga, values.region]) {
    const t = p.trim();
    if (t && !places.some((x) => x.toLowerCase() === t.toLowerCase())) places.push(t);
  }
  const where = places.join(", ");
  const name = [what, where ? `in ${where}` : ""].filter(Boolean).join(" ");
  return name.slice(0, 120);
}

/** Idempotency key for one submission: 8 to 128 of A-Z a-z 0-9 _ - . : (API contract). */
export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `wizard-${crypto.randomUUID()}`;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `wizard-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return `wizard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Stable JSON for comparing specs (key order does not change between builds of the same values). */
export function specFingerprint(spec: DiscoveryJobSpecInput): string {
  return JSON.stringify(spec);
}
