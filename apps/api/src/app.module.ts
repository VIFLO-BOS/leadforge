import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import {
  AppExceptionFilter,
  AuthGuard,
  AuthModule,
  AuthzModule,
  CoreModule,
  CsrfGuard,
  OrgScopeGuard,
  PermissionsGuard,
  PublicModule,
  ThrottlingModule,
  TrackedThrottlerGuard,
} from "@leadforge/core";
import { EnvelopeInterceptor } from "./common/envelope.interceptor.js";
import { HealthController } from "./controllers/health.controller.js";
import { AuthController } from "./controllers/auth.controller.js";
import { OrganizationsController } from "./controllers/organizations.controller.js";
import { InvitationsController } from "./controllers/invitations.controller.js";
import { PublicController } from "./controllers/public.controller.js";

@Module({})
export class AppModule {
  static forRoot(envSource: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(envSource),
        ThrottlingModule,
        AuthModule,
        AuthzModule,
        PublicModule,
      ],
      controllers: [
        HealthController,
        AuthController,
        OrganizationsController,
        InvitationsController,
        PublicController,
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
