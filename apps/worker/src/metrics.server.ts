import http from "node:http";
import type { AddressInfo } from "node:net";
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV, MetricsService, metricsAccessAllowed } from "@leadforge/core";

/**
 * The worker's Prometheus endpoint: a bare HTTP server (the worker has no Nest HTTP app) on
 * WORKER_METRICS_HOST:WORKER_METRICS_PORT (default 127.0.0.1:9464, internal only), serving
 * `GET /metrics`. With METRICS_TOKEN set it needs `Authorization: Bearer <token>`; without one,
 * loopback callers only. WORKER_METRICS_PORT=0 turns it off.
 */
@Injectable()
export class WorkerMetricsServer implements OnModuleInit, OnApplicationShutdown {
  private server: http.Server | null = null;

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly metrics: MetricsService,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.WORKER_METRICS_PORT === 0) return;
    const server = http.createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const allowed =
        req.method === "GET" &&
        path === "/metrics" &&
        metricsAccessAllowed(
          { authorization: req.headers.authorization, remoteAddress: req.socket.remoteAddress },
          this.env,
        );
      if (!allowed) {
        res
          .writeHead(404, { "content-type": "text/plain", "x-content-type-options": "nosniff" })
          .end("Not found");
        return;
      }
      this.metrics
        .render()
        .then(({ contentType, body }) =>
          res
            .writeHead(200, { "content-type": contentType, "cache-control": "no-store" })
            .end(body),
        )
        .catch(() =>
          res.writeHead(500, { "content-type": "text/plain" }).end("Metrics unavailable"),
        );
    });
    server.requestTimeout = 10_000;
    await new Promise<void>((resolve) => {
      server.once("error", (err) => {
        // A busy port must not stop job processing: log it and run without metrics.
        this.logger.error(
          { err, port: this.env.WORKER_METRICS_PORT },
          "Worker metrics server could not start",
        );
        resolve();
      });
      server.listen(this.env.WORKER_METRICS_PORT, this.env.WORKER_METRICS_HOST, () => {
        const address = server.address() as AddressInfo;
        this.server = server;
        this.logger.log(
          { host: address.address, port: address.port },
          "Worker metrics listening on /metrics",
        );
        resolve();
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
