import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import type { ServerEnv } from "@leadforge/contracts";
import {
  ENV,
  MetricsService,
  metricsAccessAllowed,
  OpsMetricsCollector,
  Public,
} from "@leadforge/core";

/**
 * Prometheus scrape endpoint, `GET /metrics` (outside the /api/v1 prefix, so the web app's /api
 * rewrite never exposes it). With METRICS_TOKEN set it needs `Authorization: Bearer <token>`;
 * without one it answers loopback callers only, and never in production. Anyone else gets a
 * plain 404. See docs/OPERATIONS.md, "Monitoring".
 */
@ApiExcludeController()
@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly metrics: MetricsService,
    // Registers the platform gauges on this registry (queue depth, billing, credits, jobs, Overture).
    private readonly _ops: OpsMetricsCollector,
  ) {}

  @Get()
  @Public()
  @SkipThrottle()
  async scrape(@Res() res: Response): Promise<void> {
    const req = res.req;
    const allowed = metricsAccessAllowed(
      { authorization: req.headers.authorization, remoteAddress: req.socket.remoteAddress },
      this.env,
    );
    if (!allowed) {
      res
        .status(404)
        .json({
          error: {
            code: "NOT_FOUND",
            message: "Not found",
            requestId: String((req as { id?: unknown }).id ?? "unknown"),
          },
        });
      return;
    }
    const { contentType, body } = await this.metrics.render();
    res.setHeader("Content-Type", contentType);
    res.status(200).send(body);
  }
}
