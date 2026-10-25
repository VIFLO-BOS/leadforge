import { z } from "zod";

export const OrganizationRole = z.enum(["owner", "admin", "researcher", "sales_rep", "analyst"]);
export type OrganizationRole = z.infer<typeof OrganizationRole>;

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  researcher: "Researcher",
  sales_rep: "Sales Representative",
  analyst: "Read-only Analyst",
};

/**
 * Permission keys. The backend enforces these on every request; the frontend only
 * uses them to hide controls. See docs/SECURITY_AND_DATA_COLLECTION.md section 2.
 */
export const Permission = z.enum([
  "businesses:read",
  "businesses:write",
  "discovery:run",
  "dedup:write",
  "lists:manage",
  "lists:manage_own",
  "pipeline:write",
  "leads:assign",
  "exports:create",
  "exports:create_assigned",
  "settings:scoring",
  "settings:pipeline",
  "settings:sources",
  "members:manage",
  "members:manage_owners",
  "billing:manage",
  "organization:settings",
  "organization:delete",
  "audit:read",
]);
export type Permission = z.infer<typeof Permission>;

const ALL_READ: Permission[] = ["businesses:read"];

export const ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  owner: Permission.options,
  admin: Permission.options.filter(
    (p) =>
      p !== "members:manage_owners" && p !== "organization:settings" && p !== "organization:delete",
  ),
  researcher: [
    ...ALL_READ,
    "businesses:write",
    "discovery:run",
    "dedup:write",
    "lists:manage",
    "leads:assign",
    "exports:create",
  ],
  sales_rep: [...ALL_READ, "lists:manage_own", "pipeline:write", "exports:create_assigned"],
  analyst: [...ALL_READ, "exports:create"],
};

export function roleHasPermission(role: OrganizationRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles that a given role may assign to others. */
export function assignableRoles(actor: OrganizationRole): OrganizationRole[] {
  if (actor === "owner") return OrganizationRole.options;
  if (actor === "admin") return OrganizationRole.options.filter((r) => r !== "owner");
  return [];
}
