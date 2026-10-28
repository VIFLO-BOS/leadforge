import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import {
  assertRoutePolicies,
  assignRequestId,
  crossSiteRequestGuard,
  ENV,
  httpMetricsMiddleware,
  MetricsService,
  securityHeaders,
} from "@leadforge/core";
import { AppModule } from "./app.module.js";

export const API_PREFIX = "api/v1";

/** Builds the HTTP app exactly as production runs it. Tests reuse this. */
export async function createApp(
  envSource: NodeJS.ProcessEnv = process.env,
): Promise<INestApplication> {
  // The API signs access tokens, so it needs the private key (the worker deliberately does not).
  if (!envSource.JWT_PRIVATE_KEY?.trim()) {
    throw new Error(
      "Invalid environment configuration:\n  JWT_PRIVATE_KEY: Required by the API. Run pnpm gen:keys",
    );
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(envSource), {
    bufferLogs: true,
    // Keeps the exact request bytes on req.rawBody next to the parsed JSON: payment webhooks are
    // signed over the raw body (HMAC-SHA512), which re-serialized JSON would not match.
    rawBody: true,
  });
  const env = app.get<ServerEnv>(ENV);

  app.useLogger(app.get(Logger));
  // Client addresses come from the socket plus exactly TRUST_PROXY_HOPS proxy hops of
  // X-Forwarded-For; anything further left is client-supplied (docs/DEPLOYMENT.md).
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");
  app.use(assignRequestId());
  app.use(httpMetricsMiddleware(app.get(MetricsService), { skipPaths: ["/metrics"] }));
  app.use(securityHeaders({ hsts: env.NODE_ENV === "production", htmlPrefixes: ["/api/docs"] }));
  app.use(
    crossSiteRequestGuard({
      allowedOrigins: [env.APP_URL, env.API_URL],
      // Server-to-server: payment providers send no browser headers, and the signature is the control.
      exemptPrefixes: [`/${API_PREFIX}/webhooks/`],
    }),
  );
  app.use(cookieParser());
  // /metrics stays outside /api/v1, so the web app's /api rewrite never exposes it.
  app.setGlobalPrefix(API_PREFIX, { exclude: ["metrics"] });
  app.enableCors({
    origin: [env.APP_URL],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
      "X-Organization-Id",
      "X-Request-Id",
      "Idempotency-Key",
    ],
    exposedHeaders: ["X-Request-Id", "Retry-After", "Content-Disposition", "X-Export-Row-Count"],
  });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== "production") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("LeadForge API")
        .setDescription(
          "Versioned REST API. All responses use the { data } envelope; errors use { error }.",
        )
        .setVersion("1")
        .addCookieAuth("lf_access")
        .build(),
    );
    SwaggerModule.setup("api/docs", app, document, { useGlobalPrefix: false });
  }

  await app.init();
  assertRoutePolicies(app);
  return app;
}
