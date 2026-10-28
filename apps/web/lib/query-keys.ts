/**
 * TanStack Query keys for organization-scoped data. Every key starts with ["org", orgId] so an
 * organization switch (which invalidates every non-auth query) and a targeted invalidation
 * (`queryKeys.businesses.all(orgId)`) both work by prefix. Keep new screens on this factory.
 */
export const queryKeys = {
  org: (orgId: string) => ["org", orgId] as const,

  businesses: {
    all: (orgId: string) => ["org", orgId, "businesses"] as const,
    lists: (orgId: string) => ["org", orgId, "businesses", "list"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "businesses", "list", params] as const,
    facets: (orgId: string) => ["org", orgId, "businesses", "facets"] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "businesses", "detail", id] as const,
    observations: (orgId: string, id: string, filter: Record<string, unknown> = {}) =>
      ["org", orgId, "businesses", "detail", id, "observations", filter] as const,
    verificationEvents: (orgId: string, id: string) =>
      ["org", orgId, "businesses", "detail", id, "verification-events"] as const,
  },

  imports: {
    all: (orgId: string) => ["org", orgId, "imports"] as const,
    list: (orgId: string, params: Record<string, unknown> = {}) =>
      ["org", orgId, "imports", "list", params] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "imports", "detail", id] as const,
    rows: (orgId: string, id: string, params: Record<string, unknown>) =>
      ["org", orgId, "imports", "detail", id, "rows", params] as const,
  },

  sources: (orgId: string) => ["org", orgId, "sources"] as const,
  overview: (orgId: string, period: string) =>
    ["org", orgId, "reports", "overview", period] as const,

  discovery: {
    all: (orgId: string) => ["org", orgId, "discovery"] as const,
    sources: (orgId: string) => ["org", orgId, "discovery", "sources"] as const,
    categories: (orgId: string, source: string, q: string) =>
      ["org", orgId, "discovery", "categories", source, q] as const,
    locations: (orgId: string, source: string) =>
      ["org", orgId, "discovery", "locations", source] as const,
    lists: (orgId: string) => ["org", orgId, "discovery", "list"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "discovery", "list", params] as const,
    estimate: (orgId: string, spec: unknown) =>
      ["org", orgId, "discovery", "estimate", spec] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "discovery", "detail", id] as const,
    items: (orgId: string, id: string, params: Record<string, unknown>) =>
      ["org", orgId, "discovery", "items", id, params] as const,
  },

  /** All background jobs (discovery, imports, analyses, enrichment). */
  jobs: {
    all: (orgId: string) => ["org", orgId, "jobs"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "jobs", "list", params] as const,
  },

  credits: {
    all: (orgId: string) => ["org", orgId, "credits"] as const,
    balance: (orgId: string) => ["org", orgId, "credits", "balance"] as const,
    ledger: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "credits", "ledger", params] as const,
  },

  /** Website analyses (Phase 4). The business-scoped latest analysis lives under businesses. */
  analysis: {
    all: (orgId: string) => ["org", orgId, "analysis"] as const,
    lists: (orgId: string) => ["org", orgId, "analysis", "list"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "analysis", "list", params] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "analysis", "detail", id] as const,
    forBusiness: (orgId: string, businessId: string) =>
      ["org", orgId, "analysis", "business", businessId] as const,
  },

  /** Enrichment runs (website contacts, email checks). */
  enrichment: {
    all: (orgId: string) => ["org", orgId, "enrichment"] as const,
    run: (orgId: string, id: string) => ["org", orgId, "enrichment", "run", id] as const,
    forBusiness: (orgId: string, businessId: string) =>
      ["org", orgId, "enrichment", "business", businessId] as const,
  },

  /** The organization's scoring profile and recompute progress. */
  scoring: {
    all: (orgId: string) => ["org", orgId, "scoring"] as const,
    profile: (orgId: string) => ["org", orgId, "scoring", "profile"] as const,
  },

  /** Duplicate review: candidates and merge history. */
  dedup: {
    all: (orgId: string) => ["org", orgId, "dedup"] as const,
    candidates: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "dedup", "candidates", params] as const,
    candidate: (orgId: string, id: string) => ["org", orgId, "dedup", "candidate", id] as const,
    merges: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "dedup", "merges", params] as const,
  },

  /** Organization members (the Team page, assignee pickers and name lookups share this key). */
  members: (orgId: string) => ["org", orgId, "members"] as const,

  /** Lead lists and their items (Phase 5). */
  lists: {
    all: (orgId: string) => ["org", orgId, "lists"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "lists", "list", params] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "lists", "detail", id] as const,
    items: (orgId: string, id: string, params: Record<string, unknown>) =>
      ["org", orgId, "lists", "detail", id, "items", params] as const,
  },

  /** Pipeline configuration, the board, its column pages and single leads (Phase 5). */
  pipeline: {
    all: (orgId: string) => ["org", orgId, "pipeline"] as const,
    config: (orgId: string) => ["org", orgId, "pipeline", "config"] as const,
    boards: (orgId: string) => ["org", orgId, "pipeline", "board"] as const,
    board: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "pipeline", "board", params] as const,
    column: (orgId: string, stage: string, params: Record<string, unknown>) =>
      ["org", orgId, "pipeline", "column", stage, params] as const,
    leads: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "pipeline", "leads", params] as const,
  },

  /** Activities and outreach records (Phase 5). */
  activities: {
    all: (orgId: string) => ["org", orgId, "activities"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "activities", "list", params] as const,
  },
  outreach: {
    all: (orgId: string) => ["org", orgId, "outreach"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "outreach", "list", params] as const,
  },

  /** Bulk operations and their per-business results (Phase 5). */
  bulk: {
    all: (orgId: string) => ["org", orgId, "bulk"] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "bulk", "detail", id] as const,
    items: (orgId: string, id: string, params: Record<string, unknown>) =>
      ["org", orgId, "bulk", "items", id, params] as const,
  },

  /** Asynchronous export jobs (Phase 5). */
  exports: {
    all: (orgId: string) => ["org", orgId, "exports"] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "exports", "detail", id] as const,
  },

  /** Reports (Phase 5). Lives under "reports" with the overview, so business writes refresh both. */
  report: (orgId: string, name: string, period: string) =>
    ["org", orgId, "reports", name, period] as const,
  usage: (orgId: string, period: string) => ["org", orgId, "usage", period] as const,

  /** Billing (Phase 6): overview, catalogue, payments, invoices and the shell banners. */
  billing: {
    all: (orgId: string) => ["org", orgId, "billing"] as const,
    overview: (orgId: string) => ["org", orgId, "billing", "overview"] as const,
    plans: (orgId: string) => ["org", orgId, "billing", "plans"] as const,
    banners: (orgId: string) => ["org", orgId, "billing", "banners"] as const,
    payments: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "billing", "payments", params] as const,
    payment: (orgId: string, reference: string) =>
      ["org", orgId, "billing", "payment", reference] as const,
    invoices: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "billing", "invoices", params] as const,
  },

  /** Stage 10: the organization profile (deletion state) and the organization data exports. */
  orgProfile: (orgId: string) => ["org", orgId, "profile"] as const,
  orgExports: {
    all: (orgId: string) => ["org", orgId, "org-exports"] as const,
    list: (orgId: string) => ["org", orgId, "org-exports", "list"] as const,
    detail: (orgId: string, id: string) => ["org", orgId, "org-exports", "detail", id] as const,
  },

  /** The signed-in user's own notifications in this organization. */
  notifications: {
    all: (orgId: string) => ["org", orgId, "notifications"] as const,
    unreadCount: (orgId: string) => ["org", orgId, "notifications", "unread-count"] as const,
    list: (orgId: string, params: Record<string, unknown>) =>
      ["org", orgId, "notifications", "list", params] as const,
    preferences: (orgId: string) => ["org", orgId, "notifications", "preferences"] as const,
  },
};
