import { ObjectId, type Document } from "@leadforge/db-mongo";
import type { BusinessListFilter, BusinessSortField, FieldState } from "@leadforge/contracts";
import { escapeRegex, normalizeKey, regionKey, searchWords } from "../normalization/index.js";
import { staleCutoff, type StateContext } from "./field-state.js";

export const MAX_SEARCH_TOKENS = 8;

/** Sort field to stored path. Every one has an `{ organizationId, <path>, _id }` index. */
export const SORT_PATHS: Record<BusinessSortField, string> = {
  updatedAt: "updatedAt",
  createdAt: "createdAt",
  name: "name.normalized",
  lastVerifiedAt: "lastVerifiedAt",
  fit: "score.fit",
  dataConfidence: "score.dataConfidence",
};

/**
 * Search terms: lowercase words matched as prefixes of the stored tokens. A query that
 * looks like a phone number collapses to its digits so "0803 123 4567" and "+234 803..."
 * both match.
 */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return [];
  const trimmed = q.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/^[\d\s()+\-.]+$/.test(trimmed) && digits.length >= 4) return [digits];
  // Longest first: MongoDB bounds the index scan on the first `$all` term, and a longer prefix
  // usually matches fewer records, so fewer documents are read to check the others.
  return [...new Set(searchWords(trimmed))]
    .slice(0, MAX_SEARCH_TOKENS)
    .sort((a, b) => b.length - a.length);
}

function notExpired(prefix: string, now: Date): Document {
  return { $or: [{ [`${prefix}expiresAt`]: null }, { [`${prefix}expiresAt`]: { $gt: now } }] };
}
function fresh(prefix: string, cutoff: Date): Document {
  return {
    $or: [
      { [`${prefix}lastObservedAt`]: { $gte: cutoff } },
      { [`${prefix}lastVerifiedAt`]: { $gte: cutoff } },
    ],
  };
}
function stale(prefix: string, cutoff: Date): Document {
  return {
    [`${prefix}lastObservedAt`]: { $lt: cutoff },
    $or: [{ [`${prefix}lastVerifiedAt`]: null }, { [`${prefix}lastVerifiedAt`]: { $lt: cutoff } }],
  };
}

/** Conditions on one field value (an array element or the single website object). */
function valueStateCondition(
  state: Exclude<FieldState, "missing">,
  prefix: string,
  ctx: StateContext,
): Document {
  const cutoff = staleCutoff(ctx);
  switch (state) {
    case "verified":
    case "unverified":
      return {
        [`${prefix}state`]: state,
        $and: [notExpired(prefix, ctx.now), fresh(prefix, cutoff)],
      };
    case "conflicting":
      return { [`${prefix}state`]: "conflicting", $and: [notExpired(prefix, ctx.now)] };
    case "stale":
      return {
        [`${prefix}state`]: { $ne: "conflicting" },
        $and: [notExpired(prefix, ctx.now), stale(prefix, cutoff)],
      };
    case "expired":
      return { [`${prefix}expiresAt`]: { $lte: ctx.now } };
  }
}

/** Array fields (phones, emails): at least one element in any of the states. */
function arrayStateClause(
  path: "phones" | "emails",
  states: FieldState[],
  ctx: StateContext,
): Document {
  const branches = states.map((s) =>
    s === "missing"
      ? { [`${path}.0`]: { $exists: false } }
      : { [path]: { $elemMatch: valueStateCondition(s, "", ctx) } },
  );
  return branches.length === 1 ? branches[0]! : { $or: branches };
}

function websiteStateClause(states: FieldState[], ctx: StateContext): Document {
  const branches = states.map((s) =>
    s === "missing"
      ? { website: null }
      : { "website.domain": { $exists: true }, ...valueStateCondition(s, "website.", ctx) },
  );
  return branches.length === 1 ? branches[0]! : { $or: branches };
}

/**
 * Builds the Mongo filter for the directory from validated filters. Values never become
 * operators: every user string is either matched by equality against a normalized key or
 * escaped and anchored inside a prefix regex. The organization scope is added by the
 * repository.
 */
export function buildBusinessFilter(
  filter: Partial<BusinessListFilter>,
  ctx: StateContext,
): Document {
  const and: Document[] = [{ deletedAt: null }];

  // At most BUSINESS_IDS_FILTER_MAX ids; with the organization prefix every repository adds,
  // ids from another organization match nothing (indistinguishable from unknown ids).
  if (filter.ids?.length)
    and.push({
      _id: {
        $in: [...new Set(filter.ids.map((i) => i.toLowerCase()))].map((i) => new ObjectId(i)),
      },
    });

  const terms = searchTerms(filter.q);
  // Terms are [a-z0-9] words, escaped anyway and anchored: prefix match on an indexed array.
  if (terms.length === 1) {
    // eslint-disable-next-line security/detect-non-literal-regexp
    and.push({ "search.tokens": new RegExp(`^${escapeRegex(terms[0]!)}`) });
  } else if (terms.length > 1) {
    // eslint-disable-next-line security/detect-non-literal-regexp
    and.push({ "search.tokens": { $all: terms.map((t) => new RegExp(`^${escapeRegex(t)}`)) } });
  }

  if (filter.category?.length)
    and.push({ "categories.key": { $in: filter.category.map(normalizeKey) } });
  if (filter.country) and.push({ "location.country": filter.country });
  if (filter.region?.length)
    and.push({ "location.regionKey": { $in: filter.region.map(regionKey) } });
  if (filter.locality?.length)
    and.push({ "location.localityKey": { $in: filter.locality.map(normalizeKey) } });
  if (filter.lga?.length) and.push({ "location.lgaKey": { $in: filter.lga.map(normalizeKey) } });

  if (filter.hasWebsite === true) and.push({ "website.domain": { $exists: true } });
  if (filter.hasWebsite === false) and.push({ website: null });
  if (filter.hasPhone === true) and.push({ "phones.0": { $exists: true } });
  if (filter.hasPhone === false) and.push({ "phones.0": { $exists: false } });
  if (filter.hasEmail === true) and.push({ "emails.0": { $exists: true } });
  if (filter.hasEmail === false) and.push({ "emails.0": { $exists: false } });

  if (filter.whatsapp?.length) and.push({ whatsappStatus: { $in: filter.whatsapp } });
  if (filter.phoneState?.length) and.push(arrayStateClause("phones", filter.phoneState, ctx));
  if (filter.emailState?.length) and.push(arrayStateClause("emails", filter.emailState, ctx));
  if (filter.websiteState?.length) and.push(websiteStateClause(filter.websiteState, ctx));
  if (filter.source?.length) and.push({ sources: { $in: filter.source } });

  const suppression = filter.suppression ?? "exclude";
  if (suppression === "exclude") and.push({ "flags.suppressed": false });
  if (suppression === "only") and.push({ "flags.suppressed": true });

  if (filter.importId) and.push({ importIds: new ObjectId(filter.importId) });
  if (filter.updatedAfter) and.push({ updatedAt: { $gte: new Date(filter.updatedAfter) } });
  // Score ranges are numeric comparisons, so unscored businesses (score null) never match.
  const range = (min: number | undefined, max: number | undefined): Document | null =>
    min === undefined && max === undefined
      ? null
      : {
          ...(min !== undefined ? { $gte: min } : {}),
          ...(max !== undefined ? { $lte: max } : {}),
        };
  const fit = range(filter.fitMin, filter.fitMax);
  if (fit) and.push({ "score.fit": fit });
  const confidence = range(filter.dataConfidenceMin, filter.dataConfidenceMax);
  if (confidence) and.push({ "score.dataConfidence": confidence });

  return and.length === 1 ? and[0]! : { $and: and };
}
