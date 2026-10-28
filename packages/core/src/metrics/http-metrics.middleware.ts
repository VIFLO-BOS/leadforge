import type { NextFunction, Request, Response } from "express";
import type { MetricsService } from "./metrics.service.js";

/**
 * Times every request and records it under its route template (`/api/v1/businesses/:id`), never
 * the raw URL, so ids and query strings do not explode the label set. Requests that match no
 * route are recorded as `unmatched`; the metrics endpoint itself is skipped.
 */
export function httpMetricsMiddleware(
  metrics: MetricsService,
  options: { skipPaths?: string[] } = {},
) {
  const skip = new Set(options.skipPaths ?? []);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (skip.has(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const routePath = (req.route as { path?: unknown } | undefined)?.path;
      const route = typeof routePath === "string" ? `${req.baseUrl}${routePath}` : "unmatched";
      metrics.observeHttp(req.method, route, res.statusCode, seconds);
    });
    next();
  };
}
