import { describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { ROLE_PERMISSIONS } from "@leadforge/contracts";
import { PermissionsGuard } from "./permissions.guard.js";
import { REQUIRED_PERMISSION_KEY } from "./decorators.js";
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
  const guard = new PermissionsGuard(new Reflector());

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
});
