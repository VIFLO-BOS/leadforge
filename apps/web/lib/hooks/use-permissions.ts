"use client";

import { roleHasPermission, type Permission } from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";

/**
 * UI permission gate for the active organization. It only decides which controls to show; the
 * API enforces every permission and answers 403 FORBIDDEN, which screens must still handle.
 */
export function usePermissions() {
  const { org } = useWorkspace();
  const can = (permission: Permission) => roleHasPermission(org.role, permission);
  const exportAll = can("exports:create");
  const exportAssigned = can("exports:create_assigned");
  return {
    role: org.role,
    can,
    /** Create, correct, suppress and import businesses (owner, admin, researcher). */
    canWriteBusinesses: can("businesses:write"),
    /**
     * Exports (Phase 5: asynchronous ZIP exports). Owners, admins, researchers and analysts export
     * everything; sales representatives export only businesses whose lead is assigned to them.
     */
    canExport: exportAll || exportAssigned,
    /** Sales representatives: exports contain only their assigned leads (`scope: "assigned"`). */
    exportsAssignedOnly: !exportAll && exportAssigned,
    /** Website analysis, website-contacts enrichment, email checks and refresh (owner, admin, researcher). */
    canRunAnalysis: can("analysis:run"),
    /** Merge, reject and defer duplicate candidates; undo merges (owner, admin, researcher). */
    canWriteDedup: can("dedup:write"),
    /** Edit scoring weights and the ideal customer profile (owner, admin). */
    canEditScoring: can("settings:scoring"),
    /** Move stages, edit leads, log activities and outreach (owner, admin, sales rep; reps on their own leads). */
    canWorkLeads: can("pipeline:write"),
    /** Assign leads (owner, admin, researcher). */
    canAssignLeads: can("leads:assign"),
    /** Create and manage lead lists: every list (owner, admin, researcher) or the rep's own. */
    canManageLists: can("lists:manage") || can("lists:manage_own"),
    canManageAllLists: can("lists:manage"),
  };
}
