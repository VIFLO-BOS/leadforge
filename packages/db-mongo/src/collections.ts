/** Canonical collection names. Keep in sync with docs/DATABASE_DESIGN.md. */
export const Collections = {
  businesses: "businesses",
  sourceObservations: "source_observations",
  verificationEvents: "verification_events",
  discoveryJobs: "discovery_jobs",
  discoveryJobItems: "discovery_job_items",
  enrichmentRuns: "enrichment_runs",
  websiteAnalyses: "website_analyses",
  scoringProfiles: "scoring_profiles",
  duplicateCandidates: "duplicate_candidates",
  mergeHistory: "merge_history",
  leadLists: "lead_lists",
  leadListItems: "lead_list_items",
  leads: "leads",
  pipelineConfigs: "pipeline_configs",
  leadActivities: "lead_activities",
  exportJobs: "export_jobs",
  suppressionEntries: "suppression_entries",
  sourceConfigs: "source_configs",
  notifications: "notifications",
  auditEvents: "audit_events",
} as const;

export type CollectionName = (typeof Collections)[keyof typeof Collections];
