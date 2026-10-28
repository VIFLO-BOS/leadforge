import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";
import {
  AppExceptionFilter,
  AuthGuard,
  AuthModule,
  AuthzModule,
  BillingModule,
  BusinessesModule,
  CoreModule,
  CreditsModule,
  CrmModule,
  CsrfGuard,
  DedupModule,
  DiscoveryModule as DiscoveryJobsModule,
  EnrichmentModule,
  ExportsModule,
  ImportsModule,
  JobsModule,
  MetricsModule,
  NotificationsModule,
  OrgScopeGuard,
  PermissionsGuard,
  OrganizationLifecycleModule,
  OrganizationsModule,
  ProvenanceModule,
  PublicModule,
  ReportsModule,
  ScoringModule,
  SourcesModule,
  ThrottlingModule,
  TrackedThrottlerGuard,
  UsageModule,
  WebsiteAnalysisModule,
} from "@leadforge/core";
import { EnvelopeInterceptor } from "./common/envelope.interceptor.js";
import { HealthController } from "./controllers/health.controller.js";
import { AuthController } from "./controllers/auth.controller.js";
import { OrganizationsController } from "./controllers/organizations.controller.js";
import { InvitationsController } from "./controllers/invitations.controller.js";
import { PublicController } from "./controllers/public.controller.js";
import { BusinessesController } from "./controllers/businesses.controller.js";
import { ImportsController } from "./controllers/imports.controller.js";
import { ExportsController } from "./controllers/exports.controller.js";
import { SourcesController } from "./controllers/sources.controller.js";
import { ReportsController } from "./controllers/reports.controller.js";
import { DiscoveryController } from "./controllers/discovery.controller.js";
import { CreditsController } from "./controllers/credits.controller.js";
import { JobsController } from "./controllers/jobs.controller.js";
import { NotificationsController } from "./controllers/notifications.controller.js";
import { AnalysisController } from "./controllers/analysis.controller.js";
import { EnrichmentController } from "./controllers/enrichment.controller.js";
import { ScoringController } from "./controllers/scoring.controller.js";
import { DedupController } from "./controllers/dedup.controller.js";
import { PipelineController } from "./controllers/pipeline.controller.js";
import { ListsController } from "./controllers/lists.controller.js";
import { ActivitiesController } from "./controllers/activities.controller.js";
import { BulkController } from "./controllers/bulk.controller.js";
import { UsageController } from "./controllers/usage.controller.js";
import { BillingController } from "./controllers/billing.controller.js";
import { WebhooksController } from "./controllers/webhooks.controller.js";
import { MetricsController } from "./controllers/metrics.controller.js";

@Module({})
export class AppModule {
  static forRoot(envSource: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(envSource),
        MetricsModule.forRoot("api"),
        DiscoveryModule,
        ThrottlingModule,
        AuthModule,
        AuthzModule,
        OrganizationsModule,
        OrganizationLifecycleModule,
        PublicModule,
        ProvenanceModule,
        BusinessesModule,
        ImportsModule,
        ExportsModule,
        SourcesModule,
        ReportsModule,
        CreditsModule,
        NotificationsModule,
        DiscoveryJobsModule,
        JobsModule,
        WebsiteAnalysisModule,
        EnrichmentModule,
        ScoringModule,
        DedupModule,
        CrmModule,
        UsageModule,
        BillingModule,
      ],
      controllers: [
        HealthController,
        AuthController,
        OrganizationsController,
        InvitationsController,
        PublicController,
        BusinessesController,
        ImportsController,
        ExportsController,
        SourcesController,
        ReportsController,
        DiscoveryController,
        CreditsController,
        JobsController,
        NotificationsController,
        AnalysisController,
        EnrichmentController,
        ScoringController,
        DedupController,
        PipelineController,
        ListsController,
        ActivitiesController,
        BulkController,
        UsageController,
        BillingController,
        WebhooksController,
        MetricsController,
      ],
      providers: [
        // Guard order matters: authenticate, then rate limit by user, then CSRF, then org scope, then permission.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: TrackedThrottlerGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: OrgScopeGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      ],
    };
  }
}
