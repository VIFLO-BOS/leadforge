import { Module, type DynamicModule } from "@nestjs/common";
import {
  BillingModule,
  CoreModule,
  CrmModule,
  DedupModule,
  DiscoveryModule,
  EnrichmentModule,
  ExportsModule,
  ImportsModule,
  MetricsModule,
  OrganizationLifecycleModule,
  OvertureModule,
  RetentionModule,
  ScoringModule,
  UsageModule,
  WebsiteAnalysisModule,
} from "@leadforge/core";
import { WorkerRuntime } from "./worker.runtime.js";
import { WorkerMetricsServer } from "./metrics.server.js";
import { OvertureSyncRunner } from "./overture/overture-sync.runner.js";
import { MailProcessor } from "./processors/mail.processor.js";
import { ImportProcessor } from "./processors/import.processor.js";
import { DiscoveryProcessor } from "./processors/discovery.processor.js";
import { BillingProcessor } from "./processors/billing.processor.js";
import { MaintenanceProcessor } from "./processors/maintenance.processor.js";
import { AnalysisProcessor } from "./processors/analysis.processor.js";
import { EnrichmentProcessor } from "./processors/enrichment.processor.js";
import { ScoringProcessor } from "./processors/scoring.processor.js";
import { DedupProcessor } from "./processors/dedup.processor.js";
import { ExportProcessor } from "./processors/export.processor.js";
import { BulkProcessor } from "./processors/bulk.processor.js";

@Module({})
export class WorkerModule {
  static forRoot(envSource: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        CoreModule.forRoot(envSource),
        MetricsModule.forRoot("worker"),
        ImportsModule,
        DiscoveryModule,
        RetentionModule,
        WebsiteAnalysisModule,
        EnrichmentModule,
        ScoringModule,
        DedupModule,
        OvertureModule,
        CrmModule,
        ExportsModule,
        UsageModule,
        BillingModule,
        OrganizationLifecycleModule,
      ],
      providers: [
        MailProcessor,
        ImportProcessor,
        DiscoveryProcessor,
        BillingProcessor,
        MaintenanceProcessor,
        AnalysisProcessor,
        EnrichmentProcessor,
        ScoringProcessor,
        DedupProcessor,
        ExportProcessor,
        BulkProcessor,
        OvertureSyncRunner,
        WorkerRuntime,
        WorkerMetricsServer,
      ],
    };
  }
}
