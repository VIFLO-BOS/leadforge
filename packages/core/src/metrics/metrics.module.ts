import { Global, Module, type DynamicModule } from "@nestjs/common";
import { QueueService } from "../queue/queue.service.js";
import { MetricsService, type MetricsServiceName } from "./metrics.service.js";
import { OpsMetricsCollector } from "./ops-metrics.collector.js";
import { OpsMetricsRepository } from "./repositories/ops-metrics.repository.js";

/**
 * Prometheus metrics. `forRoot("api")` also registers the platform gauges (queue depth,
 * billing, credits, reconciliation, Overture sync) that the API computes on scrape;
 * `forRoot("worker")` exports job and reconciliation counters only.
 */
@Global()
@Module({})
export class MetricsModule {
  static forRoot(service: MetricsServiceName): DynamicModule {
    const providers = [
      { provide: MetricsService, useFactory: () => new MetricsService(service) },
      OpsMetricsRepository,
      ...(service === "api"
        ? [
            {
              provide: OpsMetricsCollector,
              inject: [MetricsService, OpsMetricsRepository, QueueService],
              useFactory: (m: MetricsService, r: OpsMetricsRepository, q: QueueService) =>
                new OpsMetricsCollector(m, r, q),
            },
          ]
        : []),
    ];
    return {
      module: MetricsModule,
      providers,
      exports: [MetricsService, ...(service === "api" ? [OpsMetricsCollector] : [])],
    };
  }
}
