import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  OrganizationRole,
  Permission,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from "./roles.js";

describe("role permission matrix", () => {
  it("gives owners every permission", () => {
    for (const p of Permission.options) expect(roleHasPermission("owner", p)).toBe(true);
  });

  it("denies admins owner-only permissions", () => {
    expect(roleHasPermission("admin", "members:manage_owners")).toBe(false);
    expect(roleHasPermission("admin", "organization:settings")).toBe(false);
    expect(roleHasPermission("admin", "organization:delete")).toBe(false);
    expect(roleHasPermission("admin", "billing:manage")).toBe(true);
  });

  it("keeps sales reps out of discovery and dedup", () => {
    expect(roleHasPermission("sales_rep", "discovery:run")).toBe(false);
    expect(roleHasPermission("sales_rep", "dedup:write")).toBe(false);
    expect(roleHasPermission("sales_rep", "pipeline:write")).toBe(true);
  });

  it("keeps analysts read-only except exports", () => {
    const perms = ROLE_PERMISSIONS.analyst;
    expect(perms).toEqual(["businesses:read", "exports:create"]);
  });

  it("every role can read businesses", () => {
    for (const role of OrganizationRole.options) {
      expect(roleHasPermission(role, "businesses:read")).toBe(true);
    }
  });

  it("only owners can assign the owner role", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("researcher")).toEqual([]);
  });
});
