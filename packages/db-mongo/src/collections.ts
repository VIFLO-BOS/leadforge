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
  /** Phase 5: one outreach record per business and channel. */
  outreachRecords: "outreach_records",
  /** Phase 5: bulk operations and their per-business results. */
  bulkOperations: "bulk_operations",
  bulkOperationItems: "bulk_operation_items",
  exportJobs: "export_jobs",
  /** Stage 10: whole-organization data exports (owner only), built by the worker. */
  organizationDataExports: "organization_data_exports",
  importJobs: "import_jobs",
  importRows: "import_rows",
  suppressionEntries: "suppression_entries",
  sourceConfigs: "source_configs",
  notifications: "notifications",
  auditEvents: "audit_events",
  /** Platform-level reference data (not organization-scoped): Overture Maps Places staging catalogue. */
  overturePlaces: "overture_places",
  /** Platform-level: one record per Overture sync attempt. */
  overtureSyncRuns: "overture_sync_runs",
} as const;

export type CollectionName = (typeof Collections)[keyof typeof Collections];
