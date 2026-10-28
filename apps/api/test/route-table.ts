import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { RequestMethod, type INestApplication } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import type { Permission } from "@leadforge/contracts";
import {
  AUTH_ONLY_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSION_KEY,
  SKIP_CSRF_KEY,
} from "@leadforge/core";

export interface DiscoveredRoute {
  /** `GET /api/v1/businesses/:id` */
  key: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  policy: "public" | "auth" | Permission | Permission[];
  skipCsrf: boolean;
}

const METHODS: Partial<Record<RequestMethod, DiscoveredRoute["method"]>> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
};

/** Paths outside the /api/v1 prefix (bootstrap.ts `exclude`). */
const UNPREFIXED = new Set(["metrics"]);

function join(...parts: string[]): string {
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `/${joined}`;
}

/**
 * Every HTTP route the running app serves, read from Nest's controller metadata (the same source
 * the router and the boot-time policy check use), with its declared access policy.
 */
export function discoverRoutes(app: INestApplication, prefix = "api/v1"): DiscoveredRoute[] {
  const discovery = app.get(DiscoveryService, { strict: false });
  const reflector = app.get(Reflector, { strict: false });
  const scanner = new MetadataScanner();
  const routes: DiscoveredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = String(reflector.get<string | string[]>(PATH_METADATA, metatype) ?? "");
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== "function") continue;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (requestMethod === undefined) continue;
      const method = METHODS[requestMethod];
      if (!method) throw new Error(`Unsupported HTTP method on ${metatype.name}.${name}`);
      const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? "");
      const path = UNPREFIXED.has(base) ? join(base, sub) : join(prefix, base, sub);
      const targets = [handler as (...args: unknown[]) => unknown, metatype];
      const policy = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)
        ? "public"
        : reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, targets)
          ? "auth"
          : reflector.getAllAndOverride<Permission | Permission[]>(
              REQUIRED_PERMISSION_KEY,
              targets,
            );
      routes.push({
        key: `${method} ${path}`,
        method,
        path,
        policy,
        skipCsrf: Boolean(reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets)),
      });
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}
