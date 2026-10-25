import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { AUTH_ONLY_KEY, IS_PUBLIC_KEY } from "../auth/decorators.js";
import { REQUIRED_PERMISSION_KEY } from "./decorators.js";

/**
 * Boot-time check: every HTTP route must declare exactly how it is protected
 * (@Public, @AuthOnly or @RequirePermission). Missing a decorator fails startup
 * instead of silently shipping an unprotected or unreachable route.
 */
export function assertRoutePolicies(app: INestApplicationContext): void {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const violations: string[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const prototype = Object.getPrototypeOf(instance) as object;
    const basePath = reflector.get<string | string[]>(PATH_METADATA, metatype) ?? "";
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== "function") continue;
      const isRoute = Reflect.getMetadata(METHOD_METADATA, handler) !== undefined;
      if (!isRoute) continue;
      const declared =
        reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]) ||
        reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, [handler, metatype]) ||
        reflector.getAllAndOverride<string>(REQUIRED_PERMISSION_KEY, [handler, metatype]);
      if (!declared) {
        const routePath = reflector.get<string | string[]>(PATH_METADATA, handler) ?? "";
        violations.push(
          `${metatype.name}.${methodName} (${String(basePath)}/${String(routePath)})`,
        );
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Routes without an access policy (@Public, @AuthOnly or @RequirePermission):\n  ${violations.join("\n  ")}`,
    );
  }
}
