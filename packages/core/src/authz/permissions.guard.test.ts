import { describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { ROLE_PERMISSIONS } from "@leadforge/contracts";
import { PermissionsGuard } from "./permissions.guard.js";
import { PAUSED_DURING_DELETION_KEY, REQUIRED_PERMISSION_KEY } from "./decorators.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
import { pendingDeletionError } from "../organizations/organizations.service.js";
import { IS_PUBLIC_KEY } from "../auth/decorators.js";

function ctx(
  metadata: Record<string, unknown>,
  org?: { role: "owner" | "analyst" },
): ExecutionContext {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(metadata)) Reflect.defineMetadata(k, v, handler);
  class Ctrl {}
  const req = org
    ? { org: { organizationId: "o", role: org.role, permissions: ROLE_PERMISSIONS[org.role] } }
    : {};
  return {
    getHandler: () => handler,
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("PermissionsGuard", () => {
  let pending = false;
  const organizations = {
    assertNotPendingDeletion: async () => {
      if (pending) throw pendingDeletionError(new Date("2026-11-11T09:00:00.000Z"));
    },
  } as unknown as OrganizationsService;
  const guard = new PermissionsGuard(new Reflector(), organizations);

  it("allows public routes", () => {
    expect(guard.canActivate(ctx({ [IS_PUBLIC_KEY]: true }))).toBe(true);
  });

  it("fails closed when a scoped route declares no permission", () => {
    expect(() => guard.canActivate(ctx({}, { role: "owner" }))).toThrow(/permission/);
  });

  it("checks the role permission matrix", () => {
    expect(
      guard.canActivate(ctx({ [REQUIRED_PERMISSION_KEY]: "members:manage" }, { role: "owner" })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(ctx({ [REQUIRED_PERMISSION_KEY]: "members:manage" }, { role: "analyst" })),
    ).toThrow();
    expect(
      guard.canActivate(ctx({ [REQUIRED_PERMISSION_KEY]: "businesses:read" }, { role: "analyst" })),
    ).toBe(true);
  });

  it("accepts any one of several permissions", () => {
    expect(
      guard.canActivate(
        ctx(
          { [REQUIRED_PERMISSION_KEY]: ["exports:create", "exports:create_assigned"] },
          { role: "analyst" },
        ),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx({ [REQUIRED_PERMISSION_KEY]: ["leads:assign", "pipeline:write"] }, { role: "analyst" }),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(ctx({ [REQUIRED_PERMISSION_KEY]: [] }, { role: "owner" })),
    ).toThrow();
  });

  it("refuses paused routes while the organization is scheduled for deletion (Stage 10)", async () => {
    const paused = {
      [REQUIRED_PERMISSION_KEY]: "discovery:run",
      [PAUSED_DURING_DELETION_KEY]: true,
    };
    pending = false;
    await expect(guard.canActivate(ctx(paused, { role: "owner" }))).resolves.toBe(true);
    pending = true;
    await expect(
      Promise.resolve(guard.canActivate(ctx(paused, { role: "owner" }))),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_PENDING_DELETION",
      status: 409,
      details: [{ path: "purgeAfter", message: "2026-11-11T09:00:00.000Z" }],
    });
    // The permission is still checked first; unmarked routes never ask.
    expect(() => guard.canActivate(ctx(paused, { role: "analyst" }))).toThrow(/permission/);
    expect(
      guard.canActivate(ctx({ [REQUIRED_PERMISSION_KEY]: "businesses:read" }, { role: "owner" })),
    ).toBe(true);
    pending = false;
  });
});
