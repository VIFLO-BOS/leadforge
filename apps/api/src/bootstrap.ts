import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import { assertRoutePolicies, ENV } from "@leadforge/core";
import { AppModule } from "./app.module.js";

export const API_PREFIX = "api/v1";

/** Builds the HTTP app exactly as production runs it. Tests reuse this. */
export async function createApp(
  envSource: NodeJS.ProcessEnv = process.env,
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(envSource), {
    bufferLogs: true,
  });
  const env = app.get<ServerEnv>(ENV);

  app.useLogger(app.get(Logger));
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
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
    exposedHeaders: ["X-Request-Id", "Retry-After"],
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
