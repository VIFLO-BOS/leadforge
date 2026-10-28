import type {
  FieldState,
  ImportField,
  ImportIssueCode,
  ImportStatus,
  JobKind,
  LedgerEntryType,
  NotificationType,
  ObservationField,
  SourceKey,
  SourceStatus,
  WhatsAppStatus,
} from "@leadforge/contracts";
import type { JobState, StatusTone } from "@leadforge/ui";

/**
 * Display names for provenance sources. Keys come from the API; never invent new ones. Partial on
 * purpose: a source the backend adds later (for example a new discovery source) renders with a
 * readable fallback instead of breaking the build; discovery screens use the API's own `name`.
 */
export const SOURCE_LABELS: Partial<Record<SourceKey, string>> = {
  overture_places: "Overture Maps Places",
  google_places: "Google Places",
  website: "Business website",
  user_import: "CSV import",
  user_edit: "Manual entry or correction",
};

/** Compact names for dense places (table cells, cards). */
export const SOURCE_SHORT_LABELS: Partial<Record<SourceKey, string>> = {
  overture_places: "Overture",
  google_places: "Google Places",
  website: "Website",
  user_import: "CSV import",
  user_edit: "Manual",
};

/** "overture_places" to "Overture places" for keys this build has no label for. */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function sourceLabel(key: string, short = false): string {
  return (short ? SOURCE_SHORT_LABELS : SOURCE_LABELS)[key as SourceKey] ?? humanizeKey(key);
}

/** WhatsApp has three values only. There is no "probably". */
export const WHATSAPP_LABELS: Record<WhatsAppStatus, string> = {
  confirmed: "Confirmed",
  user_asserted: "Team-asserted",
  unknown: "Unknown",
};

export const WHATSAPP_DESCRIPTIONS: Record<WhatsAppStatus, string> = {
  confirmed: "Explicit evidence, such as a wa.me link on the business's own website.",
  user_asserted: "A team member said this number uses WhatsApp. Not independently confirmed.",
  unknown: "No evidence either way.",
};

export const FIELD_LABELS: Record<ObservationField, string> = {
  name: "Name",
  website: "Website",
  phone: "Phone",
  email: "Email",
  social: "Social profile",
  category: "Category",
  location: "Location",
  whatsapp: "WhatsApp",
  hours: "Opening hours",
  description: "Description",
};

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Business name",
  category: "Category",
  website: "Website",
  phone: "Phone",
  email: "Email",
  whatsapp: "WhatsApp",
  street: "Street address",
  locality: "City or town",
  lga: "LGA",
  region: "State or region",
  country: "Country",
  postalCode: "Postal code",
};

export const IMPORT_ISSUE_LABELS: Record<ImportIssueCode, string> = {
  REQUIRED: "Required value missing",
  CELL_TOO_LONG: "Value too long",
  FORMULA_INJECTION: "Spreadsheet formula",
  INVALID_PHONE: "Invalid phone",
  INVALID_EMAIL: "Invalid email",
  INVALID_WEBSITE: "Invalid website",
  INVALID_COUNTRY: "Invalid country",
  COLUMN_COUNT_MISMATCH: "Wrong number of cells",
  TOO_MANY_VALUES: "Too many values",
  POSSIBLE_DUPLICATE: "Possible duplicate",
  SOCIAL_PROFILE: "Social profile",
  SUPPRESSED: "Suppressed",
};

/** Import statuses rendered with the shared JobStatus states. */
export function importJobState(status: ImportStatus): JobState {
  switch (status) {
    case "uploaded":
    case "queued":
      return "queued";
    case "processing":
      return "running";
    case "completed":
      return "completed";
    case "completed_with_errors":
      return "completed_with_warnings";
    case "failed":
      return "failed";
  }
}

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  uploaded: "Waiting for mapping",
  queued: "Queued",
  processing: "Importing",
  completed: "Completed",
  completed_with_errors: "Completed with failed rows",
  failed: "Failed",
};

export const SOURCE_STATUS_META: Record<SourceStatus, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "success" },
  configured: { label: "Configured", tone: "info" },
  not_configured: { label: "Not configured", tone: "warning" },
  not_available: { label: "Not available yet", tone: "neutral" },
};

/** Field-state options a directory filter can ask for, per field. */
export const FIELD_FILTER_STATES: Record<"website" | "phone" | "email", FieldState[]> = {
  website: ["verified", "unverified", "stale", "conflicting", "expired"],
  phone: ["verified", "unverified", "stale", "expired"],
  email: ["verified", "unverified", "stale", "expired"],
};

/** Background job kinds on the all-jobs page. Partial so a kind added later still renders. */
const JOB_KIND_LABELS: Partial<Record<JobKind, string>> = {
  discovery: "Discovery",
  import: "CSV import",
  analysis: "Website analysis",
  enrichment: "Enrichment",
  export: "Export",
  bulk: "Bulk operation",
};

/**
 * What a notification is about, read before its title ("Assigned to you: …"). Partial with a
 * fallback from the type's suffix, so a type added later still reads sensibly.
 */
const NOTIFICATION_TYPE_LABELS: Partial<Record<NotificationType, string>> = {
  "discovery.completed": "Discovery finished",
  "discovery.completed_with_warnings": "Discovery finished with problems",
  "discovery.failed": "Discovery failed",
  "import.completed": "Import finished",
  "import.completed_with_errors": "Import finished with failed rows",
  "import.failed": "Import failed",
  "analysis.bulk_completed": "Website analyses finished",
  "lead.assigned": "Assigned to you",
  "bulk.completed": "Bulk operation finished",
  "bulk.completed_with_errors": "Bulk operation finished with errors",
  "bulk.failed": "Bulk operation failed",
  "export.completed": "Export ready",
  "export.failed": "Export failed",
  "billing.payment_succeeded": "Payment received",
  "billing.payment_failed": "Payment failed",
  "billing.subscription_changed": "Subscription changed",
  "billing.refund_updated": "Refund update",
  "billing.attention": "Billing needs attention",
  "organization.deletion_requested": "Organization scheduled for deletion",
  "organization.deletion_cancelled": "Organization deletion cancelled",
  "organization.export_completed": "Organization export ready",
  "organization.export_failed": "Organization export failed",
};

export function notificationTypeLabel(type: string): string | null {
  return NOTIFICATION_TYPE_LABELS[type as NotificationType] ?? null;
}

export function jobKindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind as JobKind] ?? humanizeKey(kind);
}

/** Normalized job statuses as shared JobStatus states (the two sets are identical). */
export function jobState(status: string): JobState {
  const known: JobState[] = [
    "draft",
    "queued",
    "running",
    "completed",
    "completed_with_warnings",
    "failed",
    "cancelled",
  ];
  return known.includes(status as JobState) ? (status as JobState) : "queued";
}

export const LEDGER_ENTRY_META: Record<
  LedgerEntryType,
  { label: string; tone: StatusTone; description: string }
> = {
  grant: {
    label: "Grant",
    tone: "success",
    description:
      "Credits added without buying a pack: a plan's credits for a paid period, or a setup grant.",
  },
  purchase: { label: "Purchase", tone: "success", description: "Credits bought as a credit pack." },
  hold: {
    label: "Hold",
    tone: "info",
    description: "Reserved when a job was queued; captured or released when it settles.",
  },
  capture: {
    label: "Capture",
    tone: "neutral",
    description: "Charged from a hold for the records a job produced.",
  },
  release: {
    label: "Release",
    tone: "success",
    description: "The unused part of a hold returned to the balance.",
  },
  adjustment: { label: "Adjustment", tone: "warning", description: "A manual correction." },
  refund_reversal: {
    label: "Refund reversal",
    tone: "destructive",
    description:
      "Credits taken back, in proportion, after a payment was refunded or reversed. The balance can go below zero.",
  },
  expiry: { label: "Expiry", tone: "neutral", description: "Credits that expired unused." },
};
